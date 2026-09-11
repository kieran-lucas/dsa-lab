import { expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { execute } from '../src/main/runner/process'
const options = { cwd: tmpdir(), timeout: 3000 }
it('captures stdin, stdout, stderr, exit code and wall time', async () => {
  const result = await execute(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout); process.stderr.write("diagnostic")'],
    { ...options, input: Buffer.from('hello') }
  )
  expect(result.stdout).toBe('hello')
  expect(result.stderr).toBe('diagnostic')
  expect(result.exitCode).toBe(0)
  expect(result.wallTimeMs).toBeGreaterThan(0)
})
it('reports spawn errors', async () => {
  const result = await execute('dsa-lab-nonexistent-tool-70933', [], options)
  expect(result.exitCode).toBeNull()
  expect(result.stderr).toContain('ENOENT')
})
it('terminates timeouts and then runs another process', async () => {
  const result = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    ...options,
    timeout: 150
  })
  expect(result.timedOut).toBe(true)
  expect(result.wallTimeMs).toBeLessThan(4500)
  expect(
    (await execute(process.execPath, ['-e', 'process.stdout.write("next")'], options)).stdout
  ).toBe('next')
})
it('caps output and terminates a runaway process', async () => {
  const result = await execute(
    process.execPath,
    ['-e', 'while(true) process.stdout.write("x".repeat(4096))'],
    { ...options, stdoutCap: 16384 }
  )
  expect(result.outputLimited).toBe(true)
  expect(Buffer.byteLength(result.stdout)).toBe(16384)
})
it('cancels the active child', async () => {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 150)
  const result = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    ...options,
    signal: controller.signal
  })
  expect(result.cancelled).toBe(true)
})
