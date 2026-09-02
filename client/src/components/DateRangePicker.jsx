import { PRESETS, PRESET_LABELS, rangeLabel } from '../lib/dateRange.js'

// Shared date-range control. Two shapes, same state:
//
//   variant="buttons" — quick buttons + a preset <select> + From/To when the
//     preset is "custom". Built for the Dashboard's .page-header, so it reuses
//     the same markup vocabulary as the scope <select> already sitting beside
//     it (btn btn-sm, plain <select>) rather than introducing a new one.
//
//   variant="field" — the same controls wrapped as .filter-field so it drops
//     into the .filter-row that the report pages already use. Nothing consumes
//     this yet; it exists so converting those pages is a swap, not a rewrite.
//
// Value shape is whatever useDateRange() holds: { preset, fromDay, toDay }.
// onChange receives a partial — { preset } or { fromDay } / { toDay } — and the
// hook works out the rest (including flipping reversed bounds to "custom").
export default function DateRangePicker({
  value,
  onChange,
  variant = 'field',
  quick = ['today', 'this_week', 'this_month', 'last_30'],
  className = ''
}) {
  const { preset, fromDay, toDay } = value || {}
  const isCustom = preset === 'custom'

  const presetSelect = (
    <select
      value={preset || 'last_30'}
      onChange={e => onChange({ preset: e.target.value })}
      aria-label="Date range"
      style={{ width: 'auto', minWidth: 150 }}
    >
      {PRESETS.map(k => <option key={k} value={k}>{PRESET_LABELS[k]}</option>)}
    </select>
  )

  const fromInput = (
    <input type="date" value={fromDay || ''} max={toDay || undefined}
      aria-label="From date"
      onChange={e => e.target.value && onChange({ fromDay: e.target.value })} />
  )
  const toInput = (
    <input type="date" value={toDay || ''} min={fromDay || undefined}
      aria-label="To date"
      onChange={e => e.target.value && onChange({ toDay: e.target.value })} />
  )

  if (variant === 'buttons') {
    return (
      <div className={`flex-row ${className}`} style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {quick.map(k => (
          <button
            key={k}
            className={`btn btn-sm ${preset === k ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => onChange({ preset: k })}
          >
            {PRESET_LABELS[k]}
          </button>
        ))}
        {presetSelect}
        {isCustom && <>{fromInput}{toInput}</>}
      </div>
    )
  }

  return (
    <>
      <div className={`filter-field ${className}`}>
        <label>Range</label>
        {presetSelect}
      </div>
      {isCustom && (
        <>
          <div className="filter-field"><label>From</label>{fromInput}</div>
          <div className="filter-field"><label>To</label>{toInput}</div>
        </>
      )}
    </>
  )
}

export { rangeLabel }
