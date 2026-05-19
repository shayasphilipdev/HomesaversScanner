import { useState } from 'react'
import { BLOCK_TYPES, BLOCK_TYPE_BY_KEY, ALERT_VARIANTS, CALC_OPERATIONS, isDisplayBlock, newBlock } from '../../lib/taskBlocks.js'

// Admin-side editor: a vertical list of block cards with add / remove /
// reorder + per-block configuration. Stored verbatim in the template's
// `blocks` jsonb column.
export default function BlockBuilder({ value, onChange }) {
  const blocks = Array.isArray(value) ? value : []
  const [picker, setPicker] = useState(false)

  const update = (idx, patch) => onChange(blocks.map((b, i) => i === idx ? { ...b, ...patch } : b))
  const remove = (idx) => onChange(blocks.filter((_, i) => i !== idx))
  const move   = (idx, delta) => {
    const next = [...blocks]
    const j = idx + delta
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  const add = (type) => {
    const b = newBlock(type)
    if (b) onChange([...blocks, b])
    setPicker(false)
  }

  const inputTypes   = BLOCK_TYPES.filter(t => t.family === 'input')
  const displayTypes = BLOCK_TYPES.filter(t => t.family === 'display')

  // Numeric input blocks that can be referenced from a calc block.
  const numericBlocks = blocks.filter(b => ['number', 'amount', 'percentage', 'temperature', 'rating'].includes(b.type))

  return (
    <div>
      {blocks.length === 0 && (
        <div className="note" style={{ marginBottom: 10, padding: 12, background: 'var(--surface-warm)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          No blocks yet. The completer will see a simple notes / photo prompt unless you add blocks below.
        </div>
      )}

      {blocks.map((b, idx) => (
        <BlockCard
          key={b.id || idx}
          block={b}
          first={idx === 0}
          last={idx === blocks.length - 1}
          numericBlocks={numericBlocks}
          onUpdate={patch => update(idx, patch)}
          onRemove={() => remove(idx)}
          onMoveUp={() => move(idx, -1)}
          onMoveDown={() => move(idx, +1)}
        />
      ))}

      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setPicker(v => !v)}>
          {picker ? '✕ Close' : '+ Add block'}
        </button>
        {picker && (
          <div style={{
            marginTop: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4
          }}>
            <div style={{ gridColumn: '1 / -1', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', padding: '6px 10px 4px' }}>Inputs</div>
            {inputTypes.map(t => <PickerItem key={t.type} type={t} onAdd={add} />)}
            <div style={{ gridColumn: '1 / -1', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', padding: '10px 10px 4px' }}>Display</div>
            {displayTypes.map(t => <PickerItem key={t.type} type={t} onAdd={add} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function PickerItem({ type, onAdd }) {
  return (
    <button
      type="button"
      onClick={() => onAdd(type.type)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        background: 'transparent', border: 'none',
        borderRadius: 6, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', fontSize: 13, color: 'var(--text)'
      }}
      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-soft)'}
      onMouseOut={e  => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ width: 22, textAlign: 'center', opacity: .8 }}>{type.icon}</span>
      <span>{type.label}</span>
    </button>
  )
}

function BlockCard({ block, first, last, numericBlocks, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const meta    = BLOCK_TYPE_BY_KEY[block.type] || { label: block.type, icon: '?' }
  const display = isDisplayBlock(block)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10,
      background: display ? 'var(--surface-warm)' : 'var(--surface)'
    }}>
      <div className="flex-row" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 18, width: 24, textAlign: 'center' }} aria-hidden>{meta.icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</span>
        {display && <span className="chip" style={{ marginLeft: 6, fontSize: 11 }}>display only</span>}
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="btn btn-sm btn-outline" disabled={first} onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="btn btn-sm btn-outline" disabled={last}  onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="btn btn-sm btn-danger"  onClick={onRemove}>Remove</button>
      </div>

      {/* Label / question — every block has one (display blocks treat it as the title). */}
      {block.type !== 'divider' && (
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label>{display ? 'Title (optional)' : 'Label / question *'}</label>
          <input value={block.label || ''} onChange={e => onUpdate({ label: e.target.value })} placeholder={display ? 'e.g. Cold-chain checks' : 'e.g. Fridge temperature reading'} />
        </div>
      )}

      {/* Required toggle is only meaningful for input blocks. */}
      {!display && (
        <label className="flex-row" style={{ gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={!!block.required} onChange={e => onUpdate({ required: e.target.checked })} />
          Required
        </label>
      )}

      {/* ── Type-specific extras ────────────────────────────────────────── */}

      {(block.type === 'text' || block.type === 'textarea' || block.type === 'signature') && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Placeholder (optional)</label>
          <input value={block.placeholder || ''} onChange={e => onUpdate({ placeholder: e.target.value })} />
        </div>
      )}

      {(block.type === 'number' || block.type === 'temperature') && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-group">
            <label>Min</label>
            <input type="number" value={block.min ?? ''} onChange={e => onUpdate({ min: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="form-group">
            <label>Max</label>
            <input type="number" value={block.max ?? ''} onChange={e => onUpdate({ max: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="form-group full">
            <label>Unit (optional)</label>
            <input
              value={block.unit || ''}
              onChange={e => onUpdate({ unit: e.target.value })}
              placeholder={block.type === 'temperature' ? '°C or °F' : 'e.g. kg, units'}
            />
          </div>
        </div>
      )}

      {block.type === 'percentage' && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-group">
            <label>Min %</label>
            <input type="number" value={block.min ?? 0} onChange={e => onUpdate({ min: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="form-group">
            <label>Max %</label>
            <input type="number" value={block.max ?? 100} onChange={e => onUpdate({ max: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        </div>
      )}

      {block.type === 'amount' && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Currency symbol</label>
          <input value={block.currency || '€'} onChange={e => onUpdate({ currency: e.target.value })} style={{ width: 100 }} />
        </div>
      )}

      {block.type === 'rating' && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Scale (top of range)</label>
          <select value={block.scale ?? 5} onChange={e => onUpdate({ scale: Number(e.target.value) })} style={{ width: 120 }}>
            {[3, 5, 7, 10].map(n => <option key={n} value={n}>1–{n}</option>)}
          </select>
        </div>
      )}

      {(block.type === 'choice_single' || block.type === 'choice_multi') && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Options (one per line)</label>
          <textarea
            rows={Math.max(3, (block.options || []).length + 1)}
            value={(block.options || []).join('\n')}
            onChange={e => onUpdate({ options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
            placeholder="Option 1&#10;Option 2&#10;Option 3"
          />
        </div>
      )}

      {block.type === 'file' && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Accepted file types (MIME or extension list)</label>
          <input
            value={block.accept || '*/*'}
            onChange={e => onUpdate({ accept: e.target.value })}
            placeholder="*/* or application/pdf,image/* or .pdf,.csv"
          />
          <span className="note" style={{ fontSize: 12 }}>Browser hint only — anything is accepted server-side.</span>
        </div>
      )}

      {block.type === 'calc' && (
        <div style={{ marginTop: 8 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Operation</label>
              <select value={block.operation || 'sum'} onChange={e => onUpdate({ operation: e.target.value })}>
                {CALC_OPERATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group full">
              <label>Source blocks (numeric only)</label>
              {numericBlocks.length === 0 ? (
                <span className="note" style={{ fontSize: 12.5 }}>Add a Number / Amount / Percentage / Temperature / Rating block first, then pick it here.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {numericBlocks.map(n => {
                    const ids = Array.isArray(block.source_block_ids) ? block.source_block_ids : []
                    const checked = ids.includes(n.id)
                    return (
                      <label key={n.id} className="flex-row" style={{ gap: 8, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => onUpdate({
                            source_block_ids: e.target.checked
                              ? [...ids, n.id]
                              : ids.filter(x => x !== n.id)
                          })}
                        />
                        <span>{n.label || `(${n.type})`}</span>
                        <span className="note" style={{ fontSize: 11, marginLeft: 'auto' }}>{n.type}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Display-block content fields */}
      {block.type === 'instruction' && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Body text *</label>
          <textarea rows={3} value={block.text || ''} onChange={e => onUpdate({ text: e.target.value })} placeholder="Multi-line guidance shown to the completer." />
        </div>
      )}

      {block.type === 'alert' && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-group">
            <label>Variant</label>
            <select value={block.variant || 'warning'} onChange={e => onUpdate({ variant: e.target.value })}>
              {ALERT_VARIANTS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div className="form-group full">
            <label>Body text *</label>
            <textarea rows={2} value={block.text || ''} onChange={e => onUpdate({ text: e.target.value })} placeholder="Important: ..." />
          </div>
        </div>
      )}
    </div>
  )
}
