import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { CPP_TEMPLATE, JAVA_TEMPLATE, PYTHON_TEMPLATE, naturalCompare } from '../shared/types'
import type {
  Approach,
  Problem,
  ProblemSummary,
  Settings,
  TestCase,
  TestGroup,
  Language,
  RunState,
  LibraryFolder
} from '../shared/types'
import { log } from './log'

export const defaultSettings: Settings = {
  cpp: { executable: 'g++', argsPrefix: [] },
  python: { executable: '', argsPrefix: [] },
  java: { executable: 'javac', argsPrefix: [] },
  problemId: null,
  approachId: null,
  language: 'cpp',
  statementWidth: 36,
  editorHeight: 57,
  sidebarCollapsed: false,
  selectedFolderId: null,
  expandedFolderIds: []
}
export type StoredTest = TestCase & { inputPath: string; outputPath: string }
export class Store {
  db: Database.Database
  constructor(public root: string) {
    mkdirSync(join(root, 'problems'), { recursive: true })
    this.db = new Database(join(root, 'data.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 3)
      throw new Error('This database was created by a newer DSA Lab. Please update the app.')
    if (version === 0)
      this.db.transaction(() => {
        this.db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
        CREATE TABLE problems (id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT, statement_path TEXT NOT NULL,
          source_zip_name TEXT, cpp_time_limit_ms INTEGER NOT NULL, python_time_limit_ms INTEGER NOT NULL,
          output_comparison TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT);
        CREATE TABLE test_groups (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sort_order INTEGER NOT NULL);
        CREATE TABLE test_cases (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES test_groups(id) ON DELETE CASCADE,
          name TEXT NOT NULL, input_path TEXT NOT NULL, output_path TEXT NOT NULL, sort_order INTEGER NOT NULL);
        CREATE TABLE approaches (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sort_order INTEGER NOT NULL, cpp_code TEXT NOT NULL, python_code TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE run_history (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
          approach_id TEXT NOT NULL REFERENCES approaches(id) ON DELETE CASCADE, language TEXT NOT NULL,
          overall_verdict TEXT NOT NULL, passed_count INTEGER NOT NULL, total_count INTEGER NOT NULL,
          total_wall_time_ms REAL, created_at TEXT NOT NULL);
        CREATE INDEX groups_problem ON test_groups(problem_id);
        CREATE INDEX cases_group ON test_cases(group_id);
        CREATE INDEX approaches_problem ON approaches(problem_id);
        CREATE INDEX history_problem ON run_history(problem_id);
        CREATE INDEX history_approach ON run_history(approach_id);
        CREATE INDEX problems_opened ON problems(last_opened_at);
        PRAGMA user_version = 1;
      `)
      })()
    if (version < 2)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT, name TEXT NOT NULL);
          CREATE INDEX folders_parent ON folders(parent_id);
          ALTER TABLE problems ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT;
          CREATE INDEX problems_folder ON problems(folder_id);
          PRAGMA user_version = 2;
        `)
      })()
    if (version < 3)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE problems ADD COLUMN java_time_limit_ms INTEGER NOT NULL DEFAULT 3000;
          ALTER TABLE approaches ADD COLUMN java_code TEXT NOT NULL DEFAULT '';
          PRAGMA user_version = 3;
        `)
        this.db
          .prepare('UPDATE approaches SET java_code=? WHERE java_code=?')
          .run(JAVA_TEMPLATE, '')
      })()
  }
  folders(): LibraryFolder[] {
    return (
      this.db.prepare('SELECT id,parent_id AS parentId,name FROM folders').all() as LibraryFolder[]
    ).sort((a, b) => naturalCompare(a.name, b.name) || a.id.localeCompare(b.id))
  }
  requireFolder(id: string | null): void {
    if (id !== null && !this.db.prepare('SELECT id FROM folders WHERE id=?').get(id))
      throw new Error('Destination folder no longer exists. Choose another folder.')
  }
  private validateFolder(id: string, name: string, parentId: string | null): void {
    this.requireFolder(parentId)
    const folders = this.folders()
    if (
      folders.some(
        (f) =>
          f.id !== id &&
          f.parentId === parentId &&
          f.name.normalize('NFC').toLocaleLowerCase() === name.normalize('NFC').toLocaleLowerCase()
      )
    )
      throw new Error('A folder with that name already exists here.')
    const proposed = [...folders.filter((f) => f.id !== id), { id, name, parentId }]
    const byId = new Map(proposed.map((f) => [f.id, f]))
    for (const folder of proposed) {
      const visited = new Set<string>()
      let current: LibraryFolder | undefined = folder
      while (current) {
        if (visited.has(current.id))
          throw new Error('A folder cannot be moved inside itself or its subfolders.')
        visited.add(current.id)
        if (visited.size > 32) throw new Error('Folders can be nested up to 32 levels.')
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
  }
  createFolder(name: string, parentId: string | null): LibraryFolder {
    const id = randomUUID()
    this.validateFolder(id, name, parentId)
    this.db
      .prepare('INSERT INTO folders (id,parent_id,name) VALUES (?,?,?)')
      .run(id, parentId, name)
    return { id, name, parentId }
  }
  updateFolder(id: string, name: string, parentId: string | null): void {
    this.requireFolder(id)
    this.validateFolder(id, name, parentId)
    this.db.prepare('UPDATE folders SET name=?,parent_id=? WHERE id=?').run(name, parentId, id)
  }
  deleteFolder(id: string): void {
    this.requireFolder(id)
    if (
      this.db.prepare('SELECT id FROM folders WHERE parent_id=?').get(id) ||
      this.db.prepare('SELECT id FROM problems WHERE folder_id=?').get(id)
    )
      throw new Error(
        'This folder is not empty. Move its problems and subfolders before deleting it.'
      )
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM folders WHERE id=?').run(id)
      const settings = this.settings()
      this.updateSettings({
        selectedFolderId: settings.selectedFolderId === id ? null : settings.selectedFolderId,
        expandedFolderIds: settings.expandedFolderIds.filter((f) => f !== id)
      })
    })()
  }
  moveProblem(id: string, folderId: string | null): void {
    this.requireFolder(folderId)
    if (
      !this.db
        .prepare('UPDATE problems SET folder_id=?,updated_at=? WHERE id=?')
        .run(folderId, new Date().toISOString(), id).changes
    )
      throw new Error('Problem no longer exists.')
  }
  path(relative: string): string {
    const target = resolve(this.root, relative)
    if (!target.startsWith(resolve(this.root) + sep)) throw new Error('Invalid storage path')
    return target
  }
  settings(): Settings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('workspace') as { value_json: string } | undefined
    return { ...defaultSettings, ...(row ? JSON.parse(row.value_json) : {}) }
  }
  updateSettings(patch: Partial<Settings>): Settings {
    const settings = { ...this.settings(), ...patch }
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
      )
      .run('workspace', JSON.stringify(settings))
    return settings
  }
  list(): ProblemSummary[] {
    return (
      this.db
        .prepare(
          `SELECT p.id,p.folder_id AS folderId,p.title,p.topic,p.last_opened_at AS lastOpenedAt,
      (SELECT COUNT(*) FROM test_cases t JOIN test_groups g ON t.group_id=g.id WHERE g.problem_id=p.id) AS testCount
      FROM problems p`
        )
        .all() as ProblemSummary[]
    ).sort((a, b) => naturalCompare(a.title, b.title) || a.id.localeCompare(b.id))
  }
  approaches(problemId: string): Approach[] {
    return this.db
      .prepare(
        `SELECT id,problem_id AS problemId,name,sort_order AS sortOrder,cpp_code AS cppCode,
      python_code AS pythonCode,java_code AS javaCode,created_at AS createdAt,updated_at AS updatedAt FROM approaches WHERE problem_id=? ORDER BY sort_order,created_at`
      )
      .all(problemId) as Approach[]
  }
  problem(id: string, markOpened = false): Problem {
    const row = this.db
      .prepare(
        `SELECT id,folder_id AS folderId,title,topic,last_opened_at AS lastOpenedAt,statement_path AS statementPath,
      cpp_time_limit_ms AS cppTimeLimitMs,python_time_limit_ms AS pythonTimeLimitMs,
      java_time_limit_ms AS javaTimeLimitMs,output_comparison AS outputComparison FROM problems WHERE id=?`
      )
      .get(id) as
      | (Omit<Problem, 'statement' | 'groups' | 'approaches' | 'testCount'> & {
          statementPath: string
        })
      | undefined
    if (!row) throw new Error('Problem no longer exists.')
    const groups = this.db
      .prepare('SELECT id,name FROM test_groups WHERE problem_id=? ORDER BY sort_order')
      .all(id) as TestGroup[]
    for (const group of groups)
      group.tests = this.db
        .prepare(
          'SELECT id,name,group_id AS groupId FROM test_cases WHERE group_id=? ORDER BY sort_order'
        )
        .all(group.id) as TestCase[]
    if (markOpened) {
      row.lastOpenedAt = new Date().toISOString()
      this.db.prepare('UPDATE problems SET last_opened_at=? WHERE id=?').run(row.lastOpenedAt, id)
    }
    const { statementPath, ...data } = row
    return {
      ...data,
      statement: readFileSync(this.path(statementPath), 'utf8'),
      groups,
      approaches: this.approaches(id),
      testCount: groups.reduce((n, g) => n + g.tests.length, 0)
    }
  }
  test(id: string): StoredTest {
    const test = this.db
      .prepare(
        'SELECT id,name,group_id AS groupId,input_path AS inputPath,output_path AS outputPath FROM test_cases WHERE id=?'
      )
      .get(id) as StoredTest | undefined
    if (!test) throw new Error('Test no longer exists.')
    return test
  }
  createApproach(problemId: string, name: string): Approach {
    if (!this.db.prepare('SELECT id FROM problems WHERE id=?').get(problemId))
      throw new Error('Problem no longer exists.')
    const existing = this.approaches(problemId)
    if (existing.some((a) => a.name.toLowerCase() === name.toLowerCase()))
      throw new Error('An approach with that name already exists.')
    const item: Approach = {
      id: randomUUID(),
      problemId,
      name,
      sortOrder: existing.length ? Math.max(...existing.map((a) => a.sortOrder)) + 1 : 0,
      cppCode: CPP_TEMPLATE,
      pythonCode: PYTHON_TEMPLATE,
      javaCode: JAVA_TEMPLATE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO approaches
          (id,problem_id,name,sort_order,cpp_code,python_code,java_code,created_at,updated_at)
         VALUES (@id,@problemId,@name,@sortOrder,@cppCode,@pythonCode,@javaCode,@createdAt,@updatedAt)`
      )
      .run(item)
    return item
  }
  renameApproach(id: string, name: string): void {
    const row = this.db.prepare('SELECT problem_id FROM approaches WHERE id=?').get(id) as
      { problem_id: string } | undefined
    if (!row) throw new Error('Approach no longer exists.')
    if (
      this.approaches(row.problem_id).some(
        (a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase()
      )
    )
      throw new Error('An approach with that name already exists.')
    this.db
      .prepare('UPDATE approaches SET name=?,updated_at=? WHERE id=?')
      .run(name, new Date().toISOString(), id)
  }
  saveCode(id: string, language: Language, code: string): void {
    const column = { cpp: 'cpp_code', python: 'python_code', java: 'java_code' }[language]
    const result = this.db
      .prepare(`UPDATE approaches SET ${column}=?,updated_at=? WHERE id=?`)
      .run(code, new Date().toISOString(), id)
    if (!result.changes) throw new Error('Cannot save: approach no longer exists.')
  }
  deleteProblem(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM problems WHERE id=?').run(id)
      if (this.settings().problemId === id)
        this.updateSettings({ problemId: null, approachId: null })
    })()
    try {
      rmSync(this.path(join('problems', id)), { recursive: true, force: true })
    } catch (error) {
      log('Orphaned problem directory after deletion', error)
    }
  }
  recordRun(state: RunState): void {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO run_history VALUES (?,?,?,?,?,?,?,?,?)').run(
        state.id,
        state.problemId,
        state.approachId,
        state.language,
        state.verdict,
        state.results.filter((t) => t.verdict === 'AC').length,
        state.totalCount,
        state.results.reduce((n, t) => n + t.wallTimeMs, 0),
        new Date().toISOString()
      )
      this.db
        .prepare(
          'DELETE FROM run_history WHERE id NOT IN (SELECT id FROM run_history ORDER BY created_at DESC LIMIT 100)'
        )
        .run()
    })()
  }
}
