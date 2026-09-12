import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  FileArchive,
  FolderInput,
  HardDrive,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  Settings2,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type {
  ImportPreview,
  LibraryFolder,
  Language,
  Problem,
  ProblemSummary,
  RunState,
  Settings
} from '../shared/types'
import { CodeEditor } from './components/CodeEditor'
import { Modal, ZipHelp } from './components/Modal'
import { Environment } from './components/Environment'
import { Results } from './components/Results'
import { Library, FolderSelect, folderPath } from './components/Library'
import {
  CODE_FONT_SIZE_KEY,
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  readCodeFontSize,
  SettingsPanel
} from './components/SettingsPanel'

type Dialog =
  | 'import'
  | 'help'
  | 'settings'
  | 'environment'
  | 'create'
  | 'rename'
  | 'delete-approach'
  | 'delete-problem'
  | 'move-problem'
  | null
type Pending = { id: string; language: Language; code: string; revision: number }
const languageName = (language: Language) =>
  language === 'cpp' ? 'C++' : language === 'python' ? 'Python' : 'Java'
const languageVersion = (language: Language) =>
  language === 'cpp' ? 'C++20' : language === 'python' ? 'Python 3' : 'Java'
const sourceFile = (language: Language) =>
  language === 'cpp' ? 'solution.cpp' : language === 'python' ? 'solution.py' : 'Main.java'
const approachSource = (
  approach: NonNullable<Problem['approaches'][number]>,
  language: Language
) =>
  language === 'cpp'
    ? approach.cppCode
    : language === 'python'
      ? approach.pythonCode
      : approach.javaCode
const sourceField = (language: Language) =>
  language === 'cpp' ? 'cppCode' : language === 'python' ? 'pythonCode' : 'javaCode'
