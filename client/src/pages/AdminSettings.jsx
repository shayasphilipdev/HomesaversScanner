import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminGetSettings, adminUpdateSettings,
  adminCleanupPhotos, adminCleanupTaskRecords, adminGetCapacity, adminListSyncRuns,
  adminUploadExcel, adminGetCloudflareUsage, localUploadServerUp
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

// Group the raw settings rows into ordered sections for display. Within a
// section, fields follow the order they appear in KEY_META. Unknown keys
// (no meta) collect under "Other" at the end.
function groupSettings(settings) {
  const metaKeys = Object.keys(KEY_META)
  const buckets = {}
  for (const s of settings) {
    if (KEY_META[s.key]?.hidden) continue   // unused/placeholder keys never render
    const section = KEY_META[s.key]?.section || 'Other'
    ;(buckets[section] ||= []).push(s)
  }
  const order = [...SECTION_ORDER, 'Other']
  return order
    .filter(sec => buckets[sec]?.length)
    .map(section => ({
      section,
      rows: buckets[section].sort((a, b) => metaKeys.indexOf(a.key) - metaKeys.indexOf(b.key))
    }))
}

// Settings are rendered grouped into these sections, in this order. Each
// KEY_META entry names its section so related fields stay together.
const SECTION_ORDER = ['Alt-barcode sync', 'Prices sync', 'Camera', 'Retention', 'Capacity', 'System']

