import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, FolderOpen, RefreshCw } from 'lucide-react'
import type { Environment as EnvironmentInfo, Settings } from '../../shared/types'
import { Modal } from './Modal'
export function Environment({
  settings,
  onUpdate,
  onClose
}: {
  settings: Settings
  onUpdate: (settings: Settings) => void
  onClose: () => void
}) {
  const [cpp, setCpp] = useState(settings.cpp.executable)
  const [python, setPython] = useState(settings.python.executable)
  const [prefix, setPrefix] = useState(JSON.stringify(settings.python.argsPrefix))
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setBusy(true)
    void window.dsa
      .detectToolchains()
      .then(setEnvironment)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }, [])
  const recheck = async () => {
    setBusy(true)
    setError('')
    try {
      const args: unknown = JSON.parse(prefix)
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))
        throw new Error('Python prefix arguments must be a JSON array of strings, such as ["-3"].')
      const updated = await window.dsa.updateSettings({
        cpp: { executable: cpp.trim(), argsPrefix: [] },
        python: { executable: python.trim(), argsPrefix: args }
      })
      onUpdate(updated)
      setEnvironment(await window.dsa.detectToolchains())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const browse = async (language: 'cpp' | 'python') => {
    try {
      const file = await window.dsa.browseExecutable()
      if (file) {
        if (language === 'cpp') setCpp(file)
        else {
          setPython(file)
          setPrefix('[]')
        }
      }
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <Modal title="Environment" onClose={onClose} wide>
      <p className="modal-intro">Your tools. Your machine. Everything runs locally.</p>
      {(['cpp', 'python'] as const).map((language) => (
        <section className="tool-section" key={language}>
          <div className="tool-heading">
            <h3>{language === 'cpp' ? 'C++' : 'Python'}</h3>
            <span className="subtle-tag">{language === 'cpp' ? 'GCC · C++20' : 'Python 3'}</span>
          </div>
          <label>
            {language === 'cpp'
              ? 'Compiler executable'
              : 'Python executable · leave blank for automatic detection'}
            <div className="input-with-button">
              <input
                value={language === 'cpp' ? cpp : python}
                onChange={(e) =>
                  language === 'cpp' ? setCpp(e.target.value) : setPython(e.target.value)
                }
                placeholder={language === 'cpp' ? 'g++' : 'Automatic: py -3, then python'}
                disabled={busy}
              />
              <button
                aria-label={`Browse ${language} executable`}
                onClick={() => void browse(language)}
                disabled={busy}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </label>
          {language === 'python' && (
            <label>
              Prefix arguments (JSON array)
              <input
                className="mono"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder='["-3"]'
                disabled={busy}
              />
            </label>
          )}
          {environment && (
            <div
              className={`tool-status ${environment[language].available ? 'success' : 'danger'}`}
            >
              {environment[language].available ? (
                <CheckCircle2 size={14} />
              ) : (
                <CircleAlert size={14} />
              )}
              <span>
                {environment[language].available
                  ? environment[language].version
                  : `${language === 'cpp' ? 'C++ compiler' : 'Python'} not found`}
              </span>
            </div>
          )}
          {environment && !environment[language].available && (
            <p className="field-help">
              {language === 'cpp'
                ? 'DSA Lab looked for g++ on PATH, or your override. Install GCC / MinGW or choose its g++.exe above.'
                : 'Install Python 3 with the Windows launcher, or choose python.exe above. For py.exe, use ["-3"] as prefix arguments.'}
            </p>
          )}
        </section>
      ))}
      {error && <p className="error-banner">{error}</p>}
      <section className="data-section">
        <h3>Local data</h3>
        <code>{environment?.dataDirectory ?? 'Loading…'}</code>
        <div className="folder-actions">
          <button
            className="text-button"
            onClick={() => void window.dsa.openFolder('data').catch((e) => setError(String(e)))}
          >
            Open data folder
          </button>
          <button
            className="text-button"
            onClick={() => void window.dsa.openFolder('logs').catch((e) => setError(String(e)))}
          >
            Open logs folder
          </button>
        </div>
      </section>
      <p className="security-note">
        DSA Lab is not a security sandbox. Solutions run with your Windows user permissions. Only
        run code you trust.
      </p>
      <div className="modal-footer">
        <span className="muted">Changes apply when you recheck.</span>
        <button className="primary" onClick={() => void recheck()} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
          {busy ? 'Checking…' : 'Save & Recheck Environment'}
        </button>
      </div>
    </Modal>
  )
}
