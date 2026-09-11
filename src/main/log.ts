import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
let logFile = ''
export function initLog(directory: string): void {
  logFile = join(directory, 'app.log')
}
export function log(message: string, error?: unknown): void {
  const line = `${new Date().toISOString()} ${message}${error ? `: ${String(error)}` : ''}\n`
  console.log(line.trim())
  if (!logFile) return
  try {
    if (existsSync(logFile) && statSync(logFile).size > 2 * 1024 * 1024)
      renameSync(logFile, logFile + '.old')
    appendFileSync(logFile, line)
  } catch {
    /* Logging must never prevent recovery. */
  }
}
