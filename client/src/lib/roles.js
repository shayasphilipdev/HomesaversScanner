// Single source of truth for the role system.
// Mirrored in functions/api/[[route]].js (kept in sync by hand — small list).

export const ROLE_KEYS = [
  'sales_assistant',
  'supervisor',
  'assistant_store_manager',
  'store_manager',
  'area_manager',
  'support_admin',
  'buying_manager',
  'buying_head',
  'admin'
]

export const STORE_ROLE_KEYS = ['sales_assistant', 'supervisor', 'assistant_store_manager', 'store_manager']
export const HQ_ROLE_KEYS    = ['area_manager', 'support_admin', 'buying_manager', 'buying_head', 'admin']

export const ROLES = {
  sales_assistant: {
    key: 'sales_assistant', label: 'Sales Assistant', scope: 'store',
    summary: 'Front-line store staff.',
    can: ['Log HO task records', 'Complete store tasks']
  },
  supervisor: {
    key: 'supervisor', label: 'Supervisor', scope: 'store',
    summary: 'Senior front-line — covers a shift.',
    can: ['Everything a Sales Assistant can do', 'See own store stats']
  },
  assistant_store_manager: {
    key: 'assistant_store_manager', label: 'Assistant Store Manager', scope: 'store',
    summary: 'Deputy to the Store Manager.',
    can: ['Everything a Supervisor can do', 'Stand in for the Store Manager']
  },
  store_manager: {
    key: 'store_manager', label: 'Store Manager', scope: 'store',
    summary: 'Runs a store.',
    can: ['Everything an Assistant Store Manager can do', 'See full store reports']
  },
  area_manager: {
    key: 'area_manager', label: 'Area Manager', scope: 'area',
    summary: 'Owns one or more areas.',
    can: ['Stats across assigned areas', 'Create store task templates']
  },
  support_admin: {
    key: 'support_admin', label: 'Store Support Administrator', scope: 'hq',
    summary: 'Back-office HO reviewer.',
    can: ['Review and resolve HO task records', 'Run reports across all stores']
  },
  buying_manager: {
    key: 'buying_manager', label: 'Buying Manager', scope: 'hq',
    summary: 'Full back-office access.',
    can: ['Full admin', 'Create store task templates', 'Review HO records']
  },
  buying_head: {
    key: 'buying_head', label: 'Buying Head', scope: 'hq',
    summary: 'Buying leadership.',
    can: ['All-store reports + dashboard', 'Create store task templates', 'Review HO records']
  },
  admin: {
    key: 'admin', label: 'Admin', scope: 'hq',
    summary: 'Top-level full access.',
    can: ['Everything in the app', 'Manage users and employees']
  }
}

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

// Per-employee feature toggles (Phase 9J)
export const canDoHQTasks    = (session) => !!session && session.can_access_hq_tasks    !== false
export const canDoStoreTasks = (session) => !!session && session.can_access_store_tasks !== false
