import { useCurrentStore } from '../lib/currentStore.jsx'

// Mandatory store picker that sits at the top of HO Tasks / Store Tasks.
// If the user has only one store, it locks to that store and shows a
// read-only "Working at" badge. If they have multiple, it's a dropdown
// they MUST pick from before doing anything.
export default function CurrentStorePicker({ subject = 'task' }) {
  const { currentStoreId, setCurrentStoreId, scopedStores, ready } = useCurrentStore()

  if (!ready) return null
  if (!scopedStores.length) {
    return (
      <div className="card mb-12">
        <div className="card-body" style={{ padding: 14 }}>
          <strong>No stores assigned.</strong> Ask the Admin to assign you to at least one store.
        </div>
      </div>
    )
  }
  if (scopedStores.length === 1) {
    const s = scopedStores[0]
    return (
      <div className="store-pick-bar" data-locked>
        <span className="store-pick-label">Working at</span>
        <strong className="store-pick-name">{s.store_name}</strong>
        <span className="td-muted" style={{ fontSize: 12 }}>({s.store_code})</span>
      </div>
    )
  }
  return (
    <div className="store-pick-bar">
      <span className="store-pick-label">Current store *</span>
      <select value={currentStoreId || ''} onChange={e => setCurrentStoreId(e.target.value || null)}>
        <option value="">— Pick a store before you start —</option>
        {scopedStores.map(s => (
          <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
        ))}
      </select>
      {!currentStoreId && (
        <span className="note" style={{ fontSize: 12, marginLeft: 6 }}>
          You must pick a store before recording a {subject}.
        </span>
      )}
    </div>
  )
}
