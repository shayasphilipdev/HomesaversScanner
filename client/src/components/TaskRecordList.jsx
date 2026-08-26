import { Fragment, useState, useCallback, useEffect } from 'react'
import { updateTaskRecord, deleteTaskRecord, bulkClearTaskRecords, bulkDeleteTaskRecords } from '../lib/api.js'
import ConfirmDeleteModal from './ConfirmDeleteModal.jsx'
import MessagesModal from './MessagesModal.jsx'
import { useStore } from '../App.jsx'
import { useToast } from './Toast.jsx'
import { TASK_FORMS } from '../lib/taskTypes.js'

const STATUS_LABEL = {
  pending:          { label: 'Pending',          cls: 'badge-pending' },
  completed:        { label: 'Completed by HO',  cls: 'badge-completed' },
  no_change_needed: { label: 'No change needed', cls: 'badge-pending' },
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' },
  cleared:          { label: 'Clear',            cls: 'badge-store-done' },
}

// Task types where store users can clear directly from Pending (no HO review needed).
const STORE_CLEARABLE = new Set(['J', 'K'])

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export default function TaskRecordList({ records, loading, onRefresh, onOptimisticRemove, onUnreadChange, autoOpenId }) {
  const { session } = useStore()
  const toast = useToast()
  // Area managers get store-side clear UI (J/K bulk-clear) despite being in backoffice mode.
  const isBO = session.mode === 'backoffice' && session.role !== 'area_manager'

  // ── Bulk-select state (J/K rows). Drives both the store Clear and the
  //    permanent Delete (available to every user for Department/Price checks). ─
  const [selected, setSelected] = useState(new Set())
  const [bulkClearing, setBulkClearing] = useState(false)
  // Permanent-delete confirmation. deleteTarget = { ids:[...] } or null.
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Message thread modal state ────────────────────────────────────────────
  // msgRecord holds the full record object whose thread is open (null = closed).
  const [msgRecord, setMsgRecord] = useState(null)
  const openMessages  = (rec) => setMsgRecord(rec)
  const closeMessages = ()    => setMsgRecord(null)
  const handleUnreadChange = useCallback(() => { onUnreadChange?.() }, [onUnreadChange])

  // When navigated here from the header message dropdown, open that record's
  // thread (once it's present in the loaded list).
  useEffect(() => {
    if (autoOpenId) {
      const rec = records.find(r => r.id === autoOpenId)
      if (rec) setMsgRecord(rec)
    }
  }, [autoOpenId, records])

  // Rows eligible for store-side bulk clear (unchanged: store users, J/K pending).
  const clearableRows = isBO ? [] : records.filter(r =>
    STORE_CLEARABLE.has(r.task_type) && r.status === 'pending'
  )
  const clearableSet = new Set(clearableRows.map(r => r.id))
  const hasBulkClear = clearableRows.length > 0

  // Rows eligible for permanent delete: every J/K (Department/Price Check) row,
  // for every user. Selection checkboxes are shown whenever any exist.
  const jkRows = records.filter(r => STORE_CLEARABLE.has(r.task_type))
  const selectedClearableCount = [...selected].filter(id => clearableSet.has(id)).length

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleAll = () => {
    const ids = jkRows.map(r => r.id)
    setSelected(prev => prev.size === ids.length ? new Set() : new Set(ids))
  }

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

  const handleBulkClear = async () => {
    // Clear only the clearable subset of the selection (a J/K row that isn't
    // pending can be selected for delete but must never be silently cleared).
    const ids = [...selected].filter(id => clearableSet.has(id))
    if (!ids.length) return
    setBulkClearing(true)
    try {
      const { cleared } = await bulkClearTaskRecords(ids)
      toast.success(`${cleared} record${cleared === 1 ? '' : 's'} cleared.`)
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      for (const id of ids) onOptimisticRemove?.(id)
    } catch (e) {
      toast.error('Bulk clear failed — ' + (e?.message || 'please try again'))
      onRefresh()
    } finally {
      setBulkClearing(false)
    }
  }

  // Existing generic delete (unchanged) — used for the old 🗑 on non-J/K rows.
  const handleDelete = async (id) => {
    if (!confirm("Delete this record? This can't be undone.")) return
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

  // Permanent delete for J/K (single or bulk), behind the strong red modal.
  const confirmDelete = async () => {
    const ids = deleteTarget?.ids || []
    if (!ids.length) { setDeleteTarget(null); return }
    setDeleting(true)
    try {
      if (ids.length === 1) await deleteTaskRecord(ids[0])
      else                  await bulkDeleteTaskRecords(ids)
      toast.success(`${ids.length} record${ids.length === 1 ? '' : 's'} permanently deleted.`)
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      for (const id of ids) onOptimisticRemove?.(id)
    } catch (e) {
      toast.error('Delete failed — ' + (e?.message || 'please try again'))
      onRefresh()
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
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

  // Checkbox column shows whenever there are J/K rows (selectable for delete,
  // and — for store users — clear).
  const showCheckCol = jkRows.length > 0

  return (
    <div className="card">
      {/* Bulk toolbar for J/K rows: store Clear (archive) + everyone Delete (permanent). */}
      {jkRows.length > 0 && (
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" onClick={toggleAll}>
            {selected.size === jkRows.length && jkRows.length > 0 ? 'Deselect all' : `Select all J/K (${jkRows.length})`}
          </button>
          {hasBulkClear && selectedClearableCount > 0 && (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleBulkClear}
              disabled={bulkClearing}
            >
              {bulkClearing ? <><span className="spinner" /> Clearing…</> : `✓ Clear selected (${selectedClearableCount})`}
            </button>
          )}
          {selected.size > 0 && (
            <button
              className="btn btn-sm"
              onClick={() => setDeleteTarget({ ids: [...selected] })}
              style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
            >
              🗑 Delete selected ({selected.size})
            </button>
          )}
          <span className="note" style={{ fontSize: 12 }}>
            {hasBulkClear ? 'Clear archives the record · Delete removes it permanently.' : 'Delete removes J/K records permanently.'}
          </span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {showCheckCol && <th style={{ width: 32 }}></th>}
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
              // Store-side: J/K records can be cleared directly from pending.
              const storeCanClearNow = !isBO && STORE_CLEARABLE.has(r.task_type) && r.status === 'pending'
              const isJK          = STORE_CLEARABLE.has(r.task_type)
              // Every J/K row is selectable (for permanent delete; store clear too).
              const isSelectable  = isJK
              const msgCount      = r.message_count || 0
              // Row colour class: green = HO reviewed; amber = has messages.
              const rowClass = reviewed ? 'tr-reviewed' : msgCount > 0 ? 'tr-has-msg' : ''
              return (
                <Fragment key={r.id}>
                  <tr className={rowClass} style={isSelectable && selected.has(r.id) ? { background: 'var(--surface-warm)' } : undefined}>
                    {showCheckCol && (
                      <td style={{ textAlign: 'center', paddingRight: 0 }}>
                        {isSelectable && (
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                      </td>
                    )}
                    <td><strong>{TASK_FORMS[r.task_type]?.name || r.task_type}</strong></td>
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
                        {/* Store: clear HO-reviewed records (standard flow) */}
                        {!isBO && reviewed && (
                          <button className="btn btn-sm btn-primary" onClick={() => markCleared(r.id)} title="PO actioned — clear from list">
                            ✓ Clear
                          </button>
                        )}
                        {/* Store: clear J/K directly from pending (no HO review needed) */}
                        {storeCanClearNow && (
                          <button className="btn btn-sm btn-primary" onClick={() => markCleared(r.id)} title="Mark as actioned — clear from list">
                            ✓ Clear
                          </button>
                        )}
                        <button
                          className={`btn-msg-toggle ${msgRecord?.id === r.id ? 'active' : ''} ${msgCount > 0 && msgRecord?.id !== r.id ? 'has-thread' : ''}`}
                          title={msgCount > 0 ? `${msgCount} message${msgCount > 1 ? 's' : ''}` : 'Messages'}
                          onClick={() => openMessages(r)}
                        >
                          💬 <span style={{ fontSize: 12 }}>Msg</span>
                          {msgCount > 0 && <span className="msg-toggle-badge">{msgCount}</span>}
                        </button>
                        {/* J/K: permanent delete for every user, behind the strong red modal. */}
                        {isJK && (
                          <button
                            className="btn btn-sm"
                            title="Permanently delete this record"
                            onClick={() => setDeleteTarget({ ids: [r.id] })}
                            style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
                          >🗑 Delete</button>
                        )}
                        {/* Existing generic delete — unchanged — for non-J/K rows only. */}
                        {!isJK && (isBO || r.status === 'store_completed') && (
                          <button className="btn btn-sm btn-icon btn-outline" title="Delete" onClick={() => handleDelete(r.id)}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDeleteModal
        open={!!deleteTarget}
        count={deleteTarget?.ids.length || 1}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null) }}
      />

      <MessagesModal
        record={msgRecord}
        onClose={closeMessages}
        onUnreadChange={handleUnreadChange}
      />
    </div>
  )
}
