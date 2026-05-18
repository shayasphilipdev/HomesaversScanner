// Visual editor for a user's store/area scope. Three knobs:
//   1) "All stores" toggle (overrides everything else)
//   2) Specific stores (chips)
//   3) Specific areas  (chips) — implicitly grants every store in the area
//
// Value shape: { all_stores: boolean, store_ids: uuid[], area_ids: uuid[] }
export default function ScopePicker({ value, onChange, stores = [], areas = [] }) {
  const v = value || { all_stores: false, store_ids: [], area_ids: [] }

  const setAll = (on) => onChange({ ...v, all_stores: !!on })
  const toggle = (key, id) => onChange({
    ...v,
    [key]: v[key].includes(id) ? v[key].filter(x => x !== id) : [...v[key], id]
  })

  return (
    <div>
      <label className="flex-row" style={{ gap: 8, marginBottom: 12 }}>
        <input type="checkbox" checked={!!v.all_stores} onChange={e => setAll(e.target.checked)} />
        <span><strong>Access to all stores</strong> (Admin / Head Office scope)</span>
      </label>

      {!v.all_stores && (
        <>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>By area (employee sees every store in each picked area)</label>
            {!areas.filter(a => a.is_active).length ? (
              <span className="note" style={{ fontSize: 12 }}>No active areas.</span>
            ) : (
              <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {areas.filter(a => a.is_active).map(a => {
                  const on = v.area_ids.includes(a.id)
                  return (
                    <button type="button" key={a.id}
                      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => toggle('area_ids', a.id)}>
                      {on ? '✓ ' : ''}{a.area_name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Or specific stores</label>
            {!stores.filter(s => s.is_active).length ? (
              <span className="note" style={{ fontSize: 12 }}>No active stores.</span>
            ) : (
              <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {stores.filter(s => s.is_active).map(s => {
                  const on = v.store_ids.includes(s.id)
                  return (
                    <button type="button" key={s.id}
                      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => toggle('store_ids', s.id)}>
                      {on ? '✓ ' : ''}{s.store_name} ({s.store_code})
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
