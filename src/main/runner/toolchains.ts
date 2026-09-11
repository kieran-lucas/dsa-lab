import { tmpdir } from 'node:os'
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
export async function detect(settings: Settings): Promise<{ cpp: ToolStatus; python: ToolStatus }> {
  const cppPromise = probe(settings.cpp)
  let python: ToolStatus
  if (settings.python.executable) python = await probe(settings.python)
  else {
    python = await probe({ executable: 'py', argsPrefix: ['-3'] })
    if (!python.available) python = await probe({ executable: 'python', argsPrefix: [] })
  }
  if (python.available && !/^Python 3\./.test(python.version))
    python = { ...python, available: false, message: 'Python 3 is required.' }
  const cpp = await cppPromise
  log(
    `Toolchains: C++ ${cpp.available ? cpp.version : 'unavailable'}; Python ${python.available ? python.version : 'unavailable'}`
  )
  return { cpp, python }
}
