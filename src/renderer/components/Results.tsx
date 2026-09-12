import { useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleX,
  Clock3,
  Copy,
  FlaskConical,
  LoaderCircle,
  Square,
  Terminal
} from 'lucide-react'
import type { Language, Problem, RunState, TestRunResult, TestText } from '../../shared/types'
const labels = {
  AC: 'Accepted',
  WA: 'Wrong Answer',
  TLE: 'Time Limit Exceeded',
  RE: 'Runtime Error',
  OLE: 'Output Limit Exceeded'
}
const verdictLabel = {
  PASSED: 'Passed',
  FAILED: 'Failed',
  COMPILE_ERROR: 'Compile Error',
  CANCELLED: 'Cancelled'
}
const languageVersion = (language: Language) =>
  language === 'cpp' ? 'C++20' : language === 'python' ? 'Python 3' : 'Java'
const timeLimit = (problem: Problem, language: Language) =>
  language === 'cpp'
    ? problem.cppTimeLimitMs
    : language === 'python'
      ? problem.pythonTimeLimitMs
      : problem.javaTimeLimitMs
export const time = (ms: number) => (ms < 1000 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(0)} ms`)
function Output({
  title,
  text,
  truncated = false
}: {
  title: string
  text: string
  truncated?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="output-block">
      <div className="output-label">
        <span>
          {title}
          {truncated ? ' · preview truncated' : ''}
        </span>
        <button
          className="icon-button"
          aria-label={`Copy ${title}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
              .catch(() => setError('Copy failed'))
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre>{text || '(empty)'}</pre>
      {error && <small>{error}</small>}
    </div>
  )
}
function TestRow({ result, name, limit }: { result: TestRunResult; name: string; limit: number }) {
  const [text, setText] = useState<TestText | null>(null)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)
  return (
    <details
      className={`test-row ${result.verdict === 'AC' ? '' : 'failed'}`}
      onToggle={(event) => {
        if (event.currentTarget.open && !opened) {
          setOpened(true)
          void window.dsa
            .getTestText(result.testId)
            .then(setText)
            .catch((e) => setError(String(e)))
        }
      }}
    >
      <summary>
        <ChevronRight size={12} />
        <span className="case-name">#{name}</span>
        <span
          className={`verdict ${result.verdict === 'AC' ? 'success' : result.verdict === 'TLE' ? 'warning' : 'danger'}`}
        >
          {result.verdict}
        </span>
        <span className="test-time">{time(result.wallTimeMs)}</span>
      </summary>
      <div className="test-detail">
        <div className="detail-meta">
          <b>{labels[result.verdict]}</b>
          <span>
            Exit {result.exitCode ?? '—'}
            {result.signal ? ` · ${result.signal}` : ''} · Wall time {time(result.wallTimeMs)}
          </span>
        </div>
        {result.timedOut && (
          <p className="warning-text">
            Limit: <span className="mono">{limit} ms</span>. The process was terminated and the
            suite continued.
          </p>
        )}
        {result.outputLimited && (
          <p className="danger-text">
            Process terminated: stdout exceeded 4 MB or stderr exceeded 1 MB.
          </p>
        )}
        {result.stderr && (
          <Output title="Stderr" text={result.stderr} truncated={result.truncated} />
        )}
        {error ? (
          <p className="danger-text">{error}</p>
        ) : text ? (
          <>
            <div className="output-pair">
              <Output
                title="Expected output"
                text={text.expected}
                truncated={text.expectedTruncated}
              />
              <Output
                title="Actual output"
                text={
                  result.verdict === 'AC'
                    ? 'Accepted · output matched. Successful stdout is not retained.'
                    : result.stdout
                }
                truncated={result.truncated}
              />
            </div>
            <Output title="Input" text={text.input} truncated={text.inputTruncated} />
          </>
        ) : (
          <p>Loading test…</p>
        )}
      </div>
    </details>
  )
}
export function Results({
  problem,
  run,
  language,
  onJump
}: {
  problem: Problem
  run: RunState | null
  language: Language
  onJump: (line: number) => void
}) {
  const byId = useMemo(() => new Map(run?.results.map((r) => [r.testId, r]) ?? []), [run])
  const [failuresOnly, setFailuresOnly] = useState(false)
  const failureCount = run?.results.filter((r) => r.verdict !== 'AC').length ?? 0
  const passed = run?.results.filter((r) => r.verdict === 'AC').length ?? 0
  const totalTime = run?.results.reduce((n, r) => n + r.wallTimeMs, 0) ?? 0
  const active = run && run.phase !== 'complete'
  const line = run
    ? (/solution\.cpp:(\d+):/.exec(run.diagnostics)?.[1] ??
      /solution\.py", line (\d+)/.exec(run.diagnostics)?.[1] ??
      /Main\.java:(\d+):/.exec(run.diagnostics)?.[1])
    : null
  return (
    <section className="results-pane" aria-label="Test results">
      <div className="panel-label">
        <div>
          <FlaskConical size={14} />
          <span>Test results</span>
          {run && <span className="subtle-tag">{languageVersion(run.language)}</span>}
        </div>
        <span>{run?.timeLimitMs ?? timeLimit(problem, language)} ms / test</span>
      </div>
      {!run ? (
        <div className="results-empty">
          <div className="empty-small-icon">
            <Terminal size={20} />
          </div>
          <p>Test your approach</p>
          <span>Run your solution to see test results.</span>
          <kbd>Ctrl + Enter</kbd>
        </div>
      ) : (
        <div className="results-scroll">
          <div
            className={`run-summary ${run.verdict === 'PASSED' ? 'summary-passed' : run.verdict === 'FAILED' ? 'summary-failed' : ''}`}
            aria-live="polite"
          >
            <div
              className={`run-status ${run.verdict === 'PASSED' ? 'success' : run.verdict === 'FAILED' || run.verdict === 'COMPILE_ERROR' ? 'danger' : ''}`}
            >
              {active ? (
                <LoaderCircle size={17} className="spin" />
              ) : run.verdict === 'PASSED' ? (
                <CheckCircle2 size={17} />
              ) : run.verdict === 'CANCELLED' ? (
                <Square size={15} />
              ) : (
                <CircleX size={17} />
              )}
              <strong>
                {active
                  ? run.phase === 'compiling'
                    ? 'Checking source…'
                    : `Running ${run.results.length} / ${run.totalCount}…`
                  : verdictLabel[run.verdict!]}
              </strong>
              <span className="run-pass-count">
                {passed} / {run.totalCount} passed
              </span>
            </div>
            <div className="run-stats">
              <span title={run.approachName} className="run-approach">
                {run.approachName}
              </span>
              <span>
                <Clock3 size={12} /> Total <b>{time(totalTime)}</b>
              </span>
              {run.results.length > 0 && (
                <>
                  <span>
                    Avg <b>{time(totalTime / run.results.length)}</b>
                  </span>
                  <span>
                    Slowest <b>{time(Math.max(...run.results.map((r) => r.wallTimeMs)))}</b>
                  </span>
                </>
              )}
            </div>
            {active && (
              <div className="progress-track">
                <div style={{ width: `${(run.results.length / run.totalCount) * 100}%` }} />
              </div>
            )}
          </div>
          {run.diagnostics && (
            <details className="diagnostics" open={run.verdict === 'COMPILE_ERROR'}>
              <summary>
                <ChevronRight size={13} />
                {run.verdict === 'COMPILE_ERROR'
                  ? 'Compiler / syntax diagnostics'
                  : 'Compiler output'}
                <span>{time(run.compileTimeMs)}</span>
              </summary>
              {line && (
                <button className="text-button" onClick={() => onJump(+line)}>
                  Go to line {line}
                </button>
              )}
              <Output title="Diagnostics" text={run.diagnostics} />
            </details>
          )}
          {run.verdict === 'COMPILE_ERROR' ? (
            <p className="no-tests">No tests ran. Fix the diagnostics above, then run again.</p>
          ) : (
            <>
              <div className="results-filter" role="group" aria-label="Filter test results">
                <button aria-pressed={!failuresOnly} onClick={() => setFailuresOnly(false)}>
                  All tests <span>{run.totalCount}</span>
                </button>
                <button aria-pressed={failuresOnly} onClick={() => setFailuresOnly(true)}>
                  Failures <span>{failureCount}</span>
                </button>
                <span className="filter-hint">{problem.groups.length} groups</span>
              </div>
              {failuresOnly && failureCount === 0 && (
                <p className="filter-empty">
                  {active ? 'No failures so far.' : 'No failed tests in this run.'}
                </p>
              )}
              {problem.groups.map((group) => {
                const completed = group.tests
                  .map((t) => byId.get(t.id))
                  .filter((r): r is TestRunResult => !!r)
                const accepted = completed.filter((t) => t.verdict === 'AC').length
                const failed = completed.some((t) => t.verdict !== 'AC')
                const done = completed.length === group.tests.length
                if (failuresOnly && !failed) return null
                return (
                  <details
                    className="test-group"
                    key={`${group.id}-${failuresOnly}`}
                    open={failuresOnly || undefined}
                  >
                    <summary>
                      <ChevronRight size={13} />
                      <span className="group-name" title={group.name}>
                        {group.name}
                      </span>
                      <span className="group-count">
                        {accepted} / {group.tests.length}
                      </span>
                      <span
                        className={`group-state ${failed ? 'danger' : done ? 'success' : 'muted'}`}
                      >
                        {failed ? (
                          <CircleX size={12} />
                        ) : done ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <Clock3 size={12} />
                        )}{' '}
                        {failed
                          ? 'Failed'
                          : done
                            ? 'Passed'
                            : run.verdict === 'CANCELLED'
                              ? 'Cancelled'
                              : 'Pending'}
                      </span>
                    </summary>
                    {group.tests.map((test) => {
                      const result = byId.get(test.id)
                      if (failuresOnly && (!result || result.verdict === 'AC')) return null
                      return result ? (
                        <TestRow
                          key={test.id}
                          result={result}
                          name={test.name}
                          limit={run.timeLimitMs}
                        />
                      ) : (
                        <div className="pending-test" key={test.id}>
                          <span>#{test.name}</span>
                          <span>{active ? 'Waiting' : 'Not run'}</span>
                        </div>
                      )
                    })}
                  </details>
                )
              })}
            </>
          )}
          <div className="results-note">
            Sequential execution · wall-clock process time
            {run.phase === 'complete' && run.compileTimeMs > 0 && (
              <>
                {' '}
                · Preflight <span className="mono">{time(run.compileTimeMs)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
