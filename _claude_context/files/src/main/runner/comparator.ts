import type { RunVerdict, TestVerdict } from '../../shared/types'
export function compareOutput(
  actual: string,
  expected: string,
  mode: 'tokens' | 'exact' = 'tokens'
): boolean {
  if (mode === 'exact') return actual.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n')
  // Avoid token arrays proportional to a large output's token count.
  const a = actual.matchAll(/\S+/g)
  const b = expected.matchAll(/\S+/g)
  while (true) {
    const x = a.next()
    const y = b.next()
    if (x.done || y.done) return !!x.done && !!y.done
    if (x.value[0] !== y.value[0]) return false
  }
}
export function aggregate(
  verdicts: TestVerdict[],
  compileError = false,
  cancelled = false
): RunVerdict {
  if (cancelled) return 'CANCELLED'
  if (compileError) return 'COMPILE_ERROR'
  return verdicts.length > 0 && verdicts.every((v) => v === 'AC') ? 'PASSED' : 'FAILED'
}
