import { describe, expect, it } from 'vitest'
import { createWriteStream, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { Store } from '../src/main/db'
import { Importer } from '../src/main/import/zipImporter'

async function makeZip(destination: string, entries: [string, string][]): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, content] of entries) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(destination))
}

function meta(fields: Record<string, unknown>): string {
  return JSON.stringify(fields)
}
type TestSpec = [string, string, string]
function slotEntries(
  slot: string,
  opts: {
    title?: string
    metaRaw?: string
    skipMeta?: boolean
    statement?: string | null
    skipStatement?: boolean
    tests?: TestSpec[]
    skipTests?: boolean
  } = {}
): [string, string][] {
  const entries: [string, string][] = []
  if (!opts.skipStatement)
    entries.push([`${slot}/problem.md`, opts.statement ?? `# ${opts.title ?? slot}\nBody text.`])
  if (!opts.skipMeta)
    entries.push([
      `${slot}/meta.json`,
      opts.metaRaw ?? meta({ title: opts.title ?? `Problem ${slot}` })
    ])
  if (!opts.skipTests) {
    const tests = opts.tests ?? ([['1', '1 2', '3']] as TestSpec[])
    for (const [name, input, output] of tests) {
      entries.push([`${slot}/tests/${name}.in`, input])
      entries.push([`${slot}/tests/${name}.out`, output])
    }
  }
  return entries
}
type Ctx = { store: Store; importer: Importer; zip: (entries: [string, string][]) => Promise<string> }
async function withImporter(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dsa-lab-import-'))
  const store = new Store(root)
  const importer = new Importer(store)
  let seq = 0
  const zip = async (entries: [string, string][]) => {
    const file = join(root, `pkg-${seq++}.zip`)
    await makeZip(file, entries)
    return file
  }
  try {
    await fn({ store, importer, zip })
  } finally {
    store.db.close()
    rmSync(root, { recursive: true, force: true })
  }
}

describe('batch import: shared format', () => {
  it('imports a single-problem package as a one-element batch', () =>
    withImporter(async ({ store, importer, zip }) => {
      const file = await zip(slotEntries('001', { title: 'Two Sum' }))
      const preview = await importer.preview(file)
      expect(preview.totalCount).toBe(1)
      expect(preview.validCount).toBe(1)
      expect(preview.problems[0]).toMatchObject({
        slot: '001',
        title: 'Two Sum',
        valid: true,
        testCount: 1
      })
      const result = await importer.commit(preview.token, null)
      expect(result.successCount).toBe(1)
      const id = result.results[0].problemId!
      expect(id).toBeTruthy()
      expect(id).not.toBe('001')
      expect(store.problem(id).title).toBe('Two Sum')
    }))
  it('imports several problems from one archive into one destination', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Two Sum' }),
        ...slotEntries('002', { title: 'Binary Search' }),
        ...slotEntries('003', { title: 'Dijkstra' })
      ])
      const preview = await importer.preview(file)
      expect(preview.totalCount).toBe(3)
      expect(preview.validCount).toBe(3)
      const result = await importer.commit(preview.token, null)
      expect(result.successCount).toBe(3)
      expect(result.results.map((r) => r.title)).toEqual(['Two Sum', 'Binary Search', 'Dijkstra'])
    }))
  it('does not special-case a larger batch', () =>
    withImporter(async ({ importer, zip }) => {
      const entries = Array.from({ length: 12 }, (_, i) =>
        slotEntries(String(i + 1).padStart(3, '0'), { title: `Problem ${i + 1}` })
      ).flat()
      const file = await zip(entries)
      const preview = await importer.preview(file)
      expect(preview.totalCount).toBe(12)
      expect(preview.validCount).toBe(12)
      const result = await importer.commit(preview.token, null)
      expect(result.successCount).toBe(12)
    }))
  it('rejects the old root-level single-problem format', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ['problem.md', '# Old format'],
        ['meta.json', meta({ title: 'Old' })],
        ['tests/1.in', '1'],
        ['tests/1.out', '1']
      ])
      await expect(importer.preview(file)).rejects.toThrow(/old single-problem ZIP format/)
    }))
  it('rejects an unexpected non-junk file at the archive root', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([...slotEntries('001', { title: 'Two Sum' }), ['random.txt', 'x']])
      await expect(importer.preview(file)).rejects.toThrow(/top level of the archive/)
    }))
  it('ignores __MACOSX, .DS_Store and Thumbs.db entries', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Two Sum' }),
        ['__MACOSX/001/._problem.md', 'junk'],
        ['.DS_Store', 'junk'],
        ['001/.DS_Store', 'junk'],
        ['Thumbs.db', 'junk']
      ])
      const preview = await importer.preview(file)
      expect(preview.totalCount).toBe(1)
      expect(preview.problems[0].valid).toBe(true)
    }))
  it('orders problems naturally (1, 2, 10) regardless of archive entry order', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('10', { title: 'Ten' }),
        ...slotEntries('2', { title: 'Two' }),
        ...slotEntries('1', { title: 'One' })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.map((p) => p.slot)).toEqual(['1', '2', '10'])
    }))
})

