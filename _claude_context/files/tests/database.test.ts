import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Store } from '../src/main/db'

describe('database migration', () => {
  it('adds Java defaults without changing existing solutions', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsa-lab-db-test-'))
    const problemId = 'problem'
    const approachId = 'approach'
    const relative = `problems/${problemId}`
    mkdirSync(join(root, relative), { recursive: true })
    writeFileSync(join(root, relative, 'problem.md'), '# Legacy')
    const seed = new Database(join(root, 'data.sqlite'))
    seed.exec(readFileSync(resolve('fixtures/legacy-v1.sql'), 'utf8'))
    seed
      .prepare('INSERT INTO problems VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        problemId,
        'Legacy',
        null,
        `${relative}/problem.md`,
        'legacy.zip',
        2000,
        5000,
        'tokens',
        '2026-01-01',
        '2026-01-01',
        null
      )
    seed
      .prepare('INSERT INTO approaches VALUES (?,?,?,?,?,?,?,?)')
      .run(
        approachId,
        problemId,
        'Main',
        0,
        '// C++ stays',
        '# Python stays',
        '2026-01-01',
        '2026-01-01'
      )
    seed.close()

    const store = new Store(root)
    try {
      const problem = store.problem(problemId)
      expect(store.db.pragma('user_version', { simple: true })).toBe(3)
      expect(problem.javaTimeLimitMs).toBe(3000)
      expect(problem.approaches[0]).toMatchObject({
        cppCode: '// C++ stays',
        pythonCode: '# Python stays'
      })
      expect(problem.approaches[0].javaCode).toContain('public class Main')
      expect(store.settings().java).toEqual({ executable: 'javac', argsPrefix: [] })
    } finally {
      store.db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
