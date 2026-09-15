import yauzl from 'yauzl'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import type {
  ImportBatchCommitResult,
  ImportBatchPreview,
  ImportProblemCommitResult,
  ImportProblemPreview
} from '../../shared/types'
import { naturalCompare, normalizeTitle } from '../../shared/types'
import { Store } from '../db'
import { log } from '../log'
import {
  isJunkPath,
  LIMITS,
  pairTests,
  parseMeta,
  PackageError,
  sortPairs,
  validatePath,
  type Pair
} from './validation'

type Bucket = { names: string[]; files: Map<string, string> }
type StagedProblem = {
  slot: string
  directory: string
  valid: boolean
  issues: string[]
  title: string | null
  topic: string | null
  cppTimeLimitMs: number
  pythonTimeLimitMs: number
  javaTimeLimitMs: number
  outputComparison: 'tokens' | 'exact'
  testCount: number
  groupCount: number
  groups: { name: string; count: number }[]
  pairs: Pair[]
}
type StagedBatch = { token: string; directory: string; source: string; problems: StagedProblem[] }

function toPreview(p: StagedProblem): ImportProblemPreview {
  return {
    slot: p.slot,
    title: p.title,
    topic: p.topic,
    valid: p.valid,
    issues: p.issues,
    testCount: p.testCount,
    groupCount: p.groupCount,
    groups: p.groups,
    cppTimeLimitMs: p.valid ? p.cppTimeLimitMs : undefined,
    pythonTimeLimitMs: p.valid ? p.pythonTimeLimitMs : undefined,
    javaTimeLimitMs: p.valid ? p.javaTimeLimitMs : undefined,
    outputComparison: p.valid ? p.outputComparison : undefined
  }
}

