import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { Store } from './db'
import { Importer } from './import/zipImporter'
import { PackageError } from './import/validation'
import { Judge } from './runner/judge'
import { detect } from './runner/toolchains'
import { log } from './log'
const id = z.string().uuid()
const name = z.string().trim().min(1).max(80)
const language = z.enum(['cpp', 'python'])
const code = z.string().max(2 * 1024 * 1024)
const command = z
  .object({
    executable: z
      .string()
      .max(1024)
      .refine((s) => !['\0', '\r', '\n'].some((c) => s.includes(c))),
    argsPrefix: z
      .array(
        z
          .string()
          .max(1024)
          .refine((s) => !s.includes('\0'))
      )
      .max(20)
  })
  .strict()
const settings = z
  .object({
    cpp: command.refine((c) => !!c.executable.trim(), 'C++ executable is required'),
    python: command,
    problemId: id.nullable(),
    approachId: id.nullable(),
    language,
    statementWidth: z.number().min(24).max(55),
    editorHeight: z.number().min(30).max(75),
    sidebarCollapsed: z.boolean(),
    selectedFolderId: id.nullable(),
    expandedFolderIds: z.array(id).max(5000)
  })
  .partial()
  .strict()
export function registerIpc(
  window: BrowserWindow,
  store: Store,
  importer: Importer,
  judge: Judge,
  logsDirectory: string,
  allowedUrl: string
) {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== allowedUrl
    )
      throw new Error('Untrusted IPC sender')
  }
  const handle = <T extends z.ZodType>(
    channel: string,
    schema: T,
    handler: (args: z.infer<T>) => unknown
  ) => {
    ipcMain.handle(`dsa:${channel}`, async (event, ...args: unknown[]) => {
      trusted(event)
      const parsed = schema.safeParse(args)
      if (!parsed.success) throw new Error(`Invalid request: ${parsed.error.issues[0].message}`)
      try {
        return await handler(parsed.data)
      } catch (error) {
        log(`IPC ${channel} failed`, error)
        throw error
      }
    })
  }
  const idle = () => {
    if (judge.active) throw new Error('Wait for the active run to finish, or cancel it first.')
  }
  handle('list', z.tuple([]), () => store.list())
  handle('folders', z.tuple([]), () => store.folders())
  const folderName = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(
      (s) => ![...s].some((c) => c.charCodeAt(0) < 32 || c === '/' || c === '\\'),
      'Use a folder name without slashes or control characters'
    )
  handle('create-folder', z.tuple([folderName, id.nullable()]), ([name, parentId]) =>
    store.createFolder(name, parentId)
  )
  handle('update-folder', z.tuple([id, folderName, id.nullable()]), ([id, name, parentId]) =>
    store.updateFolder(id, name, parentId)
  )
  handle('delete-folder', z.tuple([id]), ([id]) => store.deleteFolder(id))
  handle('move-problem', z.tuple([id, id.nullable()]), ([id, folderId]) => {
    idle()
    store.moveProblem(id, folderId)
  })
  handle('problem', z.tuple([id]), ([id]) => store.problem(id, true))
  handle('delete-problem', z.tuple([id]), ([id]) => {
    idle()
    store.deleteProblem(id)
  })
  let importing = false
  handle('import', z.tuple([]), async () => {
    if (importing) throw new Error('An import is already in progress.')
    importing = true
    try {
      const selected = await dialog.showOpenDialog(window, {
        title: 'Import problem package',
        filters: [{ name: 'Problem ZIP', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }
      return { ok: true, preview: await importer.preview(selected.filePaths[0]) }
    } catch (error) {
      log('Import rejected', error)
      return {
        ok: false,
        message: 'Could not import this package',
        issues:
          error instanceof PackageError
            ? error.issues
            : [error instanceof Error ? error.message : 'The archive could not be read.']
      }
    } finally {
      importing = false
    }
  })
  handle('confirm-import', z.tuple([id, id.nullable()]), ([token, folderId]) =>
    importer.commit(token, folderId)
  )
  handle('discard-import', z.tuple([id]), ([token]) => importer.discard(token))
  handle('create-approach', z.tuple([id, name]), ([id, name]) => store.createApproach(id, name))
  handle('rename-approach', z.tuple([id, name]), ([id, name]) => {
    idle()
    store.renameApproach(id, name)
  })
  handle('delete-approach', z.tuple([id]), ([id]) => {
    idle()
    store.db.prepare('DELETE FROM approaches WHERE id=?').run(id)
  })
  handle('save-code', z.tuple([id, language, code]), ([id, language, code]) =>
    store.saveCode(id, language, code)
  )
  handle('settings', z.tuple([]), () => store.settings())
  handle('update-settings', z.tuple([settings]), ([patch]) => store.updateSettings(patch))
  handle('environment', z.tuple([]), async () => ({
    ...(await detect(store.settings())),
    dataDirectory: store.root,
    logsDirectory
  }))
  handle('browse', z.tuple([]), async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: 'Choose executable',
      filters: [{ name: 'Windows executable', extensions: ['exe'] }],
      properties: ['openFile']
    })
    return selected.canceled ? null : (selected.filePaths[0] ?? null)
  })
  handle('open-folder', z.tuple([z.enum(['data', 'logs'])]), async ([kind]) => {
    const error = await shell.openPath(kind === 'data' ? store.root : logsDirectory)
    if (error) throw new Error(error)
  })
  handle(
    'run',
    z.tuple([z.object({ problemId: id, approachId: id, language, sourceCode: code }).strict()]),
    ([request]) => judge.start(request)
  )
  handle('cancel', z.tuple([id]), ([id]) => judge.cancel(id))
  handle('test-text', z.tuple([id]), async ([id]) => {
    const test = store.test(id)
    const preview = async (relative: string) => {
      const file = await open(store.path(relative), 'r')
      try {
        const length = (await file.stat()).size
        const buffer = Buffer.alloc(Math.min(length, 65536))
        await file.read(buffer, 0, buffer.length, 0)
        return { text: buffer.toString('utf8'), truncated: length > buffer.length }
      } finally {
        await file.close()
      }
    }
    const [input, expected] = await Promise.all([preview(test.inputPath), preview(test.outputPath)])
    return {
      input: input.text,
      expected: expected.text,
      inputTruncated: input.truncated,
      expectedTruncated: expected.truncated
    }
  })
}
