import { useEffect, useRef, useState } from 'react'
import { postDeviceDiagnostic } from '../lib/api.js'

// Usable on the test app and in local dev, never on the live site. This file
// only exists on the test branch at all, so the check is belt-and-braces.
const LIVE_HOST = 'homesaversscanner.pages.dev'

// Scan Doctor — a diagnostic instrument, not a feature.
//
// Eight attempts to kill the Android double-tap were tried and reverted over
// six days in June (inputMode="none" twice, input remount, imperative clear,
// the readOnly trick, disabling Android auto-focus twice). Every one of them
// was a guess about what the handhelds actually emit, because nobody had
// measured it. This page measures it.
//
// The question that decides the whole Department Scan redesign: can the page
// receive a scan with NOTHING focused? If yes, we can delete the text input
// entirely and the IME has nothing to attach to — no composition buffer, no
// re-injection, no soft keyboard, no focus retries. If no, the scan has to
// land in a focused field and we take the fallback design instead.
//
// Four capture modes, so one tester answers every open question in one visit.
// Test build only — routed behind isTestEnv().

const MODES = [
  { key: 'nofocus',  label: 'A · Nothing focused', hint: 'No box at all. Can the page hear the gun on its own?' },
  { key: 'normal',   label: 'B · Normal box',      hint: "Today's behaviour — an ordinary focused text box." },
  { key: 'readonly', label: 'C · Read-only box',   hint: 'Focused but read-only. Keeps focus, should not raise the keyboard.' },
  { key: 'imenone',  label: 'D · Keyboard off',    hint: 'inputMode="none" — focused, on-screen keyboard suppressed.' },
  { key: 'vkpolicy', label: 'E · Keyboard held back', hint: 'Normal editable box, but the keyboard is asked not to open.' },
]

// A burst of keystrokes is treated as one finished scan after this much quiet.
const QUIET_MS = 350

// The handhelds in this estate send a function key around each scan — on a
// page that does not swallow it, F1 opens Chrome's help site and navigates
// away mid-scan. ScannerInput.jsx:92 has swallowed these since ff68555 ("a
// mis-set Android trigger key was opening Chrome Help"). Which function key
// it is, and where in the burst it lands, is now the most valuable thing this
// page can report — so these are recorded and then suppressed, never ignored.
const isFnKey = (e) =>
  /^F\d{1,2}$/.test(e.key || '') || (e.keyCode >= 112 && e.keyCode <= 135)

const isEnterKey = (e) => e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 10
const isTabKey   = (e) => e.key === 'Tab'   || e.keyCode === 9

