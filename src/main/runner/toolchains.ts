import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { Settings, ToolCommand, ToolStatus } from '../../shared/types'
import { execute } from './process'
import { log } from '../log'
async function probe(command: ToolCommand): Promise<ToolStatus> {
  const result = await execute(command.executable, [...command.argsPrefix, '--version'], {
    cwd: tmpdir(),
    timeout: 5000,
    stdoutCap: 16384,
    stderrCap: 16384
  })
  const available = result.exitCode === 0 && !result.timedOut && !result.outputLimited
  return {
    command,
    available,
    version: available ? (result.stdout || result.stderr).trim().split(/\r?\n/)[0] : '',
    message: available
      ? ''
      : result.timedOut
        ? 'Version check timed out.'
        : result.stderr.trim() || 'Executable could not be started.'
  }
}
export function javaRuntime(compiler: string): string {
  if (!compiler.includes('/') && !compiler.includes('\\')) return 'java'
  const extension = extname(compiler)
  const name = basename(compiler, extension).toLowerCase()
  return name === 'javac' ? join(dirname(compiler), `java${extension}`) : 'java'
}
export async function detect(
  settings: Settings
): Promise<{ cpp: ToolStatus; python: ToolStatus; java: ToolStatus }> {
  const cppPromise = probe(settings.cpp)
  const javaCompilerPromise = probe(settings.java)
  let python: ToolStatus
  if (settings.python.executable) python = await probe(settings.python)
  else {
    python = await probe({ executable: 'py', argsPrefix: ['-3'] })
    if (!python.available) python = await probe({ executable: 'python', argsPrefix: [] })
  }
  if (python.available && !/^Python 3\./.test(python.version))
    python = { ...python, available: false, message: 'Python 3 is required.' }
  const cpp = await cppPromise
  const javaCompiler = await javaCompilerPromise
  const runtime = await probe({ executable: javaRuntime(settings.java.executable), argsPrefix: [] })
  const java = runtime.available
    ? javaCompiler
    : {
        ...javaCompiler,
        available: false,
        message: javaCompiler.available
          ? `Java runtime could not be started: ${runtime.message}`
          : javaCompiler.message
      }
  log(
    `Toolchains: C++ ${cpp.available ? cpp.version : 'unavailable'}; Python ${python.available ? python.version : 'unavailable'}; Java ${java.available ? java.version : 'unavailable'}`
  )
  return { cpp, python, java }
}
