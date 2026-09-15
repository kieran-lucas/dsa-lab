import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'

await mkdir('.qa', { recursive: true })
const directory = await mkdtemp(resolve('.qa/dev-'))
const child = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev'], {
  shell: false,
  windowsHide: true,
  env: { ...process.env, DSA_LAB_DATA_DIR: directory, REMOTE_DEBUGGING_PORT: '9337' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})
let browser
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9337', { timeout: 700 })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  assert.ok(browser, output)
  const context = browser.contexts()[0]
  let page = context.pages()[0]
  if (!page) page = await context.waitForEvent('page')
  page.on('pageerror', (error) => {
    output += `\nRenderer error: ${error}`
  })
  page.on('console', (message) => {
    if (message.type() === 'error') output += `\nRenderer console: ${message.text()}`
  })
  page.on('requestfailed', (request) => {
    output += `\nRequest failed: ${request.url()} ${request.failure()?.errorText}`
  })
  await page.waitForFunction(() => !!window.dsa, null, { timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'No problems yet' })).toBeVisible({
    timeout: 30000
  })
  const list = await page.evaluate(() => window.dsa.listProblems())
  assert.deepEqual(list, [])
  await page.screenshot({ path: join(directory, 'dev.png') })
  assert.doesNotMatch(
    output,
    /Refused to execute|Content Security Policy.*violat|Startup failure|Untrusted IPC sender/
  )
  console.log(`Development launch passed. ${directory}`)
} finally {
  await writeFile(join(directory, 'dev.log'), output)
  if (browser) await browser.close()
  await new Promise((resolve) => {
    const kill = spawn(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, shell: false, stdio: 'ignore' }
    )
    kill.on('close', resolve)
  })
}
