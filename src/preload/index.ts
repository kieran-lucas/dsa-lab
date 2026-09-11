import { contextBridge, ipcRenderer } from 'electron'
import type { DsaApi, RunProgress } from '../shared/types'
const api: DsaApi = {
  listProblems: () => ipcRenderer.invoke('dsa:list'),
  getProblem: (id) => ipcRenderer.invoke('dsa:problem', id),
  deleteProblem: (id) => ipcRenderer.invoke('dsa:delete-problem', id),
  importProblemZip: () => ipcRenderer.invoke('dsa:import'),
  confirmImport: (token) => ipcRenderer.invoke('dsa:confirm-import', token),
  discardImport: (token) => ipcRenderer.invoke('dsa:discard-import', token),
  createApproach: (id, name) => ipcRenderer.invoke('dsa:create-approach', id, name),
  renameApproach: (id, name) => ipcRenderer.invoke('dsa:rename-approach', id, name),
  deleteApproach: (id) => ipcRenderer.invoke('dsa:delete-approach', id),
  saveCode: (id, language, code) => ipcRenderer.invoke('dsa:save-code', id, language, code),
  getSettings: () => ipcRenderer.invoke('dsa:settings'),
  updateSettings: (patch) => ipcRenderer.invoke('dsa:update-settings', patch),
  detectToolchains: () => ipcRenderer.invoke('dsa:environment'),
  browseExecutable: () => ipcRenderer.invoke('dsa:browse'),
  openFolder: (kind) => ipcRenderer.invoke('dsa:open-folder', kind),
  runSolution: (request) => ipcRenderer.invoke('dsa:run', request),
  cancelRun: (id) => ipcRenderer.invoke('dsa:cancel', id),
  getTestText: (id) => ipcRenderer.invoke('dsa:test-text', id),
  onRunProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: RunProgress) => callback(data)
    ipcRenderer.on('dsa:run-progress', listener)
    return () => ipcRenderer.removeListener('dsa:run-progress', listener)
  },
  onBeforeClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('dsa:before-close', listener)
    return () => ipcRenderer.removeListener('dsa:before-close', listener)
  },
  readyToClose: () => ipcRenderer.send('dsa:ready-close')
}
contextBridge.exposeInMainWorld('dsa', api)
