// Roles are stored as lowercase string enums on the users doc
// (e.g. "field_assessor"). This registry is the single source of truth for
// how the portal treats each role.
//
// category:
//   'internal' — garage staff (sidebar: Quick Links / Core Ops / Data Mgmt)
//   'customer' — fleet customer (sidebar: Fleet / My Fleet / Quotations)
//
// defaultRoute — where to land after login.
//
// Feature permissions — boolean flags that gate access to specific areas:
//   booking          — Service Bookings (/appointments)
//   assessment       — Vehicle assessment (/appointments/:id/assess, /pms)
//   serviceRequest   — Service Receipts (/service-receipts)
//   serviceQuotation — Service Quotations (/quotations)
//   reports          — Reports (/reports)
//   myGarage         — My Garage dashboard + My Mechanics (/home)
//   myFleet          — My Fleet (/portal/my-fleet)
//   clientDashboard  — Fleet client dashboard (/portal)
//   canApproveQuotations — Can approve/disapprove service quotations

export const ROLE_REGISTRY = {
  // --- internal (garage staff) ---
  general_manager: {
    label: 'General Manager',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    assessment: true,
    serviceRequest: true,
    serviceQuotation: true,
    reports: true,
    myGarage: true,
  },
  admin_assistance: {
    label: 'Admin Assistance',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    serviceRequest: true,
    serviceQuotation: true,
    reports: true,
    myGarage: true,
  },
  field_assessor: {
    label: 'Field Assessor',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    assessment: true,
    serviceRequest: true,
  },
  dispatcher: {
    label: 'Dispatcher',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    assessment: true,
    serviceRequest: true,
  },
  finance: {
    label: 'Finance',
    category: 'internal',
    defaultRoute: '/quotations',
    serviceQuotation: true,
    reports: true,
  },
  warrior: {
    label: 'Warrior',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    assessment: true,
    serviceRequest: true,
  },
  operations_manager: {
    label: 'Operations Manager',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    serviceRequest: true,
    serviceQuotation: true,
    reports: true,
    myGarage: true,
  },
  call_center: {
    label: 'Call Center',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    serviceQuotation: true,
  },
  admin_supervisor: {
    label: 'Admin Supervisor',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    assessment: true,
    serviceRequest: true,
    serviceQuotation: true,
  },
  finance_head: {
    label: 'Finance Head',
    category: 'internal',
    defaultRoute: '/quotations',
    serviceQuotation: true,
    reports: true,
  },

  // --- customer (fleet clients) ---
  fleet_client: {
    label: 'Fleet Client',
    category: 'customer',
    defaultRoute: '/portal',
    myFleet: true,
    clientDashboard: true,
    serviceQuotation: true,
    scheduleService: true,
  },
  fleet_client_manager: {
    label: 'Fleet Client Manager',
    category: 'customer',
    defaultRoute: '/portal',
    myFleet: true,
    clientDashboard: true,
    serviceQuotation: true,
    canApproveQuotations: true,
    scheduleService: true,
  },

  // --- legacy / compatibility ---
  // Existing mg-fms users may have role: 'technician'. Treated as field_assessor.
  technician: {
    label: 'Technician',
    category: 'internal',
    defaultRoute: '/appointments',
    booking: true,
    assessment: true,
    serviceRequest: true,
  },
}

const normalize = (role) => String(role || '').toLowerCase().trim()

export const getRoleInfo = (role) => ROLE_REGISTRY[normalize(role)] || null

export const roleLabel = (role) => getRoleInfo(role)?.label || role || '—'

export const isInternal = (role) => getRoleInfo(role)?.category === 'internal'
export const isCustomer = (role) => getRoleInfo(role)?.category === 'customer'

// Feature permission helpers
export const canBooking = (role) => Boolean(getRoleInfo(role)?.booking)
export const canAssess = (role) => Boolean(getRoleInfo(role)?.assessment)
export const canServiceRequest = (role) => Boolean(getRoleInfo(role)?.serviceRequest)
export const canServiceQuotation = (role) => Boolean(getRoleInfo(role)?.serviceQuotation)
export const canReports = (role) => Boolean(getRoleInfo(role)?.reports)
export const canMyGarage = (role) => Boolean(getRoleInfo(role)?.myGarage)
export const canMyFleet = (role) => Boolean(getRoleInfo(role)?.myFleet)
export const canClientDashboard = (role) => Boolean(getRoleInfo(role)?.clientDashboard)
export const canApproveQuotations = (role) => Boolean(getRoleInfo(role)?.canApproveQuotations)
export const canScheduleService = (role) => Boolean(getRoleInfo(role)?.scheduleService)

// Back-compat aliases used by existing code
export const canBookServices = canBooking
export const canReviewAtBranch = (role) => {
  const r = normalize(role)
  return r === 'general_manager' || r === 'admin_supervisor' || r === 'operations_manager'
}
export const canForwardToClient = (role) => {
  const r = normalize(role)
  return r === 'general_manager' || r === 'operations_manager' || r === 'call_center'
}

export const defaultRouteForRole = (role) => getRoleInfo(role)?.defaultRoute || '/login'

// For ProtectedRoute: pass a category instead of listing every role string.
export const INTERNAL_CATEGORY = 'internal'
export const CUSTOMER_CATEGORY = 'customer'

// True when the profile should ONLY see vetted (SENT_TO_CLIENT) data.
// Customer-category users without the is_admin escape hatch.
export const isClientView = (profile) =>
  Boolean(profile) && isCustomer(profile.role) && !profile.is_admin

// Check if a role has access to a specific permission.
// Used by ProtectedRoute for per-feature gating.
export const hasPermission = (role, permission) => Boolean(getRoleInfo(role)?.[permission])
