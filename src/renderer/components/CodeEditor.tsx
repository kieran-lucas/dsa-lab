import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor/editor'
import 'monaco-editor/languages/definitions/cpp/register'
import 'monaco-editor/languages/definitions/python/register'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/features/find/register'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/folding/browser/folding'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess'
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type { Language } from '../../shared/types'
;(globalThis as typeof globalThis & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}
monaco.editor.defineTheme('dsa-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '6650A4' },
    { token: 'keyword.control', foreground: '255EA6' },
    { token: 'type', foreground: '137C88' },
    { token: 'type.identifier', foreground: '137C88' },
    { token: 'string', foreground: '227544' },
    { token: 'number', foreground: 'A15B15' },
    { token: 'comment', foreground: '737373', fontStyle: 'italic' },
    { token: 'identifier', foreground: '252525' }
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#242424',
    'editorLineNumber.foreground': '#969A9F',
    'editorLineNumber.activeForeground': '#34383C',
    'editor.lineHighlightBackground': '#F6F7F8',
    'editor.selectionBackground': '#DDEBFF',
    'editor.inactiveSelectionBackground': '#EBF1F8',
    'editorIndentGuide.background1': '#EDEEF0',
    'editorIndentGuide.activeBackground1': '#CFD2D6',
    'editorCursor.foreground': '#171717',
    'editorWidget.border': '#DDDDDD',
    'editorWidget.background': '#FAFAFA'
  }
})
type Props = {
  value: string
  language: Language
  modelId: string
  onChange: (value: string) => void
  diagnostics: string
  jump: { line: number; nonce: number } | null
}
export function CodeEditor({ value, language, modelId, onChange, diagnostics, jump }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const callback = useRef(onChange)
  callback.current = onChange
  const initial = useRef(value)
  useEffect(() => {
    const model = monaco.editor.createModel(
      initial.current,
      language === 'cpp' ? 'cpp' : 'python',
      monaco.Uri.parse(
        `inmemory://dsa/${modelId}/${language === 'cpp' ? 'solution.cpp' : 'solution.py'}`
      )
    )
    const instance = monaco.editor.create(host.current!, {
      model,
      theme: 'dsa-light',
      fontFamily: '"JetBrains Mono Variable", monospace',
      fontWeight: '570',
      fontSize: 13,
      lineHeight: 22,
      fontLigatures: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 18, bottom: 18 },
      tabSize: 4,
      insertSpaces: true,
      wordWrap: 'off',
      smoothScrolling: true,
      renderLineHighlight: 'all',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: true,
      bracketPairColorization: { enabled: false },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      accessibilitySupport: 'on'
    })
    editor.current = instance
    const subscription = instance.onDidChangeModelContent(() =>
      callback.current(instance.getValue())
    )
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts())
    return () => {
      subscription.dispose()
      instance.dispose()
      model.dispose()
      editor.current = null
    }
  }, [modelId, language])
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value)
  }, [value])
  useEffect(() => {
    const model = editor.current?.getModel()
    if (!model) return
    const markers: monaco.editor.IMarkerData[] = []
    for (const match of diagnostics.matchAll(
      /solution\.cpp:(\d+):(\d+):\s*(error|warning):\s*([^\n]+)/g
    ))
      markers.push({
        startLineNumber: +match[1],
        endLineNumber: +match[1],
        startColumn: +match[2],
        endColumn: +match[2] + 1,
        message: match[4],
        severity: match[3] === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
      })
    const python = /File "[^"\n]*solution\.py", line (\d+)/.exec(diagnostics)
    if (python)
      markers.push({
        startLineNumber: +python[1],
        endLineNumber: +python[1],
        startColumn: 1,
        endColumn: 100,
        message: diagnostics,
        severity: monaco.MarkerSeverity.Error
      })
    monaco.editor.setModelMarkers(model, 'dsa', markers)
  }, [diagnostics])
  useEffect(() => {
    if (jump && editor.current) {
      editor.current.revealLineInCenter(jump.line)
      editor.current.setPosition({ lineNumber: jump.line, column: 1 })
      editor.current.focus()
    }
  }, [jump])
  return (
    <div
      className="code-editor"
      ref={host}
      aria-label={`${language === 'cpp' ? 'C++' : 'Python'} solution editor`}
    />
  )
}
