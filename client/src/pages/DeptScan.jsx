import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTaskRecord, deleteTaskRecord, scanLookup } from '../lib/api.js'
import { altFields } from '../components/forms/useTaskForm.jsx'
import ScannerInput from '../components/forms/ScannerInput.jsx'
import { useStore } from '../App.jsx'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { getAll as outboxGetAll, remove as outboxRemove } from '../lib/outbox.js'

// Department Scan — a dedicated, stripped-down loop for Task J, which is over
// 90% of everything the estate records.
//
// Designed around a measured constraint rather than a hoped-for one. The
// handhelds deliver a scan THROUGH the Android IME (keyCode 229; see
// ScanDoctor.jsx and the device_diagnostics table). Suppressing the keyboard
// — readOnly, inputMode="none", virtualkeyboardpolicy="manual" — suppresses
// the scan with it, every time. So the keyboard is going to be up, and this
// page's whole layout assumes that: everything the operator needs sits in a
// short strip at the top, and nothing that matters is ever placed where the
// keyboard will cover it. That is the actual complaint being fixed — the
// keyboard covering the scan box, the Save button and the data.
//
// The Save tap is gone too. Across 143,818 live Task J records there are zero
// notes and zero quantities: every stored field is derived from the barcode,
// so confirming it conveys nothing. The record commits on lookup, and Undo
// replaces the confirmation step.

const euro = (v) =>
  (v == null || v === '' || isNaN(Number(v))) ? '—' : `€${Number(v).toFixed(2)}`

// Supplier id and code both carry meaning and are often both set; the rest of
// the app shows them joined the same way (see LookupBanner in useTaskForm).
const supplierOf = (info) =>
  [info?.supl_id, info?.supplier_code].filter(Boolean).join(' · ')

// The source tables store 'Active' / 'Inactive'; the floor wants Yes / No.
const activeYesNo = (v) => {
  if (!v) return '—'
  return String(v).trim().toLowerCase() === 'active' ? 'Yes' : 'No'
}

const DUP_WINDOW_MS = 3000   // a repeat of the same barcode inside this is a double trigger-pull
const LOOKUP_TIMEOUT_MS = 10000  // shop wifi can connect and then never answer
const MAX_ROWS      = 50     // on-screen history; the full list lives in Reports

// WebAudio rather than audio files: no asset to load on a slow shop
// connection, and the tones can be told apart without looking at the screen.
let audioCtx = null
function tone(freq, ms, type = 'sine') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc  = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(gain); gain.connect(audioCtx.destination)
    const t0 = audioCtx.currentTime
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000)
    osc.start(t0); osc.stop(t0 + ms / 1000)
  } catch { /* audio is a bonus, never a blocker */ }
}
// Saved — including saved with no department, which the business treats as a
// normal outcome and explicitly does not want flagged.
const soundSaved = () => { tone(880, 80); try { navigator.vibrate?.(40) } catch {} }
// Duplicate — the one case that must interrupt, since auto-save means a
// stray second trigger-pull would otherwise be committed silently.
const soundDup = () => {
  tone(240, 160, 'square')
  setTimeout(() => tone(240, 160, 'square'), 190)
  try { navigator.vibrate?.([60, 70, 60]) } catch {}
}

