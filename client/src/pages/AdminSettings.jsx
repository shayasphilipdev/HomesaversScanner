import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminGetSettings, adminUpdateSettings,
  adminCleanupPhotos, adminCleanupTaskRecords, adminGetCapacity
} from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'
import { useToast } from '../components/Toast.jsx'

// Format bytes in a human-readable way: 1.4 MB, 312 KB, etc.
function fmtBytes(b) {
  if (b === 0 || b == null) return '0 B'
  const u = ['B','KB','MB','GB','TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log10(b) / 3))
  return `${(b / Math.pow(1000, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

// Friendly labels for the known app_settings keys. New keys default to a
// generic label so back office can still see/edit them without a redeploy.
// Thresholds at which the meter (and the nav alert) turn yellow / red.
const WARN_PCT = 70
const CRIT_PCT = 85

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
  },
  scanner_camera_enabled: {
    label: 'Camera scanning',
    hint:  'When on, every barcode field shows a "Use camera" button. Off by default — stores use a scanner gun.',
    bool:  true
  },
  capacity_db_limit_bytes: {
    label: 'Database size limit (bytes)',
    hint:  'Used by the Capacity meter at the top of this page. Free Supabase tier = 524288000 (500 MB). Update if you upgrade plan.'
  },
  capacity_storage_limit_bytes: {
    label: 'Storage size limit (bytes)',
    hint:  'Used by the Capacity meter at the top of this page. Free Supabase tier = 1073741824 (1 GB).'
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
  const [recordCleanupBusy, setRecordCleanupBusy] = useState(false)
  const [capacity, setCapacity] = useState(null)
  const isOnlyAdmin = session?.role === 'admin'

  const loadCapacity = async () => {
    if (!isOnlyAdmin) return
    try { setCapacity(await adminGetCapacity()) } catch (e) { /* admin-only endpoint; silent */ }
  }
  useEffect(() => { loadCapacity() }, [isOnlyAdmin])

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
      loadCapacity()
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setCleanupBusy(false) }
  }

  const runRecordCleanup = async () => {
    if (!confirm('Delete cleared / store-confirmed task records older than the retention window? The records leave the database for good. Photos referenced by them are NOT deleted by this action — run the photo cleanup separately.')) return
    setRecordCleanupBusy(true); setError('')
    try {
      const res = await adminCleanupTaskRecords()
      toast.success(`Records cleanup complete — ${res.deleted} removed (retention ${res.days}d).`)
      loadCapacity()
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setRecordCleanupBusy(false) }
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

      {isOnlyAdmin && capacity && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Supabase capacity</span>
            <span className="note" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {capacity.computed_at ? new Date(capacity.computed_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
            <button className="btn btn-sm btn-outline" onClick={loadCapacity}>↻ Refresh</button>
          </div>
          <div className="card-body">
            <Meter
              label="Database"
              used={capacity.db.used_bytes}
              limit={capacity.db.limit_bytes}
            />
            <Meter
              label={`Storage · ${capacity.storage.object_count.toLocaleString('en-IE')} object${capacity.storage.object_count === 1 ? '' : 's'}`}
              used={capacity.storage.used_bytes}
              limit={capacity.storage.limit_bytes}
            />
            <p className="note" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              When usage gets high, lower <code>scan_record_retention_days</code> or <code>photo_retention_days</code> below and run the cleanups in the Maintenance card. Limits are editable below if you upgrade Supabase plan.
            </p>
          </div>
        </div>
      )}

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
                  const isOn = values[s.key] === 'true'
                  return (
                    <div className="form-group full" key={s.key}>
                      <label>{meta.label}</label>
                      {meta.bool ? (
                        <label className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={e => updateValue(s.key, e.target.checked ? 'true' : 'false')}
                          />
                          <span className="note" style={{ fontSize: 13 }}>{isOn ? 'On' : 'Off'}</span>
                        </label>
                      ) : (
                        <input
                          type="text"
                          value={values[s.key] || ''}
                          onChange={e => updateValue(s.key, e.target.value)}
                        />
                      )}
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
            Free up storage by purging old data. Run these one at a time; both
            actions are irreversible.
          </p>
          <div className="flex-row mt-12" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={runCleanup} disabled={cleanupBusy}>
              {cleanupBusy ? <><span className="spinner" /> Cleaning…</> : '🧹 Run photo cleanup now'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={runRecordCleanup} disabled={recordCleanupBusy}>
              {recordCleanupBusy ? <><span className="spinner" /> Cleaning…</> : '🗑 Delete old task records'}
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

// Single horizontal capacity meter. Goes amber at WARN_PCT (70%), red at
// CRIT_PCT (85%). The CRIT shade is the trigger for the flashing nav alert.
function Meter({ label, used, limit }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const colour = pct >= CRIT_PCT ? '#D14B3D' : pct >= WARN_PCT ? '#E0A03A' : '#3E9F4B'
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="flex-row" style={{ marginBottom: 4, fontSize: 13 }}>
        <strong>{label}</strong>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {fmtBytes(used)} of {fmtBytes(limit)} · <strong style={{ color: colour }}>{pct.toFixed(1)}%</strong>
        </span>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: 'var(--bg-soft)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: colour, transition: 'width 250ms ease' }} />
      </div>
    </div>
  )
}
