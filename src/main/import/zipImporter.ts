import yauzl from 'yauzl'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import type { ImportPreview } from '../../shared/types'
import { Store } from '../db'
import { log } from '../log'
import { LIMITS, metadata, PackageError, pairTests, validatePath, type Pair } from './validation'

type Staged = { directory: string; preview: ImportPreview; pairs: Pair[]; source: string }
export class Importer {
  private pending: Staged | null = null
  constructor(private store: Store) {}
  async discard(token?: string): Promise<void> {
    if (!this.pending || (token && token !== this.pending.preview.token)) return
    const item = this.pending
    this.pending = null
    await rm(item.directory, { recursive: true, force: true }).catch((e) =>
      log('Import staging cleanup failed', e)
    )
  }
  async preview(file: string): Promise<ImportPreview> {
    await this.discard()
    if ((await stat(file)).size > LIMITS.zip)
      throw new PackageError(['ZIP exceeds the 128 MB archive limit.'])
    const stagingRoot = join(this.store.root, 'staging')
    await mkdir(stagingRoot, { recursive: true })
    const directory = await mkdtemp(join(stagingRoot, 'import-'))
    try {
      const files = new Map<string, string>()
      const names: string[] = []
      const seen = new Set<string>()
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
            if (++count > LIMITS.entries) throw new PackageError(['ZIP exceeds 5,000 entries.'])
            total += entry.uncompressedSize
            if (total > LIMITS.total)
              throw new PackageError(['ZIP exceeds the 512 MB uncompressed limit.'])
            if (entry.generalPurposeBitFlag & 1)
              throw new PackageError([`Encrypted entries are unsupported: ${name}`])
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              throw new PackageError([`Unsafe non-regular archive entry: ${name}`])
            if (seen.has(name.toLowerCase()))
              throw new PackageError([`Duplicate archive path: ${name}`])
            seen.add(name.toLowerCase())
            names.push(name)
            if (!name.endsWith('/')) {
              const supported =
                name === 'problem.md' ||
                name === 'meta.json' ||
                (name.startsWith('tests/') &&
                  (/\.(in|out)$/i.test(name) || /\/(input|output).+\.txt$/i.test(name)))
              const limit =
                name === 'problem.md'
                  ? LIMITS.statement
                  : name === 'meta.json'
                    ? LIMITS.meta
                    : LIMITS.test
              if (entry.uncompressedSize > limit)
                throw new PackageError([
                  `${name} exceeds its ${limit / 1024 / 1024} MB file limit.`
                ])
              if (supported) {
                const destination = join(directory, `${files.size}.part`)
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
                files.set(name, destination)
              }
            }
            if (!failed) zip.readEntry()
          })().catch(fail)
        })
        zip.readEntry()
      })
      if (!files.has('problem.md'))
        throw new PackageError(['problem.md is missing at the root of the ZIP.'])
      const decode = async (filePath: string) => {
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filePath))
        } catch {
          throw new PackageError(['problem.md and meta.json must be readable UTF-8 text.'])
        }
      }
      const statement = await decode(files.get('problem.md')!)
      if (!statement.trim()) throw new PackageError(['problem.md is empty.'])
      const meta = metadata(
        files.has('meta.json') ? await decode(files.get('meta.json')!) : undefined,
        statement,
        basename(file)
      )
      const pairs = pairTests(names).sort((a, b) => {
        const priority = (g: string) => (g.toLowerCase() === 'sample' ? 0 : g === 'General' ? 1 : 2)
        return (
          priority(a.group) - priority(b.group) ||
          a.group.localeCompare(b.group, undefined, { numeric: true }) ||
          a.name.localeCompare(b.name, undefined, { numeric: true })
        )
      })
      await mkdir(join(directory, 'tests'))
      await writeFile(join(directory, 'problem.md'), statement, 'utf8')
      for (let i = 0; i < pairs.length; i++) {
        await rename(files.get(pairs[i].input)!, join(directory, 'tests', `${i}.in`))
        await rename(files.get(pairs[i].output)!, join(directory, 'tests', `${i}.out`))
      }
      for (const path of files.values()) await rm(path, { force: true })
      const groups = new Map<string, number>()
      pairs.forEach((p) => groups.set(p.group, (groups.get(p.group) ?? 0) + 1))
      const preview: ImportPreview = {
        token: randomUUID(),
        ...meta,
        testCount: pairs.length,
        groupCount: groups.size,
        groups: [...groups].map(([name, count]) => ({ name, count }))
      }
      this.pending = { directory, preview, pairs, source: basename(file) }
      return preview
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch((e) =>
        log('Failed import cleanup', e)
      )
      log('ZIP validation failed', error)
      throw error
    }
  }
  async commit(token: string, folderId: string | null): Promise<string> {
    this.store.requireFolder(folderId)
    const item = this.pending
    if (!item || item.preview.token !== token)
      throw new Error('Import preview expired. Please choose the ZIP again.')
    this.pending = null
    const id = randomUUID()
    const relative = join('problems', id)
    const destination = this.store.path(relative)
    try {
      // Finalize files before committing metadata. Failed commits remove the final directory.
      await rename(item.directory, destination)
      this.store.db.transaction(() => {
        const p = item.preview
        const now = new Date().toISOString()
        this.store.db
          .prepare(
            `INSERT INTO problems
              (id,title,topic,statement_path,source_zip_name,cpp_time_limit_ms,python_time_limit_ms,java_time_limit_ms,output_comparison,created_at,updated_at,last_opened_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            id,
            p.title,
            p.topic,
            join(relative, 'problem.md'),
            item.source,
            p.cppTimeLimitMs,
            p.pythonTimeLimitMs,
            p.javaTimeLimitMs,
            p.outputComparison,
            now,
            now,
            now
          )
        const groupIds = new Map<string, string>()
        for (const group of p.groups) {
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
        this.store.moveProblem(id, folderId)
      })()
      log(`Imported problem ${id}: ${item.pairs.length} tests`)
      return id
    } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch((e) =>
        log('Import rollback cleanup', e)
      )
      await rm(item.directory, { recursive: true, force: true }).catch((e) =>
        log('Import staging cleanup', e)
      )
      throw error
    }
  }
}