export default function DeptScan() {
  const { session } = useStore()
  const { currentStoreId } = useCurrentStore()
  const navigate = useNavigate()

  const storeId = currentStoreId || session.storeId || null

  const [code, setCode]   = useState('')
  const [rows, setRows]   = useState([])
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  // Height of what is actually visible. With the keyboard up this is roughly
  // half the screen, and it is the only number this layout trusts.
  const [viewH, setViewH] = useState(0)
  // Bumped on undo to clear ScannerInput's dedupe guards — see undoLast.
  const [resetSignal, setResetSignal] = useState(0)

  // THE most important guard on this page.
  //
  // These handhelds deliver a scan through the Android IME, and an IME only
  // delivers to a FOCUSED input. Tapping Undo, the camera, or anywhere that is
  // not the box moves focus to that element — and ScannerInput only restores
  // focus when the field transitions to empty, which it already is. The
  // operator then pulls the trigger, nothing happens, and there is nothing on
  // screen explaining why. That is the "it stopped scanning" failure.
  //
  // The buttons on this page refuse focus in the first place (preventDefault
  // on mousedown), which is what actually keeps the keyboard from bouncing.
  // This is the safety net for anything that still manages to take it. It
  // listens on focusin ONLY — a blanket click listener would refocus, and so
  // re-open the keyboard, on any tap at all, including a tap to scroll the
  // table. Real text fields are exempt so the camera's zoom slider works.
  useEffect(() => {
    const restore = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const box = document.querySelector('input.scan-input')
      if (!box || document.activeElement === box) return
      setTimeout(() => {
        try { box.focus({ preventScroll: true }) } catch { box.focus() }
      }, 0)
    }
    document.addEventListener('focusin', restore)
    return () => document.removeEventListener('focusin', restore)
  }, [])

  // Always-current rows, for handlers that need them without re-subscribing.
  const rowsRef    = useRef(rows)
  rowsRef.current  = rows
  const genRef     = useRef(0)
  const lastCodeRef = useRef('')
  const lastAtRef   = useRef(0)

  const savedCount  = rows.filter(r => ['saved', 'queued', 'synced'].includes(r.status)).length
  // Shown in the header rather than as an eighth table column: the operator
  // must be able to see "some of this has not reached the server yet" without
  // scrolling a table sideways.
  const queuedCount = rows.filter(r => r.status === 'queued').length

  useEffect(() => {
    const measure = () => setViewH(window.visualViewport?.height || window.innerHeight)
    measure()
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Full-bleed: on a small handheld screen the nav chrome is pure cost, and
  // with the keyboard up there is no room for it at all.
  useEffect(() => {
    document.body.classList.add('deptscan-full')
    return () => document.body.classList.remove('deptscan-full')
  }, [])

  // Browsers refuse to start audio until the user has interacted, and the
  // first thing that wants to make a sound here is a scan, not a tap — so the
  // duplicate alert would be silent exactly when it is first needed. Unlock on
  // the first touch anywhere, which the operator makes on the way in.
  useEffect(() => {
    const unlock = () => {
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
        if (audioCtx.state === 'suspended') audioCtx.resume()
      } catch { /* no audio on this device; vibration still fires */ }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('touchstart', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  // The outbox drains in the background — OfflineIndicator triggers it on the
  // browser's `online` event and on tab visibility, and it is still mounted
  // here (this page hides the nav with display:none, which does not unmount
  // it). Without listening, a row scanned offline would keep saying "offline"
  // long after it had actually reached the server. A row whose outbox entry
  // has disappeared has been posted.
  useEffect(() => {
    const onOutboxChanged = async () => {
      try {
        const items = await outboxGetAll()
        const stillQueued = new Set(items.map(i => i.id))
        // Read from the ref, not from inside a setRows updater: React runs
        // updaters asynchronously, so anything captured in there is still
        // empty by the time the loop below runs.
        const justSynced = rowsRef.current.filter(r =>
          r.status === 'queued' && r.queuedId && !stillQueued.has(r.queuedId) &&
          r.lookupFailed && !r.info)
        setRows(prev => prev.map(r =>
          r.status === 'queued' && r.queuedId && !stillQueued.has(r.queuedId)
            ? { ...r, status: 'synced' }
            : r))

        // The drain resolves the product details server-side, so this page
        // never sees them and the row would keep claiming the details are
        // still to come. Fetch them back now that there is signal — but
        // bounded, because a long offline stint could otherwise fire hundreds
        // of requests the moment the wifi returns, against a 100k/day cap.
        if (!navigator.onLine) return
        for (const row of justSynced.slice(0, 10)) {
          try {
            const info = await scanLookup(row.barcode)
            if (!info) continue
            setRows(prev => prev.map(r => r.key === row.key
              ? { ...r, info, price: info.price || null, dept: info.price?.item_group || null,
                  name: info.item_name || null, lookupFailed: false }
              : r))
          } catch { /* leave the row as synced-without-detail */ }
        }
      } catch { /* the pill in the nav remains the source of truth */ }
    }
    window.addEventListener('hs:outbox-changed', onOutboxChanged)
    return () => window.removeEventListener('hs:outbox-changed', onOutboxChanged)
  }, [])

  const handleConfirm = useCallback(async (raw) => {
    const scanned = String(raw || '').trim()
    if (scanned.length < 4) return

    const now = Date.now()
    if (scanned === lastCodeRef.current && now - lastAtRef.current < DUP_WINDOW_MS) {
      soundDup()
      setRows(prev => [{ key: `dup-${now}`, barcode: scanned, status: 'dup' }, ...prev].slice(0, MAX_ROWS))
      setCode('')
      return
    }
    lastCodeRef.current = scanned
    lastAtRef.current   = now

    const gen    = ++genRef.current
    const rowKey = `r-${now}-${gen}`
    // The row goes up before the network is touched, so the operator sees the
    // scan register immediately rather than after a round trip.
    setRows(prev => [{ key: rowKey, barcode: scanned, status: 'saving' }, ...prev].slice(0, MAX_ROWS))
    setCode('')
    setBusy(true)
    setError('')

    // One request, not two sequential ones — the barcode→EAN→price chain is
    // resolved inside the Worker so this slow link is crossed once.
    //
    // A THROW and a null are different things and must not be shown the same
    // way: a null means the barcode really is not in the database, a throw
    // usually means there is no signal in that aisle. Telling an operator
    // "HO will update it soon" about a product HO already has, purely because
    // the wifi dropped, would send them chasing nothing.
    // Bounded: shop wifi can accept a connection and then never answer. Left
    // unbounded the row would sit on "Looking up…" indefinitely. On timeout we
    // treat it as a failed lookup — the scan still saves, and the details are
    // filled in server-side when the record syncs.
    let info = null, price = null, lookupFailed = false
    try {
      info = await Promise.race([
        scanLookup(scanned),
        new Promise((_, reject) => setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_TIMEOUT_MS)),
      ])
      price = info?.price || null
    } catch { lookupFailed = true }
    if (gen !== genRef.current) return

    const dept = price?.item_group || null
    const name = info?.item_name || null

    try {
      const res = await createTaskRecord({
        task_type:    'J',
        store_id:     storeId,
        product_code: scanned,
        ...altFields(info, scanned),
        details:      { item_group: dept },
        // Stamped when the trigger was pulled, not when the row reaches the
        // server. Without this an offline batch lands with every record
        // timestamped at reconnect, which misreports when the shelf was walked.
        scanned_at:   new Date(now).toISOString(),
      })
      setRows(prev => prev.map(r => r.key === rowKey
        ? {
            ...r,
            status:   res?.queued ? 'queued' : 'saved',
            id:       res?.queued ? null : res?.id,
            // The outbox id, so Undo can pull a not-yet-synced scan back out
            // of the queue instead of reaching past it to an older record.
            queuedId: res?.queued ? res.id : null,
            dept, name, info, price, lookupFailed,
          }
        : r))
      soundSaved()
    } catch (e) {
      setRows(prev => prev.map(r => r.key === rowKey ? { ...r, status: 'failed', dept, name, info, price, lookupFailed } : r))
      setError(e?.message || 'Could not save')
    } finally {
      // Only the newest scan owns the spinner. Clearing it unconditionally
      // would switch off the indicator for a scan that is still in flight.
      if (gen === genRef.current) setBusy(false)
    }
  }, [storeId])

  // Undo replaces the confirmation step, so it has to be the easiest thing on
  // the page to hit — one big target, not a small per-row control on a screen
  // whose touch digitiser is unreliable.
  const undoLast = async () => {
    // Stop at the FIRST row that actually recorded something, whatever state
    // it is in. Searching past one for a deletable record is how you end up
    // silently deleting an older, already-synced scan while the operator
    // believes they undid the last one.
    const target = rows.find(r => ['saved', 'queued', 'synced'].includes(r.status))
    if (!target) return
    if (target.status === 'synced') {
      // Queued offline, then synced in the background — the server gave the id
      // to the outbox drain, not to this page, so there is nothing here to
      // delete against. Say so rather than deleting the wrong thing.
      setError('Already synced — remove it from HO Tasks.')
      return
    }
    const previousStatus = target.status
    setRows(prev => prev.map(r => r.key === target.key ? { ...r, status: 'undoing' } : r))
    try {
      if (previousStatus === 'queued') await outboxRemove(target.queuedId)
      else                             await deleteTaskRecord(target.id)
      // Drop the undone row and anything above it. Those can only be notices
      // that never saved — duplicates, failures — since `target` is the first
      // actually-saved row. Leaving a "Duplicate" line sitting on top after an
      // undo reads as if the undo did not work.
      setRows(prev => prev.slice(prev.findIndex(r => r.key === target.key) + 1))
      // Undoing means the operator intends to scan that barcode again, so put
      // the page back to a genuinely clean state. The box itself must be
      // emptied: the Android IME re-commits the previous barcode after a save,
      // so it is usually still sitting there, and a re-scan of a value the box
      // already holds looks like no change at all. Then clear this page's own
      // 3s duplicate window AND ScannerInput's echo guards, or the very
      // mechanisms that swallow IME echoes will swallow the deliberate re-scan.
      setCode('')
      lastCodeRef.current = ''
      lastAtRef.current   = 0
      setResetSignal(n => n + 1)
      tone(520, 70)
    } catch (e) {
      setRows(prev => prev.map(r => r.key === target.key ? { ...r, status: previousStatus } : r))
      setError(e?.message || 'Could not undo')
    }
  }

  const latest = rows[0]
  const canUndo = rows.some(r => r.status === 'saved' && r.id)

  if (!storeId) {
    return (
      <div className="card"><div className="card-body">
        <p><strong>No store selected.</strong></p>
        <p className="note">Pick a store on HO Tasks first, then come back.</p>
        <button className="btn btn-primary" onClick={() => navigate('/tasks')}>Go to HO Tasks</button>
      </div></div>
    )
  }

  return (
    <div style={{
      height: viewH ? `${viewH}px` : '100vh',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: 'var(--bg)',
    }}>
      {/* Header — deliberately one thin line. Every pixel here is a pixel not
          available above the keyboard. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {/* The ONLY way off this page — the nav, sidebar and bottom bar are
            all hidden here. The first version was a 44x25 "Exit" chip in the
            top-right corner and stores reported being stuck: about half the
            Android minimum touch target, in the hardest corner to reach, with
            a label that does not read as navigation. Now a full-height button
            on the left, where a back control is expected. */}
        <button
          type="button"
          onClick={() => navigate('/tasks')}
          aria-label="Back to HO Tasks"
          style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            height: 28, padding: '0 12px',
            border: '1px solid var(--border-strong)', borderRadius: 7,
            background: 'var(--bg-soft)', color: 'inherit',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >← Back</button>
        <strong style={{
          fontSize: 13, minWidth: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>Department Check</strong>
        {queuedCount > 0 && (
          <span style={{
            marginLeft: 'auto', flexShrink: 0,
            background: 'var(--amber-soft)', color: 'var(--amber)',
            borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700,
          }}>{queuedCount} waiting</span>
        )}
        <span style={{
          marginLeft: queuedCount > 0 ? 8 : 'auto', fontSize: 20, fontWeight: 800, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums', color: 'var(--green)',
        }}>{savedCount}</span>
      </div>

      {/* The result, directly under the header and above the scan box, because
          this is the one thing the operator actually reads. */}
      {/* One line: DEPARTMENT · Product description, truncated at the edge.
          It persists until the next scan replaces it, so the operator can look
          away, check the shelf, and look back. This also absorbs the old
          "Pull the trigger to scan." block rather than paying for a separate
          one. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexShrink: 0,
        height: 52, padding: '0 10px', gap: 8,
        background: latest?.status === 'dup' ? 'var(--amber-soft)' : 'var(--surface-warm)',
        borderBottom: '1px solid var(--border)',
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        {!latest ? (
          <span className="note" style={{ fontSize: 14 }}>Pull the trigger to scan.</span>
        ) : latest.status === 'dup' ? (
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Already scanned
            <span className="note" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>{latest.barcode} — not saved again</span>
          </span>
        ) : (
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{
              fontSize: 20, fontWeight: 800,
              color: latest.dept ? 'var(--text)' : 'var(--text-muted)',
            }}>
              {latest.status === 'saving' ? '…' : (latest.dept || 'No department')}
            </span>
            <span className="note" style={{ fontSize: 13, marginLeft: 8 }}>
              · {latest.name || latest.barcode}
            </span>
          </span>
        )}
      </div>

      {/* The scan box. It has to exist and stay focused — that is the only way
          this hardware delivers a scan — but the operator never needs to read
          it, so it gets the least space. */}
      <div style={{ padding: '6px 10px 0', flexShrink: 0 }}>
        <ScannerInput
          label=""
          value={code}
          onChange={setCode}
          onConfirm={handleConfirm}
          lookupLoading={busy}
          readerId="reader-deptscan"
          placeholder="Scan"
          resetSignal={resetSignal}
          // Undo shares one small row with the camera button rather than
          // taking a full-width line of its own — every pixel here is a pixel
          // the keyboard would otherwise take.
          compactActions={
            <button
              type="button"
              // Do not take focus. Focus must stay in the scan box — that is
              // the only thing the IME delivers to — and on Android moving it
              // away hides the keyboard, then putting it back animates the
              // keyboard up again. That bounce is what the floor reported as
              // "Undo pops the keyboard". preventDefault on mousedown stops
              // the focus transfer while still firing onClick.
              onMouseDown={e => e.preventDefault()}
              onClick={undoLast}
              disabled={!canUndo}
              style={{
                flexShrink: 0, padding: '0 12px', borderRadius: 8, border: 'none',
                background: 'var(--red)', color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                opacity: canUndo ? 1 : .4,
              }}
            >Undo Last Scan</button>
          }
        />
      </div>

      {/* Pinned to a single line: the strip above the keyboard is the whole
          budget, and a long error message must never push the scan box into
          the covered region. */}
      {error && (
        <div className="login-error" title={error} style={{
          margin: '0 10px 6px', fontSize: 12, flexShrink: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{error}</div>
      )}

      {/* Detail table. Everything below here may well be behind the keyboard,
          and nothing in it is needed to keep scanning — it is for checking a
          product, so it is allowed to be wider than the screen and scroll
          sideways rather than cramming seven columns into 375px. */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        borderTop: '1px solid var(--border-soft)', WebkitOverflowScrolling: 'touch',
      }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', minWidth: '100%' }}>
          <thead>
            <tr>
              {['Product Id', 'Product Desc', 'Selling Price', 'Department', 'Product Status',
                'Product Active', 'Barcode Active', 'Barcode', 'Supplier']
                .map(h => (
                  <th key={h} style={{
                    position: 'sticky', top: 0, zIndex: 1,
                    background: 'var(--surface)', borderBottom: '1px solid var(--border)',
                    padding: '6px 10px', textAlign: 'left', fontSize: 11,
                    fontWeight: 700, color: 'var(--text-muted)',
                  }}>{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const td = {
                padding: '6px 10px', borderBottom: '1px solid var(--border-soft)',
                maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
              }
              // Nothing came back from the lookup: the barcode is not in the
              // database yet. Show the barcode and say so — the operator has
              // done nothing wrong and the scan is still saved.
              if (r.status !== 'dup' && !r.info) {
                return (
                  <tr key={r.key}>
                    <td colSpan={7} style={{ ...td, color: 'var(--amber)', fontWeight: 600 }}>
                      {r.status === 'saving' ? 'Looking up…'
                        // No signal, so we never got to ask. The product may be
                        // perfectly well known — the details fill in on sync.
                        : r.status === 'synced' ? 'Synced — details on HO Tasks'
                        : r.lookupFailed ? 'Saved — details will fill in when back online'
                        : 'HO will update it soon'}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.barcode}</td>
                    <td style={td} />
                  </tr>
                )
              }
              if (r.status === 'dup') {
                return (
                  <tr key={r.key} style={{ opacity: .6 }}>
                    <td colSpan={7} style={{ ...td, color: 'var(--amber)' }}>Duplicate — not saved again</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.barcode}</td>
                    <td style={td} />
                  </tr>
                )
              }
              return (
                <tr key={r.key}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.info.ean_barcode || '—'}</td>
                  <td style={td} title={r.info.item_name || ''}>{r.info.item_name || '—'}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{euro(r.price?.sale_rate)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.price?.item_group || '—'}</td>
                  <td style={td}>{r.price?.product_type || '—'}</td>
                  <td style={td}>{activeYesNo(r.info.item_status)}</td>
                  <td style={td}>{activeYesNo(r.info.barcode_status)}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.barcode}</td>
                  <td style={td} title={supplierOf(r.info)}>{supplierOf(r.info) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
