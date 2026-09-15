import { describe, expect, it } from 'vitest'
import { compareOutput, aggregate } from '../src/main/runner/comparator'
import { metadata, pairTests, validatePath } from '../src/main/import/validation'
import { naturalCompare } from '../src/shared/types'
import { javaRuntime } from '../src/main/runner/toolchains'
describe('library ordering', () => {
  it('sorts numeric names naturally, then alphabetically', () => {
    expect(['Bài 10', 'Beta', 'Bài 2', 'Alpha', 'Bài 1'].sort(naturalCompare)).toEqual([
      'Alpha',
      'Bài 1',
      'Bài 2',
      'Bài 10',
      'Beta'
    ])
  })
  it('is stable regardless of last-opened timestamps', () => {
    const problems = [
      { title: 'Problem 10', lastOpenedAt: '2030-01-01' },
      { title: 'Problem 2', lastOpenedAt: '2020-01-01' },
      { title: 'Problem 1', lastOpenedAt: null }
    ]
    expect(problems.sort((a, b) => naturalCompare(a.title, b.title)).map((p) => p.title)).toEqual([
      'Problem 1',
      'Problem 2',
      'Problem 10'
    ])
  })
})
describe('output comparison', () => {
  it.each([
    ['1 2', '1 2'],
    ['1\r\n2', '1\n2'],
    [' 1  2\n3 ', '1 2 3\n'],
    ['\n\n1\n\n', '1'],
    ['', ''],
    [' \n', '']
  ])('equates %j and %j', (a, b) => expect(compareOutput(a, b)).toBe(true))
  it('rejects different tokens', () => expect(compareOutput('1 2', '1 3')).toBe(false))
  it('rejects extra tokens', () => expect(compareOutput('1', '1 2')).toBe(false))
  it('does not apply floating-point tolerance', () => expect(compareOutput('1.0', '1')).toBe(false))
  it('exact comparison normalizes only CRLF', () => {
    expect(compareOutput('1\r\n', '1\n', 'exact')).toBe(true)
    expect(compareOutput('1 ', '1', 'exact')).toBe(false)
  })
})
describe('test pairing and archive paths', () => {
  it('pairs grouped tests', () =>
    expect(pairTests(['tests/random/017.in', 'tests/random/017.out'])).toEqual([
      { name: '017', group: 'random', input: 'tests/random/017.in', output: 'tests/random/017.out' }
    ]))
  it('supports flat pairs', () =>
    expect(pairTests(['tests/a.in', 'tests/a.out'])[0].group).toBe('General'))
  it('preserves nested names', () =>
    expect(pairTests(['tests/random/large/1.in', 'tests/random/large/1.out'])[0]).toMatchObject({
      name: 'large/1',
      group: 'random'
    }))
  it('supports external-generator suffixes', () =>
    expect(pairTests(['tests/input001.txt', 'tests/output001.txt'])[0].name).toBe('001'))
  it.each([
    { names: ['tests/a.in'] },
    { names: ['tests/a.out'] },
    { names: [] },
    { names: ['tests/a.in', 'tests/a.out', 'tests/a.in'] },
    { names: ['tests/a.in', 'tests/a.out', 'tests/inputa.txt'] },
    { names: ['tests/A.in', 'tests/a.in', 'tests/a.out'] }
  ])('rejects incomplete or duplicate tests $names', ({ names }) =>
    expect(() => pairTests(names)).toThrow()
  )
  it.each([
    '../bad',
    'tests/../bad',
    '/absolute',
    'C:/evil',
    'tests\\a.in',
    'tests//a.in',
    'tests/./a.in',
    'tests/a.in:stream',
    'tests/NUL.in',
    'tests/COM1.out',
    'tests/a./1.in',
    'tests/a\0.in'
  ])('rejects unsafe path %s', (name) => expect(() => validatePath(name)).toThrow())
})
describe('metadata', () => {
  it('uses metadata title', () =>
    expect(metadata('{"title":"Explicit"}', '# Heading', 'archive.zip').title).toBe('Explicit'))
  it('falls back to first H1', () =>
    expect(metadata(undefined, 'Introduction\n# Heading\nText', 'archive.zip').title).toBe(
      'Heading'
    ))
  it('falls back to archive name and defaults', () =>
    expect(metadata(undefined, 'No heading', 'archive.zip')).toEqual({
      title: 'archive',
      topic: null,
      cppTimeLimitMs: 2000,
      pythonTimeLimitMs: 5000,
      javaTimeLimitMs: 3000,
      outputComparison: 'tokens'
    }))
  it('rejects bad JSON and invalid limits', () => {
    expect(() => metadata('{', 'x', 'x.zip')).toThrow()
    expect(() => metadata('{"timeLimitMs":{"cpp":-1}}', 'x', 'x.zip')).toThrow()
  })
})
describe('Java toolchain', () => {
  it('uses java on PATH for javac on PATH', () => expect(javaRuntime('javac')).toBe('java'))
  it('uses the runtime beside an explicitly selected compiler', () =>
    expect(javaRuntime('C:\\jdk\\bin\\javac.exe')).toBe('C:\\jdk\\bin\\java.exe'))
})
describe('verdict aggregation', () => {
  it('all AC passes', () => expect(aggregate(['AC', 'AC'])).toBe('PASSED'))
  it.each(['WA', 'TLE', 'RE', 'OLE'] as const)('%s fails the run', (verdict) =>
    expect(aggregate(['AC', verdict, 'AC'])).toBe('FAILED')
  )
  it('preflight error is compile error', () => expect(aggregate([], true)).toBe('COMPILE_ERROR'))
  it('cancel wins over partial results', () =>
    expect(aggregate(['AC'], false, true)).toBe('CANCELLED'))
  it('empty results cannot pass', () => expect(aggregate([])).toBe('FAILED'))
})
