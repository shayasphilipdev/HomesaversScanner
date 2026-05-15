import { Fragment } from 'react'
import { updateTaskRecord, deleteTaskRecord } from '../lib/api.js'
import { useStore } from '../App.jsx'

const STATUS_LABEL = {
  pending:          { label: 'Pending',          cls: 'badge-pending' },
  completed:        { label: 'Completed by HQ',  cls: 'badge-completed' },
  no_change_needed: { label: 'No change needed', cls: 'badge-pending' },
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' },
}

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export default function TaskRecordList({ records, loading, onRefresh }) {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const markCompleted = async (id) => {
    await updateTaskRecord(id, { status: 'completed', completed_at: new Date().toISOString() })
    onRefresh()
  }

  const markStoreCompleted = async (id) => {
    await updateTaskRecord(id, {
      status: 'store_completed',
      store_completed_at: new Date().toISOString(),
      marked_for_deletion: true
    })
    onRefresh()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this record?')) return
    await deleteTaskRecord(id)
    onRefresh()
  }

  if (loading) {
    return <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
  }

  if (!records.length) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>No records yet. Pick a task type and scan a product to get started.</p>
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
              <th>Product Code</th>
              <th>Description</th>
              <th>UOM</th>
              <th className="td-right">Qty</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Date / Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
              const supplier = r.supplier_name_text || r.supplier_id || ''
              const description = r.description || r.product_name_label || ''
              // Store needs to acknowledge both `completed` and
              // `no_change_needed` — both are HQ-reviewed states.
              const reviewed = r.status === 'completed' || r.status === 'no_change_needed'
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td><strong>{r.task_type}</strong></td>
                    <td className="td-code">{r.product_code || r.product_barcode || ''}</td>
                    <td>{description || <span className="td-muted">—</span>}</td>
                    <td>
                      {r.uom || <span className="td-muted">—</span>}
                      {r.uom === 'Eachs' && (
                        <span title="Single piece — check pack contents" style={{ marginLeft: 4 }}>⚠️</span>
                      )}
                    </td>
                    <td className="td-right">{r.quantity ?? <span className="td-muted">—</span>}</td>
                    <td>{supplier || <span className="td-muted">—</span>}</td>
                    <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                    <td className="td-muted">{formatDT(r.created_at)}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {isBO && r.status === 'pending' && (
                          <button className="btn btn-sm btn-primary" onClick={() => markCompleted(r.id)}>Mark complete</button>
                        )}
                        {!isBO && reviewed && (
                          <button className="btn btn-sm btn-outline" onClick={() => markStoreCompleted(r.id)}>Confirm ✓</button>
                        )}
                        {(isBO || r.status === 'store_completed') && (
                          <button className="btn btn-sm btn-icon btn-outline" title="Delete" onClick={() => handleDelete(r.id)}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {r.review_notes && (
                    <tr>
                      <td colSpan={9} style={{ background: 'var(--gray-50, #fafafa)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-muted)', borderTop: 'none' }}>
                        💬 HQ note: {r.review_notes}
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
