import { Fragment, useState, useCallback, useEffect } from 'react'
import { updateTaskRecord, deleteTaskRecord, bulkClearTaskRecords, bulkDeleteTaskRecords } from '../lib/api.js'
import ConfirmDeleteModal from './ConfirmDeleteModal.jsx'
import ConfirmArchiveModal from './ConfirmArchiveModal.jsx'
import { useStore } from '../App.jsx'
import { useToast } from './Toast.jsx'
import { TASK_FORMS, STORE_ARCHIVABLE } from '../lib/taskTypes.js'
import { isAdminRole } from '../lib/roles.js'
import RecordMessages from './RecordMessages.jsx'
import AgeClock from './AgeClock.jsx'

const STATUS_LABEL = {
  pending:          { label: 'Pending',          cls: 'badge-pending' },
  completed:        { label: 'Completed by HO',  cls: 'badge-completed' },
  no_change_needed: { label: 'No change needed', cls: 'badge-pending' },
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' },
  cleared:          { label: 'Archived',         cls: 'badge-store-done' },
}

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export default function TaskRecordList({ records, loading, onRefresh, onOptimisticRemove, onUnreadChange, autoOpenId, showBulkToolbar = true, showRowActions = true }) {
  const { session, appConfig } = useStore()
  const toast = useToast()
  // Unified 2026-09-11: area managers now count as back office everywhere,
  // same as Reports.jsx and the server's isBackOffice()/BO_ROLES — they
  // already get the back-office login treatment in every other respect
  // (mode:'backoffice', sessionStorage, 12h token). This used to exclude
  // area_manager specifically so they'd see the store-side J/K clear UI on
  // this page; that's now gone for them here (Reports.jsx never gave them
  // that UI anyway), superseded by full back-office treatment instead.
  const isBO = session.mode === 'backoffice'

  // ── Bulk-select state. Drives both the store Archive and the
  //    permanent Delete (available to every user for Department/Price checks). ─
  const [selected, setSelected] = useState(new Set())
  // Archive confirmation. archiveTarget = { ids:[...] } or null.
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [archiving, setArchiving] = useState(false)
  // Permanent-delete confirmation. deleteTarget = { ids:[...] } or null.
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Message thread expand state ───────────────────────────────────────────
  const [expandedMessages, setExpandedMessages] = useState(new Set())
  const toggleMessages = (id) => setExpandedMessages(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const handleUnreadChange = useCallback(() => { onUnreadChange?.() }, [onUnreadChange])

  // When navigated here from the header message dropdown, open that record's
  // thread (once it's present in the loaded list).
  useEffect(() => {
    if (autoOpenId && records.some(r => r.id === autoOpenId)) {
      setExpandedMessages(prev => prev.has(autoOpenId) ? prev : new Set(prev).add(autoOpenId))
    }
  }, [autoOpenId, records])

  // Rows a store user may ARCHIVE. Archive replaced both Clear and (for
  // everyone but an admin) Delete, so it has to cover everywhere either of them
  // used to appear: the store's own floor types while pending, anything HO has
  // already reviewed, and the store's own confirmed records. Kept in step with
  // the bulk-clear filter in functions/api/[[route]].js.
  const clearableRows = isBO ? [] : records.filter(r =>
    (STORE_ARCHIVABLE.has(r.task_type) && r.status === 'pending') ||
    r.status === 'completed' || r.status === 'no_change_needed' ||
    r.status === 'store_completed'
  )
  const clearableSet = new Set(clearableRows.map(r => r.id))
  const hasBulkClear = clearableRows.length > 0

  // Permanent delete is ADMIN ONLY now and is no longer restricted by task type
  // -- the old J/K/H allow-list existed to stop stores destroying a query record
  // awaiting an HO answer, which is moot once stores cannot delete at all.
  const isAdmin = isAdminRole(session)

  // Rows the user can bulk-action: an admin may select anything (to delete);
  // a store user may select what it can archive.
  const selectableRows = isAdmin ? records : records.filter(r => clearableSet.has(r.id))
  const selectedClearableCount = [...selected].filter(id => clearableSet.has(id)).length

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleAll = () => {
    const ids = selectableRows.map(r => r.id)
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

  // ARCHIVE. The stored value stays the literal 'cleared' -- see
  // supabase-migration-rename-d1-copied-at.sql for why the status string was
  // deliberately not renamed. Only the wording changed.
  const markCleared = async (id) => {
    try {
      await updateTaskRecord(id, { status: 'cleared' })
      onOptimisticRemove?.(id)
    } catch (e) {
      toast.error('Could not archive — ' + (e?.message || 'please try again'))
      onRefresh()
    }
  }

  // Both the single and bulk archive go through one confirmation, so the
  // retention promise is worded identically however it was reached.
  const runArchive = async () => {
    const ids = archiveTarget?.ids || []
    if (!ids.length) { setArchiveTarget(null); return }
    setArchiving(true)
    try {
      if (ids.length === 1) {
        await markCleared(ids[0])
      } else {
        const { cleared } = await bulkClearTaskRecords(ids)
        toast.success(`${cleared} record${cleared === 1 ? '' : 's'} archived.`)
        setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
        for (const id of ids) onOptimisticRemove?.(id)
      }
    } catch (e) {
      toast.error('Archive failed — ' + (e?.message || 'please try again'))
      onRefresh()
    } finally {
      setArchiving(false)
      setArchiveTarget(null)
    }
  }

  // Archive only the archivable subset of the selection: an admin can select a
  // row to delete that it must never silently archive instead.
  const handleBulkClear = () => {
    const ids = [...selected].filter(id => clearableSet.has(id))
    if (!ids.length) return
    setArchiveTarget({ ids })
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

  // Checkbox column shows whenever there is anything the user can bulk-action
  // AND the caller wants the bulk toolbar at all (store-mode HO Tasks turns
  // this off — Select all / Archive selected / Delete selected duplicate what
  // Reports -> HO records already offers against these same records; the
  // per-row Archive/Delete/Messages buttons below are untouched by this flag).
  const showCheckCol = showBulkToolbar && selectableRows.length > 0

  return (
    <div className="card">
      {/* Bulk toolbar: Archive (everyone) + permanent Delete (admin only). */}
      {showBulkToolbar && selectableRows.length > 0 && (
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" onClick={toggleAll}>
            {selected.size === selectableRows.length && selectableRows.length > 0 ? 'Deselect all' : `Select all (${selectableRows.length})`}
          </button>
          {hasBulkClear && selectedClearableCount > 0 && (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleBulkClear}
              disabled={archiving}
            >
              {`📦 Archive selected (${selectedClearableCount})`}
            </button>
          )}
          {isAdmin && selected.size > 0 && (
            <button
              className="btn btn-sm"
              onClick={() => setDeleteTarget({ ids: [...selected] })}
              style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
            >
              🗑 Delete selected ({selected.size})
            </button>
          )}
          <span className="note" style={{ fontSize: 12 }}>
            {isAdmin
              ? 'Archive is reversible and keeps the record readable · Delete removes it permanently.'
              : 'Archiving moves the record out of your lists. It can be undone.'}
          </span>
        </div>
      )}

      <div className="table-wrap table-dense">
        <table>
          <thead>
            <tr>
              {showCheckCol && <th style={{ width: 32 }}></th>}
              <th style={{ minWidth: 110 }}>Task</th>
              <th style={{ minWidth: 110 }}>Product Barcode</th>
              <th style={{ minWidth: 90 }}>Product Code</th>
              <th>Product Description</th>
              <th style={{ minWidth: 70 }}>UOM</th>
              <th className="td-right" style={{ minWidth: 60 }}>Qty</th>
              <th style={{ minWidth: 110 }}>Supplier</th>
              <th style={{ minWidth: 110 }}>Photos</th>
              <th style={{ minWidth: 120 }}>Status</th>
              <th style={{ minWidth: 130 }}>Date / Time</th>
              {showRowActions && <th style={{ minWidth: 220 }}></th>}
            </tr>
          </thead>
          <tbody>
            {records.map(r => {
              const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
              const supplier = r.supplier_name || r.supl_id || r.supplier_name_text || ''
              const description = r.item_name || r.description || r.product_name_label || ''
              const barcodeNo  = r.barcode_no || r.product_code || ''
              const reviewed = r.status === 'completed' || r.status === 'no_change_needed'
              // ARCHIVE is one button covering everywhere Clear or Delete used
              // to appear. Back office archives anything HO has reviewed; a
              // store additionally archives its own floor types straight from
              // pending (no HO review is coming) and its own confirmed records.
              // clearableSet already encodes the store-side rule, so the two
              // cannot drift apart.
              const canArchive = isBO
                ? (reviewed || r.status === 'store_completed')
                : clearableSet.has(r.id)
              // Selectable = anything this user can bulk-action on this row.
              // An admin can select any row, because it can delete any row.
              const isSelectable  = isAdmin || clearableSet.has(r.id)
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
                    <td style={{ minWidth: 110, whiteSpace: 'nowrap' }}><strong>{TASK_FORMS[r.task_type]?.name || r.task_type}</strong></td>
                    <td className="td-code" style={{ minWidth: 110, whiteSpace: 'nowrap' }}>{barcodeNo}</td>
                    <td className="td-muted" style={{ fontSize: 12, minWidth: 90, whiteSpace: 'nowrap' }}>{r.product_barcode || '—'}</td>
                    <td>{description || <span className="td-muted">—</span>}</td>
                    <td style={{ minWidth: 70, whiteSpace: 'nowrap' }}>
                      {r.uom || <span className="td-muted">—</span>}
                      {r.uom === 'Eachs' && (
                        <span title="Single piece — check pack contents" role="img" aria-label="Pack-contents warning" style={{ marginLeft: 4 }}>⚠️</span>
                      )}
                    </td>
                    <td className="td-right" style={{ minWidth: 60, whiteSpace: 'nowrap' }}>{r.quantity ?? <span className="td-muted">—</span>}</td>
                    <td style={{ minWidth: 110, whiteSpace: 'nowrap' }}>{supplier || <span className="td-muted">—</span>}</td>
                    <td style={{ minWidth: 110, whiteSpace: 'nowrap' }}>
                      <div className="flex-row" style={{ gap: 6 }}>
                        {r.photo_product_url && <a href={r.photo_product_url} target="_blank" rel="noopener noreferrer" title="Product photo">📷 product</a>}
                        {r.photo_barcode_url && <a href={r.photo_barcode_url} target="_blank" rel="noopener noreferrer" title="Barcode photo">📷 barcode</a>}
                        {!r.photo_product_url && !r.photo_barcode_url && <span className="td-muted">—</span>}
                      </div>
                    </td>
                    <td style={{ minWidth: 120, whiteSpace: 'nowrap' }}>
                      <span className={`badge ${status.cls}`}>{status.label}</span>
                      {r.status === 'pending' && <AgeClock at={r.created_at} style={{ marginLeft: 5 }} />}
                    </td>
                    <td className="td-muted" style={{ minWidth: 130, whiteSpace: 'nowrap' }}>{formatDT(r.created_at)}</td>
                    {showRowActions && (
                      <td style={{ minWidth: 220, whiteSpace: 'nowrap' }}>
                        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {isBO && r.status === 'pending' && (
                            <button className="btn btn-sm btn-primary" onClick={() => markCompleted(r.id)}>Mark complete</button>
                          )}
                          {/* ARCHIVE — one button, one confirmation, wherever
                              Clear or Delete used to sit. */}
                          {canArchive && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => setArchiveTarget({ ids: [r.id] })}
                              title="Move to the archive — reversible"
                            >
                              📦 Archive
                            </button>
                          )}
                          <button
                            className={`btn-msg-toggle ${expandedMessages.has(r.id) ? 'active' : ''} ${msgCount > 0 && !expandedMessages.has(r.id) ? 'has-thread' : ''}`}
                            title={msgCount > 0 ? `${msgCount} message${msgCount > 1 ? 's' : ''}` : 'Messages'}
                            onClick={() => toggleMessages(r.id)}
                          >
                            💬 <span style={{ fontSize: 12 }}>Msg</span>
                            {msgCount > 0 && <span className="msg-toggle-badge">{msgCount}</span>}
                          </button>
                          {/* PERMANENT delete — admin only, any task type,
                              behind the strong red modal. Everyone else
                              archives, which is reversible. */}
                          {isAdmin && (
                            <button
                              className="btn btn-sm"
                              title="Permanently delete this record"
                              onClick={() => setDeleteTarget({ ids: [r.id] })}
                              style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
                            >🗑 Delete</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {/* Reachable even with showRowActions=false: a Nav message
                      notification adds straight to expandedMessages (see the
                      autoOpenId effect above) without going through this
                      row's own Msg button, so a deep link still opens the
                      thread even though the button itself is gone. */}
                  {expandedMessages.has(r.id) && (
                    <tr>
                      <td colSpan={(showCheckCol ? 1 : 0) + 10 + (showRowActions ? 1 : 0)} style={{ padding: 0, borderTop: 'none' }}>
                        <RecordMessages
                          recordId={r.id}
                          onUnreadChange={handleUnreadChange}
                          resolvedAt={r.messages_resolved_at}
                          resolvedByName={r.messages_resolved_by_name}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmArchiveModal
        open={!!archiveTarget}
        count={archiveTarget?.ids.length || 1}
        busy={archiving}
        totalDays={appConfig?.retention?.total_days}
        liveDays={appConfig?.retention?.live_days}
        storeWording={!isBO}
        onConfirm={runArchive}
        onCancel={() => { if (!archiving) setArchiveTarget(null) }}
      />

      <ConfirmDeleteModal
        open={!!deleteTarget}
        count={deleteTarget?.ids.length || 1}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null) }}
      />
    </div>
  )
}
