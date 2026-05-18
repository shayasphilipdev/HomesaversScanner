import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { adminGetSettings, adminUpdateSettings, adminCleanupPhotos } from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'
import { useToast } from '../components/Toast.jsx'

// Friendly labels for the known app_settings keys. New keys default to a
// generic label so back office can still see/edit them without a redeploy.
const KEY_META = {
  list_auto_close_hours: {
    label: 'List auto-close (hours)',
    hint:  'How long after creation a list auto-closes (planned feature — currently informational).'
  },
  scan_record_retention_days: {
    label: 'Scan record retention (days)',
    hint:  'How long task records are kept before cleanup (planned feature).'
  },
  photo_retention_days: {
    label: 'Photo retention (days)',
    hint:  'Photos older than this can be removed via the cleanup button below.'
  },
  product_sync_folder: {
    label: 'Product sync folder',
    hint:  'UNC or local path the daily 06:00 PowerShell job reads. Use the same path the Windows machine can see — e.g. Y:\\Supply Chain & Buying - Shared\\Data\\VRSDAILYDATADUMP\\ProductMaster\\2026'
  },
  product_sync_file_pattern: {
    label: 'Product sync file pattern',
    hint:  'Glob to match within the folder — e.g. *.xlsx. The newest matching file by modified date is used each day.'
  },
  product_sync_sheet: {
    label: 'Product sync Excel sheet',
    hint:  'Sheet to read inside the workbook. "1" = first sheet by index, or enter a sheet name.'
  }
}

export default function AdminSettings() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [settings, setSettings] = useState([])
  const [values, setValues]     = useState({})
  const [dirty, setDirty]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupResult, setCleanupResult] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await adminGetSettings()
      setSettings(rows)
      setValues(Object.fromEntries(rows.map(r => [r.key, r.value])))
      setDirty(false)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { if (isBO) load() }, [isBO])

  const updateValue = (key, value) => {
    setValues(v => ({ ...v, [key]: value }))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      // Only send changed keys.
      const original = Object.fromEntries(settings.map(r => [r.key, r.value]))
      const changed  = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== original[k]))
      if (!Object.keys(changed).length) { setDirty(false); return }
      await adminUpdateSettings(changed)
      toast.success('Settings saved.')
      await load()
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const runCleanup = async () => {
    if (!confirm('Delete all photos older than the retention window? This cannot be undone.')) return
    setCleanupBusy(true); setError(''); setCleanupResult(null)
    try {
      const res = await adminCleanupPhotos()
      setCleanupResult(res)
      toast.success(`Photo cleanup complete — ${res.deleted} deleted.`)
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setCleanupBusy(false) }
  }

  if (!isBO) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Retention windows and maintenance</div>
        </div>
      </div>

      <AdminNav />

      {error && <div className="login-error mt-12">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">App settings</div>
        <div className="card-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
          ) : !settings.length ? (
            <div className="empty-state"><p>No editable settings.</p></div>
          ) : (
            <>
              <div className="form-grid">
                {settings.map(s => {
                  const meta = KEY_META[s.key] || { label: s.key, hint: '' }
                  return (
                    <div className="form-group full" key={s.key}>
                      <label>{meta.label}</label>
                      <input
                        type="text"
                        value={values[s.key] || ''}
                        onChange={e => updateValue(s.key, e.target.value)}
                      />
                      {meta.hint && <span className="note" style={{ fontSize: 12 }}>{meta.hint}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="flex-row mt-20" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={load} disabled={saving}>Reload</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || saving}>
                  {saving ? <><span className="spinner" /> Saving…</> : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Maintenance</div>
        <div className="card-body">
          <p className="note" style={{ marginTop: 0 }}>
            Run the photo cleanup to remove product / barcode photos older than the retention window above.
          </p>
          <div className="flex-row mt-12" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={runCleanup} disabled={cleanupBusy}>
              {cleanupBusy ? <><span className="spinner" /> Cleaning…</> : '🧹 Run photo cleanup now'}
            </button>
            {cleanupResult && (
              <span className="note">
                Scanned <strong>{cleanupResult.scanned}</strong> old photos · deleted <strong>{cleanupResult.deleted}</strong>{cleanupResult.failed ? ` · failed ${cleanupResult.failed}` : ''} · retention {cleanupResult.days}d.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
