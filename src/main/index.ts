import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron'
import { extname, join, resolve, sep } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { Store } from './db'
import { Importer } from './import/zipImporter'
import { Judge } from './runner/judge'
import { registerIpc } from './ipc'
import { initLog, log } from './log'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dsa',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])
if (process.env.DSA_LAB_DATA_DIR) app.setPath('userData', resolve(process.env.DSA_LAB_DATA_DIR))
const lock = app.requestSingleInstanceLock()
let window: BrowserWindow | null = null
if (!lock) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('dev.dsalab.desktop')
      const root = join(app.getPath('userData'), 'dsa-lab')
      const logsDirectory = join(root, 'logs')
      mkdirSync(logsDirectory, { recursive: true })
      initLog(logsDirectory)
      log('DSA Lab startup')
      let store: Store
      try {
        store = new Store(root)
      } catch (error) {
        log('Database initialization failed', error)
        dialog.showErrorBox('DSA Lab could not open its database', String(error))
        app.quit()
        return
      }
      // Staging is app-owned, and no imports are active at startup.
      const staging = join(root, 'staging')
      for (const entry of await readdir(staging, { withFileTypes: true }).catch(() => []))
        if (entry.isDirectory() && entry.name.startsWith('import-'))
          await rm(join(staging, entry.name), { recursive: true, force: true }).catch((e) =>
            log('Stale import cleanup', e)
          )
      const rendererRoot = resolve(__dirname, '../renderer')
      protocol.handle('dsa', async (request) => {
        try {
          const url = new URL(request.url)
          if (url.hostname !== 'app') return new Response('Not found', { status: 404 })
          const path = resolve(
            rendererRoot,
            '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
          )
          if (!path.startsWith(rendererRoot + sep))
            return new Response('Forbidden', { status: 403 })
          const types: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.svg': 'image/svg+xml',
            '.png': 'image/png'
          }
          return new Response(await readFile(path), {
            headers: {
              'Content-Type': types[extname(path)] ?? 'application/octet-stream',
              'X-Content-Type-Options': 'nosniff'
            }
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
      const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
      if (devUrl && !['localhost', '127.0.0.1'].includes(new URL(devUrl).hostname))
        throw new Error('Development renderer must use a local loopback address.')
      const allowedUrl = devUrl ? new URL(devUrl).toString() : 'dsa://app/'
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false)
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url)
        const local =
          (url.protocol === 'dsa:' && url.hostname === 'app') ||
          url.protocol === 'devtools:' ||
          (!!devUrl && ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(devUrl).host)
        callback({ cancel: !local })
      })
      window = new BrowserWindow({
        width: 1500,
        height: 920,
        minWidth: 1100,
        minHeight: 680,
        title: 'DSA Lab',
        icon: join(rendererRoot, 'icon.png'),
        backgroundColor: '#ffffff',
        show: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true
        }
      })
      const mainWindow = window
      mainWindow.setMenu(null)
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
      mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
      mainWindow.webContents.on('render-process-gone', (_event, details) =>
        log('Renderer exited', details.reason)
      )
      const importer = new Importer(store)
      const judge = new Judge(store, (event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('dsa:run-progress', event)
      })
      registerIpc(mainWindow, store, importer, judge, logsDirectory, allowedUrl)
      let closing = false
      let awaitingSave = false
      let closeTimer: ReturnType<typeof setTimeout> | undefined
      const close = async () => {
        if (closing) return
        closing = true
        clearTimeout(closeTimer)
        await judge.shutdown()
        await importer.discard()
        store.db.close()
        mainWindow.destroy()
        app.quit()
      }
      ipcMain.on('dsa:ready-close', (event) => {
        if (
          awaitingSave &&
          event.sender === mainWindow.webContents &&
          event.senderFrame === mainWindow.webContents.mainFrame &&
          event.senderFrame.url === allowedUrl
        )
          void close()
      })
      mainWindow.on('close', (event) => {
        if (closing) return
        event.preventDefault()
        if (awaitingSave) return
        awaitingSave = true
        mainWindow.webContents.send('dsa:before-close')
        closeTimer = setTimeout(() => {
          void dialog
            .showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Waiting to save',
              message: 'The editor has not confirmed that your code was saved.',
              detail: 'Keep DSA Lab open to retry saving, or close and discard unsaved changes.',
              buttons: ['Keep open', 'Close anyway'],
              defaultId: 0,
              cancelId: 0
            })
            .then((answer) => {
              if (answer.response === 1) void close()
              else awaitingSave = false
            })
        }, 8000)
      })
      await mainWindow.loadURL(allowedUrl)
      mainWindow.maximize()
      mainWindow.show()
    })
    .catch((error) => {
      log('Startup failure', error)
      dialog.showErrorBox('DSA Lab could not start', String(error))
      app.quit()
    })
}
app.on('window-all-closed', () => app.quit())
