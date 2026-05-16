import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/admin/stores',    label: 'Stores' },
  { to: '/admin/areas',     label: 'Areas' },
  { to: '/admin/users',     label: 'Users' },
  { to: '/admin/suppliers', label: 'Suppliers' },
  { to: '/admin/lookups',   label: 'Reason / Size lookups' },
  { to: '/admin/products',  label: 'Products' },
  { to: '/admin/settings',  label: 'Settings' }
]

export default function AdminNav() {
  return (
    <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
      {TABS.map(t => (
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
