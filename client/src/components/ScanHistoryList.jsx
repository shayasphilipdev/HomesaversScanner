import { useState } from 'react'
import RecordDetailModal from './RecordDetailModal.jsx'

// Store-mode HO Tasks history — deliberately NOT TaskRecordList. That
// component is a back-office review workspace (bulk select, per-row
// Complete/Clear/Delete/Messages, a Status column) built for a desktop
// reviewer working through a queue. On a handheld scanner none of that is
// wanted: the page is for scanning, and this is just "what did I just scan" —
// minimum columns, no actions, maximum space for the scan input above it.
//
// Every action this used to offer for a store login (bulk Clear, bulk Delete
// J/K, per-row Clear) already exists in Reports -> HO records, scoped to the
// exact same records (STORE_CLEARABLE + pending, same as here) — so nothing
// is lost, it just has one home instead of two. A tap on a row still opens
// the full record (same popup Reports uses, showInternal=false so the
// HO-only fields stay hidden) so a message thread or the full detail is a tap
// away without permanently occupying space in the list.
export default function ScanHistoryList({ records, loading, autoOpenId }) {
  const [openRecord, setOpenRecord] = useState(null)

  // Arriving from a Nav message notification (`autoOpenId`) — open the detail
  // popup for that record as soon as it's actually in the loaded list.
  if (autoOpenId && !openRecord) {
    const match = records.find(r => r.id === autoOpenId)
    if (match) setOpenRecord(match)
  }

  if (loading) {
    return <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
  }

  if (!records.length) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>Nothing scanned yet.</p>
          <p className="note" style={{ marginTop: 6 }}>Scan a product above to log your first entry.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="table-wrap table-dense">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 110 }}>Barcode</th>
              <th>Description</th>
              <th style={{ minWidth: 70 }}>UOM</th>
              <th className="td-right" style={{ minWidth: 50 }}>Qty</th>
              <th style={{ minWidth: 120 }}>Scanned</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const barcode     = r.barcode_no || r.product_code || ''
              const description = r.item_name || r.description || r.product_name_label || ''
              return (
                <tr key={r.id} className="scan-history-row" onClick={() => setOpenRecord(r)}>
                  <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{barcode || <span className="td-muted">—</span>}</td>
                  <td>{description || <span className="td-muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.uom || <span className="td-muted">—</span>}</td>
                  <td className="td-right">{r.quantity ?? <span className="td-muted">—</span>}</td>
                  <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <RecordDetailModal
        open={!!openRecord}
        record={openRecord}
        showInternal={false}
        onClose={() => setOpenRecord(null)}
      />
    </div>
  )
}
