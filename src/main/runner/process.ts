import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { log } from '../log'
export type ProcessResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  wallTimeMs: number
  timedOut: boolean
  outputLimited: boolean
  cancelled: boolean
}
export function execute(
  executable: string,
  args: string[],
  options: {
    cwd: string
    timeout: number
    input?: Buffer
    signal?: AbortSignal
    stdoutCap?: number
    stderrCap?: number
  }
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = performance.now()
    let stdoutSize = 0
    let stderrSize = 0
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let outputLimited = false
    let cancelled = false
    let settled = false
    let killing = false
    let killTask: Promise<void> = Promise.resolve()
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    const kill = () => {
      if (killing) return
      killing = true
      if (child.pid && process.platform === 'win32') {
        const pid = child.pid
        killTask = new Promise<void>((done) => {
          const killer = spawn(
            join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(pid), '/T', '/F'],
            { shell: false, windowsHide: true, stdio: 'ignore' }
          )
          const fallback = setTimeout(() => {
            child.kill('SIGKILL')
            killer.kill()
            done()
          }, 3000)
          const end = () => {
            clearTimeout(fallback)
            child.kill('SIGKILL')
            done()
          }
          killer.once('error', end)
          killer.once('close', end)
        })
      } else child.kill('SIGKILL')
    }
    const abort = () => {
      cancelled = true
      kill()
    }
    const timer = setTimeout(
      () => {
        timedOut = true
        kill()
      },
      Math.max(0, options.timeout - (performance.now() - started))
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const collect = (chunk: Buffer, channel: 'stdout' | 'stderr') => {
      const cap =
        channel === 'stdout'
          ? (options.stdoutCap ?? 4 * 1024 * 1024)
          : (options.stderrCap ?? 1024 * 1024)
      const size = channel === 'stdout' ? stdoutSize : stderrSize
      const keep = chunk.subarray(0, Math.max(0, cap - size))
      if (keep.length) (channel === 'stdout' ? stdout : stderr).push(keep)
      if (channel === 'stdout') stdoutSize += chunk.length
      else stderrSize += chunk.length
      if (size + chunk.length > cap) {
        outputLimited = true
        kill()
      }
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'))
    child.stdin.on('error', () => {
      /* Early exit can close stdin before all input is consumed. */
    })
    child.stdin.end(options.input)
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      const wallTimeMs = performance.now() - started
      if (exitCode !== null && wallTimeMs > options.timeout && !cancelled && !outputLimited)
        timedOut = true
      void killTask.finally(() =>
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode,
          signal,
          wallTimeMs,
          timedOut,
          outputLimited,
          cancelled
        })
      )
    }
    child.once('error', (error) => {
      log('Process spawn failed', error)
      collect(Buffer.from(error.message), 'stderr')
      finish(null, null)
    })
    child.once('close', finish)
  })
}
