import { updateProductRecord, deleteProductRecord } from '../lib/api.js'
import { useStore } from '../App.jsx'

const STATUS_LABEL = {
  pending:        { label: 'Pending',          cls: 'badge-pending' },
  completed:      { label: 'Completed by HQ',  cls: 'badge-completed' },
  store_completed:{ label: 'Store confirmed',  cls: 'badge-store-done' },
}

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export default function ProductList({ records, loading, onRefresh }) {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const markCompleted = async (id) => {
    await updateProductRecord(id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    onRefresh()
  }

  const markStoreCompleted = async (id) => {
    await updateProductRecord(id, {
      status: 'store_completed',
      store_completed_at: new Date().toISOString(),
      marked_for_deletion: true
    })
    onRefresh()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this record?')) return
    await deleteProductRecord(id)
    onRefresh()
  }

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
          <span className="spinner spinner-dark" />
        </div>
      </div>
    )
  }

  if (!records.length) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>No product records yet. Scan a product above to get started.</p>
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
              <th>Product Code</th>
              <th>Description</th>
              <th>UOM</th>
              <th className="td-right">Qty</th>
              <th>Status</th>
              <th>Date / Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const status = STATUS_LABEL[r.status] || STATUS_LABEL.pending
              return (
                <tr key={r.id}>
                  <td className="td-code">{r.product_code}</td>
                  <td>{r.description || <span className="td-muted">—</span>}</td>
                  <td>
                    {r.uom}
                    {r.uom === 'Eachs' && (
                      <span title="Single piece — check pack contents" style={{ marginLeft: 4, cursor: 'default' }}>⚠️</span>
                    )}
                  </td>
                  <td className="td-right">{r.quantity}</td>
                  <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                  <td className="td-muted">{formatDT(r.created_at)}</td>
                  <td>
                    <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {/* Back office marks as completed */}
                      {isBO && r.status === 'pending' && (
                        <button className="btn btn-sm btn-primary" onClick={() => markCompleted(r.id)}>
                          Mark complete
                        </button>
                      )}
                      {/* Store confirms completion — triggers early-deletion eligibility */}
                      {!isBO && r.status === 'completed' && (
                        <button className="btn btn-sm btn-outline" onClick={() => markStoreCompleted(r.id)}>
                          Confirm ✓
                        </button>
                      )}
                      {/* Back office can delete anything; store can only delete store_completed */}
                      {(isBO || r.status === 'store_completed') && (
                        <button className="btn btn-sm btn-icon btn-outline" title="Delete" onClick={() => handleDelete(r.id)}>
                          🗑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
