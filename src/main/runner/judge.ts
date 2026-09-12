import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunProgress, RunRequest, RunState, TestRunResult } from '../../shared/types'
import { Store } from '../db'
import { log } from '../log'
import { compareOutput, aggregate } from './comparator'
import { execute } from './process'
import { detect, javaRuntime } from './toolchains'
export class Judge {
  active: { state: RunState; controller: AbortController; done?: Promise<void> } | null = null
  constructor(
    private store: Store,
    private emit: (event: RunProgress) => void
  ) {}
  start(request: RunRequest): RunState {
    if (this.active) throw new Error('A run is already active. Cancel it before starting another.')
    const problem = this.store.problem(request.problemId)
    const approach = problem.approaches.find((a) => a.id === request.approachId)
    if (!approach) throw new Error('Approach does not belong to this problem.')
    this.store.saveCode(request.approachId, request.language, request.sourceCode)
    const state: RunState = {
      id: randomUUID(),
      problemId: problem.id,
      approachId: approach.id,
      approachName: approach.name,
      language: request.language,
      phase: 'compiling',
      totalCount: problem.testCount,
      timeLimitMs:
        request.language === 'cpp'
          ? problem.cppTimeLimitMs
          : request.language === 'python'
            ? problem.pythonTimeLimitMs
            : problem.javaTimeLimitMs,
      results: [],
      diagnostics: '',
      compileTimeMs: 0
    }
    const job = {
      state,
      controller: new AbortController(),
      done: undefined as Promise<void> | undefined
    }
    this.active = job
    // IPC start must return the run ID before progress starts arriving.
    job.done = new Promise<void>((resolve) =>
      setImmediate(() => {
        void this.perform(request, job).finally(resolve)
      })
    )
    return structuredClone(state)
  }
  cancel(id: string): void {
    if (this.active?.state.id === id) this.active.controller.abort()
  }
  async shutdown(): Promise<void> {
    const job = this.active
    job?.controller.abort()
    await job?.done
  }
  private async perform(request: RunRequest, job: NonNullable<Judge['active']>): Promise<void> {
    const { state, controller } = job
    let directory: string | undefined
    try {
      const problem = this.store.problem(request.problemId)
      const environment = await detect(this.store.settings())
      const tool = environment[request.language]
      if (controller.signal.aborted) {
        state.verdict = 'CANCELLED'
        return
      }
      if (!tool.available) {
        state.verdict = 'COMPILE_ERROR'
        const toolName =
          request.language === 'cpp'
            ? 'C++ compiler'
            : request.language === 'python'
              ? 'Python 3'
              : 'Java compiler/runtime'
        state.diagnostics = `${toolName} not found.\n\nOpen Environment to configure the executable and recheck.\n${tool.message}`
        return
      }
      directory = await mkdtemp(join(tmpdir(), 'dsa-lab-run-'))
      const file =
        request.language === 'cpp'
          ? 'solution.cpp'
          : request.language === 'python'
            ? 'solution.py'
            : 'Main.java'
      await writeFile(join(directory, file), request.sourceCode, 'utf8')
      const compileArgs =
        request.language === 'cpp'
          ? [file, '-std=c++20', '-O2', '-Wall', '-Wextra', '-o', 'program.exe']
          : request.language === 'python'
            ? ['-m', 'py_compile', file]
            : ['-encoding', 'UTF-8', file]
      const compile = await execute(
        tool.command.executable,
        [...tool.command.argsPrefix, ...compileArgs],
        { cwd: directory, timeout: 60000, signal: controller.signal }
      )
      state.compileTimeMs = compile.wallTimeMs
      state.diagnostics = compile.stdout + compile.stderr
      if (compile.cancelled) {
        state.verdict = 'CANCELLED'
        return
      }
      if (compile.exitCode !== 0 || compile.timedOut || compile.outputLimited) {
        state.verdict = 'COMPILE_ERROR'
        if (compile.timedOut) state.diagnostics += '\nCompilation exceeded the 60 second limit.'
        if (compile.outputLimited)
          state.diagnostics +=
            '\nCompiler output exceeded the capture limit; diagnostics are truncated.'
        return
      }
      state.phase = 'running'
      this.emit({ runId: state.id, state: structuredClone(state) })
      let retained = 0
      const retentionCap = 8 * 1024 * 1024
      for (const group of problem.groups)
        for (const test of group.tests) {
          if (controller.signal.aborted) {
            state.verdict = 'CANCELLED'
            return
          }
          const stored = this.store.test(test.id)
          let result: TestRunResult
          try {
            const input = await readFile(this.store.path(stored.inputPath))
            const expected = await readFile(this.store.path(stored.outputPath), 'utf8')
            const executable =
              request.language === 'cpp'
                ? join(directory, 'program.exe')
                : request.language === 'python'
                  ? tool.command.executable
                  : javaRuntime(tool.command.executable)
            const args =
              request.language === 'cpp'
                ? []
                : request.language === 'python'
                  ? [...tool.command.argsPrefix, '-B', file]
                  : ['-Dfile.encoding=UTF-8', '-cp', directory, 'Main']
            const process = await execute(executable, args, {
              cwd: directory,
              timeout: state.timeLimitMs,
              input,
              signal: controller.signal
            })
            if (process.cancelled) {
              state.verdict = 'CANCELLED'
              return
            }
            const verdict = process.outputLimited
              ? 'OLE'
              : process.timedOut
                ? 'TLE'
                : process.exitCode !== 0
                  ? 'RE'
                  : compareOutput(process.stdout, expected, problem.outputComparison)
                    ? 'AC'
                    : 'WA'
            const stdout =
              verdict === 'AC'
                ? ''
                : process.stdout.slice(0, Math.max(0, Math.min(16384, retentionCap - retained)))
            retained += Buffer.byteLength(stdout)
            const stderr = process.stderr.slice(
              0,
              Math.max(0, Math.min(16384, retentionCap - retained))
            )
            retained += Buffer.byteLength(stderr)
            result = {
              testId: test.id,
              verdict,
              wallTimeMs: process.wallTimeMs,
              stdout,
              stderr,
              exitCode: process.exitCode,
              signal: process.signal,
              timedOut: process.timedOut,
              outputLimited: process.outputLimited,
              truncated:
                (verdict !== 'AC' && stdout.length < process.stdout.length) ||
                stderr.length < process.stderr.length
            }
          } catch (error) {
            log('Test execution error', error)
            result = {
              testId: test.id,
              verdict: 'RE',
              wallTimeMs: 0,
              stdout: '',
              stderr: `Could not execute test: ${String(error)}`,
              exitCode: null,
              signal: null,
              timedOut: false,
              outputLimited: false,
              truncated: false
            }
          }
          state.results.push(result)
          this.emit({ runId: state.id, result })
        }
      state.verdict = aggregate(state.results.map((r) => r.verdict))
    } catch (error) {
      log('Runner failure', error)
      state.verdict = controller.signal.aborted
        ? 'CANCELLED'
        : state.phase === 'compiling'
          ? 'COMPILE_ERROR'
          : 'FAILED'
      state.diagnostics += `\n${String(error)}`
    } finally {
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(
          (error) => log('Run temp cleanup failed', error)
        )
      state.phase = 'complete'
      try {
        this.store.recordRun(state)
      } catch (error) {
        log('Run history save failed', error)
      }
      this.active = null
      this.emit({ runId: state.id, state: structuredClone(state) })
    }
  }
}
