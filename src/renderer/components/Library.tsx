import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Trash2
} from 'lucide-react'
import {
  naturalCompare,
  type LibraryFolder,
  type ProblemSummary,
  type Settings
} from '../../shared/types'
import { Modal } from './Modal'

export function folderPath(folders: LibraryFolder[], id: string | null): string {
  const parts: string[] = []
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const folder = folders.find((f) => f.id === id)
    if (!folder) break
    parts.unshift(folder.name)
    id = folder.parentId
  }
  return ['Library', ...parts].join(' / ')
}

export function FolderSelect({
  folders,
  value,
  onChange,
  label,
  excludeId,
  required = false,
  disabled = false
}: {
  folders: LibraryFolder[]
  value: string
  onChange: (value: string) => void
  label: string
  excludeId?: string
  required?: boolean
  disabled?: boolean
}) {
  const excluded = new Set(excludeId ? [excludeId] : [])
  for (let i = 0; i < folders.length; i++)
    for (const folder of folders)
      if (folder.parentId && excluded.has(folder.parentId)) excluded.add(folder.id)
  const options = folders
    .filter((f) => !excluded.has(f.id))
    .map((f) => ({ id: f.id, path: folderPath(folders, f.id) }))
    .sort((a, b) => naturalCompare(a.path, b.path))
  return (
    <label className="folder-select">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
      >
        <option value="" disabled>
          Choose a destination…
        </option>
        <option value="root">Library (top level)</option>
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {f.path}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Library({
  folders,
  problems,
  currentId,
  settings,
  search,
  disabled,
  onOpen,
  onSettings,
  onRefresh,
  onError
}: {
  folders: LibraryFolder[]
  problems: ProblemSummary[]
  currentId?: string
  settings: Settings | null
  search: string
  disabled: boolean
  onOpen: (id: string) => void
  onSettings: (patch: Partial<Settings>) => Promise<unknown>
  onRefresh: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const [editing, setEditing] = useState<LibraryFolder | 'new' | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('root')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const activeProblem = useRef<HTMLButtonElement>(null)
  const selected = settings?.selectedFolderId ?? null
  const expanded = settings?.expandedFolderIds ?? []
  useEffect(() => {
    activeProblem.current?.scrollIntoView({ block: 'nearest' })
  }, [currentId, search, expanded])
  const select = (id: string | null) =>
    void onSettings({
      selectedFolderId: id,
      expandedFolderIds: id ? [...new Set([...expanded, id])] : expanded
    }).catch(onError)
  const toggle = (id: string) =>
    void onSettings({
      expandedFolderIds: expanded.includes(id)
        ? expanded.filter((f) => f !== id)
        : [...expanded, id]
    }).catch(onError)
  const open = (folder: LibraryFolder | 'new') => {
    setName(folder === 'new' ? '' : folder.name)
    setParent((folder === 'new' ? selected : folder.parentId) ?? 'root')
    setError('')
    setDeleting(false)
    setEditing(folder)
  }
  const save = async () => {
    if (!editing || saving) return
    setSaving(true)
    setError('')
    try {
      if (deleting && editing !== 'new') await window.dsa.deleteFolder(editing.id)
      else if (editing === 'new') {
        const folder = await window.dsa.createFolder(name.trim(), parent === 'root' ? null : parent)
        const ancestors = [folder.id]
        let next = folder.parentId
        while (next) {
          ancestors.push(next)
          next = folders.find((f) => f.id === next)?.parentId ?? null
        }
        await onSettings({
          selectedFolderId: folder.id,
          expandedFolderIds: [...new Set([...expanded, ...ancestors])]
        })
      } else {
        await window.dsa.updateFolder(editing.id, name.trim(), parent === 'root' ? null : parent)
        const ancestors = [editing.id]
        let next: string | null = parent === 'root' ? null : parent
        while (next) {
          ancestors.push(next)
          next = folders.find((f) => f.id === next)?.parentId ?? null
        }
        await onSettings({
          expandedFolderIds: [...new Set([...expanded, ...ancestors])]
        })
      }
      await onRefresh()
      setEditing(null)
    } catch (e) {
      setError(String(e).replace(/^Error: Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setSaving(false)
    }
  }
  const problemRow = (item: ProblemSummary, depth: number, searching = false) => (
    <button
      key={item.id}
      className={`problem-item tree-problem ${item.id === currentId ? 'selected' : ''}`}
      style={{ paddingLeft: 8 + Math.min(depth, 8) * 12 }}
      disabled={disabled}
      onClick={() => onOpen(item.id)}
      ref={item.id === currentId ? activeProblem : undefined}
      aria-current={item.id === currentId ? 'page' : undefined}
      title={`${folderPath(folders, item.folderId)} / ${item.title}\nLast opened: ${item.lastOpenedAt ? new Date(item.lastOpenedAt).toLocaleString() : 'Never'}`}
    >
      <FileText size={14} />
      <span>
        <b>{item.title}</b>
        <small>
          {searching
            ? folderPath(folders, item.folderId)
            : `${item.testCount} tests${item.topic ? ` · ${item.topic}` : ''}`}
        </small>
      </span>
    </button>
  )
  const branch = (parentId: string | null, depth: number): React.ReactNode => (
    <>
      {folders
        .filter((f) => f.parentId === parentId)
        .map((folder) => (
          <div key={folder.id}>
            <div
              className={`folder-row ${selected === folder.id ? 'selected' : ''}`}
              style={{ paddingLeft: Math.min(depth, 8) * 12 }}
            >
              <button
                className="icon-button folder-chevron"
                aria-label={`${expanded.includes(folder.id) ? 'Collapse' : 'Expand'} ${folder.name}`}
                aria-expanded={expanded.includes(folder.id)}
                onClick={() => toggle(folder.id)}
              >
                <ChevronRight size={12} />
              </button>
              <button
                className="folder-name"
                onClick={() => select(folder.id)}
                title={folderPath(folders, folder.id)}
                aria-pressed={selected === folder.id}
              >
                {expanded.includes(folder.id) ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{folder.name}</span>
              </button>
              <button
                className="icon-button folder-menu-button"
                aria-label={`Manage folder ${folder.name}`}
                title="Rename, move or delete folder"
                disabled={disabled}
                onClick={() => open(folder)}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            {expanded.includes(folder.id) && branch(folder.id, depth + 1)}
            {expanded.includes(folder.id) &&
              !folders.some((f) => f.parentId === folder.id) &&
              !problems.some((p) => p.folderId === folder.id) && (
                <p className="folder-empty" style={{ paddingLeft: 24 + Math.min(depth, 8) * 12 }}>
                  Empty folder
                </p>
              )}
          </div>
        ))}
      {problems.filter((p) => p.folderId === parentId).map((p) => problemRow(p, depth))}
    </>
  )
  const matches = problems.filter((p) =>
    p.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
  return (
    <>
      <div className="library-tree-heading">
        <span className="eyebrow">FOLDERS & PROBLEMS</span>
        <button
          className="icon-button"
          aria-label="New folder"
          title="New folder in selected location"
          disabled={disabled || !settings}
          onClick={() => open('new')}
        >
          <FolderPlus size={16} />
        </button>
      </div>
      <nav className="problem-list" aria-label="Problem library">
        {search.trim() ? (
          <>
            {matches.map((p) => problemRow(p, 0, true))}
            {!matches.length && <p className="library-message">No matching problems.</p>}
          </>
        ) : (
          <>
            <button
              className={`library-root ${selected === null ? 'selected' : ''}`}
              onClick={() => select(null)}
              aria-pressed={selected === null}
            >
              <FolderOpen size={14} />
              Library<span className="count">{problems.length}</span>
            </button>
            {branch(null, 0)}
            {!folders.length && !problems.length && (
              <p className="library-message">
                Create a folder for your course or import a problem.
              </p>
            )}
          </>
        )}
      </nav>
      {editing && (
        <Modal
          title={
            deleting ? 'Delete empty folder?' : editing === 'new' ? 'New folder' : 'Manage folder'
          }
          onClose={() => {
            if (!saving) setEditing(null)
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            {deleting ? (
              <p className="confirm-copy">
                Delete <strong>{name}</strong>? Only empty folders can be deleted.
              </p>
            ) : (
              <>
                <p className="modal-intro">
                  Organize courses, homework and practice sets in nested folders.
                </p>
                <label>
                  Folder name
                  <input
                    autoFocus
                    required
                    maxLength={80}
                    placeholder="e.g. DSA UET"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <FolderSelect
                  folders={folders}
                  value={parent}
                  onChange={setParent}
                  label="Parent folder"
                  excludeId={editing === 'new' ? undefined : editing.id}
                  required
                  disabled={saving}
                />
              </>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              {editing !== 'new' && !deleting && (
                <button
                  type="button"
                  className="text-button danger"
                  disabled={saving}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={13} />
                  Delete folder
                </button>
              )}
              <span className="toolbar-spacer" />
              <button type="button" disabled={saving} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className={deleting ? 'destructive' : 'primary'}
                disabled={saving || !name.trim()}
              >
                {saving
                  ? 'Saving…'
                  : deleting
                    ? 'Delete'
                    : editing === 'new'
                      ? 'Create folder'
                      : 'Save folder'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
