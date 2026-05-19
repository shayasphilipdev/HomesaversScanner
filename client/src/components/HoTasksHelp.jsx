import { useState, useEffect } from 'react'

// Collapsible "How do I report …?" panel shown at the top of the HO Tasks page.
// Covers the seven daily task types only — H (Stock Count) and I (Misc) are
// once-off and have their own brief, so they are deliberately omitted here.
// State is persisted in localStorage so a Sales Assistant who collapses it
// keeps it collapsed on subsequent visits.

const STORAGE_KEY = 'hs_ho_tasks_help_open'

const DAILY_TASKS = [
  { code: 'A', name: 'UOM Errors',
    use: 'Shelf-label unit is wrong (e.g. label says "each" but the product is a 6-pack).',
    fields: 'Scan barcode · pick correct UOM · quantity · supplier · note.' },
  { code: 'B', name: 'Non-Scans',
    use: "Till can't scan the barcode — beeps red or shows 'item not found'.",
    fields: 'Scan barcode · description · two photos (product + barcode) · supplier.' },
  { code: 'C', name: 'Wrong Prices',
    use: 'Shelf price and till price disagree.',
    fields: 'Scan barcode · shelf price · till price · supplier · note.' },
  { code: 'D', name: 'Wrong Description',
    use: "Till receipt name doesn't match the product (wrong, misspelled, foreign language).",
    fields: 'Scan barcode · correct description · supplier · note.' },
  { code: 'E', name: 'Price Marked Products',
    use: 'Product packaging shows a printed price different from the till price.',
    fields: 'Scan barcode · printed price · till price · supplier · note.' },
  { code: 'F', name: 'DRS Errors',
    use: 'Deposit Return Scheme charge is wrong. Always verify the return logo is on the product first.',
    fields: 'Scan barcode · bottle size · units per pack (deposit is calculated for you) · supplier.' },
  { code: 'G', name: 'Promotion Error',
    use: "Promotion (2-for-€5, BOGOF, etc.) isn't applying at the till.",
    fields: 'Scan barcode · promotion description · promotion price · supplier · note.' }
]

export default function HoTasksHelp() {
  // Collapsed by default. Stays closed/open per browser via localStorage.
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  useEffect(() => { localStorage.setItem(STORAGE_KEY, open ? '1' : '0') }, [open])

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="card-header"
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 0,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px'
        }}
        aria-expanded={open}
      >
        <span aria-hidden style={{ fontSize: 16 }}>{open ? '▾' : '▸'}</span>
        <span><strong>Quick guide — daily HO tasks</strong></span>
        <span className="note" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p className="note" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
            Pick the task type from the dropdown below, scan the barcode, fill the form, tap <strong>Save Record</strong>.
            Records go to Head Office for review; once they come back as <strong>Completed by HO</strong>, check the till and tap <strong>✓ Clear</strong> to remove from your list.
          </p>
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Code</th>
                  <th style={{ width: 170 }}>Task</th>
                  <th>Use it when…</th>
                  <th>What to fill</th>
                </tr>
              </thead>
              <tbody>
                {DAILY_TASKS.map(t => (
                  <tr key={t.code}>
                    <td><strong>{t.code}</strong></td>
                    <td>{t.name}</td>
                    <td>{t.use}</td>
                    <td className="td-muted" style={{ fontSize: 12.5 }}>{t.fields}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
            🟢 Top-right badge must show <strong>Store Login · &lt;your store&gt;</strong> before you log anything.
            If you go offline (Wi-Fi down), records save locally and sync when you're back online.
          </p>
        </div>
      )}
    </div>
  )
}
