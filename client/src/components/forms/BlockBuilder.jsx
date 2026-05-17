import { useState } from 'react'
import { BLOCK_TYPES, BLOCK_TYPE_BY_KEY, newBlock } from '../../lib/taskBlocks.js'

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
          onUpdate={patch => update(idx, patch)}
          onRemove={() => remove(idx)}
          onMoveUp={() => move(idx, -1)}
          onMoveDown={() => move(idx, +1)}
        />
      ))}

      <div style={{ position: 'relative', marginTop: 10 }}>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setPicker(v => !v)}>
          {picker ? '✕ Close' : '+ Add block'}
        </button>
        {picker && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 6,
            zIndex: 50, minWidth: 240
          }}>
            {BLOCK_TYPES.map(t => (
              <button
                key={t.type}
                type="button"
                onClick={() => add(t.type)}
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
                <span style={{ width: 22, textAlign: 'center', opacity: .8 }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BlockCard({ block, first, last, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const meta = BLOCK_TYPE_BY_KEY[block.type] || { label: block.type, icon: '?' }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10,
      background: 'var(--surface)'
    }}>
      <div className="flex-row" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 18, width: 24, textAlign: 'center' }} aria-hidden>{meta.icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="btn btn-sm btn-outline" disabled={first} onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="btn btn-sm btn-outline" disabled={last}  onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="btn btn-sm btn-danger"  onClick={onRemove}>Remove</button>
      </div>

      <div className="form-group" style={{ marginBottom: 8 }}>
        <label>Label / question *</label>
        <input value={block.label || ''} onChange={e => onUpdate({ label: e.target.value })} placeholder="e.g. Fridge temperature reading" />
      </div>

      <label className="flex-row" style={{ gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={!!block.required} onChange={e => onUpdate({ required: e.target.checked })} />
        Required
      </label>

      {/* Type-specific extras */}
      {(block.type === 'text' || block.type === 'textarea') && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Placeholder (optional)</label>
          <input value={block.placeholder || ''} onChange={e => onUpdate({ placeholder: e.target.value })} />
        </div>
      )}

      {block.type === 'number' && (
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
            <input value={block.unit || ''} onChange={e => onUpdate({ unit: e.target.value })} placeholder="e.g. °C, kg, units" />
          </div>
        </div>
      )}

      {block.type === 'amount' && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Currency symbol</label>
          <input value={block.currency || '€'} onChange={e => onUpdate({ currency: e.target.value })} style={{ width: 100 }} />
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
    </div>
  )
}