const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export default function ScanDoctor() {
  const [mode, setMode]       = useState('nofocus')
  const [scans, setScans]     = useState([])
  const [activeTag, setActiveTag] = useState('')
  const [sending, setSending] = useState(null)   // null | 'sending' | 'sent' | 'failed: …'
  const [kbd, setKbd]         = useState({ vv: 0, win: 0 })

  const inputRef  = useRef(null)
  const eventsRef = useRef([])     // events in the current burst
  const startRef  = useRef(0)      // performance.now() of the burst's first event
  const timerRef  = useRef(null)

  // Flush the current burst into a finished scan summary. Buffering in a ref
  // and only setting state here matters: re-rendering on every keystroke would
  // itself perturb the timings we are trying to measure.
  const flush = () => {
    const evs = eventsRef.current
    eventsRef.current = []
    if (!evs.length) return

    const keydowns = evs.filter(e => e.type === 'keydown')
    const gaps = []
    for (let i = 1; i < keydowns.length; i++) gaps.push(Math.round(keydowns[i].t - keydowns[i - 1].t))

    const last = keydowns[keydowns.length - 1] || {}
    const isTerm = (e) => isEnterKey(e) || isTabKey(e) || isFnKey(e)
    const chars = keydowns.filter(e => !isTerm(e) && e.key && e.key.length === 1).map(e => e.key).join('')

    // Function keys, with their position in the burst — a key at index 0 is a
    // prefix, one at the end is the terminator. Either is usable as an exact
    // scan-complete signal, which would retire the 250ms auto-settle delay
    // that currently costs a quarter second on every single scan.
    const fnKeys = keydowns
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => isFnKey(e))
      .map(({ e, i }) => `${e.key || '?'}(kc${e.keyCode})@${i === 0 ? 'start' : i === keydowns.length - 1 ? 'end' : i}`)

    setScans(prev => [{
      id: prev.length + 1,
      mode,
      assembled:    chars,
      length:       chars.length,
      events:       evs.length,
      keydowns:     keydowns.length,
      durationMs:   Math.round((evs[evs.length - 1]?.t ?? 0)),
      medianGapMs:  median(gaps),
      terminator:   isTerm(last) ? `${last.key || '?'} (keyCode ${last.keyCode})` : 'NONE',
      fnKeys,
      saw229:       evs.some(e => e.keyCode === 229),
      sawUnident:   evs.some(e => e.key === 'Unidentified'),
      sawComposing: evs.some(e => e.isComposing),
      inputValue:   inputRef.current ? inputRef.current.value : '',
      raw:          evs,
    }, ...prev].slice(0, 12))

    // Clear the box the way the real form does after a save. That clear is
    // precisely what provokes the Android IME re-injection, so whatever the
    // NEXT scan records as its box value tells us whether the old barcode
    // came back — measured instead of inferred.
    if (inputRef.current) inputRef.current.value = ''
  }

  const record = (type, e) => {
    const now = performance.now()
    if (!eventsRef.current.length) startRef.current = now
    eventsRef.current.push({
      type,
      t:           now - startRef.current,
      key:         e.key ?? null,
      keyCode:     e.keyCode ?? null,
      code:        e.code ?? null,
      isComposing: !!e.isComposing,
      data:        e.data ?? null,
      inputType:   e.inputType ?? null,
    })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, QUIET_MS)
  }

  // Document-level capture, capture-phase so nothing else sees these first.
  // Everything is recorded before anything is suppressed: we suppress only
  // the keys that would drive browser UI or move focus and so end the test
  // (F-keys open Chrome help; Tab jumps focus out of the field under test).
  // Ordinary characters are always left alone, so modes B/C/D can still show
  // what actually lands in the box.
  useEffect(() => {
    const onKeyDown = (e) => {
      record('keydown', e)
      if (isFnKey(e) || isTabKey(e)) { e.preventDefault(); return }
      if (mode === 'nofocus' && isEnterKey(e)) e.preventDefault()
    }
    const onKeyPress = (e) => {
      record('keypress', e)
      if (isFnKey(e) || isTabKey(e)) e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keypress', onKeyPress, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keypress', onKeyPress, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Apply the focus policy for the selected mode. The captured log is kept
  // across mode switches — every card records the mode it came from, and one
  // upload should carry all four modes rather than only the last one tried.
  // Only the in-flight burst is dropped, so a half-captured scan never gets
  // attributed to the mode being switched to.
  useEffect(() => {
    eventsRef.current = []
    if (mode === 'nofocus') {
      document.activeElement?.blur?.()
    } else {
      const el = inputRef.current
      if (el) { el.value = ''; try { el.focus({ preventScroll: true }) } catch { el.focus() } }
      // Mode E: the field stays a normal editable input — which the measured
      // results show is the only kind this gun will deliver into — but the
      // VirtualKeyboard API is asked to keep the on-screen keyboard down.
      // virtualkeyboardpolicy="manual" stops it auto-opening on focus; hide()
      // closes it if it already came up.
      if (mode === 'vkpolicy' && navigator.virtualKeyboard) {
        try {
          navigator.virtualKeyboard.overlaysContent = true
          navigator.virtualKeyboard.hide()
        } catch { /* unsupported — the report records that */ }
      }
    }
  }, [mode])

  // What actually holds focus right now, and whether the on-screen keyboard is
  // up — visualViewport shrinks when the IME opens, which is the only reliable
  // signal a web page gets.
  useEffect(() => {
    const tick = () => {
      const el = document.activeElement
      setActiveTag(el && el !== document.body ? `${el.tagName}${el.type ? '[' + el.type + ']' : ''}` : 'none')
      setKbd({ vv: Math.round(window.visualViewport?.height || 0), win: window.innerHeight })
    }
    tick()
    const iv = setInterval(tick, 500)
    window.visualViewport?.addEventListener('resize', tick)
    return () => { clearInterval(iv); window.visualViewport?.removeEventListener('resize', tick) }
  }, [])

  const report = () => JSON.stringify({
    ua: navigator.userAgent,
    screen: `${window.screen.width}x${window.screen.height} dpr${window.devicePixelRatio}`,
    mode,
    virtualKeyboardApi: typeof navigator !== 'undefined' && 'virtualKeyboard' in navigator,
    keyboardUp: kbd.vv > 0 && kbd.win - kbd.vv > 120,
    scans: scans.map(s => ({
      mode: s.mode, value: s.assembled, len: s.length, events: s.events,
      keydowns: s.keydowns, ms: s.durationMs, gapMs: s.medianGapMs,
      terminator: s.terminator, fnKeys: s.fnKeys, kc229: s.saw229, unidentified: s.sawUnident,
      composing: s.sawComposing, inputValue: s.inputValue,
      raw: s.raw.slice(0, 40),
    })),
  }, null, 1)

  const copy = async () => {
    try { await navigator.clipboard.writeText(report()) } catch { /* fall back to the textarea below */ }
  }

  // The whole point: one tap puts the result where head office can read it,
  // instead of the tester squinting at JSON on this screen and retyping it.
  const send = async () => {
    setSending('sending')
    try {
      await postDeviceDiagnostic('scan-doctor', JSON.parse(report()), navigator.userAgent)
      setSending('sent')
    } catch (e) {
      setSending('failed: ' + (e?.message || 'could not send'))
    }
  }

  if (window.location.hostname === LIVE_HOST) {
    return <div className="card"><div className="card-body">Scan Doctor runs on the test app only.</div></div>
  }

  const kbdUp = kbd.vv > 0 && kbd.win - kbd.vv > 120

  return (
    <div className="card">
      <div className="card-body">
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Scan Doctor</h2>
        <p className="note" style={{ fontSize: 13, marginTop: 0 }}>
          Pick a mode, then <strong>scan any product 3 times</strong>. Do all four modes if you can.
          Then press <strong>Copy report</strong> and send it to head office.
        </p>

        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                border: `2px solid ${mode === m.key ? 'var(--primary)' : 'var(--border)'}`,
                background: mode === m.key ? 'var(--primary-tint)' : 'var(--surface)',
                color: 'inherit', fontSize: 15, fontWeight: mode === m.key ? 700 : 500,
              }}
            >
              {m.label}
              <div className="note" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>{m.hint}</div>
            </button>
          ))}
        </div>

        {mode === 'nofocus' ? (
          <div style={{
            padding: '14px 12px', borderRadius: 8, border: '2px dashed var(--border-strong)',
            textAlign: 'center', fontSize: 14, color: 'var(--text-muted)', marginBottom: 10,
          }}>
            No box on purpose. Just pull the trigger.
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            readOnly={mode === 'readonly'}
            inputMode={mode === 'imenone' ? 'none' : undefined}
            virtualkeyboardpolicy={mode === 'vkpolicy' ? 'manual' : undefined}
            placeholder="Scan here"
            className="scan-input"
            style={{ width: '100%', marginBottom: 10, fontSize: 16 }}
            onInput={e => record('input', e.nativeEvent)}
            onBeforeInput={e => record('beforeinput', e.nativeEvent)}
          />
        )}

        <div className="note" style={{ fontSize: 12, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>Focused: <strong>{activeTag}</strong></span>
          <span>Keyboard: <strong style={{ color: kbdUp ? 'var(--red)' : 'var(--green)' }}>{kbdUp ? 'UP' : 'down'}</strong></span>
          <span>Scans: <strong>{scans.length}</strong></span>
        </div>

        <button
          type="button"
          onClick={send}
          disabled={!scans.length || sending === 'sending'}
          style={{
            width: '100%', padding: '16px 12px', fontSize: 18, fontWeight: 700,
            borderRadius: 10, marginBottom: 8, cursor: 'pointer',
            border: 'none', color: '#fff',
            background: sending === 'sent' ? 'var(--green)' : 'var(--primary)',
            opacity: (!scans.length || sending === 'sending') ? .5 : 1,
          }}
        >
          {sending === 'sending' ? 'Sending…'
            : sending === 'sent' ? '✓ Sent to head office'
            : 'Send to head office'}
        </button>
        {typeof sending === 'string' && sending.startsWith('failed') && (
          <div className="login-error" style={{ marginBottom: 8 }}>
            {sending} — use Copy report instead.
          </div>
        )}

        <div className="flex-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={copy}>Copy report</button>
          <button type="button" className="btn btn-outline" onClick={() => { setScans([]); eventsRef.current = []; setSending(null) }}>Clear</button>
        </div>

        {scans.length === 0 && (
          <div className="note" style={{ fontSize: 13 }}>Nothing captured yet in this mode. Pull the trigger.</div>
        )}

        {scans.map(s => (
          <div key={s.id} style={{
            border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
            marginBottom: 8, background: 'var(--surface-warm)', fontSize: 13,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, wordBreak: 'break-all' }}>
              {s.assembled || <span style={{ color: 'var(--red)' }}>(no characters)</span>}
            </div>
            <div className="note" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
              mode <strong>{s.mode}</strong> · {s.length} chars · {s.keydowns} keydowns · {s.durationMs}ms ·
              {' '}gap {s.medianGapMs}ms<br />
              terminator: <strong style={{ color: s.terminator === 'NONE' ? 'var(--red)' : 'var(--green)' }}>{s.terminator}</strong>
              {s.fnKeys?.length > 0 && (
                <><br />function keys: <strong style={{ color: 'var(--blue)' }}>{s.fnKeys.join(', ')}</strong></>
              )}
              {s.saw229       && <> · <strong style={{ color: 'var(--amber)' }}>keyCode 229 (IME)</strong></>}
              {s.sawUnident   && <> · <strong style={{ color: 'var(--amber)' }}>Unidentified</strong></>}
              {s.sawComposing && <> · <strong style={{ color: 'var(--amber)' }}>composing</strong></>}
              {s.inputValue   && <><br />box value: <code>{s.inputValue}</code></>}
            </div>
          </div>
        ))}

        {scans.length > 0 && (
          <>
            <div className="note" style={{ fontSize: 12, marginTop: 12, marginBottom: 4 }}>
              If Copy did not work, select all of this and send it:
            </div>
            <textarea
              readOnly
              value={report()}
              onFocus={e => e.target.select()}
              style={{ width: '100%', height: 140, fontSize: 11, fontFamily: 'monospace' }}
            />
          </>
        )}
      </div>
    </div>
  )
}
