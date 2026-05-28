// Central dummy data for the UI-first build. Matches the figures in the
// developer's PNG mockups (MG Fleet Portal Screens/). When the enrollment flow
// is wired up later, this file becomes the fallback for unauthenticated/demo
// mode and real pages read from Firestore.

// Real mg-fms branches (src/App.jsx:9 in mg-fms-app/)
export const BRANCHES = ['MGCAVITE', 'MGQUEZON CITY', 'MGPAMPANGA', 'MGDAVAO', 'MGPALAWAN', 'MGBATANGAS']

// Real mg-fms fleet clients (src/App.jsx:10 in mg-fms-app/). The `name` field
// must EXACTLY equal mg-fms's `header.client` string (including the em-dash in
// "Purefoods — San Miguel Corporation") or the portal's filter won't match.
export const MGFMS_CLIENTS = [
  { code: 'PUREFOODS',   name: 'Purefoods — San Miguel Corporation' },
  { code: 'NATL_MUSEUM', name: 'National Museum of the Philippines' },
  { code: 'CHINABANK',   name: 'China Banking Corporation' },
]

// Back-compat alias — anything that used to import FLEET_COMPANIES now gets
// the real mg-fms clients.
export const FLEET_COMPANIES = MGFMS_CLIENTS

export const MECHANICS = [
  { id: 'm1',  name: 'Amelia Castillo',  assigned: 1 },
  { id: 'm2',  name: 'Aria Delgado',     assigned: 0 },
  { id: 'm3',  name: 'Ava Lopez',        assigned: 0 },
  { id: 'm4',  name: 'Benjamin Rivera',  assigned: 1 },
  { id: 'm5',  name: 'Charlotte Cruz',   assigned: 0 },
  { id: 'm6',  name: 'Aria Morales',     assigned: 1 },
  { id: 'm7',  name: 'Oliver Santos',    assigned: 0 },
  { id: 'm8',  name: 'Luna Reyes',       assigned: 0 },
]

export const CUSTOMERS = [
  { id: 'c1',  name: 'Customer 100',     phone: '09649109931', type: 'fleet', company: 'PUREFOODS' },
  { id: 'c2',  name: 'Mateo Guzman',     phone: '09171234567', type: 'fleet', company: 'PUREFOODS' },
  { id: 'c3',  name: 'Henry Dominguez',  phone: '09171234568', type: 'fleet', company: 'PUREFOODS' },
  { id: 'c4',  name: 'Ezra Rivera',      phone: '09171234569', type: 'walkin' },
  { id: 'c5',  name: 'Luke Dela Cruz',   phone: '09171234570', type: 'walkin' },
  { id: 'c6',  name: 'Sophia Santos',    phone: '09171234571', type: 'fleet', company: 'PUREFOODS' },
  { id: 'c7',  name: 'Isabella Cruz',    phone: '09171234572', type: 'fleet', company: 'PUREFOODS' },
  { id: 'c8',  name: 'Harper Dela Cruz', phone: '09171234573', type: 'fleet', company: 'PUREFOODS' },
]

// NOTE: dummy VEHICLES removed. Vehicles are now read exclusively from the
// shared mg-fms Firestore (`assessments` + `pms_records`) via `watchVehicles`
// in `src/lib/vehicles.js`. Pages handle an empty list with a clean empty
// state instead of a fallback.

// Appointments — at the top-of-garage "today" board (October 9, 2025)
// status options: BOOKED | ARRIVED | DIAGNOSED | ONGOING | PENDING | COMPLETED
export const APPOINTMENTS = [
  {
    id: 'a1',
    plateNo: 'AEG1638',
    status: 'ONGOING',
    arrivedAt: '2025-10-06T15:27:00',
    durationDays: 3,
    customer: 'Mateo Guzman',
    mechanic: 'Not yet assigned',
    note: 'REPAIR STARTED',
    noteAgeMinutes: 40,
  },
  {
    id: 'a2',
    plateNo: 'XMJ7360',
    status: 'ARRIVED',
    arrivedAt: '2025-10-05T23:54:00',
    durationDays: 3,
    customer: 'Henry Dominguez',
    mechanic: 'Benjamin Rivera',
    note: 'ARRIVED AT MGBACOOR',
    noteAgeDays: 3,
  },
  {
    id: 'a3',
    plateNo: 'SFF6009',
    status: 'ARRIVED',
    arrivedAt: '2025-10-05T23:54:00',
    durationDays: 3,
    customer: 'Ezra Rivera',
    mechanic: 'Amelia Castillo',
    note: 'ARRIVED AT MGBACOOR',
    noteAgeDays: 3,
  },
  {
    id: 'a4',
    plateNo: 'HHZ1939',
    status: 'COMPLETED',
    arrivedAt: null,
    durationDays: 0,
    customer: 'Luke Dela Cruz',
    mechanic: 'Amelia Castillo',
    note: 'PMS COMPLETED',
    noteAgeMinutes: 2,
  },
  {
    id: 'a5',
    plateNo: 'BYS6150',
    status: 'PENDING',
    arrivedAt: '2025-10-09T09:30:00',
    durationDays: 0,
    customer: 'Ella Bautista',
    mechanic: 'Not yet assigned',
    note: 'Awaiting customer confirmation',
    noteAgeMinutes: 10,
  },
]

