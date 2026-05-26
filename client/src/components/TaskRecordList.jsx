import { Fragment } from 'react'
import { updateTaskRecord, deleteTaskRecord } from '../lib/api.js'
import { useStore } from '../App.jsx'
import { useToast } from './Toast.jsx'

const STATUS_LABEL = {
  pending:          { label: 'Pending',          cls: 'badge-pending' },
  completed:        { label: 'Completed by HO',  cls: 'badge-completed' },
  no_change_needed: { label: 'No change needed', cls: 'badge-pending' },
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' },
  cleared:          { label: 'Clear',            cls: 'badge-store-done' },
}

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export default function TaskRecordList({ records, loading, onRefresh, onOptimisticRemove }) {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const markCompleted = async (id) => {
    try {
      await updateTaskRecord(id, { status: 'completed', completed_at: new Date().toISOString() })
      onRefresh()
    } catch (e) {
      toast.error('Could not mark complete — ' + (e?.message || 'please try again'))
    }
  }

  const markStoreCompleted = async (id) => {
    try {
      await updateTaskRecord(id, {
        status: 'store_completed',
        store_completed_at: new Date().toISOString(),
        marked_for_deletion: true
      })
      onRefresh()
    } catch (e) {
      toast.error('Could not confirm — ' + (e?.message || 'please try again'))
    }
  }

  // Store closes the loop: once they've actioned the HO-completed record
  // in the POs, they mark it 'Clear'. Cleared records stay in the database
  // but disappear from forms and reports (cleared_at is stamped server-side).
  const markCleared = async (id) => {
    try {
      await updateTaskRecord(id, { status: 'cleared' })
      onOptimisticRemove?.(id)
    } catch (e) {
      toast.error('Could not clear — ' + (e?.message || 'please try again'))
      onRefresh()
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this record? This can’t be undone.')) return
    // Optimistic — drop the row from the table immediately. If the server
    // rejects, onRefresh() re-fetches and the row reappears.
    onOptimisticRemove?.(id)
    try {
      await deleteTaskRecord(id)
    } catch (e) {
      onRefresh()
      alert('Could not delete: ' + (e?.message || 'unknown error'))
    }
  }

  if (loading) {
    return <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
  }

  if (!records.length) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>Nothing here yet.</p>
          <p className="note" style={{ marginTop: 6 }}>
            Pick a task type above and scan a product to log your first entry.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Product Barcode</th>
              <th>Product Code</th>
              <th>Product Description</th>
              <th>UOM</th>
              <th className="td-right">Qty</th>
              <th>Supplier</th>
              <th>Photos</th>
              <th>Status</th>
              <th>Date / Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
              const supplier = r.supplier_name || r.supl_id || r.supplier_name_text || ''
              const description = r.item_name || r.description || r.product_name_label || ''
              const barcodeNo  = r.barcode_no || r.product_code || ''
              const reviewed = r.status === 'completed' || r.status === 'no_change_needed'
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td><strong>{r.task_type}</strong></td>
                    <td className="td-code">{barcodeNo}</td>
                    <td className="td-muted" style={{ fontSize: 12 }}>{r.product_barcode || '—'}</td>
                    <td>{description || <span className="td-muted">—</span>}</td>
                    <td>
                      {r.uom || <span className="td-muted">—</span>}
                      {r.uom === 'Eachs' && (
                        <span title="Single piece — check pack contents" role="img" aria-label="Pack-contents warning" style={{ marginLeft: 4 }}>⚠️</span>
                      )}
                    </td>
                    <td className="td-right">{r.quantity ?? <span className="td-muted">—</span>}</td>
                    <td>{supplier || <span className="td-muted">—</span>}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6 }}>
                        {r.photo_product_url && <a href={r.photo_product_url} target="_blank" rel="noopener noreferrer" title="Product photo">📷 product</a>}
                        {r.photo_barcode_url && <a href={r.photo_barcode_url} target="_blank" rel="noopener noreferrer" title="Barcode photo">📷 barcode</a>}
                        {!r.photo_product_url && !r.photo_barcode_url && <span className="td-muted">—</span>}
                      </div>
                    </td>
                    <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                    <td className="td-muted">{formatDT(r.created_at)}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {isBO && r.status === 'pending' && (
                          <button className="btn btn-sm btn-primary" onClick={() => markCompleted(r.id)}>Mark complete</button>
                        )}
                        {!isBO && reviewed && (
                          <button className="btn btn-sm btn-primary" onClick={() => markCleared(r.id)} title="PO actioned — clear from list">
                            ✓ Clear
                          </button>
                        )}
                        {(isBO || r.status === 'store_completed') && (
                          <button className="btn btn-sm btn-icon btn-outline" title="Delete" onClick={() => handleDelete(r.id)}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {r.review_notes && (
                    <tr>
                      <td colSpan={11} style={{ background: 'var(--surface-warm)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-muted)', borderTop: 'none' }}>
                        💬 HO note: {r.review_notes}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
