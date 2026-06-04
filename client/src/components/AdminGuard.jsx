import { Navigate } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { canAccessAdmin, canAccessTemplates, canAccessSettings } from '../lib/roles.js'

// Wrap a route element to keep non-admin roles out.
//   mode='admin'     → admin / buying_manager (the general admin area)
//   mode='templates' → any task creator
//   mode='settings'  → admin only (stricter)
// Non-admins are bounced to /dashboard rather than shown a dead-end panel —
// this also covers the case where a store user signs in while an /admin/*
// URL was left over from a previous session.
export default function AdminGuard({ mode = 'admin', children }) {
  const { session } = useStore()
  const allowed = mode === 'templates' ? canAccessTemplates(session)
    : mode === 'settings' ? canAccessSettings(session)
    : canAccessAdmin(session)
  if (!allowed) return <Navigate to="/dashboard" replace />
  return children
}
