// Phase 9K — Current-store context.
//
// Tasks (HO + Store) are single-store actions: the user picks ONE store
// to act on. This context shares that selection across the page and its
// child forms. Persists in sessionStorage so it survives navigation.
//
// Resolves to:
//   { currentStoreId, setCurrentStoreId, scopedStores, ready }
// scopedStores  = the active stores the current employee can work in
// currentStoreId = the one currently selected (auto-picked when only one)
// ready         = true once we've loaded the scoped store list

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getStores } from './api.js'
import { useStore } from '../App.jsx'
import { canAccessAdmin } from './roles.js'

const KEY = 'hs_current_store'

const Ctx = createContext({
  currentStoreId: null,
  setCurrentStoreId: () => {},
  scopedStores: [],
  ready: false
})

export const useCurrentStore = () => useContext(Ctx)

export function CurrentStoreProvider({ children }) {
  const { session } = useStore()
  const [stores, setStores] = useState([])
  const [ready, setReady] = useState(false)
  const [currentStoreId, _setCurrentStoreId] = useState(() => sessionStorage.getItem(KEY) || null)

  const setCurrentStoreId = (id) => {
    _setCurrentStoreId(id || null)
    if (id) sessionStorage.setItem(KEY, id)
    else    sessionStorage.removeItem(KEY)
  }

  // Cheap stable cache keys for the two arrays so we don't serialize on
  // every render. (.join is roughly an order of magnitude cheaper than
  // JSON.stringify and produces a primitive React can compare with ===.)
  const storeIdsKey = (session.store_ids || []).join(',')
  const areaIdsKey  = (session.area_ids  || []).join(',')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const all = await getStores()
        if (!alive) return
        const active = all.filter(s => s.is_active)
        // Restrict to the employee's scope.
        let scoped = active
        if (!session.all_stores && !canAccessAdmin(session)) {
          const set = new Set(session.store_ids || [])
          if (Array.isArray(session.area_ids) && session.area_ids.length) {
            for (const s of active) if (session.area_ids.includes(s.area_id)) set.add(s.id)
          }
          scoped = active.filter(s => set.has(s.id))
        }
        setStores(scoped)
        // Auto-pick when only one store, or when previously-selected is out of scope.
        if (scoped.length === 1) {
          setCurrentStoreId(scoped[0].id)
        } else if (currentStoreId && !scoped.some(s => s.id === currentStoreId)) {
          setCurrentStoreId(null)
        }
        setReady(true)
      } catch (e) {
        // Surface the failure in the console so an offline page-load is
        // diagnosable rather than silently leaving the picker empty.
        console.warn('[currentStore] could not load scoped stores:', e?.message || e)
        setReady(true)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.all_stores, storeIdsKey, areaIdsKey])

  const value = useMemo(() => ({
    currentStoreId,
    setCurrentStoreId,
    scopedStores: stores,
    ready
  }), [currentStoreId, stores, ready])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
