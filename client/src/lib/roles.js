// Single source of truth for the role system.
// Mirrored in functions/api/[[route]].js (kept in sync by hand — small list).
//
// Permission flags are explanatory only; the actual server-side checks
// live in [[route]].js. Keep them aligned with the API guards.

export const ROLE_KEYS = [
  'sales_assistant',
  'store_manager',
  'area_manager',
  'support_admin',
  'buying_manager',
  'buying_head',
  'admin'
]

export const STORE_ROLE_KEYS = ['sales_assistant', 'store_manager']
export const HQ_ROLE_KEYS    = ['area_manager', 'support_admin', 'buying_manager', 'buying_head', 'admin']

export const ROLES = {
  sales_assistant: {
    key:    'sales_assistant',
    label:  'Sales Assistant',
    scope:  'store',
    summary: 'Front-line store staff. Logs HQ issues and completes store tasks for own store.',
    can: [
      'Log HQ task records (UOM, prices, non-scans…) for own store',
      'Complete store checklist tasks for own store'
    ]
  },
  store_manager: {
    key:    'store_manager',
    label:  'Store Manager',
    scope:  'store',
    summary: 'Runs a single store. Same as Sales Assistant plus visibility into own store stats.',
    can: [
      'Everything a Sales Assistant can do',
      'See own store completion stats and reports'
    ]
  },
  area_manager: {
    key:    'area_manager',
    label:  'Area Manager',
    scope:  'area',
    summary: 'Owns one or more areas. Sees aggregate compliance across their stores; can create tasks.',
    can: [
      'See stats for every store in their assigned areas',
      'Create / edit store task templates targeted at their areas'
    ]
  },
  support_admin: {
    key:    'support_admin',
    label:  'Store Support Administrator',
    scope:  'hq',
    summary: 'Back-office HQ reviewer. Processes the HQ task records that stores submit.',
    can: [
      'Review and resolve HQ task records (mark complete / no change needed)',
      'Run reports across all stores'
    ]
  },
  buying_manager: {
    key:    'buying_manager',
    label:  'Buying Manager',
    scope:  'hq',
    summary: 'Full back-office access. Manages products and suppliers; can create tasks.',
    can: [
      'Full admin: Stores · Areas · Users · Suppliers · Lookups · Products · Settings',
      'Create / edit store task templates (any scope)',
      'Review HQ task records · run reports'
    ]
  },
  buying_head: {
    key:    'buying_head',
    label:  'Buying Head',
    scope:  'hq',
    summary: 'Buying leadership. All-store reports; can create tasks.',
    can: [
      'All-store reports + dashboard',
      'Create / edit store task templates (any scope)',
      'Review HQ task records'
    ]
  },
  admin: {
    key:    'admin',
    label:  'Admin',
    scope:  'hq',
    summary: 'Top-level full access — everything the app exposes.',
    can: [
      'Everything in the app',
      'Manage users and employees',
      'Reset PINs · change settings'
    ]
  }
}

// Which roles each "permission" gate uses. The server enforces — these
// labels are the same checks expressed for the UI.
export const ADMIN_ROLES          = ['admin', 'buying_manager']
export const TASK_CREATOR_ROLES   = ['admin', 'buying_manager', 'buying_head', 'area_manager']
export const TASK_REVIEWER_ROLES  = ['admin', 'buying_manager', 'buying_head', 'support_admin']

export const roleLabel = (key) => ROLES[key]?.label || key
export const roleScope = (key) => ROLES[key]?.scope || 'unknown'

// Convenience predicates — mirror the server-side guards.
export const canAccessAdmin       = (session) => !!session && ADMIN_ROLES.includes(session.role)
export const canAccessTemplates   = (session) => !!session && TASK_CREATOR_ROLES.includes(session.role)
export const canReviewHQRecords   = (session) => !!session && TASK_REVIEWER_ROLES.includes(session.role)
export const canSeeAnyAdminLink   = (session) => canAccessAdmin(session) || canAccessTemplates(session)
