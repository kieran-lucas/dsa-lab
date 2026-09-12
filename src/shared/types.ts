export type Language = 'cpp' | 'python'
export type TestVerdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'OLE'
export type RunVerdict = 'PASSED' | 'FAILED' | 'COMPILE_ERROR' | 'CANCELLED'
export type ToolCommand = { executable: string; argsPrefix: string[] }
export type Settings = {
  cpp: ToolCommand
  python: ToolCommand
  problemId: string | null
  approachId: string | null
  language: Language
  statementWidth: number
  editorHeight: number
  sidebarCollapsed: boolean
  selectedFolderId: string | null
  expandedFolderIds: string[]
}
export type LibraryFolder = { id: string; parentId: string | null; name: string }
export type ProblemSummary = {
  id: string
  folderId: string | null
  title: string
  topic: string | null
  testCount: number
  lastOpenedAt: string | null
}
export type Approach = {
  id: string
  problemId: string
  name: string
  sortOrder: number
  cppCode: string
  pythonCode: string
  createdAt: string
  updatedAt: string
}
export type TestCase = { id: string; name: string; groupId: string }
export type TestGroup = { id: string; name: string; tests: TestCase[] }
export type Problem = ProblemSummary & {
  statement: string
  cppTimeLimitMs: number
  pythonTimeLimitMs: number
  outputComparison: 'tokens' | 'exact'
  groups: TestGroup[]
  approaches: Approach[]
}
export type ImportPreview = {
  token: string
  title: string
  topic: string | null
  groupCount: number
  testCount: number
  cppTimeLimitMs: number
  pythonTimeLimitMs: number
  outputComparison: 'tokens' | 'exact'
  groups: { name: string; count: number }[]
}
export type ImportResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; message: string; issues: string[] }
  | { cancelled: true }
export type ToolStatus = {
  command: ToolCommand
  available: boolean
  version: string
  message: string
}
export type Environment = {
  cpp: ToolStatus
  python: ToolStatus
  dataDirectory: string
  logsDirectory: string
}
export type RunRequest = {
  problemId: string
  approachId: string
  language: Language
  sourceCode: string
}
export type TestRunResult = {
  testId: string
  verdict: TestVerdict
  wallTimeMs: number
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  outputLimited: boolean
  truncated: boolean
}
export type RunState = {
  id: string
  problemId: string
  approachId: string
  approachName: string
  language: Language
  phase: 'compiling' | 'running' | 'complete'
  verdict?: RunVerdict
  totalCount: number
  timeLimitMs: number
  results: TestRunResult[]
  diagnostics: string
  compileTimeMs: number
}
export type RunProgress = { runId: string; state?: RunState; result?: TestRunResult }
export type TestText = {
  input: string
  expected: string
  inputTruncated: boolean
  expectedTruncated: boolean
}
export interface DsaApi {
  listFolders(): Promise<LibraryFolder[]>
  createFolder(name: string, parentId: string | null): Promise<LibraryFolder>
  updateFolder(id: string, name: string, parentId: string | null): Promise<void>
  deleteFolder(id: string): Promise<void>
  moveProblem(id: string, folderId: string | null): Promise<void>
  listProblems(): Promise<ProblemSummary[]>
  getProblem(id: string): Promise<Problem>
  deleteProblem(id: string): Promise<void>
  importProblemZip(): Promise<ImportResult>
  confirmImport(token: string, folderId: string | null): Promise<string>
  discardImport(token: string): Promise<void>
  createApproach(problemId: string, name: string): Promise<Approach>
  renameApproach(id: string, name: string): Promise<void>
  deleteApproach(id: string): Promise<void>
  saveCode(id: string, language: Language, code: string): Promise<void>
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<Settings>
  detectToolchains(): Promise<Environment>
  browseExecutable(): Promise<string | null>
  openFolder(kind: 'data' | 'logs'): Promise<void>
  runSolution(request: RunRequest): Promise<RunState>
  cancelRun(id: string): Promise<void>
  getTestText(testId: string): Promise<TestText>
  onRunProgress(callback: (progress: RunProgress) => void): () => void
  onBeforeClose(callback: () => void): () => void
  readyToClose(): void
}
export const CPP_TEMPLATE =
  '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // Write your solution here.\n\n    return 0;\n}\n'
export const PYTHON_TEMPLATE =
  'import sys\n\n\ndef solve():\n    # Write your solution here.\n    pass\n\n\nif __name__ == "__main__":\n    solve()\n'