describe('batch import: per-problem validation isolation', () => {
  it('marks one problem invalid without failing its siblings', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Alpha' }),
        ...slotEntries('002', { title: 'Beta', skipMeta: true }),
        ...slotEntries('003', { title: 'Gamma' })
      ])
      const preview = await importer.preview(file)
      expect(preview.validCount).toBe(2)
      expect(preview.invalidCount).toBe(1)
      const invalid = preview.problems.find((p) => p.slot === '002')!
      expect(invalid.valid).toBe(false)
      expect(invalid.issues[0]).toMatch(/meta.json is missing/)
      const result = await importer.commit(preview.token, null)
      expect(result.successCount).toBe(2)
      expect(result.failureCount).toBe(1)
      expect(result.results.find((r) => r.slot === '002')!.ok).toBe(false)
    }))
  it('requires a non-blank meta.json title', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { metaRaw: meta({}) }),
        ...slotEntries('002', { metaRaw: meta({ title: '   ' }) })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.every((p) => !p.valid)).toBe(true)
    }))
  it('isolates invalid meta.json JSON to that problem', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Alpha' }),
        ...slotEntries('002', { metaRaw: '{not json' })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.find((p) => p.slot === '001')!.valid).toBe(true)
      const bad = preview.problems.find((p) => p.slot === '002')!
      expect(bad.valid).toBe(false)
      expect(bad.issues[0]).toMatch(/not valid JSON/)
    }))
  it('rejects empty or missing problem.md per problem', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { statement: '   ' }),
        ...slotEntries('002', { skipStatement: true })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.every((p) => !p.valid)).toBe(true)
    }))
  it('rejects an unmatched test pair per problem', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { skipTests: true }),
        ['001/tests/1.in', 'only input']
      ])
      const preview = await importer.preview(file)
      expect(preview.problems[0].valid).toBe(false)
    }))
  it('supports grouped, flat and legacy test naming in one problem', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Mixed', skipTests: true }),
        ['001/tests/sample/1.in', 'a'],
        ['001/tests/sample/1.out', 'a'],
        ['001/tests/2.in', 'b'],
        ['001/tests/2.out', 'b'],
        ['001/tests/input003.txt', 'c'],
        ['001/tests/output003.txt', 'c']
      ])
      const preview = await importer.preview(file)
      const p = preview.problems[0]
      expect(p.valid).toBe(true)
      expect(p.testCount).toBe(3)
      expect(p.groups.map((g) => g.name).sort()).toEqual(['General', 'sample'])
    }))
})

