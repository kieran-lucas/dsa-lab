import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/db'
import { Judge } from '../src/main/runner/judge'
import type { RunState } from '../src/shared/types'

const hasJdk =
  spawnSync('javac', ['--version'], { windowsHide: true }).status === 0 &&
  spawnSync('java', ['--version'], { windowsHide: true }).status === 0

describe('Java runner', () => {
  it.runIf(hasJdk)('compiles Main.java and judges its output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsa-lab-java-test-'))
    const store = new Store(root)
    try {
      const relative = 'problems/problem'
      mkdirSync(join(root, relative, 'tests'), { recursive: true })
      writeFileSync(join(root, relative, 'problem.md'), '# Sum')
      writeFileSync(join(root, relative, 'tests/0.in'), '2 3\n')
      writeFileSync(join(root, relative, 'tests/0.out'), '5\n')
      store.db
        .prepare(
          `INSERT INTO problems
            (id,title,topic,statement_path,source_zip_name,cpp_time_limit_ms,python_time_limit_ms,java_time_limit_ms,output_comparison,created_at,updated_at,last_opened_at,folder_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          'problem',
          'Sum',
          null,
          `${relative}/problem.md`,
          null,
          2000,
          5000,
          3000,
          'tokens',
          '2026-01-01',
          '2026-01-01',
          null,
          null
        )
      store.db
        .prepare('INSERT INTO test_groups VALUES (?,?,?,?)')
        .run('group', 'problem', 'sample', 0)
      store.db
        .prepare('INSERT INTO test_cases VALUES (?,?,?,?,?,?)')
        .run('test', 'group', '001', `${relative}/tests/0.in`, `${relative}/tests/0.out`, 0)
      const approach = store.createApproach('problem', 'Main')
      let final: RunState | undefined
      const judge = new Judge(store, (progress) => {
        if (progress.state?.phase === 'complete') final = progress.state
      })
      judge.start({
        problemId: 'problem',
        approachId: approach.id,
        language: 'java',
        sourceCode:
          'import java.util.*; public class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt() + s.nextInt()); } }'
      })
      await judge.active?.done

      expect(final?.verdict).toBe('PASSED')
      expect(final?.results).toHaveLength(1)
      expect(final?.results[0].verdict).toBe('AC')
    } finally {
      store.db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
