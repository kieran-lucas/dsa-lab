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
      <p>
        One ZIP. One or more problems. Each top-level folder in the archive is one problem — a
        single-problem package is just a collection of one.
      </p>
      <pre>
        {
          'problems.zip\n├── 001/\n│   ├── meta.json\n│   ├── problem.md\n│   └── tests/\n│       └── sample/\n│           ├── 001.in\n│           └── 001.out\n└── 002/\n    ├── meta.json\n    ├── problem.md\n    └── tests/\n        ├── 001.in\n        └── 001.out'
        }
      </pre>
      <p>
        The top-level folder name (<code>001</code>, <code>002</code>, …) is just a package label,
        not a problem ID — the app assigns its own internal ID to every imported problem. Any safe
        folder name works, but short numeric labels sort predictably.
      </p>
      <p>
        Inside each problem folder: <code>meta.json</code> is required and must set{' '}
        <code>title</code> — that title is the only source of the problem&apos;s name.{' '}
        <code>problem.md</code> is required and must be non-empty UTF-8. At least one valid test
        pair is required under <code>tests/</code>.
      </p>
      <p>
        Match each <code>.in</code> with a <code>.out</code> of the same name in the same
        directory. The first folder under <code>tests/</code> names the group. Flat pairs use{' '}
        <b>General</b>. Also accepted: <code>input001.txt</code> + <code>output001.txt</code>.
      </p>
      <p>
        All problems in one import go into the single Library destination you choose — a ZIP
        cannot target multiple destinations. A problem with errors does not block the other valid
        problems in the same package from importing.
      </p>
      <details>
        <summary>meta.json fields &amp; limits</summary>
        <pre>
          {
            '{\n  "title": "Sum of Two Numbers",\n  "topic": "Foundations",\n  "timeLimitMs": { "cpp": 2000, "python": 5000, "java": 3000 },\n  "outputComparison": "tokens"\n}'
          }
        </pre>
        <p>
          <code>title</code> is required. Other fields are optional. Defaults: C++ 2,000 ms ·
          Python 5,000 ms · Java 3,000 ms. Limits may range from 50 to 60,000 ms. Token comparison
          ignores whitespace; <code>exact</code> only normalizes CRLF.
          <br />
          Archive ≤512 MB, ≤50,000 entries, ≤2 GB expanded; each test file ≤16 MB, statement ≤4 MB,
          meta.json ≤64 KB.
        </p>
      </details>
    </div>
  )
}
