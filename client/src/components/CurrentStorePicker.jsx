import MultiSelectDropdown from './forms/MultiSelectDropdown.jsx'
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
    // Single-store users: a tiny top-left line, no card, no "Working at".
    // The store is also shown in the top nav badge, so this stays minimal
    // to keep the form fields high on a phone screen.
    return (
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 8px 2px' }}>
        📍 <strong style={{ color: 'var(--text)' }}>{s.store_name}</strong> <span style={{ opacity: 0.7 }}>({s.store_code})</span>
      </div>
    )
  }
  const options = scopedStores.map(s => ({ id: s.id, label: `${s.store_name} (${s.store_code})` }))

  return (
    <div className="store-pick-bar">
      <span className="store-pick-label">Current store *</span>
      <div style={{ flex: 1, maxWidth: 360 }}>
        <MultiSelectDropdown
          single
          options={options}
          value={currentStoreId ? [currentStoreId] : []}
          onChange={arr => setCurrentStoreId(arr[0] || null)}
          placeholder="— Pick a store before you start —"
        />
      </div>
      {!currentStoreId && (
        <span className="note" style={{ fontSize: 12, marginLeft: 6 }}>
          You must pick a store before recording a {subject}.
        </span>
      )}
    </div>
  )
}