const KEY_META = {
  // ── Alt-barcode sync (kept together) ──────────────────────────────────
  alt_barcode_sync_folder: {
    section: 'Alt-barcode sync',
    label: 'Sync folder',
    wide:  true,
    hint:  'Network path the PowerShell job reads. e.g. Y:\\Supply Chain & Buying - Shared\\Data\\VRSDAILYDATADUMP\\ProductMaster-ALTBarcode\\2026'
  },
  alt_barcode_sync_pattern: {
    section: 'Alt-barcode sync',
    label: 'File pattern',
    hint:  'Glob to match in the folder — e.g. *.xlsx. Newest matching file wins.'
  },
  alt_barcode_sync_name_prefix: {
    section: 'Alt-barcode sync',
    label: 'File name starts with',
    hint:  'Safety guard: only files whose name begins with this are synced (e.g. "ALT Barcode Master"). Stops a stray workbook in the folder being imported. Leave blank to allow any matching file.'
  },
  alt_barcode_sync_sheet: {
    section: 'Alt-barcode sync',
    label: 'Excel sheet',
    hint:  '"1" = first sheet by index, or a sheet name.'
  },
  alt_barcode_sync_schedule: {
    section: 'Alt-barcode sync',
    label: 'Schedule',
    hint:  'How often the job runs. Works with the time below — e.g. "daily at 06:00". Match this in Windows Task Scheduler.',
    choices: ['daily', 'weekly', 'monthly']
  },
  alt_barcode_sync_time: {
    section: 'Alt-barcode sync',
    label: 'Schedule time',
    time:  true,
    hint:  'Time of day the job runs (24h). Pairs with the schedule above. Set the same time in Windows Task Scheduler.'
  },
  // ── Prices sync (ItemMaster) ───────────────────────────────────────────
  prices_sync_folder: {
    section: 'Prices sync',
    label: 'Sync folder',
    wide:  true,
    hint:  'Network path containing ItemMaster*.xlsx files. e.g. Y:\\Supply Chain & Buying - Shared\\Data\\VRSDAILYDATADUMP\\ProductMaster\\2026'
  },
  prices_sync_pattern: {
    section: 'Prices sync',
    label: 'File pattern',
    hint:  'Glob to match — e.g. *.xlsx. Newest matching file wins.'
  },
  prices_sync_name_prefix: {
    section: 'Prices sync',
    label: 'File name starts with',
    hint:  'Only files whose name begins with this are synced (e.g. "ItemMaster"). Leave blank to allow any matching file.'
  },
  prices_sync_sheet: {
    section: 'Prices sync',
    label: 'Excel sheet',
    hint:  'Sheet name in the workbook — e.g. "ItemMaster". Or "1" for the first sheet.'
  },
  prices_sync_schedule: {
    section: 'Prices sync',
    label: 'Schedule',
    hint:  'How often the job runs. Match in Windows Task Scheduler.',
    choices: ['daily', 'weekly', 'monthly']
  },
  prices_sync_time: {
    section: 'Prices sync',
    label: 'Schedule time',
    time:  true,
    hint:  'Time of day the prices sync runs (24h). Match in Windows Task Scheduler.'
  },
  // ── Camera ─────────────────────────────────────────────────────────────
  scanner_camera_enabled: {
    section: 'Camera',
    label: 'Camera scanning',
    hint:  'When on, every barcode field shows a "Use camera" button. Off by default — stores use a scanner gun.',
    bool:  true
  },
  // ── Competition ────────────────────────────────────────────────────────
  competition_enabled: {
    section: 'Competition',
    label: 'Competition capture',
    hint:  'When on, the Competition screen (record competitors around each store) is available to all users, plus its Reports tab. Off hides it everywhere.',
    bool:  true
  },
  // ── Retention ──────────────────────────────────────────────────────────
  list_auto_close_hours: {
    section: 'Retention',
    label: 'List auto-close (hours)',
    hidden: true,   // not wired to anything — kept in DB, hidden from the UI
    hint:  'Planned feature — currently unused.'
  },
  scan_record_retention_days: {
    section: 'Retention',
    label: 'Scan record retention (days)',
    hint:  'Cleared / store-confirmed task records older than this are removed by the "Delete old task records" cleanup (and the nightly auto-cleanup).'
  },
  photo_retention_days: {
    section: 'Retention',
    label: 'Photo retention (days)',
    hint:  'Photos older than this can be removed via the cleanup button below.'
  },
  stats_rollup_retention_days: {
    section: 'Retention',
    label: 'Dashboard statistics retention (days)',
    hint:  'How long the per-day dashboard statistics (task_stats_daily) are kept — counts only, no records. Default 180 (6 months). These survive the record cleanup above, which is what keeps long-range dashboard reports accurate.'
  },
  stats_rollup_window_days: {
    section: 'Retention',
    label: 'Statistics recompute window (days)',
    hint:  'How many past days the nightly statistics job recalculates, so late status changes are picked up. Must stay below Scan record retention — it is clamped automatically to (retention − 3), because recomputing a day whose records are already deleted would zero that day.'
  },
  // ── Capacity ───────────────────────────────────────────────────────────
  capacity_db_limit_bytes: {
    section: 'Capacity',
    label: 'Database size limit (MB)',
    mb:    true,
    hint:  'Used by the Capacity meter at the top of this page. Free Supabase tier = 500 MB. Update if you upgrade plan.'
  },
  capacity_storage_limit_bytes: {
    section: 'Capacity',
    label: 'Storage size limit (MB)',
    mb:    true,
    hint:  'Used by the Capacity meter at the top of this page. Free Supabase tier = 1024 MB (1 GB).'
  },
  // ── System (read-only) ──────────────────────────────────────────────────
  last_auto_cleanup_at: {
    section: 'System',
    label: 'Last auto-cleanup',
    readonly: true,
    hint:  'When the nightly retention cleanup last ran. Read-only — set automatically.'
  }
}