describe('batch import: duplicate title detection', () => {
  it('rejects a duplicate against an existing problem in the same destination', () =>
    withImporter(async ({ store, importer, zip }) => {
      const first = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      await importer.commit(first.token, null)
      const second = await importer.preview(
        await zip([
          ...slotEntries('001', { title: 'Two Sum' }),
          ...slotEntries('002', { title: 'Dijkstra' })
        ])
      )
      const result = await importer.commit(second.token, null)
      expect(result.results.find((r) => r.slot === '001')!.ok).toBe(false)
      expect(result.results.find((r) => r.slot === '001')!.issues[0]).toMatch(/already exists/)
      expect(result.results.find((r) => r.slot === '002')!.ok).toBe(true)
      expect(store.list().length).toBe(2)
    }))
  it('rejects a later duplicate within the same batch, keeping the earlier one', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Two Sum' }),
        ...slotEntries('002', { title: 'Binary Search' }),
        ...slotEntries('003', { title: 'Two Sum' })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.find((p) => p.slot === '001')!.valid).toBe(true)
      const dup = preview.problems.find((p) => p.slot === '003')!
      expect(dup.valid).toBe(false)
      expect(dup.issues[0]).toMatch(/Duplicate of an earlier problem/)
      const result = await importer.commit(preview.token, null)
      expect(result.results.find((r) => r.slot === '001')!.ok).toBe(true)
      expect(result.results.find((r) => r.slot === '003')!.ok).toBe(false)
    }))
  it('treats titles as duplicates case-insensitively', () =>
    withImporter(async ({ importer, zip }) => {
      const file = await zip([
        ...slotEntries('001', { title: 'Two Sum' }),
        ...slotEntries('002', { title: 'two sum' })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.find((p) => p.slot === '002')!.valid).toBe(false)
    }))
  it('treats NFC/NFD-equivalent unicode titles as duplicates', () =>
    withImporter(async ({ importer, zip }) => {
      const composed = 'Duong di'
      const withDiacritics = 'Đường đi'
      const file = await zip([
        ...slotEntries('001', { title: withDiacritics }),
        ...slotEntries('002', { title: withDiacritics.normalize('NFD') }),
        ...slotEntries('003', { title: composed })
      ])
      const preview = await importer.preview(file)
      expect(preview.problems.find((p) => p.slot === '001')!.valid).toBe(true)
      expect(preview.problems.find((p) => p.slot === '002')!.valid).toBe(false)
      expect(preview.problems.find((p) => p.slot === '003')!.valid).toBe(true)
    }))
  it('allows the same title in two different destinations', () =>
    withImporter(async ({ store, importer, zip }) => {
      const folder = store.createFolder('Week 2', null)
      const first = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      await importer.commit(first.token, null)
      const second = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      const result = await importer.commit(second.token, folder.id)
      expect(result.successCount).toBe(1)
    }))
  it('detects a duplicate at the root destination', () =>
    withImporter(async ({ importer, zip }) => {
      const first = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      await importer.commit(first.token, null)
      const second = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      const result = await importer.commit(second.token, null)
      expect(result.successCount).toBe(0)
      expect(result.results[0].issues[0]).toMatch(/already exists/)
    }))
})

describe('moveProblem title uniqueness', () => {
  it('rejects moving a problem into a folder with a same-title sibling', () =>
    withImporter(async ({ store, importer, zip }) => {
      const folderA = store.createFolder('A', null)
      const folderB = store.createFolder('B', null)
      const first = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      await importer.commit(first.token, folderA.id)
      const second = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      const result = await importer.commit(second.token, folderB.id)
      const movingId = result.results[0].problemId!
      expect(() => store.moveProblem(movingId, folderA.id)).toThrow(/already exists/)
    }))
  it('does not self-conflict when moving a problem into its current folder', () =>
    withImporter(async ({ store, importer, zip }) => {
      const folder = store.createFolder('A', null)
      const preview = await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      const result = await importer.commit(preview.token, folder.id)
      const id = result.results[0].problemId!
      expect(() => store.moveProblem(id, folder.id)).not.toThrow()
    }))
})

describe('batch import: partial commit failure and cleanup', () => {
  it('does not roll back successful siblings when one item fails at commit', () =>
    withImporter(async ({ store, importer, zip }) => {
      const existing = await importer.preview(await zip(slotEntries('existing', { title: 'Clash' })))
      await importer.commit(existing.token, null)
      const preview = await importer.preview(
        await zip([
          ...slotEntries('001', { title: 'Alpha' }),
          ...slotEntries('002', { title: 'Clash' }),
          ...slotEntries('003', { title: 'Beta' })
        ])
      )
      const before = readdirSync(join(store.root, 'problems')).length
      const result = await importer.commit(preview.token, null)
      expect(result.results.find((r) => r.slot === '001')!.ok).toBe(true)
      expect(result.results.find((r) => r.slot === '002')!.ok).toBe(false)
      expect(result.results.find((r) => r.slot === '003')!.ok).toBe(true)
      expect(store.list().map((p) => p.title).sort()).toEqual(['Alpha', 'Beta', 'Clash'])
      const after = readdirSync(join(store.root, 'problems'))
      expect(after.length).toBe(before + result.successCount)
    }))
  it('discardImport removes the entire batch staging directory', () =>
    withImporter(async ({ store, importer, zip }) => {
      const file = await zip(slotEntries('001', { title: 'Two Sum' }))
      const preview = await importer.preview(file)
      const stagingRoot = join(store.root, 'staging')
      expect(readdirSync(stagingRoot).length).toBeGreaterThan(0)
      await importer.discard(preview.token)
      expect(readdirSync(stagingRoot).length).toBe(0)
    }))
  it('choosing another ZIP cleans up the previous staging batch', () =>
    withImporter(async ({ store, importer, zip }) => {
      await importer.preview(await zip(slotEntries('001', { title: 'Two Sum' })))
      const stagingRoot = join(store.root, 'staging')
      await importer.preview(await zip(slotEntries('001', { title: 'Binary Search' })))
      expect(readdirSync(stagingRoot).length).toBe(1)
    }))
})
