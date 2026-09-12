import { _electron as electron, expect } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

await mkdir('.qa', { recursive: true })
const directory = await mkdtemp(resolve('.qa/migration-'))
const root = join(directory, 'dsa-lab')
const problemId = randomUUID(),
  approachId = randomUUID(),
  groupId = randomUUID(),
  testId = randomUUID()
const relative = `problems/${problemId}`
await mkdir(join(root, relative), { recursive: true })
await writeFile(join(root, relative, 'problem.md'), '# Legacy problem\n\nExisting statement.')
await writeFile(join(root, relative, '001.in'), '2 3\n')
await writeFile(join(root, relative, '001.out'), '5\n')
const seed = spawnSync(
  electronPath,
  [
    '-e',
    `
  const Database = require(${JSON.stringify(resolve('node_modules/better-sqlite3'))});
  const fs = require('node:fs');
  const db = new Database(${JSON.stringify(join(root, 'data.sqlite'))});
  db.exec(fs.readFileSync(${JSON.stringify(resolve('fixtures/legacy-v1.sql'))},'utf8'));
  db.prepare('INSERT INTO problems VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(${JSON.stringify(problemId)},'Legacy problem','Arrays',${JSON.stringify(relative + '/problem.md')},'legacy.zip',2000,5000,'tokens','2026-09-01','2026-09-01','2026-09-01');
  db.prepare('INSERT INTO test_groups VALUES (?,?,?,?)').run(${JSON.stringify(groupId)},${JSON.stringify(problemId)},'sample',0);
  db.prepare('INSERT INTO test_cases VALUES (?,?,?,?,?,?)').run(${JSON.stringify(testId)},${JSON.stringify(groupId)},'001',${JSON.stringify(relative + '/001.in')},${JSON.stringify(relative + '/001.out')},0);
  db.prepare('INSERT INTO approaches VALUES (?,?,?,?,?,?,?,?)').run(${JSON.stringify(approachId)},${JSON.stringify(problemId)},'Main',0,'// original C++','print(5)','2026-09-01','2026-09-01');
  db.prepare('INSERT INTO settings VALUES (?,?)').run('workspace',${JSON.stringify(JSON.stringify({ problemId, approachId, language: 'python', sidebarCollapsed: false }))});
  db.close();
`
  ],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    shell: false,
    encoding: 'utf8'
  }
)
assert.equal(seed.status, 0, seed.stderr)
let app
try {
  for (let restart = 0; restart < 2; restart++) {
    app = await electron.launch({
      ...(process.env.DSA_QA_EXECUTABLE
        ? { executablePath: resolve(process.env.DSA_QA_EXECUTABLE), args: [] }
        : { args: ['.'] }),
      env: { ...process.env, DSA_LAB_DATA_DIR: directory }
    })
    const page = await app.firstWindow()
    await expect(page.locator('.view-lines')).toContainText('print(5)')
    const state = await page.evaluate(
      async (problemId) => ({
        problem: await window.dsa.getProblem(problemId),
        text: await window.dsa.getTestText(
          (await window.dsa.getProblem(problemId)).groups[0].tests[0].id
        ),
        folders: await window.dsa.listFolders()
      }),
      problemId
    )
    assert.equal(state.problem.approaches[0].cppCode, '// original C++')
    assert.equal(state.problem.approaches[0].pythonCode, 'print(5)')
    assert.equal(state.problem.testCount, 1)
    assert.equal(state.text.input, '2 3\n')
    assert.equal(state.text.expected, '5\n')
    if (!restart) {
      assert.equal(state.problem.folderId, null)
      assert.equal(state.folders.length, 0)
      await page.evaluate(async (problemId) => {
        const folder = await window.dsa.createFolder('DSA UET', null)
        await window.dsa.moveProblem(problemId, folder.id)
      }, problemId)
    } else assert.equal(state.problem.folderId, state.folders[0].id)
    await app.close()
    app = null
  }
  console.log(
    `PASS: schema v1 migration preserves problems, both sources, tests, selection and folder moves after restart. ${directory}`
  )
} finally {
  if (app) await app.close()
}
