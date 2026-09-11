import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Modal({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function ZipHelp() {
  return (
    <div className="zip-help">
      <p>One statement. Paired text files. Any number of test groups.</p>
      <pre>
        {
          'problem.md\nmeta.json              # optional\ntests/\n  sample/\n    001.in\n    001.out\n  boundary/\n    001.in\n    001.out'
        }
      </pre>
      <p>
        Match each <code>.in</code> with a <code>.out</code> of the same name in the same directory.
        The first folder under <code>tests/</code> names the group. Flat pairs use <b>General</b>.
      </p>
      <p>
        Also accepted: <code>input001.txt</code> + <code>output001.txt</code>. ZIP the contents
        directly, without a wrapping folder. Statements and metadata must use UTF-8.
      </p>
      <details>
        <summary>Optional metadata & limits</summary>
        <pre>
          {
            '{\n  "title": "Sum of Two Numbers",\n  "topic": "Foundations",\n  "timeLimitMs": { "cpp": 2000, "python": 5000 },\n  "outputComparison": "tokens"\n}'
          }
        </pre>
        <p>
          Defaults: C++ 2,000 ms · Python 5,000 ms. Limits may range from 50 to 60,000 ms. Token
          comparison ignores whitespace; <code>exact</code> only normalizes CRLF. ZIP ≤128 MB,
          ≤5,000 entries, ≤512 MB expanded, each test file ≤16 MB, statement ≤4 MB.
        </p>
      </details>
    </div>
  )
}