export class Importer {
  private pending: StagedBatch | null = null
  constructor(private store: Store) {}
  async discard(token?: string): Promise<void> {
    if (!this.pending || (token && token !== this.pending.token)) return
    const item = this.pending
    this.pending = null
    await rm(item.directory, { recursive: true, force: true }).catch((e) =>
      log('Import staging cleanup failed', e)
    )
  }
  async preview(file: string): Promise<ImportBatchPreview> {
    await this.discard()
    if ((await stat(file)).size > LIMITS.zip)
      throw new PackageError([`ZIP exceeds the ${LIMITS.zip / 1024 / 1024} MB archive limit.`])
    const stagingRoot = join(this.store.root, 'staging')
    await mkdir(stagingRoot, { recursive: true })
    const directory = await mkdtemp(join(stagingRoot, 'import-'))
    try {
      const slots = new Map<string, Bucket>()
      const seenPaths = new Set<string>()
      let fileSeq = 0
      const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
        yauzl.open(
          file,
          { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: true },
          (e, z) => (e ? reject(e) : resolve(z!))
        )
      )
      await new Promise<void>((resolve, reject) => {
        let count = 0
        let total = 0
        let failed = false
        const fail = (error: unknown) => {
          if (!failed) {
            failed = true
            zip.close()
            reject(error)
          }
        }
        zip.on('error', fail)
        zip.on('end', resolve)
        zip.on('entry', (entry: yauzl.Entry) => {
          void (async () => {
            const name = entry.fileName
            validatePath(name)
            if (++count > LIMITS.entries)
              throw new PackageError([`ZIP exceeds ${LIMITS.entries.toLocaleString()} entries.`])
            total += entry.uncompressedSize
            if (total > LIMITS.total)
              throw new PackageError([
                `ZIP exceeds the ${LIMITS.total / 1024 / 1024 / 1024} GB uncompressed limit.`
              ])
            if (entry.generalPurposeBitFlag & 1)
              throw new PackageError([`Encrypted entries are unsupported: ${name}`])
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              throw new PackageError([`Unsafe non-regular archive entry: ${name}`])
            const folded = name.toLowerCase()
            if (seenPaths.has(folded)) throw new PackageError([`Duplicate archive path: ${name}`])
            seenPaths.add(folded)
            if (isJunkPath(name)) {
              if (!failed) zip.readEntry()
              return
            }
            const isDir = name.endsWith('/')
            const slashIndex = name.indexOf('/')
            if (slashIndex === -1) {
              if (name === 'problem.md' || name === 'meta.json')
                throw new PackageError([
                  'This package uses the old single-problem ZIP format. Put every problem inside its own top-level directory.'
                ])
              throw new PackageError([
                `Unexpected file at the top level of the archive: ${name}. Every problem must be inside its own top-level directory.`
              ])
            }
            const slot = name.slice(0, slashIndex)
            const relative = name.slice(slashIndex + 1)
            if (!slots.has(slot)) slots.set(slot, { names: [], files: new Map() })
            const bucket = slots.get(slot)!
            if (!isDir) {
              bucket.names.push(relative)
              const supported =
                relative === 'problem.md' ||
                relative === 'meta.json' ||
                (relative.startsWith('tests/') &&
                  (/\.(in|out)$/i.test(relative) || /\/(input|output).+\.txt$/i.test(relative)))
              const limit =
                relative === 'problem.md'
                  ? LIMITS.statement
                  : relative === 'meta.json'
                    ? LIMITS.meta
                    : LIMITS.test
              if (entry.uncompressedSize > limit)
                throw new PackageError([
                  `${name} exceeds its ${limit / 1024 / 1024} MB file limit.`
                ])
              if (supported) {
                const destination = join(directory, `${fileSeq++}.part`)
                const stream = await new Promise<import('node:stream').Readable>((res, rej) =>
                  zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s!)))
                )
                let bytes = 0
                let crc = 0
                const guard = new Transform({
                  transform(chunk: Buffer, _encoding, callback) {
                    bytes += chunk.length
                    crc = crc32(chunk, crc)
                    callback(
                      bytes > limit
                        ? new PackageError([`${name} exceeds its uncompressed size limit.`])
                        : null,
                      chunk
                    )
                  }
                })
                await pipeline(stream, guard, createWriteStream(destination, { flags: 'wx' }))
                if (crc !== entry.crc32)
                  throw new PackageError([
                    `${name} failed its ZIP checksum. The archive may be damaged.`
                  ])
                bucket.files.set(relative, destination)
              }
            }
            if (!failed) zip.readEntry()
          })().catch(fail)
        })
        zip.readEntry()
      })
      const slotNames = [...slots.keys()].sort(naturalCompare)
      const problems: StagedProblem[] = []
      const seenTitles = new Set<string>()
      let seq = 0
      for (const slot of slotNames) {
        const bucket = slots.get(slot)!
        const evaluated = await this.evaluate(bucket)
        let valid = evaluated.issues.length === 0
        let issues = evaluated.issues
        if (valid) {
          const key = normalizeTitle(evaluated.title!)
          if (seenTitles.has(key)) {
            valid = false
            issues = [
              `Duplicate of an earlier problem in this import (title "${evaluated.title}").`
            ]
          } else seenTitles.add(key)
        }
        if (valid) {
          const problemDirectory = join(directory, `p-${seq}`)
          await mkdir(join(problemDirectory, 'tests'), { recursive: true })
          await writeFile(join(problemDirectory, 'problem.md'), evaluated.statement, 'utf8')
          for (let i = 0; i < evaluated.pairs.length; i++) {
            await rename(
              bucket.files.get(evaluated.pairs[i].input)!,
              join(problemDirectory, 'tests', `${i}.in`)
            )
            await rename(
              bucket.files.get(evaluated.pairs[i].output)!,
              join(problemDirectory, 'tests', `${i}.out`)
            )
          }
          problems.push({
            slot,
            directory: problemDirectory,
            valid: true,
            issues: [],
            title: evaluated.title,
            topic: evaluated.topic,
            cppTimeLimitMs: evaluated.cppTimeLimitMs,
            pythonTimeLimitMs: evaluated.pythonTimeLimitMs,
            javaTimeLimitMs: evaluated.javaTimeLimitMs,
            outputComparison: evaluated.outputComparison,
            testCount: evaluated.pairs.length,
            groupCount: evaluated.groups.length,
            groups: evaluated.groups,
            pairs: evaluated.pairs
          })
        } else {
          problems.push({
            slot,
            directory: '',
            valid: false,
            issues,
            title: evaluated.title,
            topic: evaluated.topic,
            cppTimeLimitMs: evaluated.cppTimeLimitMs,
            pythonTimeLimitMs: evaluated.pythonTimeLimitMs,
            javaTimeLimitMs: evaluated.javaTimeLimitMs,
            outputComparison: evaluated.outputComparison,
            testCount: evaluated.pairs.length,
            groupCount: evaluated.groups.length,
            groups: evaluated.groups,
            pairs: []
          })
        }
        seq++
      }
      const token = randomUUID()
      this.pending = { token, directory, source: basename(file), problems }
      return {
        token,
        sourceName: basename(file),
        totalCount: problems.length,
        validCount: problems.filter((p) => p.valid).length,
        invalidCount: problems.filter((p) => !p.valid).length,
        problems: problems.map(toPreview)
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch((e) =>
        log('Failed import cleanup', e)
      )
      log('ZIP validation failed', error)
      throw error
    }
  }
  private async evaluate(bucket: Bucket): Promise<{
    issues: string[]
    title: string | null
    topic: string | null
    cppTimeLimitMs: number
    pythonTimeLimitMs: number
    javaTimeLimitMs: number
    outputComparison: 'tokens' | 'exact'
    statement: string
    pairs: Pair[]
    groups: { name: string; count: number }[]
  }> {
    const issues: string[] = []
    let title: string | null = null
    let topic: string | null = null
    let cppTimeLimitMs = 2000
    let pythonTimeLimitMs = 5000
    let javaTimeLimitMs = 3000
    let outputComparison: 'tokens' | 'exact' = 'tokens'
    let statement = ''
    let pairs: Pair[] = []
    const decode = async (path: string, label: string): Promise<string | null> => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))
      } catch {
        issues.push(`${label} must be readable UTF-8 text.`)
        return null
      }
    }
    const problemMdPath = bucket.files.get('problem.md')
    if (!problemMdPath) issues.push('problem.md is missing.')
    else {
      const text = await decode(problemMdPath, 'problem.md')
      if (text !== null) {
        if (!text.trim()) issues.push('problem.md is empty.')
        else statement = text
      }
    }
    const metaPath = bucket.files.get('meta.json')
    if (!metaPath) issues.push('meta.json is missing.')
    else {
      const text = await decode(metaPath, 'meta.json')
      if (text !== null) {
        try {
          const meta = parseMeta(text)
          title = meta.title
          topic = meta.topic
          cppTimeLimitMs = meta.cppTimeLimitMs
          pythonTimeLimitMs = meta.pythonTimeLimitMs
          javaTimeLimitMs = meta.javaTimeLimitMs
          outputComparison = meta.outputComparison
        } catch (e) {
          issues.push(...(e instanceof PackageError ? e.issues : [String(e)]))
        }
      }
    }
    try {
      pairs = sortPairs(pairTests(bucket.names))
    } catch (e) {
      issues.push(...(e instanceof PackageError ? e.issues : [String(e)]))
    }
    const groups = new Map<string, number>()
    pairs.forEach((p) => groups.set(p.group, (groups.get(p.group) ?? 0) + 1))
    return {
      issues,
      title,
      topic,
      cppTimeLimitMs,
      pythonTimeLimitMs,
      javaTimeLimitMs,
      outputComparison,
      statement,
      pairs,
      groups: [...groups].map(([name, count]) => ({ name, count }))
    }
  }
  async commit(token: string, folderId: string | null): Promise<ImportBatchCommitResult> {
    this.store.requireFolder(folderId)
    const batch = this.pending
    if (!batch || batch.token !== token)
      throw new Error('Import preview expired. Please choose the ZIP again.')
    this.pending = null
    const results: ImportProblemCommitResult[] = []
    for (const item of batch.problems) {
      if (!item.valid) {
        results.push({ slot: item.slot, title: item.title, ok: false, issues: item.issues })
        continue
      }
      const id = randomUUID()
      const relative = join('problems', id)
      const destination = this.store.path(relative)
      try {
        this.store.assertProblemTitleAvailable(item.title!, folderId)
        // Finalize files before committing metadata. Failed commits remove the final directory.
        await rename(item.directory, destination)
        this.store.db.transaction(() => {
          const now = new Date().toISOString()
          this.store.db
            .prepare(
              `INSERT INTO problems
                (id,title,topic,statement_path,source_zip_name,cpp_time_limit_ms,python_time_limit_ms,java_time_limit_ms,output_comparison,folder_id,created_at,updated_at,last_opened_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
              id,
              item.title,
              item.topic,
              join(relative, 'problem.md'),
              batch.source,
              item.cppTimeLimitMs,
              item.pythonTimeLimitMs,
              item.javaTimeLimitMs,
              item.outputComparison,
              folderId,
              now,
              now,
              now
            )
          const groupIds = new Map<string, string>()
          for (const group of item.groups) {
            const groupId = randomUUID()
            this.store.db
              .prepare('INSERT INTO test_groups VALUES (?,?,?,?)')
              .run(groupId, id, group.name, groupIds.size)
            groupIds.set(group.name, groupId)
          }
          item.pairs.forEach((pair, i) =>
            this.store.db
              .prepare('INSERT INTO test_cases VALUES (?,?,?,?,?,?)')
              .run(
                randomUUID(),
                groupIds.get(pair.group),
                pair.name,
                join(relative, 'tests', `${i}.in`),
                join(relative, 'tests', `${i}.out`),
                i
              )
          )
          this.store.createApproach(id, 'Main')
        })()
        log(`Imported problem ${id} (slot ${item.slot}): ${item.pairs.length} tests`)
        results.push({ slot: item.slot, title: item.title, ok: true, problemId: id, issues: [] })
      } catch (error) {
        await rm(destination, { recursive: true, force: true }).catch((e) =>
          log('Import rollback cleanup', e)
        )
        results.push({
          slot: item.slot,
          title: item.title,
          ok: false,
          issues: [error instanceof Error ? error.message : String(error)]
        })
      }
    }
    await rm(batch.directory, { recursive: true, force: true }).catch((e) =>
      log('Import staging cleanup', e)
    )
    const successCount = results.filter((r) => r.ok).length
    return {
      totalCount: results.length,
      successCount,
      failureCount: results.length - successCount,
      results
    }
  }
}
