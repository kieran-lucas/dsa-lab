import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'

await mkdir('.qa', { recursive: true })
const directory = await mkdtemp(resolve('.qa/startup-renderer-'))
const executablePath = resolve(process.env.DSA_QA_EXECUTABLE || 'release/win-unpacked/DSA Lab.exe')
const report = []
for (let run = 0; run < 4; run++) {
  let app
  try {
    const started = performance.now()
    app = await electron.launch({
      executablePath,
      args: [],
      env: { ...process.env, DSA_LAB_DATA_DIR: directory }
    })
    const page = await app.firstWindow()
    if (run === 0) {
      await expect(page.getByRole('heading', { name: 'No problems yet' })).toBeVisible()
      const resources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((r) => r.name)
      )
      assert.equal(
        resources.some((url) => /CodeEditor-/.test(url)),
        false,
        'Empty library should not load Monaco'
      )
    } else {
      await expect(page.locator('.view-lines')).toContainText('startup-preserved')
      await expect(page.getByRole('button', { name: 'Run All' })).toBeEnabled()
    }
    const result = {
      run,
      state: run ? 'restored-editor' : 'empty-library',
      readyMs: Math.round(performance.now() - started)
    }
    report.push(result)
    console.log(JSON.stringify(result))
    if (run === 0) {
      await app.evaluate(({ dialog }, fixture) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
      }, resolve('fixtures/sum-of-two-numbers.zip'))
      await page.evaluate(async () => {
        const imported = await window.dsa.importProblemZip()
        if (!imported.ok) throw new Error('Fixture import failed')
        const problemId = await window.dsa.confirmImport(imported.preview.token, null)
        const problem = await window.dsa.getProblem(problemId)
        const approachId = problem.approaches[0].id
        await window.dsa.saveCode(approachId, 'python', 'print("startup-preserved")\n')
        await window.dsa.updateSettings({ problemId, approachId, language: 'python' })
      })
    }
  } finally {
    if (app) await app.close()
  }
}
await writeFile(
  join(directory, 'startup-report.json'),
  JSON.stringify({ executablePath, report }, null, 2)
)
console.log(`PASS: deferred editor and saved-code restoration. ${directory}`)