export const SERVICE_RECEIPTS = [
  {
    id: 'sr1',
    code: 'Q-MGCAVITE-1',
    plateNo: 'UFF4915',
    customer: 'Customer 100',
    mobile: '09649109931',
    brandModel: 'Toyota - Vios',
    latestOdo: 165306,
    mechanic: 'Amelia Castillo',
    personInCharge: 'Aria Morales',
    scheduleType: 'SCHEDULED',
    dateCreated: '2025-10-06',
    missingParts: 1,
    status: 'OPEN',
    items: [
      { type: 'Labor', qty: 1, description: 'PREVENTIVE MAINTENANCE SERVICE', unitCost: 2500, subTotal: 2500 },
      { type: 'Labor', qty: 1, description: 'REPLACE ENGINE SUPPORT',         unitCost: 800,  subTotal: 800 },
      { type: 'Parts', qty: 1, description: 'ENGINE SUPPORT FOR VIOS',        unitCost: 1200, subTotal: 1200 },
      { type: 'Parts', qty: 1, description: 'US LUBE GASOLINE',               unitCost: 250,  subTotal: 250 },
      { type: 'Parts', qty: 1, description: 'ENGINE FILTER',                  unitCost: 500,  subTotal: 500 },
      { type: 'Parts', qty: 1, description: 'CABIN FILTER',                   unitCost: 350,  subTotal: 350 },
      { type: 'Parts', qty: 2, description: 'DRY RAG',                        unitCost: 10,   subTotal: 20 },
    ],
    laborTotal: 3300,
    materialsTotal: 2320,
    estimatedTotal: 5620,
  },
]

// Service history rows for a given plate — shown on Vehicle Details page.
export const SERVICE_HISTORY = [
  {
    plateNo: 'UFF4915',
    rows: [
      { date: '2025-10-05', performedBy: 'MGCAVITE',    service: 'PREVENTIVE MAINTENANCE SERVICE; UNDER CHASSIS – REPLACE ENGINE SUPPORT', details: 'REPLACE LEFT ENGINE SUPPORT (FOR VIOS 2003)', odometer: 165306, receipt: 'Q-MGCAVITE-1', status: 'COMPLETED' },
      { date: '2025-08-24', performedBy: 'OUTSIDE MG', service: 'Tire Replacement',      details: 'Replaced 2 rear tires' },
      { date: '2025-08-09', performedBy: 'OUTSIDE MG', service: 'Transmission Service', details: 'Replaced ATF fluid' },
      { date: '2025-07-25', performedBy: 'OUTSIDE MG', service: 'Brake Service',        details: 'Replaced rear brake pads' },
      { date: '2025-07-10', performedBy: 'OUTSIDE MG', service: 'Spark Plug Replacement', details: 'Installed new spark plugs' },
      { date: '2025-06-25', performedBy: 'OUTSIDE MG', service: 'Oil Change',           details: 'Changed engine oil and filter' },
    ],
  },
]

// Status-log entries shown on the Vehicle Service Update side panel.
export const SERVICE_UPDATES = {
  HHZ1939: [
    { date: '10/09', tag: 'COMPLETED', label: 'PMS COMPLETED' },
    { date: null,    tag: 'ONGOING',   label: 'PMS STARTED' },
    { date: '10/06', tag: 'POST',      label: 'TEST NOTES' },
    { date: '10/05', tag: 'DIAGNOSED', label: 'DIAGNOSIS: PMS ONLY' },
    { date: null,    tag: 'BOOKED',    label: 'SERVICE BOOKED' },
  ],
}

// Utility: map a vehicle model to its photo URL under /public/assets/cars_img/
// Falls back to default.png if no dedicated image exists.
const CAR_IMG_MODELS = new Set([
  'Accent', 'Altis', 'BR-V', 'Bus', 'CR-V', 'Canter', 'City', 'Civic', 'Crosswind',
  'Fortuner', 'Harabas', 'Hilux', 'Innova', 'Jazz', 'Montero', 'NV350', 'Navara',
  'Outlander', 'Strada', 'Transvan', 'Vios', 'Wigo', 'Xpander',
])

export function vehicleImage(model) {
  if (!model) return '/assets/cars_img/default.png'
  const cleaned = String(model).trim()
  return CAR_IMG_MODELS.has(cleaned)
    ? `/assets/cars_img/${cleaned}.jpg`
    : '/assets/cars_img/default.png'
}

// Summary helpers
export function fleetStats(vehicles) {
  let total = vehicles.length, active = 0, minor = 0, unfit = 0
  for (const v of vehicles) {
    if (v.roadworthy === 'active') active++
    else if (v.roadworthy === 'minor') minor++
    else if (v.roadworthy === 'unfit') unfit++
  }
  return { total, active, minor, unfit }
}

export function pmStats(vehicles, now = new Date()) {
  let dueThisMonth = 0, scheduled = 0, overdue = 0
  const m = now.getMonth(), y = now.getFullYear()
  for (const v of vehicles) {
    if (v.nextPms) {
      const d = new Date(v.nextPms)
      if (!isNaN(d)) {
        if (d < now && (now - d) / 86400000 > 0) overdue++
        if (d.getMonth() === m && d.getFullYear() === y) dueThisMonth++
      }
    }
    if (v.bookedSchedule) scheduled++
  }
  return { dueThisMonth, scheduled, overdue }
}

export function formatDate(v) {
  if (!v) return '-'
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) return '-'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

export function formatDateTime(v) {
  if (!v) return '-'
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) return '-'
  const date = formatDate(d)
  let hh = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  const ampm = hh >= 12 ? 'PM' : 'AM'
  hh = hh % 12; if (hh === 0) hh = 12
  return `${date} ${hh}:${min} ${ampm}`
}

export function formatMoney(n) {
  if (n == null) return '-'
  return '₱' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
