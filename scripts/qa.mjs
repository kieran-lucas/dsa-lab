import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fixtureEntries, makeZip } from './fixture.mjs'
import assert from 'node:assert/strict'

// Real Electron + renderer integration; the only mock replaces the native file picker.
await mkdir('.qa', { recursive: true })
const qaRoot = await mkdtemp(resolve('.qa/session-'))
const entries = await fixtureEntries()
const fixture = join(qaRoot, 'sum.zip')
await makeZip(
  fixture,
  entries.map(([name, data]) => [
    name,
    name === 'meta.json'
      ? JSON.stringify({
          title: 'Sum of Two Numbers',
          topic: 'Foundations',
          timeLimitMs: { cpp: 800, python: 1000 }
        })
      : data
  ])
)
const cpp =
  '#include <iostream>\nusing namespace std;\nint main() { long long a,b; cin >> a >> b; cout << a+b << "\\n"; }\n'
const python = 'a, b = map(int, input().split())\nprint(a + b)\n'
const executablePath = process.env.DSA_QA_EXECUTABLE
const report = []
let app, page
const errors = []
async function launch() {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }),
    env: { ...process.env, DSA_LAB_DATA_DIR: join(qaRoot, 'data') },
    timeout: 30000
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.waitForFunction(() => !!window.dsa)
  await page.evaluate(() => {
    window.__qaEvents = []
    window.dsa.onRunProgress((event) => window.__qaEvents.push(event))
  })
}
async function record(name, fn) {
  console.log(`QA: ${name}`)
  await fn()
  report.push(name)
  console.log(`PASS: ${name}`)
}
async function pick(file) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
}
async function setCode(text) {
  const editor = page.locator('.monaco-editor').first()
  await editor.click({ position: { x: 180, y: 45 } })
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
}
async function run(expected, verdicts) {
  await page.evaluate(() => {
    window.__qaEvents = []
  })
  await page.getByRole('button', { name: 'Run All' }).click()
  await page.waitForFunction(
    () => window.__qaEvents.some((e) => e.state?.phase === 'complete'),
    null,
    { timeout: 90000 }
  )
  const state = await page.evaluate(
    () => window.__qaEvents.findLast((e) => e.state?.phase === 'complete').state
  )
  assert.equal(state.verdict, expected, JSON.stringify(state, null, 2))
  if (verdicts)
    assert.deepEqual(
      state.results.map((r) => r.verdict),
      verdicts
    )
  for (const result of state.results) assert.ok(result.wallTimeMs > 0)
  await expect(page.locator('.run-status strong')).toHaveText(
    { PASSED: 'Passed', FAILED: 'Failed', COMPILE_ERROR: 'Compile Error', CANCELLED: 'Cancelled' }[
      expected
    ]
  )
  return state
}
try {
  await launch()
  await record('first launch, SQLite initialization, isolated renderer', async () => {
    await expect(page.getByRole('heading', { name: 'No problems yet' })).toBeVisible()
    assert.deepEqual(
      await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process })),
      { node: 'undefined', process: 'undefined' }
    )
    const preferences = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    )
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.sandbox, true)
    await page.screenshot({ path: join(qaRoot, '01-empty.png') })
  })
  await record('valid ZIP preview, atomic commit, library and statement', async () => {
    await pick(fixture)
    await page.getByRole('button', { name: 'Import ZIP', exact: true }).click()
    await expect(page.locator('.preview-stats')).toContainText('3 test groups')
    await expect(page.locator('.preview-stats')).toContainText('6 test cases')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.locator('.statement-body h1')).toHaveText('Sum of Two Numbers')
    await expect(page.locator('.monaco-editor')).toBeVisible()
    await expect(page.locator('.markdown h2').first()).toHaveText('Input')
  })
  await record('GCC and Python detection', async () => {
    const env = await page.evaluate(() => window.dsa.detectToolchains())
    assert.equal(env.cpp.available, true, env.cpp.message)
    assert.equal(env.python.available, true, env.python.message)
    console.log(env.cpp.version, env.python.version)
  })
  await record('C++ accepted, six processes with individual timing', async () => {
    await setCode(cpp)
    await run('PASSED', Array(6).fill('AC'))
    await page.locator('.test-group>summary').first().click()
    await expect(page.locator('.test-row:visible')).toHaveCount(2)
    await page.screenshot({ path: join(qaRoot, '02-passed.png') })
  })
  await record('Monaco syntax colors and find/replace', async () => {
    const colors = await page
      .locator('.view-lines span span')
      .evaluateAll((nodes) => [...new Set(nodes.map((n) => getComputedStyle(n).color))])
    assert.ok(colors.length >= 3, `Expected colored syntax; got ${colors}`)
    await page.locator('.monaco-editor').click({ position: { x: 180, y: 45 } })
    await page.keyboard.press('Control+f')
    await expect(page.locator('.find-widget')).toBeVisible()
    await page.keyboard.press('Escape')
  })
  await record('wrong answers continue through the entire suite', async () => {
    await setCode('#include <iostream>\nint main(){std::cout << "wrong";}')
    await run('FAILED', Array(6).fill('WA'))
    await page.locator('.test-group>summary').first().click()
    await page.locator('.test-row>summary').first().click()
    await expect(page.locator('.output-pair')).toContainText('wrong')
    await expect(page.locator('.output-pair')).toContainText('5')
    await page.screenshot({ path: join(qaRoot, '03-failed.png') })
  })
  await record('C++ compile error runs no tests and displays diagnostics', async () => {
    await setCode('int main() { invalid code }')
    const state = await run('COMPILE_ERROR', [])
    assert.match(state.diagnostics, /error:/)
    await expect(page.getByRole('button', { name: 'Go to line 1' })).toBeVisible()
  })
  await record('timeouts terminate each process and continue', async () => {
    await setCode('int main(){ for(;;){} }')
    await run('FAILED', Array(6).fill('TLE'))
  })
  await record('C++ runtime failure does not stop later tests', async () => {
    await setCode('int main(){ return 42; }')
    const state = await run('FAILED', Array(6).fill('RE'))
    assert.equal(state.results[0].exitCode, 42)
  })
  await record('Python accepted and syntax preflight', async () => {
    await page.getByRole('tab', { name: 'Python', exact: true }).click()
    await setCode(python)
    await run('PASSED', Array(6).fill('AC'))
    await setCode('if True\n    print(1)')
    const state = await run('COMPILE_ERROR', [])
    assert.match(state.diagnostics, /SyntaxError/)
  })
  await record('Python runtime traceback and output caps', async () => {
    await setCode('raise RuntimeError("intentional QA failure")')
    const state = await run('FAILED', Array(6).fill('RE'))
    assert.match(state.results[0].stderr, /intentional QA failure/)
    await setCode('import sys\nsys.stdout.write("x" * (5 * 1024 * 1024))')
    await run('FAILED', Array(6).fill('OLE'))
  })
  await record('cancellation retains completed tests; double run rejected', async () => {
    await setCode(
      'import time\na,b=map(int,input().split())\nif a == -8: time.sleep(10)\nprint(a+b)'
    )
    await page.evaluate(() => {
      window.__qaEvents = []
    })
    await page.getByRole('button', { name: 'Run All' }).click()
    const doubleRunRejected = await page.evaluate(async () => {
      const s = await window.dsa.getSettings()
      try {
        await window.dsa.runSolution({
          problemId: s.problemId,
          approachId: s.approachId,
          language: s.language,
          sourceCode: 'print(0)'
        })
        return false
      } catch {
        return true
      }
    })
    assert.equal(doubleRunRejected, true)
    await page.waitForFunction(() => window.__qaEvents.some((e) => e.result?.verdict === 'AC'))
    await page.getByRole('button', { name: 'Cancel Run' }).click()
    await page.waitForFunction(() => window.__qaEvents.some((e) => e.state?.phase === 'complete'))
    const state = await page.evaluate(
      () => window.__qaEvents.findLast((e) => e.state?.phase === 'complete').state
    )
    assert.equal(state.verdict, 'CANCELLED')
    assert.ok(state.results.length >= 1 && state.results.length < 6)
  })
  await record('a run uses its source snapshot while later edits autosave', async () => {
    await setCode('import time\ntime.sleep(0.2)\na,b=map(int,input().split())\nprint(a+b)')
    await page.evaluate(() => {
      window.__qaEvents = []
    })
    await page.getByRole('button', { name: 'Run All' }).click()
    await expect(page.getByRole('button', { name: 'Cancel Run' })).toBeVisible()
    await setCode('# edited during the run\nprint("next run")')
    await page.waitForFunction(
      () => window.__qaEvents.some((e) => e.state?.phase === 'complete'),
      null,
      { timeout: 30000 }
    )
    const state = await page.evaluate(
      () => window.__qaEvents.findLast((e) => e.state?.phase === 'complete').state
    )
    assert.equal(state.verdict, 'PASSED')
    assert.equal(state.results.length, 6)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.save-state')).toHaveText('Saved')
    const stored = await page.evaluate(async () => {
      const s = await window.dsa.getSettings()
      return (await window.dsa.getProblem(s.problemId)).approaches.find(
        (a) => a.id === s.approachId
      ).pythonCode
    })
    assert.match(stored, /edited during the run/)
  })
  await record('approach and language autosave across immediate switches', async () => {
    await page.getByRole('tab', { name: 'C++', exact: true }).click()
    await setCode(cpp)
    await page.getByRole('button', { name: 'Add approach', exact: true }).click()
    await page.getByLabel('Approach name').fill('Brute Force')
    await page.getByRole('button', { name: 'Create approach' }).click()
    await setCode('// brute force cpp\nint main(){return 0;}')
    await page.getByRole('tab', { name: 'Python', exact: true }).click()
    await setCode('# brute force python\nprint(123)')
    await page.getByRole('button', { name: 'Rename approach', exact: true }).click()
    await page.getByLabel('Approach name').fill('Two Pointers')
    await page.getByRole('button', { name: 'Save name' }).click()
    const options = await page
      .getByLabel('Approach', { exact: true })
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => ({ id: n.value, name: n.textContent })))
    await page
      .getByLabel('Approach', { exact: true })
      .selectOption(options.find((o) => o.name === 'Main').id)
    await setCode(python)
    await page.getByRole('tab', { name: 'C++', exact: true }).click()
    await expect(page.locator('.view-lines')).toContainText('long long a,b')
    await page
      .getByLabel('Approach', { exact: true })
      .selectOption(options.find((o) => o.name === 'Two Pointers').id)
    await expect(page.locator('.view-lines')).toContainText('brute force cpp')
    await page.getByRole('tab', { name: 'Python', exact: true }).click()
    await expect(page.locator('.view-lines')).toContainText('brute force python')
    await setCode('# persisted on immediate close\nprint(456)')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await new Promise((resolve) => app.process().once('exit', resolve))
    await launch()
    await expect(page.locator('.view-lines')).toContainText('persisted on immediate close')
    await expect(page.getByLabel('Approach', { exact: true })).toContainText('Two Pointers')
    const data = await page.evaluate(async () => {
      const s = await window.dsa.getSettings()
      return window.dsa.getProblem(s.problemId)
    })
    assert.equal(data.approaches.find((a) => a.name === 'Main').cppCode.replace(/\r\n/g, '\n'), cpp)
    assert.equal(
      data.approaches.find((a) => a.name === 'Main').pythonCode.replace(/\r\n/g, '\n'),
      python
    )
  })
  await record('malformed packages fail without partial imports', async () => {
    const cases = [
      ['missing-statement.zip', entries.filter(([n]) => n !== 'problem.md')],
      ['missing-output.zip', entries.filter(([n]) => n !== 'tests/sample/001.out')],
      ['missing-input.zip', entries.filter(([n]) => n !== 'tests/sample/001.in')],
      ['empty-tests.zip', entries.filter(([n]) => !n.startsWith('tests/'))]
    ]
    for (const [name, content] of cases) {
      const file = join(qaRoot, name)
      await makeZip(file, content)
      await pick(file)
      const result = await page.evaluate(() => window.dsa.importProblemZip())
      assert.equal(result.ok, false, name)
    }
    const unsafe = join(qaRoot, 'unsafe.zip')
    await makeZip(unsafe, [
      ['problem.md', '# Unsafe'],
      ['xx/bad.in', '1'],
      ['xx/bad.out', '1']
    ])
    const buffer = await readFile(unsafe)
    const from = Buffer.from('xx/bad.')
    let pos = 0
    while ((pos = buffer.indexOf(from, pos)) >= 0) {
      buffer.write('../bad.', pos, 'ascii')
      pos += from.length
    }
    await writeFile(unsafe, buffer)
    await pick(unsafe)
    assert.equal((await page.evaluate(() => window.dsa.importProblemZip())).ok, false)
    assert.equal((await page.evaluate(() => window.dsa.listProblems())).length, 1)
  })
  await record('missing compiler setup and strict IPC validation', async () => {
    const result = await page.evaluate(async () => {
      const s = await window.dsa.getSettings()
      await window.dsa.updateSettings({ cpp: { executable: 'missing-dsa-g++', argsPrefix: [] } })
      const e = await window.dsa.detectToolchains()
      await window.dsa.updateSettings({ cpp: s.cpp })
      return e.cpp
    })
    assert.equal(result.available, false)
    const rejected = await page.evaluate(async () => {
      try {
        await window.dsa.getProblem('../escape')
        return false
      } catch {
        return true
      }
    })
    assert.equal(rejected, true)
  })
  await record('environment dialog, compact layout, no renderer errors', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 768))
    await page.getByRole('button', { name: 'Environment', exact: true }).click()
    await expect(page.locator('.tool-status').first()).toBeVisible()
    await page.screenshot({ path: join(qaRoot, '04-environment.png') })
    await page.getByRole('button', { name: 'Close dialog' }).click()
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      content: document.documentElement.scrollWidth,
      height: window.innerHeight,
      contentHeight: document.documentElement.scrollHeight,
      fonts:
        document.fonts.check('13px "Space Grotesk Variable"') &&
        document.fonts.check('13px "JetBrains Mono Variable"')
    }))
    assert.equal(layout.width, layout.content)
    assert.equal(layout.height, layout.contentHeight)
    assert.equal(layout.fonts, true)
    await page.screenshot({ path: join(qaRoot, '05-compact-workspace.png') })
    assert.deepEqual(errors, [])
  })
  await record('confirmed approach and problem deletion', async () => {
    await page.getByRole('button', { name: 'Delete approach', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Delete approach', exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const data = await page.evaluate(async () =>
      window.dsa.getProblem((await window.dsa.getSettings()).problemId)
    )
    assert.equal(data.approaches.length, 1)
    await page.getByRole('button', { name: 'Delete problem', exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No problems yet' })).toBeVisible()
  })
  await writeFile(
    join(qaRoot, 'report.json'),
    JSON.stringify({ passed: report, rendererErrors: errors, packaged: !!executablePath }, null, 2)
  )
  console.log(`All ${report.length} QA scenarios passed. Artifacts: ${qaRoot}`)
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: join(qaRoot, 'failure.png') }).catch(() => {})
  console.error('Renderer errors:', errors, 'Artifacts:', qaRoot)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
}