// Format an ISO timestamp for the read-only System fields; pass through plain
// strings unchanged.
function fmtMaybeDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime())
    ? v
    : d.toLocaleString('en-IE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  const [syncRuns, setSyncRuns] = useState([])
  const [cfUsage, setCfUsage]           = useState(null)
  const [cfUsageLoading, setCfUsageLoading] = useState(false)
  const [cfUsageError, setCfUsageError]     = useState('')
  const isOnlyAdmin = session?.role === 'admin'

  const loadCapacity = async () => {
    if (!isOnlyAdmin) return
    try { setCapacity(await adminGetCapacity()) } catch (e) { /* admin-only endpoint; silent */ }
  }
  const loadSyncRuns = async () => {
    try { setSyncRuns(await adminListSyncRuns()) } catch { /* silent */ }
  }
  // Loaded on demand (page open + manual refresh) rather than polled, so this
  // monitoring feature doesn't itself add to the Cloudflare request volume
  // it's meant to be tracking.
  const loadCfUsage = async () => {
    if (!isOnlyAdmin) return
    setCfUsageLoading(true); setCfUsageError('')
    try { setCfUsage(await adminGetCloudflareUsage()) }
    catch (e) { setCfUsageError(e.message) }
    finally { setCfUsageLoading(false) }
  }
  useEffect(() => { loadCapacity() }, [isOnlyAdmin])
  useEffect(() => { loadCfUsage() }, [isOnlyAdmin])
  useEffect(() => { if (isBO) loadSyncRuns() }, [isBO])

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

      <SyncDashboard
        syncRuns={syncRuns}
        onRefresh={loadSyncRuns}
        values={values}
        toast={toast}
      />

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

      {isOnlyAdmin && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Cloudflare requests · last 7 days</span>
            <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={loadCfUsage} disabled={cfUsageLoading}>
              {cfUsageLoading ? <span className="spinner spinner-dark" /> : '↻ Refresh'}
            </button>
          </div>
          <div className="card-body">
            {cfUsageError ? (
              <p className="note" style={{ color: '#D14B3D' }}>{cfUsageError}</p>
            ) : (
              <CloudflareUsageChart data={cfUsage} loading={cfUsageLoading} />
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        </div>
      ) : !settings.length ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body"><div className="empty-state"><p>No editable settings.</p></div></div>
        </div>
      ) : (
        <SettingsCards
          groups={groupSettings(settings)}
          values={values}
          updateValue={updateValue}
          onReload={load}
          onSave={save}
          dirty={dirty}
          saving={saving}
        />
      )}

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

// ── App settings — one compact card per section, in responsive grids ───────
function SettingsCards({ groups, values, updateValue, onReload, onSave, dirty, saving }) {
  const isSync = sec => sec === 'Alt-barcode sync' || sec === 'Prices sync'
  const syncGroups  = groups.filter(g => isSync(g.section))
  const smallGroups = groups.filter(g => !isSync(g.section))

  const field = (s) => {
    const meta = KEY_META[s.key] || { label: s.key, hint: '' }
    const isOn = values[s.key] === 'true'
    return (
      <div className={`form-group${meta.wide ? ' full' : ''}`} key={s.key}>
        <label>{meta.label}</label>
        {meta.readonly ? (
          <input type="text" readOnly value={fmtMaybeDate(values[s.key])}
            style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }} />
        ) : meta.bool ? (
          <label className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={isOn}
              onChange={e => updateValue(s.key, e.target.checked ? 'true' : 'false')} />
            <span className="note" style={{ fontSize: 13 }}>{isOn ? 'On' : 'Off'}</span>
          </label>
        ) : meta.choices ? (
          <select value={values[s.key] || ''} onChange={e => updateValue(s.key, e.target.value)}>
            {meta.choices.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : meta.time ? (
          <input type="time" value={values[s.key] || ''} onChange={e => updateValue(s.key, e.target.value)} />
        ) : meta.mb ? (
          <input type="number" min="0" step="1"
            value={values[s.key] ? Math.round(Number(values[s.key]) / 1048576) : ''}
            onChange={e => updateValue(s.key, e.target.value === '' ? '' : String(Math.round(Number(e.target.value) * 1048576)))} />
        ) : (
          <input type="text" value={values[s.key] || ''} onChange={e => updateValue(s.key, e.target.value)} />
        )}
        {meta.hint && <span className="note" style={{ fontSize: 11, lineHeight: 1.35 }}>{meta.hint}</span>}
      </div>
    )
  }

  const card = ({ section, rows }, oneCol) => (
    <div className="card settings-card" key={section}>
      <div className="card-header">{section}</div>
      <div className="card-body">
        <div className={'settings-field-grid' + (oneCol ? ' settings-field-grid--one' : '')}>
          {rows.map(field)}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {syncGroups.length > 0 && (
        <div className="settings-card-grid settings-card-grid--wide">
          {syncGroups.map(g => card(g, false))}
        </div>
      )}
      {smallGroups.length > 0 && (
        <div className="settings-card-grid">
          {smallGroups.map(g => card(g, true))}
        </div>
      )}
      <div className="flex-row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 20 }}>
        <button className="btn btn-outline btn-sm" onClick={onReload} disabled={saving}>Reload</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={!dirty || saving}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Save changes'}
        </button>
      </div>
    </>
  )
}

// ── Sync Dashboard ────────────────────────────────────────────────────────────
function SyncDashboard({ syncRuns, onRefresh, values, toast }) {
  const altRuns      = syncRuns.filter(r => r.kind === 'alt_barcodes' || !r.kind).slice(0, 3)
  const pricesRuns   = syncRuns.filter(r => r.kind === 'prices').slice(0, 3)
  const cnRuns       = syncRuns.filter(r => r.kind === 'cn_codes').slice(0, 5)
  const bmRuns       = syncRuns.filter(r => r.kind === 'bm_daily').slice(0, 5)
  const manifestRuns = syncRuns.filter(r => r.kind === 'manifest').slice(0, 5)

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Data Sync</div>
        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={onRefresh}>↻ Refresh</button>
      </div>
      <div className="sync-grid">
        <SyncCard
          title="Alt Barcode Master"
          icon="🔖"
          runs={altRuns}
          sheetDefault={values.alt_barcode_sync_sheet || '1'}
          endpoint="/alt-barcodes/upload-excel"
          syncCmd="run_sync.bat alt-barcodes"
          toast={toast}
        />
        <SyncCard
          title="ItemMaster (Prices)"
          icon="💰"
          runs={pricesRuns}
          sheetDefault={values.prices_sync_sheet || '1'}
          endpoint="/prices/upload-excel"
          syncCmd="run_sync.bat prices"
          toast={toast}
        />
        <SyncCard
          title="CN Code Master"
          icon="🛃"
          runs={cnRuns}
          rowsLabel="codes imported"
          footnote="Pulled automatically every night (02:45) from the CN-code master app (Task Scheduler job 'Homesavers CN Code Sync'). Full replace of product codes; red = a run failed."
          runCmd="powershell scripts\\sync-cn-codes.ps1"
          toast={toast}
        />
        <SyncCard
          title="B&M Daily File"
          icon="📦"
          runs={bmRuns}
          rowsLabel="product codes"
          sheetDefault="1"
          endpoint="/bm-daily/upload-excel"
          syncCmd="run_sync.bat bm-daily"
          footnote="Pulled automatically every night (08:15) from the latest HomeSavers_*.xlsx B&M product file (Task Scheduler job 'Homesavers B&M Daily Sync'). Full replace of ProductIDs; red = a run failed."
          toast={toast}
        />
        <SyncCard
          title="Delivery Manifests"
          icon="🚚"
          runs={manifestRuns}
          rowsLabel="rows in manifest"
          footnote="Generated automatically every 30 minutes from new HSVMAN files (Task Scheduler job 'Homesavers Manifest'). One entry per manifest; red = a load failed to generate."
          syncCmd="manifest-generator.py"
          toast={toast}
        />
      </div>
    </div>
  )
}

