// Roles are stored as lowercase string enums on the users doc
// (e.g. "fleet_manager"). This registry is the single source of truth for
// how the portal treats each role.
//
// category:
//   'internal' — garage staff (sidebar: Quick Links / Core Ops / Data Mgmt)
//   'customer' — fleet customer (sidebar: Fleet / My Fleet / Quotations)
//
// defaultRoute — where to land after login.
// canBookServices — whether "+ Book a Service" appears (customer view only).

export const ROLE_REGISTRY = {
  // --- fleet customer side ---
  // Per the new flow: fleet clients no longer book directly. The MG Fleet
  // Manager (mg_fleet_manager, internal) books on their behalf and forwards
  // approved docs. Customer-side fleet_manager keeps quotation approval and
  // view-only access only.
  fleet_manager: {
    label: 'Fleet Manager (Client)',
    category: 'customer',
    defaultRoute: '/portal',
    canBookServices: false,
    canApproveQuotations: true,
  },
  fleet_user: {
    label: 'Fleet User',
    category: 'customer',
    defaultRoute: '/portal',
    canBookServices: false,
    canApproveQuotations: false,
  },
  customer: {
    label: 'Customer',
    category: 'customer',
    defaultRoute: '/portal',
    canBookServices: false,
    canApproveQuotations: false,
  },

  // --- MG Fleet (the team that coordinates between fleet clients and branches) ---
  mg_fleet_manager: {
    label: 'MG Fleet Manager',
    category: 'internal',
    defaultRoute: '/home',
    canBookServices: true,
    canForwardToClient: true,
  },

  // --- garage staff side ---
  // Confirmed in production (2026-04-22): most staff have role 'technician'.
  // The other internal roles below are registered for future use; create the
  // accounts in /admin/users when the workflow needs them.
  admin: { label: 'Admin', category: 'internal', defaultRoute: '/home' },
  branch_manager: { label: 'Branch Manager', category: 'internal', defaultRoute: '/home', canReviewAtBranch: true },
  admin_supervisor: { label: 'Admin Supervisor', category: 'internal', defaultRoute: '/home', canReviewAtBranch: true },
  call_center: { label: 'Call Center', category: 'internal', defaultRoute: '/home' },
  service_advisor: { label: 'Service Advisor', category: 'internal', defaultRoute: '/home' },
  floor_supervisor: { label: 'Floor Supervisor', category: 'internal', defaultRoute: '/home' },
  parts_man: { label: 'Parts Man', category: 'internal', defaultRoute: '/home' },
  finance: { label: 'Finance', category: 'internal', defaultRoute: '/home' },
  mechanic: { label: 'Mechanic', category: 'internal', defaultRoute: '/home' },
  field_assessor: { label: 'Field Assessor', category: 'internal', defaultRoute: '/home', canAssess: true },
  // Existing mg-fms users have role: 'technician'. Treated as a field assessor
  // for now — they're the same persona (the person doing the inspection).
  technician: { label: 'Technician', category: 'internal', defaultRoute: '/home', canAssess: true },
}

const normalize = (role) => String(role || '').toLowerCase().trim()

export const getRoleInfo = (role) => ROLE_REGISTRY[normalize(role)] || null

export const roleLabel = (role) => getRoleInfo(role)?.label || role || '—'

export const isInternal = (role) => getRoleInfo(role)?.category === 'internal'
export const isCustomer = (role) => getRoleInfo(role)?.category === 'customer'

export const canBookServices = (role) => Boolean(getRoleInfo(role)?.canBookServices)
export const canApproveQuotations = (role) =>
  Boolean(getRoleInfo(role)?.canApproveQuotations)
export const canReviewAtBranch = (role) => Boolean(getRoleInfo(role)?.canReviewAtBranch)
export const canAssess = (role) => Boolean(getRoleInfo(role)?.canAssess)
export const canForwardToClient = (role) => Boolean(getRoleInfo(role)?.canForwardToClient)

export const defaultRouteForRole = (role) => getRoleInfo(role)?.defaultRoute || '/login'

// For ProtectedRoute: pass a category instead of listing every role string.
export const INTERNAL_CATEGORY = 'internal'
export const CUSTOMER_CATEGORY = 'customer'

// True when the profile should ONLY see vetted (SENT_TO_CLIENT) data.
// Customer-category users without the is_admin escape hatch.
export const isClientView = (profile) =>
  Boolean(profile) && isCustomer(profile.role) && !profile.is_admin
