import { z } from 'zod'
import { basename } from 'node:path'
export const LIMITS = {
  zip: 128 * 1024 * 1024,
  entries: 5000,
  total: 512 * 1024 * 1024,
  test: 16 * 1024 * 1024,
  statement: 4 * 1024 * 1024,
  meta: 64 * 1024
}
export class PackageError extends Error {
  constructor(public issues: string[]) {
    super(issues.join('\n'))
    this.name = 'PackageError'
  }
}
export function validatePath(name: string): void {
  const clean = name.endsWith('/') ? name.slice(0, -1) : name
  if (
    !clean ||
    name.length > 500 ||
    [...name].some((c) => c.charCodeAt(0) < 32) ||
    /[\\\x7f:<>"|?*]/.test(name) ||
    name.startsWith('/') ||
    clean
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)
      )
  )
    throw new PackageError([`Unsafe archive path: ${name.slice(0, 200)}`])
}
export type Pair = { name: string; group: string; input: string; output: string }
export function pairTests(names: string[]): Pair[] {
  const paths = new Set<string>()
  const logical = new Map<string, Partial<Pair>>()
  for (const name of names) {
    validatePath(name)
    const folded = name.toLowerCase()
    if (paths.has(folded)) throw new PackageError([`Duplicate archive path: ${name}`])
    paths.add(folded)
    if (!name.startsWith('tests/') || name.endsWith('/')) continue
    const parts = name.split('/')
    const file = parts.pop()!
    const directory = parts.join('/')
    let stem: string
    let side: 'input' | 'output'
    const canonical = /^(.*)\.(in|out)$/i.exec(file)
    const external = /^(input|output)(.+)\.txt$/i.exec(file)
    if (canonical) {
      stem = canonical[1]
      side = canonical[2].toLowerCase() === 'in' ? 'input' : 'output'
    } else if (external) {
      stem = external[2]
      side = external[1].toLowerCase() === 'input' ? 'input' : 'output'
    } else continue
    if (!stem) throw new PackageError([`Empty test name: ${name}`])
    const key = `${directory}/${stem}`.toLowerCase()
    const pair = logical.get(key) ?? {
      name: parts.length > 2 ? `${parts.slice(2).join('/')}/${stem}` : stem,
      group: parts.length > 1 ? parts[1] : 'General'
    }
    if (pair[side]) throw new PackageError([`Duplicate logical test: ${directory}/${stem}`])
    pair[side] = name
    logical.set(key, pair)
  }
  const issues: string[] = []
  for (const pair of logical.values()) {
    if (!pair.input) issues.push(`${pair.output} has no matching input (.in or input*.txt).`)
    if (!pair.output) issues.push(`${pair.input} has no matching output (.out or output*.txt).`)
  }
  if (!logical.size) issues.push('No valid test pairs found in tests/.')
  if (issues.length) throw new PackageError(issues.slice(0, 30))
  return [...logical.values()] as Pair[]
}
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().max(100).optional(),
  timeLimitMs: z
    .object({
      cpp: z.number().int().min(50).max(60000).optional(),
      python: z.number().int().min(50).max(60000).optional()
    })
    .optional(),
  outputComparison: z.enum(['tokens', 'exact']).optional()
})
export function metadata(raw: string | undefined, statement: string, zipName: string) {
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    throw new PackageError(['meta.json is not valid JSON.'])
  }
  const result = metadataSchema.safeParse(parsed)
  if (!result.success)
    throw new PackageError(
      result.error.issues.map((i) => `meta.json ${i.path.join('.')}: ${i.message}`)
    )
  const meta = result.data
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(statement)?.[1]
  return {
    title: meta.title ?? h1?.slice(0, 200) ?? basename(zipName, '.zip'),
    topic: meta.topic || null,
    cppTimeLimitMs: meta.timeLimitMs?.cpp ?? 2000,
    pythonTimeLimitMs: meta.timeLimitMs?.python ?? 5000,
    outputComparison: meta.outputComparison ?? ('tokens' as const)
  }
}
