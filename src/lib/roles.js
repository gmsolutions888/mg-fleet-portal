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
//   serviceQuotation — Service Quotations (/quotations). 'read' = read-only.
//   branchInvoice    — Branch Invoices (/branch-invoices)
//   clientInvoice    — Client Invoices (/client-invoices)
//   creditNotes      — Credit Notes (/credit-notes)
//   reports          — Reports (/reports)
//   myGarage         — My Garage dashboard + My Mechanics (/home)
//   fleet            — Data Management > Fleet (/vehicles). 'read' = read-only.
//   customers        — Data Management > Customers (/customers). 'read' = read-only.
//   myFleet          — My Fleet (/portal/my-fleet)
//   clientDashboard  — Fleet client dashboard (/portal)
//   canApproveQuotations — Can approve/disapprove service quotations

export const ROLE_REGISTRY = {
  // --- internal (garage staff) ---

  // PDF Role 1: MG Fleet Manager — system-wide, all branches, all data
  general_manager: {
    label: 'MG Fleet Manager',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    bookingRequests: true,
    serviceRequest: true,
    serviceQuotation: true,
    branchInvoice: true,
    clientInvoice: true,
    creditNotes: true,
    reports: true,
    myGarage: true,
    fleet: true,
    customers: true,
  },

  // PDF Role 2: MG Fleet Finance — all branches, financial data only
  finance: {
    label: 'MG Fleet Finance',
    category: 'internal',
    defaultRoute: '/quotations',
    serviceQuotation: 'read',
    branchInvoice: true,
    clientInvoice: true,
    creditNotes: true,
    reports: true,
  },
  finance_head: {
    label: 'MG Fleet Finance Head',
    category: 'internal',
    defaultRoute: '/quotations',
    serviceQuotation: 'read',
    branchInvoice: true,
    clientInvoice: true,
    creditNotes: true,
    reports: true,
  },

  // PDF Role 3: Branch Admin Supervisor / Ops Manager — branch-scoped
  admin_supervisor: {
    label: 'Admin Supervisor',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    assessment: true,
    serviceRequest: true,
    serviceQuotation: true,
    unbilledQuotations: true,
    branchInvoice: true,
    reports: true,
    myGarage: true,
    mechanics: true,
  },
  operations_manager: {
    label: 'Operations Manager',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    serviceRequest: true,
    serviceQuotation: true,
    unbilledQuotations: true,
    branchInvoice: true,
    reports: true,
    myGarage: true,
    mechanics: true,
  },

  // PDF Role 4: Field Assessor / Warrior — assigned bookings only
  // No My Garage, My Mechanics, Service Bookings, Mechanics, or Services Offered
  field_assessor: {
    label: 'Field Assessor',
    category: 'internal',
    defaultRoute: '/home',
    assessment: true,
    serviceQuotation: true,
    myGarage: true,
  },
  warrior: {
    label: 'Warrior',
    category: 'internal',
    defaultRoute: '/appointments',
    assessment: true,
    serviceQuotation: true,
    myGarage: true,
  },
  dispatcher: {
    label: 'Dispatcher',
    category: 'internal',
    defaultRoute: '/appointments',
    assessment: true,
    serviceQuotation: true,
    myGarage: true,
  },

  // PDF Role 5: Call Center — branch-scoped, booking stages only
  call_center: {
    label: 'Call Center',
    category: 'internal',
    defaultRoute: '/booking-requests',
    booking: true,
    bookingRequests: true,
    myGarage: 'read',
    customers: 'read',
    fleet: 'read',
  },

  // Not in PDF — kept for backward compatibility with existing users
  admin_assistance: {
    label: 'Admin Assistance',
    category: 'internal',
    defaultRoute: '/home',
    booking: true,
    serviceRequest: true,
    serviceQuotation: true,
    unbilledQuotations: true,
    reports: true,
    myGarage: true,
  },

  // --- customer (fleet clients) ---

  // PDF Role 6: Fleet Client Manager — company-scoped approver
  fleet_client_manager: {
    label: 'Fleet Client Manager',
    category: 'customer',
    defaultRoute: '/portal',
    myFleet: true,
    clientDashboard: true,
    serviceQuotation: true,
    canApproveQuotations: true,
    clientInvoice: true,
    creditNotes: true,
    scheduleService: true,
  },

  // PDF Role 7: Fleet Client — company-scoped, booking + tracking only
  fleet_client: {
    label: 'Fleet Client',
    category: 'customer',
    defaultRoute: '/portal',
    myFleet: true,
    clientDashboard: true,
    serviceQuotation: 'read',
    booking: true,
    scheduleService: true,
  },

  // --- legacy / compatibility ---
  // Existing mg-fms users may have role: 'technician'. Treated as field_assessor.
  technician: {
    label: 'Technician',
    category: 'internal',
    defaultRoute: '/appointments',
    assessment: true,
    serviceQuotation: true,
  },
}

const normalize = (role) => String(role || '').toLowerCase().trim()

export const getRoleInfo = (role) => ROLE_REGISTRY[normalize(role)] || null

export const roleLabel = (role) => getRoleInfo(role)?.label || role || '—'

export const isInternal = (role) => getRoleInfo(role)?.category === 'internal'
export const isCustomer = (role) => getRoleInfo(role)?.category === 'customer'

// Feature permission helpers
// Permissions can be true (full access), 'read' (read-only), or falsy (no access).
export const canBooking = (role) => Boolean(getRoleInfo(role)?.booking)
export const canAssess = (role) => Boolean(getRoleInfo(role)?.assessment)
export const canServiceRequest = (role) => Boolean(getRoleInfo(role)?.serviceRequest)
export const canServiceQuotation = (role) => Boolean(getRoleInfo(role)?.serviceQuotation)
export const canServiceQuotationReadOnly = (role) => getRoleInfo(role)?.serviceQuotation === 'read'
export const canBookingRequests = (role) => Boolean(getRoleInfo(role)?.bookingRequests)
export const canUnbilledQuotations = (role) => Boolean(getRoleInfo(role)?.unbilledQuotations)
export const canBranchInvoice = (role) => Boolean(getRoleInfo(role)?.branchInvoice)
export const canClientInvoice = (role) => Boolean(getRoleInfo(role)?.clientInvoice)
export const canCreditNotes = (role) => Boolean(getRoleInfo(role)?.creditNotes)
export const canReports = (role) => Boolean(getRoleInfo(role)?.reports)
export const canMyGarage = (role) => Boolean(getRoleInfo(role)?.myGarage)
export const canFleet = (role) => Boolean(getRoleInfo(role)?.fleet)
export const canFleetReadOnly = (role) => getRoleInfo(role)?.fleet === 'read'
export const canCustomers = (role) => Boolean(getRoleInfo(role)?.customers)
export const canCustomersReadOnly = (role) => getRoleInfo(role)?.customers === 'read'
export const canMechanics = (role) => Boolean(getRoleInfo(role)?.mechanics)
export const canMyFleet = (role) => Boolean(getRoleInfo(role)?.myFleet)
export const canClientDashboard = (role) => Boolean(getRoleInfo(role)?.clientDashboard)
export const canApproveQuotations = (role) => Boolean(getRoleInfo(role)?.canApproveQuotations)
export const canScheduleService = (role) => Boolean(getRoleInfo(role)?.scheduleService)

// Back-compat aliases used by existing code
export const canBookServices = canBooking
export const canReviewAtBranch = (role) => {
  const r = normalize(role)
  return r === 'general_manager' || r === 'admin_supervisor' || r === 'operations_manager' || r === 'admin_assistance'
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
