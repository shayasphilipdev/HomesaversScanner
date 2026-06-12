import { NavLink } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { canAccessAdmin, canAccessTemplates, canAccessSettings } from '../lib/roles.js'

// Tabs available depend on the user's role:
//   - admin                   → everything (incl. Settings)
//   - buying_manager          → everything except Settings
//   - other task creators     → only "Task templates"
// Reports moved to the Reports page (as "Master Reports").
const ADMIN_TABS = [
  { to: '/admin/stores',          label: 'Stores' },
  { to: '/admin/areas',           label: 'Areas' },
  { to: '/admin/employees',       label: 'Employees' },
  { to: '/admin/users',           label: 'User accounts' },
  { to: '/admin/lookups',         label: 'Reason / Size lookups' },
  { to: '/admin/products',        label: 'Products' },
  { to: '/admin/suppliers',       label: 'Suppliers' },
  { to: '/admin/space-plan',      label: 'Space Plan' }
]
const SETTINGS_TAB = { to: '/admin/settings', label: 'Settings' }
const TEMPLATE_TAB = { to: '/admin/task-templates', label: 'Task templates' }

export default function AdminNav() {
  const { session } = useStore()
  const tabs = []
  if (canAccessAdmin(session))     tabs.push(...ADMIN_TABS)
  if (canAccessSettings(session))  tabs.push(SETTINGS_TAB)
  if (canAccessTemplates(session)) tabs.push(TEMPLATE_TAB)
  if (!tabs.length) return null

  return (
    <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
      {tabs.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) => `btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}`}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
