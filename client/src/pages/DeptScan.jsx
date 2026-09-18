import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTaskRecord, deleteTaskRecord, lookupAltBarcode, lookupPrice } from '../lib/api.js'
import { altFields } from '../components/forms/useTaskForm.jsx'
import ScannerInput from '../components/forms/ScannerInput.jsx'
import { useStore } from '../App.jsx'
import { useCurrentStore } from '../lib/currentStore.jsx'

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

const DUP_WINDOW_MS = 3000   // a repeat of the same barcode inside this is a double trigger-pull
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

  const genRef     = useRef(0)
  const lastCodeRef = useRef('')
  const lastAtRef   = useRef(0)

  const savedCount = rows.filter(r => r.status === 'saved' || r.status === 'queued').length

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

    let info = null, price = null
    try { info = await lookupAltBarcode(scanned) } catch { /* unknown barcodes still save */ }
    if (gen !== genRef.current) return
    if (info?.ean_barcode) {
      try { price = await lookupPrice(info.ean_barcode) } catch { /* department stays null */ }
    }
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
        ? { ...r, status: res?.queued ? 'queued' : 'saved', id: res?.queued ? null : res?.id, dept, name }
        : r))
      soundSaved()
    } catch (e) {
      setRows(prev => prev.map(r => r.key === rowKey ? { ...r, status: 'failed', dept, name } : r))
      setError(e?.message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }, [storeId])

  // Undo replaces the confirmation step, so it has to be the easiest thing on
  // the page to hit — one big target, not a small per-row control on a screen
  // whose touch digitiser is unreliable.
  const undoLast = async () => {
    const target = rows.find(r => r.status === 'saved' && r.id)
    if (!target) return
    setRows(prev => prev.map(r => r.key === target.key ? { ...r, status: 'undoing' } : r))
    try {
      await deleteTaskRecord(target.id)
      setRows(prev => prev.filter(r => r.key !== target.key))
      lastCodeRef.current = ''      // let the same barcode be re-scanned straight away
      tone(520, 70)
    } catch (e) {
      setRows(prev => prev.map(r => r.key === target.key ? { ...r, status: 'saved' } : r))
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
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <strong style={{ fontSize: 13 }}>Department Scan</strong>
        <span style={{
          marginLeft: 'auto', fontSize: 20, fontWeight: 800, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums', color: 'var(--green)',
        }}>{savedCount}</span>
        <button
          type="button"
          onClick={() => navigate('/tasks')}
          style={{
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'inherit',
            borderRadius: 6, padding: '4px 10px', fontSize: 13, cursor: 'pointer',
          }}
        >Exit</button>
      </div>

      {/* The result, directly under the header and above the scan box, because
          this is the one thing the operator actually reads. */}
      <div style={{
        padding: '8px 10px', flexShrink: 0, minHeight: 64,
        background: latest?.status === 'dup' ? 'var(--amber-soft)' : 'var(--surface-warm)',
        borderBottom: '1px solid var(--border)',
      }}>
        {!latest ? (
          <div className="note" style={{ fontSize: 14 }}>Pull the trigger to scan.</div>
        ) : latest.status === 'dup' ? (
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>
            Already scanned
            <div className="note" style={{ fontSize: 12, fontWeight: 400 }}>{latest.barcode} — not saved again</div>
          </div>
        ) : (
          <>
            <div style={{
              fontSize: 22, fontWeight: 800, lineHeight: 1.15,
              color: latest.dept ? 'var(--text)' : 'var(--text-muted)',
            }}>
              {latest.status === 'saving' ? '…' : (latest.dept || 'No department')}
            </div>
            <div className="note" style={{
              fontSize: 12, marginTop: 2, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {latest.name || latest.barcode}
            </div>
          </>
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
          // Undo shares one small row with the camera button rather than
          // taking a full-width line of its own — every pixel here is a pixel
          // the keyboard would otherwise take.
          compactActions={
            <button
              type="button"
              onClick={undoLast}
              disabled={!canUndo}
              className="btn btn-sm"
              style={{
                flex: 1, background: 'var(--red)', color: '#fff', border: 'none',
                fontWeight: 700, opacity: canUndo ? 1 : .4,
              }}
            >Undo last</button>
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

      {/* Everything below here may well be behind the keyboard. Nothing in it
          is required to keep scanning. */}
      <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid var(--border-soft)' }}>
        {rows.map(r => (
          <div
            key={r.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              borderBottom: '1px solid var(--border-soft)', fontSize: 13,
              opacity: r.status === 'dup' ? .65 : 1,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong>{r.dept || (r.status === 'dup' ? 'duplicate' : '—')}</strong>
              <span className="note" style={{ marginLeft: 6 }}>{r.name || r.barcode}</span>
            </span>
            <span className="note" style={{ fontSize: 11, flexShrink: 0 }}>
              {r.status === 'saving'  ? '…'
                : r.status === 'queued' ? 'offline'
                : r.status === 'failed' ? 'failed'
                : r.status === 'undoing' ? '…'
                : r.status === 'dup'    ? '×'
                : '✓'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
