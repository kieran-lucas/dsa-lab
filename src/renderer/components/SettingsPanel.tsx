import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'

export const DEFAULT_CODE_FONT_SIZE = 14
export const MIN_CODE_FONT_SIZE = 10
export const MAX_CODE_FONT_SIZE = 28
export const CODE_FONT_SIZE_KEY = 'dsaLab.codeFontSize'

export function readCodeFontSize(): number {
  const stored = Number(localStorage.getItem(CODE_FONT_SIZE_KEY))
  return Number.isInteger(stored) && stored >= MIN_CODE_FONT_SIZE && stored <= MAX_CODE_FONT_SIZE
    ? stored
    : DEFAULT_CODE_FONT_SIZE
}

export function SettingsPanel({
  codeFontSize,
  onCodeFontSizeChange,
  onClose
}: {
  codeFontSize: number
  onCodeFontSizeChange: (size: number) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const requestClose = useCallback(() => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    setClosing(true)
    closeTimer.current = setTimeout(onClose, 200)
  }, [closing, onClose])

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => {
      clearTimeout(closeTimer.current)
      dialog.current?.close()
      requestAnimationFrame(() => previousFocus.current?.focus())
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={`settings-sheet${closing ? ' closing' : ''}`}
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          requestClose()
      }}
    >
      <div className="settings-heading">
        <div>
          <h2 id="settings-title">Settings</h2>
          <span>Preferences are stored on this device.</span>
        </div>
        <button
          className="icon-button settings-close"
          aria-label="Close settings"
          title="Close settings"
          onClick={requestClose}
          autoFocus
        >
          <X size={17} />
        </button>
      </div>
      <div className="settings-content">
        <section className="settings-section" aria-labelledby="editor-settings-heading">
          <h3 id="editor-settings-heading">Editor</h3>
          <div className="settings-row">
            <div>
              <label id="code-font-size-label">Code font size</label>
              <span>Applies to the editor, code examples, and test data.</span>
            </div>
            <div className="font-size-stepper" aria-labelledby="code-font-size-label">
              <button
                className="icon-button"
                aria-label="Decrease code font size"
                disabled={codeFontSize <= MIN_CODE_FONT_SIZE}
                onClick={() => onCodeFontSizeChange(codeFontSize - 1)}
              >
                <Minus size={15} />
              </button>
              <output aria-live="polite">{codeFontSize} px</output>
              <button
                className="icon-button"
                aria-label="Increase code font size"
                disabled={codeFontSize >= MAX_CODE_FONT_SIZE}
                onClick={() => onCodeFontSizeChange(codeFontSize + 1)}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div className="settings-preview">
            <span>Preview</span>
            <pre>
              <code>{'int main() {\n    return 0;\n}'}</code>
            </pre>
          </div>
          <div className="settings-footer">
            <button
              className="text-button"
              disabled={codeFontSize === DEFAULT_CODE_FONT_SIZE}
              onClick={() => onCodeFontSizeChange(DEFAULT_CODE_FONT_SIZE)}
            >
              <RotateCcw size={13} />
              Reset to default
            </button>
            <span>Saved automatically</span>
          </div>
        </section>
      </div>
    </dialog>
  )
}
