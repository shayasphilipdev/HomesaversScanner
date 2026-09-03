import { NavLink } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { canAccessAdmin, canDoHQTasks, canDoStoreTasks, canSeeManagerDashboard } from '../lib/roles.js'

// Visible only on phones (CSS handles the breakpoint).
// Thumb-reach navigation pinned to the bottom edge, with safe-area
// inset support so it sits above the iOS home indicator.
//
// ICONS. Previously plain Unicode glyphs (◧ ✚ ⏳ ⊞ ⚑ 💬 ☑ ▤ ⚙). Several of
// those codepoints default to full-colour EMOJI presentation on phones
// (⏳ and 💬 confirmed on a real device — a bright hourglass and speech
// balloon sitting among otherwise flat, single-colour glyphs) while the rest
// render as plain text glyphs — which two you get depends on the phone's own
// font/OS emoji tables, not on anything this app controls. Hand-drawn SVGs
// side-step that entirely: every icon is the same stroke weight, same size,
// same `currentColor`, on every device, always.
const iconProps = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
}
const Icon = (children) => () => <svg {...iconProps} aria-hidden="true">{children}</svg>

const ICONS = {
  home: Icon(<>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10" />
    <path d="M9.5 20.5V14h5v6.5" />
  </>),
  manager: Icon(<>
    <path d="M4.5 16a7.5 7.5 0 0 1 15 0" />
    <path d="M12 16 15.5 10" />
    <circle cx="12" cy="16" r="1.15" fill="currentColor" stroke="none" />
  </>),
  ho: Icon(<>
    <rect x="6" y="4.5" width="12" height="16" rx="2" />
    <rect x="9" y="3" width="6" height="3" rx="1" />
    <path d="M9 12.3 11 14.3 15.5 9.8" />
  </>),
  replies: Icon(<>
    <path d="M9.5 14.5 4.5 9.5l5-5" />
    <path d="M4.5 9.5H14a5.5 5.5 0 0 1 5.5 5.5v2" />
  </>),
  spacePlan: Icon(<>
    <rect x="3.5" y="3.5" width="7.2" height="7.2" rx="1.1" />
    <rect x="13.3" y="3.5" width="7.2" height="7.2" rx="1.1" />
    <rect x="3.5" y="13.3" width="7.2" height="7.2" rx="1.1" />
    <rect x="13.3" y="13.3" width="7.2" height="7.2" rx="1.1" />
  </>),
  compete: Icon(<>
    <path d="M6 3v18" />
    <path d="M6 4.5h10.5l-2.7 4 2.7 4H6" />
  </>),
  query: Icon(<>
    <path d="M4.5 5.5h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H10l-4.2 3.5V15.5H4.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
    <path d="M9 10.2c0-1.1.9-2 2-2 1.2 0 2.1.8 2.1 1.8 0 .9-.6 1.3-1.2 1.7-.6.4-.9.7-.9 1.3" />
    <circle cx="11.9" cy="15.6" r=".15" fill="currentColor" stroke="currentColor" strokeWidth="1.4" />
  </>),
  tasks: Icon(<>
    <path d="M4 7.2 5.4 8.6 8 6" />
    <path d="M11.5 7.2h8.5" />
    <path d="M4 13.2 5.4 14.6 8 12" />
    <path d="M11.5 13.2h8.5" />
    <path d="M4 19.2 5.4 20.6 8 18" />
    <path d="M11.5 19.2h8.5" />
  </>),
  reports: Icon(<>
    <path d="M4 20.5h16" />
    <rect x="5.5" y="13.5" width="3.4" height="7" rx=".6" />
    <rect x="10.3" y="9" width="3.4" height="11.5" rx=".6" />
    <rect x="15.1" y="5" width="3.4" height="15.5" rx=".6" />
  </>),
  admin: Icon(<>
    <path d="M4 7h16" /><circle cx="15.5" cy="7" r="2" />
    <path d="M4 13h16" /><circle cx="9" cy="13" r="2" />
    <path d="M4 19h16" /><circle cx="16.5" cy="19" r="2" />
  </>)
}

export default function BottomNav() {
  const { session, appConfig } = useStore()

  const items = [
    { to: '/dashboard', icon: 'home', label: 'Home' }
  ]
  if (canSeeManagerDashboard(session)) items.push({ to: '/manager', icon: 'manager', label: 'Manager' })
  // HO Tasks comes before Store Tasks (swapped) — it's the primary store action.
  if (canDoHQTasks(session))    items.push({ to: '/tasks', icon: 'ho', label: 'HO' })
  if (canDoHQTasks(session))    items.push({ to: '/awaiting-reply', icon: 'replies', label: 'Replies' })
  items.push({ to: '/space-plan', icon: 'spacePlan', label: 'Space Plan' })
  if (appConfig?.competition_enabled !== false) items.push({ to: '/competition', icon: 'compete', label: 'Compete' })
  items.push({ to: '/product-query', icon: 'query', label: 'Query' })
  if (canDoStoreTasks(session)) items.push({ to: '/store-tasks', icon: 'tasks', label: 'Tasks' })
  items.push({ to: '/reports', icon: 'reports', label: 'Reports' })
  if (session.mode === 'backoffice') items.push({ to: '/pricing', icon: null, glyph: '€', label: 'Pricing' })
  if (canAccessAdmin(session)) items.push({ to: '/admin/stores', icon: 'admin', label: 'Admin' })

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map(i => {
        const IconCmp = i.icon ? ICONS[i.icon] : null
        return (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}>
            <span className="bottom-nav-icon-slot">
              <span className={`bottom-nav-icon${IconCmp ? '' : ' bottom-nav-icon--glyph'}`}>
                {IconCmp ? <IconCmp /> : i.glyph}
              </span>
            </span>
            <span className="bottom-nav-label">{i.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