const Statement = memo(function Statement({ problem }: { problem: Problem }) {
  return (
    <article className="statement-body">
      <div className="statement-eyebrow">{problem.topic || 'PROBLEM'}</div>
      <h1>{problem.title}</h1>
      <div className="problem-facts">
        <span>{problem.testCount} test cases</span>
        <span>{problem.groups.length} groups</span>
        <span>
          {problem.outputComparison === 'tokens' ? 'Token comparison' : 'Exact comparison'}
        </span>
      </div>
      <div className="markdown">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children }) => <span className="statement-link">{children}</span>,
            img: ({ alt }) => (
              <span className="muted">[Image: {alt || 'not included in text package'}]</span>
            )
          }}
        >
          {problem.statement.replace(/^#\s+.+(?:\r?\n|$)/, '')}
        </Markdown>
      </div>
    </article>
  )
})
export function App() {
  const [codeFontSize, setCodeFontSize] = useState(readCodeFontSize)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [destination, setDestination] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [approachId, setApproachId] = useState('')
  const [language, setLanguage] = useState<Language>('cpp')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importIssues, setImportIssues] = useState<string[]>([])
  const [importBusy, setImportBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [run, setRun] = useState<RunState | null>(null)
  const [name, setName] = useState('')
  const [modalError, setModalError] = useState('')
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null)
  const pending = useRef<Pending | null>(null)
  const revision = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const currentRunId = useRef<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchRequested = useRef(false)
  const workspace = useRef<HTMLDivElement>(null)
  const coding = useRef<HTMLDivElement>(null)
  const active = !!run && run.phase !== 'complete'
  const approach = problem?.approaches.find((a) => a.id === approachId)
  const sidebarCollapsed = settings?.sidebarCollapsed ?? false
  useEffect(() => {
    document.documentElement.style.setProperty('--code-font-size', `${codeFontSize}px`)
    localStorage.setItem(CODE_FONT_SIZE_KEY, String(codeFontSize))
  }, [codeFontSize])
  useEffect(() => {
    if (!sidebarCollapsed && searchRequested.current) {
      searchRequested.current = false
      searchInput.current?.focus()
    }
  }, [sidebarCollapsed])
  const report = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : String(e)
    )
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const item = pending.current
    if (!item) {
      await saveChain.current
      return
    }
    setSaveStatus('Saving…')
    const operation = saveChain.current
      .catch(() => {})
      .then(() => window.dsa.saveCode(item.id, item.language, item.code))
    saveChain.current = operation
    try {
      await operation
      if (pending.current?.revision === item.revision) {
        pending.current = null
        setSaveStatus('Saved')
      }
    } catch (e) {
      setSaveStatus('Save failed')
      report(e)
      throw e
    }
  }, [])
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.dsa.updateSettings(patch)
    setSettings(next)
    return next
  }, [])
  const focusSearch = () => {
    if (!sidebarCollapsed) {
      searchInput.current?.focus()
      return
    }
    searchRequested.current = true
    void updateSettings({ sidebarCollapsed: false }).catch((error) => {
      searchRequested.current = false
      report(error)
    })
  }
  const toggleSidebar = useCallback(() => {
    if (!settings) return
    void updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed }).catch(report)
  }, [settings, updateSettings])
  const changeCodeFontSize = (size: number) =>
    setCodeFontSize(Math.max(MIN_CODE_FONT_SIZE, Math.min(MAX_CODE_FONT_SIZE, Math.round(size))))
  const loadProblem = useCallback(
    async (id: string, preferred?: string, lang?: Language) => {
      const item = await window.dsa.getProblem(id)
      const next = item.approaches.find((a) => a.id === preferred) ?? item.approaches[0]
      const chosenLanguage = lang ?? language
      setProblem(item)
      setApproachId(next?.id ?? '')
      setSource(next ? approachSource(next, chosenLanguage) : '')
      setLanguage(chosenLanguage)
      setRun(null)
      currentRunId.current = null
      setJump(null)
      await updateSettings({
        problemId: id,
        approachId: next?.id ?? null,
        language: chosenLanguage
      })
      setProblems(await window.dsa.listProblems())
    },
    [language, updateSettings]
  )
  useEffect(() => {
    let mounted = true
    void (async () => {
      const [state, list, folderList] = await Promise.all([
        window.dsa.getSettings(),
        window.dsa.listProblems(),
        window.dsa.listFolders()
      ])
      if (!mounted) return
      setSettings(state)
      setProblems(list)
      setFolders(folderList)
      setLanguage(state.language)
      const initial = list.find((p) => p.id === state.problemId) ?? list[0]
      if (initial) await loadProblem(initial.id, state.approachId ?? undefined, state.language)
      if (mounted) setInitialized(true)
    })().catch(report)
    return () => {
      mounted = false
    }
    // Initial restoration only; subsequent navigation is explicit.
  }, [])
  useEffect(
    () =>
      window.dsa.onBeforeClose(() => {
        void flush()
          .then(() => window.dsa.readyToClose())
          .catch(() => {})
      }),
    [flush]
  )
  useEffect(() => {
    if (!active) return
    return window.dsa.onRunProgress((event) => {
      if (event.runId !== currentRunId.current) return
      if (event.state) setRun(event.state)
      else if (event.result)
        setRun((previous) =>
          previous ? { ...previous, results: [...previous.results, event.result!] } : previous
        )
    })
  }, [active])
  const edit = (code: string) => {
    setSource(code)
    pending.current = { id: approachId, language, code, revision: ++revision.current }
    setSaveStatus('Saving…')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void flush().catch(() => {})
    }, 450)
  }
  const rememberSource = () =>
    setProblem((previous) =>
      previous
        ? {
            ...previous,
            approaches: previous.approaches.map((a) =>
              a.id === approachId ? { ...a, [sourceField(language)]: source } : a
            )
          }
        : previous
    )
  const switchProblem = async (id: string) => {
    if (active || busy || id === problem?.id) return
    setBusy(true)
    try {
      await flush()
      await loadProblem(id)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  const switchApproach = async (id: string) => {
    if (!problem || busy || active) return
    setBusy(true)
    try {
      await flush()
      rememberSource()
      const next = problem.approaches.find((a) => a.id === id)
      if (!next) return
      setApproachId(id)
      setSource(approachSource(next, language))
      setRun(null)
      setJump(null)
      await updateSettings({ approachId: id })
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  const switchLanguage = async (next: Language) => {
    if (next === language || !approach || active || busy) return
    setBusy(true)
    try {
      await flush()
      rememberSource()
      setLanguage(next)
      setSource(approachSource(approach, next))
      setRun(null)
      setJump(null)
      await updateSettings({ language: next })
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  const runAll = async () => {
    if (!problem || !approach || active || busy || dialog) return
    setBusy(true)
    setError('')
    try {
      await flush()
      rememberSource()
      const state = await window.dsa.runSolution({
        problemId: problem.id,
        approachId,
        language,
        sourceCode: source
      })
      currentRunId.current = state.id
      setRun(state)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  const keyboard = useRef({ runAll, flush, focusSearch, toggleSidebar })
  keyboard.current = { runAll, flush, focusSearch, toggleSidebar }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
      if (event.key === 'Enter') {
        event.preventDefault()
        void keyboard.current.runAll()
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void keyboard.current.flush().catch(() => {})
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        keyboard.current.focusSearch()
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        keyboard.current.toggleSidebar()
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])
  const openDialog = (next: Dialog) => {
    setModalError('')
    setName(next === 'rename' ? (approach?.name ?? '') : '')
    setDialog(next)
    if (next === 'move-problem') setDestination(problem?.folderId ?? 'root')
  }
  const chooseZip = async () => {
    if (dialog !== 'import') setDestination('')
    setDialog('import')
    setImportBusy(true)
    setImportIssues([])
    setPreview(null)
    try {
      const result = await window.dsa.importProblemZip()
      if ('cancelled' in result) return
      if (result.ok) setPreview(result.preview)
      else setImportIssues(result.issues)
    } catch (e) {
      setImportIssues([String(e)])
    } finally {
      setImportBusy(false)
    }
  }
  const closeImport = () => {
    if (importBusy) return
    if (preview) void window.dsa.discardImport(preview.token).catch(report)
    setPreview(null)
    setDialog(null)
  }
  const confirmImport = async () => {
    if (!preview) return
    setImportBusy(true)
    try {
      await flush()
      if (!destination) throw new Error('Choose an import destination.')
      const folderId = destination === 'root' ? null : destination
      const id = await window.dsa.confirmImport(preview.token, folderId)
      await revealFolder(folderId)
      await loadProblem(id)
      setPreview(null)
      setDialog(null)
    } catch (e) {
      setImportIssues([String(e)])
      setPreview(null)
    } finally {
      setImportBusy(false)
    }
  }
  const mutateApproach = async () => {
    if (!problem) return
    setBusy(true)
    setModalError('')
    try {
      await flush()
      let nextId = approachId
      if (dialog === 'create')
        nextId = (await window.dsa.createApproach(problem.id, name.trim())).id
      else if (dialog === 'rename') await window.dsa.renameApproach(approachId, name.trim())
      else if (dialog === 'delete-approach') {
        await window.dsa.deleteApproach(approachId)
        nextId = ''
      }
      await loadProblem(problem.id, nextId)
      setDialog(null)
    } catch (e) {
      setModalError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const deleteProblem = async () => {
    if (!problem) return
    setBusy(true)
    try {
      await flush()
      await window.dsa.deleteProblem(problem.id)
      const list = await window.dsa.listProblems()
      setProblems(list)
      if (list.length) await loadProblem(list[0].id)
      else {
        setProblem(null)
        setApproachId('')
        setSource('')
        setRun(null)
      }
      setDialog(null)
    } catch (e) {
      setModalError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const resize = (
    event: React.PointerEvent<HTMLDivElement>,
    axis: 'statementWidth' | 'editorHeight'
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const element = event.currentTarget
    const bounds = (axis === 'statementWidth' ? workspace : coding).current!.getBoundingClientRect()
    let latest = settings![axis]
    const move = (e: PointerEvent) => {
      latest =
        axis === 'statementWidth'
          ? Math.max(24, Math.min(55, ((e.clientX - bounds.left) / bounds.width) * 100))
          : Math.max(30, Math.min(75, ((e.clientY - bounds.top) / bounds.height) * 100))
      setSettings((previous) => (previous ? { ...previous, [axis]: latest } : previous))
    }
    const end = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
      void updateSettings({ [axis]: latest }).catch(report)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
  }
  const refreshLibrary = async () => {
    const [list, folderList, state] = await Promise.all([
      window.dsa.listProblems(),
      window.dsa.listFolders(),
      window.dsa.getSettings()
    ])
    setProblems(list)
    setFolders(folderList)
    setSettings(state)
  }
  const revealFolder = async (folderId: string | null) => {
    const ancestors: string[] = []
    let next = folderId
    while (next) {
      ancestors.push(next)
      next = folders.find((f) => f.id === next)?.parentId ?? null
    }
    await updateSettings({
      selectedFolderId: folderId,
      expandedFolderIds: [...new Set([...(settings?.expandedFolderIds ?? []), ...ancestors])]
    })
  }
  const moveProblem = async () => {
    if (!problem || !destination) return
    setBusy(true)
    setModalError('')
    try {
      await flush()
      const folderId = destination === 'root' ? null : destination
      await window.dsa.moveProblem(problem.id, folderId)
      setProblem((previous) => (previous ? { ...previous, folderId } : previous))
      await revealFolder(folderId)
      await refreshLibrary()
      setDialog(null)
    } catch (e) {
      setModalError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Braces size={19} />
          </span>
          <span>DSA Lab</span>
          <span className="local-label">LOCAL</span>
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-controls="library-panel"
            aria-expanded={!sidebarCollapsed}
            aria-keyshortcuts="Control+B"
            disabled={!settings}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <div className="breadcrumb">
          <span title={folderPath(folders, problem?.folderId ?? null)}>
            {folderPath(folders, problem?.folderId ?? null)}
          </span>
          {problem && (
            <>
              <ChevronRight size={12} />
              <span>{problem.title}</span>
            </>
          )}
        </div>
        <div className="header-actions">
          <span className={`save-state ${saveStatus === 'Save failed' ? 'danger' : ''}`}>
            {saveStatus === 'Saved' ? (
              <Check size={12} />
            ) : (
              <LoaderCircle size={12} className="spin" />
            )}
            {saveStatus}
          </span>
          <button
            className="icon-button header-settings-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => openDialog('settings')}
          >
            <SettingsIcon size={17} />
          </button>
          <button onClick={() => openDialog('environment')}>
            <Settings2 size={14} />
            Environment
          </button>
        </div>
      </header>
      {error && (
        <div className="global-error" role="alert">
          <span>{error}</span>
          {saveStatus === 'Save failed' && (
            <button onClick={() => void flush().catch(() => {})}>Retry save</button>
          )}
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <div className="app-body">
        <aside
          id="library-panel"
          className="library"
          aria-hidden={sidebarCollapsed}
          inert={sidebarCollapsed}
        >
          <div className="library-top">
            <span className="eyebrow">LIBRARY</span>
            <span className="count">{problems.length}</span>
          </div>
          <label className="search-box">
            <Search size={14} />
            <input
              ref={searchInput}
              aria-label="Search problems"
              placeholder="Search problems…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>Ctrl+K</kbd>
          </label>
          <button
            className="import-button"
            onClick={() => void chooseZip()}
            disabled={active || busy}
          >
            <Plus size={15} />
            Import problem<span>ZIP</span>
          </button>
          <Library
            folders={folders}
            problems={problems}
            currentId={problem?.id}
            settings={settings}
            search={search}
            disabled={active || busy}
            onOpen={(id) => void switchProblem(id)}
            onSettings={updateSettings}
            onRefresh={refreshLibrary}
            onError={report}
          />
          <div className="library-footer">
            <button className="text-button" onClick={() => openDialog('help')}>
              <CircleHelp size={14} />
              ZIP format
              <ArrowUpRight size={12} />
            </button>
            <div>
              <HardDrive size={12} />
              <span>Stored on this device</span>
            </div>
          </div>
        </aside>
        {!initialized ? (
          <main className="welcome">
            <LoaderCircle className="spin" />
            <p>Opening your workspace…</p>
          </main>
        ) : !problem ? (
          <main className="welcome">
            <div className="welcome-icon">
              <Code2 size={26} />
            </div>
            <span className="eyebrow">YOUR LOCAL PRACTICE WORKSPACE</span>
            <h1>No problems yet</h1>
            <p>Import a problem package to start practicing.</p>
            <button className="primary" onClick={() => void chooseZip()}>
              <ArrowDownToLine size={15} />
              Import ZIP
            </button>
            <button className="text-button" onClick={() => openDialog('help')}>
              View ZIP format
              <ArrowUpRight size={12} />
            </button>
            <div className="welcome-footnote">
              <span>C++20, Python 3 & Java</span>
              <i>·</i>
              <span>Fully offline</span>
              <i>·</i>
              <span>No accounts</span>
            </div>
          </main>
        ) : (
          <main
            className="workspace"
            ref={workspace}
            style={{ gridTemplateColumns: `${settings?.statementWidth ?? 36}% 5px minmax(0, 1fr)` }}
          >
            <section className="statement-pane">
              <div className="panel-label">
                <div>
                  <BookOpen size={14} />
                  <span>Problem</span>
                </div>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Move problem"
                    title="Move problem to folder"
                    disabled={active || busy}
                    onClick={() => openDialog('move-problem')}
                  >
                    <FolderInput size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Delete problem"
                    disabled={active || busy}
                    onClick={() => openDialog('delete-problem')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <Statement problem={problem} />
            </section>
            <div
              className="resize-handle vertical"
              role="separator"
              aria-label="Resize statement"
              aria-valuenow={settings?.statementWidth}
              aria-valuemin={24}
              aria-valuemax={55}
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(e) => resize(e, 'statementWidth')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  void updateSettings({
                    statementWidth: Math.max(
                      24,
                      Math.min(55, settings!.statementWidth + (e.key === 'ArrowLeft' ? -2 : 2))
                    )
                  }).catch(report)
                }
              }}
            />
            <div
              className="coding-pane"
              ref={coding}
              style={{
                gridTemplateRows: `minmax(180px, ${settings?.editorHeight ?? 57}%) 5px minmax(0, 1fr)`
              }}
            >
              <section className="editor-pane">
                <div className="approach-toolbar">
                  <div className="approach-choice">
                    <span>Approach</span>
                    <select
                      aria-label="Approach"
                      value={approachId}
                      disabled={active || busy || !problem.approaches.length}
                      onChange={(e) => void switchApproach(e.target.value)}
                    >
                      {problem.approaches.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Add approach"
                    title="Add approach"
                    disabled={active || busy}
                    onClick={() => openDialog('create')}
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Rename approach"
                    title="Rename approach"
                    disabled={active || busy || !approach}
                    onClick={() => openDialog('rename')}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Delete approach"
                    title="Delete approach"
                    disabled={active || busy || !approach}
                    onClick={() => openDialog('delete-approach')}
                  >
                    <Trash2 size={13} />
                  </button>
                  <span className="toolbar-spacer" />
                  <button
                    className={active ? 'cancel-button' : 'primary run-button'}
                    disabled={busy || !approach}
                    onClick={() =>
                      active ? void window.dsa.cancelRun(run!.id).catch(report) : void runAll()
                    }
                  >
                    {active ? <Square size={12} /> : <Play size={13} fill="currentColor" />}
                    {active ? 'Cancel Run' : 'Run All'}
                    {!active && <kbd>Ctrl+Enter</kbd>}
                  </button>
                </div>
                <div className="language-toolbar">
                  <div className="language-tabs" role="tablist" aria-label="Solution language">
                    {(['cpp', 'python', 'java'] as const).map((lang) => (
                      <button
                        key={lang}
                        role="tab"
                        aria-selected={lang === language}
                        className={lang === language ? 'active' : ''}
                        disabled={active || busy}
                        onClick={() => void switchLanguage(lang)}
                      >
                        {languageName(lang)}
                      </button>
                    ))}
                  </div>
                  <span className="file-label">{sourceFile(language)}</span>
                  <span className="language-version">{languageVersion(language)}</span>
                </div>
                {approach ? (
                  <CodeEditor
                    key={`${approachId}-${language}`}
                    modelId={approachId}
                    value={source}
                    language={language}
                    onChange={edit}
                    diagnostics={run?.diagnostics ?? ''}
                    jump={jump}
                    fontSize={codeFontSize}
                  />
                ) : (
                  <div className="results-empty">
                    <p>No approach selected</p>
                    <button onClick={() => openDialog('create')}>
                      <Plus size={14} />
                      Add approach
                    </button>
                  </div>
                )}
                <div className="editor-status">
                  <span>
                    <span className="tiny-dot" />
                    Autosave enabled
                  </span>
                  <span>
                    UTF-8
                    <span className="status-divider" />
                    Spaces: 4
                  </span>
                </div>
              </section>
              <div
                className="resize-handle horizontal"
                role="separator"
                aria-label="Resize editor"
                aria-valuenow={settings?.editorHeight}
                aria-valuemin={30}
                aria-valuemax={75}
                aria-orientation="horizontal"
                tabIndex={0}
                onPointerDown={(e) => resize(e, 'editorHeight')}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    void updateSettings({
                      editorHeight: Math.max(
                        30,
                        Math.min(75, settings!.editorHeight + (e.key === 'ArrowUp' ? -2 : 2))
                      )
                    }).catch(report)
                  }
                }}
              />
              <Results
                key={run?.id ?? problem.id}
                problem={problem}
                run={run}
                language={language}
                onJump={(line) => setJump({ line, nonce: Date.now() })}
              />
            </div>
          </main>
        )}
      </div>
      {dialog === 'help' && (
        <Modal title="Problem package format" onClose={() => setDialog(null)}>
          <ZipHelp />
          <div className="modal-footer">
            <button className="primary" disabled={active} onClick={() => void chooseZip()}>
              <FileArchive size={14} />
              Choose ZIP
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'environment' && settings && (
        <Environment settings={settings} onUpdate={setSettings} onClose={() => setDialog(null)} />
      )}
      {dialog === 'settings' && (
        <SettingsPanel
          codeFontSize={codeFontSize}
          onCodeFontSizeChange={changeCodeFontSize}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'move-problem' && (
        <Modal
          title="Move problem"
          onClose={() => {
            if (!busy) setDialog(null)
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void moveProblem()
            }}
          >
            <p className="modal-intro">
              Choose a location for <strong>{problem?.title}</strong>. Saved code and tests move
              with it.
            </p>
            <FolderSelect
              folders={folders}
              value={destination}
              onChange={setDestination}
              label="Destination folder"
              required
              disabled={busy}
            />
            {modalError && (
              <p className="error-banner" role="alert">
                {modalError}
              </p>
            )}
            <div className="modal-footer">
              <button type="button" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !destination}>
                Move problem
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'import' && (
        <Modal title="Import problem" onClose={closeImport}>
          {importBusy ? (
            <div className="import-loading">
              <LoaderCircle className="spin" size={24} />
              <h3>{preview ? 'Importing problem…' : 'Validating package…'}</h3>
              <p>Checking the statement, test pairs, and archive safety.</p>
            </div>
          ) : preview ? (
            <div className="import-preview">
              <div className="import-identity">
                <div className="preview-icon">
                  <FileArchive size={22} />
                </div>
                <div>
                  <h3>{preview.title}</h3>
                  {preview.topic && <span className="subtle-tag">{preview.topic}</span>}
                </div>
              </div>
              <div className="preview-stats">
                <span>
                  <b>{preview.groupCount}</b> test groups
                </span>
                <span>
                  <b>{preview.testCount}</b> test cases
                </span>
              </div>
              <FolderSelect
                folders={folders}
                value={destination}
                onChange={setDestination}
                label="Import into"
                required
              />
              <div className="preview-groups">
                {preview.groups.map((g) => (
                  <div key={g.name}>
                    <span>{g.name}</span>
                    <span>{g.count} tests</span>
                  </div>
                ))}
              </div>
              <p className="preview-limits">
                C++ <span className="mono">{preview.cppTimeLimitMs} ms</span> · Python{' '}
                <span className="mono">{preview.pythonTimeLimitMs} ms</span> · Java{' '}
                <span className="mono">{preview.javaTimeLimitMs} ms</span>
                <br />
                {preview.outputComparison === 'tokens'
                  ? 'Whitespace-insensitive token comparison'
                  : 'Exact output comparison'}
              </p>
            </div>
          ) : (
            <>
              {importIssues.length > 0 && (
                <div className="import-errors" role="alert">
                  <h3>Could not import this package</h3>
                  <ul>
                    {importIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              <ZipHelp />
            </>
          )}
          <div className="modal-footer">
            <button onClick={closeImport} disabled={importBusy}>
              Cancel
            </button>
            <span className="toolbar-spacer" />
            <button onClick={() => void chooseZip()} disabled={importBusy}>
              {preview ? 'Choose another ZIP' : 'Choose ZIP'}
            </button>
            {preview && (
              <button
                className="primary"
                onClick={() => void confirmImport()}
                disabled={importBusy || !destination}
              >
                <Plus size={14} />
                Import
              </button>
            )}
          </div>
        </Modal>
      )}
      {(dialog === 'create' ||
        dialog === 'rename' ||
        dialog === 'delete-approach' ||
        dialog === 'delete-problem') && (
        <Modal
          title={
            dialog === 'create'
              ? 'New approach'
              : dialog === 'rename'
                ? 'Rename approach'
                : dialog === 'delete-approach'
                  ? 'Delete approach?'
                  : 'Delete problem?'
          }
          onClose={() => {
            if (!busy) setDialog(null)
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void (dialog === 'delete-problem' ? deleteProblem() : mutateApproach())
            }}
          >
            {dialog === 'create' || dialog === 'rename' ? (
              <>
                <p className="modal-intro">
                  A simple name for a different way to solve this problem.
                </p>
                <label>
                  Approach name
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. Two Pointers"
                    required
                    disabled={busy}
                  />
                </label>
                <p className="field-help">
                  Each approach keeps its own C++, Python and Java solution.
                </p>
              </>
            ) : (
              <p className="confirm-copy">
                {dialog === 'delete-problem' ? (
                  <>
                    Delete <strong>{problem?.title}</strong> and all its tests, approaches, and
                    saved code?
                  </>
                ) : (
                  <>
                    Delete <strong>{approach?.name}</strong> and all saved language solutions?
                  </>
                )}
                <br />
                <span className="muted">This cannot be undone.</span>
              </p>
            )}
            {modalError && (
              <p className="error-banner" role="alert">
                {modalError}
              </p>
            )}
            <div className="modal-footer">
              <button type="button" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="submit"
                className={dialog.startsWith('delete') ? 'destructive' : 'primary'}
                disabled={busy || ((dialog === 'create' || dialog === 'rename') && !name.trim())}
              >
                {busy
                  ? 'Saving…'
                  : dialog === 'create'
                    ? 'Create approach'
                    : dialog === 'rename'
                      ? 'Save name'
                      : 'Delete'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