function SyncCard({ title, icon, runs, sheetDefault, endpoint, syncCmd, toast, rowsLabel = 'rows imported', footnote, runCmd }) {
  const last = runs[0]

  const statusColor = !last ? '#888'
    : last.status === 'ok'    ? '#3E9F4B'
    : '#c0392b'

  const statusLabel = !last ? 'Never synced'
    : last.status === 'ok' ? 'Last sync OK'
    : 'Last sync failed'

  const lastTime = last?.finished_at
    ? new Date(last.finished_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{
      background: 'var(--card-bg, #fff)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,.06)'
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10
      }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 12, color: statusColor, marginTop: 1 }}>
            {statusLabel}{lastTime ? ` · ${lastTime}` : ''}
          </div>
        </div>
        {last && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              {last.records_imported != null ? last.records_imported.toLocaleString('en-IE') : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>{rowsLabel}</div>
          </div>
        )}
      </div>

      {/* Recent runs */}
      <div style={{ padding: '10px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          Recent syncs
        </div>
        {!runs.length ? (
          <p className="note" style={{ margin: '4px 0', fontSize: 12 }}>No syncs recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {runs.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, padding: '4px 0',
                borderBottom: '1px solid var(--border)'
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: r.status === 'ok' ? '#3E9F4B' : '#c0392b'
                }} />
                <span style={{ color: '#888', minWidth: 90 }}>
                  {r.finished_at ? new Date(r.finished_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#555' }}>
                  {r.file_name || '—'}
                </span>
                <span style={{ fontWeight: 600, color: r.status === 'ok' ? '#3E9F4B' : '#c0392b' }}>
                  {r.records_imported != null ? `+${r.records_imported.toLocaleString('en-IE')}` : r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual upload (sync cards) or how-it-runs note (generated kinds) */}
      <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
        {endpoint ? (
          <>
            {/* A card can have BOTH: the footnote explains the nightly job,
                the upload is the manual path. B&M has both; before this it
                could only show one, so adding upload would have hidden how the
                automatic sync works. */}
            {footnote && (
              <p className="note" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>{footnote}</p>
            )}
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Manual upload
            </div>
            <ExcelImportCard sheetDefault={sheetDefault} endpoint={endpoint} toast={toast} />
            <p className="note" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              Or run from CMD: <code style={{ fontSize: 11 }}>scripts\{syncCmd}</code>
            </p>
          </>
        ) : (
          <p className="note" style={{ fontSize: 11, margin: 0 }}>
            {footnote} Run now from CMD: <code style={{ fontSize: 11 }}>{runCmd || `py scripts\\${syncCmd}`}</code>
          </p>
        )}
      </div>
    </div>
  )
}

// Reusable sync-run history card. Renders a table of recent runs for a given
// sync kind. Used for both Alt-barcode sync and Prices sync sections.
function SyncRunsCard({ title, runs, onRefresh, syncNowCmd, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{title}</span>
        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={onRefresh}>↻ Refresh</button>
      </div>
      <div className="card-body">
        {!runs.length ? (
          <p className="note" style={{ margin: 0 }}>No sync has run yet. The PowerShell job records its status here after each run.</p>
        ) : (
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead><tr>
                <th>When</th><th>File</th><th className="td-right">Imported</th><th className="td-right">Skipped</th><th className="td-right">Size</th><th>Status</th>
              </tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <td className="td-muted">{r.finished_at ? new Date(r.finished_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>{r.file_name || '—'}</td>
                    <td className="td-right">{r.records_imported ?? '—'}</td>
                    <td className="td-right">{r.records_skipped ?? '—'}</td>
                    <td className="td-right">{r.file_size_bytes ? fmtBytes(r.file_size_bytes) : '—'}</td>
                    <td>
                      <span className={'badge ' + (r.status === 'ok' ? 'badge-completed' : 'badge-deleted')}>{r.status}</span>
                      {r.status === 'error' && r.message && <div className="note" style={{ fontSize: 11, marginTop: 2 }}>{r.message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          <strong>Sync Now:</strong> run the desktop job manually on the PC —{' '}
          <code>{syncNowCmd}</code>.
          Set the schedule + time below and match them in Windows Task Scheduler.
        </p>
        {children}
      </div>
    </div>
  )
}

// Column alias maps for Excel import — mirrors the PowerShell sync scripts so
// the same workbook file works for both the desktop sync and manual upload.
const ALT_BARCODE_ALIASES = {
  barcode_no:     ['barcode_no','barcodeno','barcode','barcode_number','alt_barcode','altbarcode'],
  ean_barcode:    ['ean_barcode','ean','eanbarcode'],
  item_name:      ['item_name','itemname','name','description','product_name'],
  supl_id:        ['supl_id','suplid','supplier_id','supplierid'],
  supplier_code:  ['supplier_code','suppliercode','supl_code'],
  item_status:    ['item_status','itemstatus','product_status','status'],
  barcode_status: ['barcode_status','barcodestatus','bc_status'],
}

const PRICES_ALIASES = {
  ean_barcode:    ['ean_barcode','eanbarcode','ean','article_number','articleno'],
  item_group:     ['itemgroup','item_group','department','dept'],
  item_subgrp_id: ['itemsubgrp_id','item_subgrp_id','subgroup','subgrp_id','subgrpid','itemsubgrpid'],
  product_type:   ['producttype','product_type','type'],
  sale_rate:      ['salerate','sale_rate','sellingprice','selling_price','price','retail_price'],
}

// Manual Excel upload card — sends raw .xlsx to the server, server parses
// with SheetJS (same approach as pandas dtype=str). No browser-side parsing.
function ExcelImportCard({ sheetDefault, endpoint, toast }) {
  const [sheetVal,  setSheetVal]  = useState(sheetDefault || '1')
  const [file,      setFile]      = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState('')
  // null = still checking. The upload goes to a Python server running on this
  // PC, so it can simply be down - and it was, silently, for a long time (an
  // ASCII crash on startup). Probe it up front rather than letting someone
  // pick a 20 MB file and only then be told.
  const [serverUp,  setServerUp]  = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => { setSheetVal(sheetDefault || '1') }, [sheetDefault])

  const probe = useCallback(() => {
    let alive = true
    setServerUp(null)
    localUploadServerUp().then(up => { if (alive) setServerUp(up) })
    return () => { alive = false }
  }, [])
  useEffect(probe, [probe])

  const handleUpload = async () => {
    if (!file || uploading) return
    setUploading(true); setError(''); setResult(null)
    try {
      const res = await adminUploadExcel(endpoint, file, sheetVal)
      setResult(res)
      toast.success(`Import done — ${res.written} written, ${res.skipped} skipped.`)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) { setError(e.message); toast.error(e.message); probe() }
    finally { setUploading(false) }
  }

  return (
    <div>
      {serverUp === false && (
        <div className="note" style={{
          fontSize: 11.5, marginBottom: 8, padding: '6px 9px', borderRadius: 6,
          background: '#FFF4E5', border: '1px solid #E0A03A', color: '#8a5a14'
        }}>
          Upload server is not running on this PC, so manual upload is
          unavailable. Start it with{' '}
          <code style={{ fontSize: 11 }}>scripts\run_sync.bat server</code>, then{' '}
          <button className="btn btn-sm btn-outline" style={{ minHeight: 22, padding: '1px 7px', fontSize: 11 }}
                  onClick={probe}>re-check</button>.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 10px', marginBottom: 6 }}>
        <div>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 2, color: '#888' }}>Sheet</label>
          <input type="text" value={sheetVal} onChange={e => setSheetVal(e.target.value)}
            style={{ width: 80, fontSize: 12 }} placeholder="1" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 2, color: '#888' }}>Excel file (.xlsx)</label>
          <input ref={fileInputRef} type="file" accept=".xlsx"
            onChange={e => { setFile(e.target.files?.[0] || null); setError(''); setResult(null) }}
            style={{ fontSize: 12, width: '100%' }} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleUpload} disabled={!file || uploading || serverUp === false}>
          {uploading ? <><span className="spinner" /> Uploading…</> : 'Upload'}
        </button>
      </div>
      {error  && <div className="login-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</div>}
      {result && <div style={{ fontSize: 12, color: '#3E9F4B', marginTop: 4 }}>
        ✓ <strong>{result.written.toLocaleString('en-IE')}</strong> written, <strong>{result.skipped}</strong> skipped.
      </div>}
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

// Daily Cloudflare Workers/Pages Functions request count vs. the free-tier
// daily cap, with a reference line at the limit so it's obvious at a glance
// how close a given day came. Same WARN/CRIT thresholds as the Supabase
// capacity meter above, applied per-bar.
function CloudflareUsageChart({ data, loading }) {
  if (loading && !data) {
    return <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
  }
  if (!data?.days?.length) {
    return <p className="note">No data yet — click Refresh.</p>
  }

  const { days, daily_limit: limit } = data
  const fmt = (n) => n.toLocaleString('en-IE')
  const maxVal = Math.max(limit, ...days.map(d => d.requests), 1)

  const VW = 700, VH = 210, PAD_L = 10, PAD_R = 10, TOP = 26, BOT = 168
  const n = days.length
  const xAt = (i) => n <= 1 ? VW / 2 : PAD_L + (VW - PAD_L - PAD_R) * (i / (n - 1))
  const yAt = (v) => BOT - (v / maxVal) * (BOT - TOP)
  const limitY = yAt(limit)

  const colourFor = (pct) => pct >= CRIT_PCT ? '#D14B3D' : pct >= WARN_PCT ? '#E0A03A' : '#3E9F4B'
  const labelDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IE', { weekday: 'short', day: '2-digit', month: 'short' })

  const total = days.reduce((s, d) => s + d.requests, 0)
  const worst = days.reduce((m, d) => Math.max(m, d.requests), 0)

  // Smooth (Catmull-Rom → cubic bézier) line through the daily points, plus a
  // matching area path closed down to the baseline for the gradient fill.
  const pts = days.map((d, i) => [xAt(i), yAt(d.requests)])
  const linePath = pts.reduce((acc, p, i) => {
    if (i === 0) return `M${p[0]},${p[1]}`
    const p0 = pts[i - 2 >= 0 ? i - 2 : 0]
    const p1 = pts[i - 1]
    const p2 = p
    const p3 = pts[i + 1 < pts.length ? i + 1 : i]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    return `${acc}C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`
  }, '')
  const areaPath = pts.length ? `${linePath} L${pts[pts.length - 1][0]},${BOT} L${pts[0][0]},${BOT} Z` : ''

  return (
    <div>
      <div className="flex-row" style={{ marginBottom: 10, fontSize: 13, flexWrap: 'wrap', gap: 10 }}>
        <span><strong>{fmt(total)}</strong> total this week</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          Peak day: <strong style={{ color: colourFor((worst / limit) * 100) }}>{fmt(worst)}</strong> of {fmt(limit)}/day
        </span>
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img" aria-label={`Area chart of daily Cloudflare requests over the last 7 days against a ${fmt(limit)} per day limit. Total ${fmt(total)}.`}>
        <defs>
          <linearGradient id="cfAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2E78D6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2E78D6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD_L} y1={limitY} x2={VW - PAD_R} y2={limitY} stroke="#D14B3D" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.85" />
        <text x={VW - PAD_R} y={limitY - 6} textAnchor="end" fontSize="11" fill="#D14B3D">{fmt(limit)}/day limit</text>
        {areaPath && <path d={areaPath} fill="url(#cfAreaFill)" />}
        {linePath && <path d={linePath} fill="none" stroke="#2E78D6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {days.map((d, i) => {
          const pct = (d.requests / limit) * 100
          const cx = pts[i][0], cy = pts[i][1]
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
          const valY = cy < TOP + 24 ? cy + 16 : cy - 11
          return (
            <g key={d.date}>
              <circle cx={cx} cy={cy} r="4.5" fill={colourFor(pct)} stroke="var(--surface)" strokeWidth="2.5" />
              <text x={cx} y={valY} textAnchor={anchor} fontSize="11" fill="var(--text-muted)">
                {fmt(d.requests)}
              </text>
              <text x={cx} y={VH - 6} textAnchor={anchor} fontSize="11" fill="var(--text-muted)">
                {labelDate(d.date)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
