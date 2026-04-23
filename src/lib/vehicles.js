// Vehicles lib. Derives the portal's "vehicle" view from mg-fms's shared
// Firestore collections (`assessments`, `pms_records`). Dummy data is used as
// a fallback so pages still render when the collections are empty or blocked.
//
// Key schema references (from FMS_ARCHITECTURE.md §2):
//   assessments/{auto_doc_id} {
//     submittedAt: string (ISO),
//     header: { plate, make, model, yearModel, client, branch, technician, odometer, date },
//     classification: { overallStatus: 'active' | 'conditional' | 'deferred', ... },
//     pmsData: { updates: { [pmsCode]: { lastDate, lastOdo, nextDate, nextOdo } } | null }
//   }
//   pms_records/{plate} {
//     [pmsCode]: { lastDate, lastOdo, nextDate, nextOdo, performedBy, ... }
//   }

import {
  collection, doc, getDoc, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from './firebase'
import { isVisibleToClient } from './reviewStatus'

export { vehicleImage } from './dummyData'

// -- plate / field normalizers ---------------------------------------------

export function normalizePlate(plate) {
  return String(plate || '').replace(/\s+/g, '').toUpperCase()
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

// Return the canonical "company" label from a user profile. Checks several
// field shapes so both enrollment-created users (company_id) and legacy mg-fms
// users (no company) can be handled.
export function profileCompany(profile) {
  return pick(profile, [
    'company_id', 'companyId', 'company', 'companyName', 'company_name',
    'fleet', 'fleetCompany', 'fleet_company', 'fleetAccount', 'fleet_account',
    'fleetName', 'fleet_name',
  ])
}

export function profileBranch(profile) {
  return pick(profile, ['branch', 'branchCode', 'branch_code'])
}

// -- roadworthy bucket + label ---------------------------------------------

export function roadworthyBucket(status) {
  const s = String(status ?? '').toLowerCase().trim()
  if (!s) return 'unknown'
  if (s === 'active' || s === 'roadworthy' || s === '1'
      || (s.includes('fit') && !s.includes('unfit') && !s.includes('limited'))) return 'active'
  if (s === 'conditional' || s.includes('minor') || s.includes('limited') || s.includes('observation') || s === '2' || s === '3') return 'minor'
  if (s === 'deferred' || s.includes('unfit') || s.includes('unroadworthy') || s.includes('unsafe') || s === '4') return 'unfit'
  return 'unknown'
}

export function roadworthyLabel(status) {
  switch (roadworthyBucket(status)) {
    case 'active': return 'Active / Roadworthy'
    case 'minor':  return 'Minor Repairs Needed & Under Observation'
    case 'unfit':  return 'Unfit for Use / Unroadworthy'
    default:       return status || 'Unknown'
  }
}

// -- date helpers (legacy API kept for any existing callers) ---------------

export function toDate(v) {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d }
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate()
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000)
  return null
}

export function formatDate(v) {
  const d = toDate(v); if (!d) return '-'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

export function daysUntil(v) {
  const d = toDate(v); if (!d) return null
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// -- core: merge assessments + pms_records into normalized vehicle records --

function latestByPlate(assessments) {
  const map = new Map()
  for (const a of assessments) {
    const plate = normalizePlate(a?.header?.plate)
    if (!plate) continue
    const prev = map.get(plate)
    const ts = Date.parse(a?.submittedAt || '') || 0
    if (!prev || (Date.parse(prev?.submittedAt || '') || 0) < ts) {
      map.set(plate, a)
    }
  }
  return map
}

function nextPmsFromRecord(record) {
  // pms_records/{plate} is an object keyed by PMS code. Find the earliest
  // `nextDate` across all codes — that's the "next service due".
  if (!record || typeof record !== 'object') return null
  let best = null
  for (const key of Object.keys(record)) {
    const entry = record[key]
    if (entry && typeof entry === 'object' && entry.nextDate) {
      const d = new Date(entry.nextDate)
      if (!isNaN(d) && (!best || d < best)) best = d
    }
  }
  return best
}

function recentServiceFromRecord(record) {
  if (!record || typeof record !== 'object') return null
  let best = null
  for (const key of Object.keys(record)) {
    const entry = record[key]
    if (entry && entry.lastDate) {
      const d = new Date(entry.lastDate)
      if (!isNaN(d) && (!best || d > best)) best = d
    }
  }
  return best
}

function odoFromRecord(record) {
  if (!record || typeof record !== 'object') return null
  let best = null
  for (const key of Object.keys(record)) {
    const entry = record[key]
    if (entry && typeof entry.lastOdo === 'number' && (!best || entry.lastOdo > best)) best = entry.lastOdo
  }
  return best
}

function overdueDays(nextPms) {
  const d = toDate(nextPms); if (!d) return null
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : null
}

// Build a normalized vehicle object from an assessment + optional pms_record.
function toVehicle(assessment, pmsRecord) {
  const h = assessment?.header || {}
  const cls = assessment?.classification || {}
  const plate = normalizePlate(h.plate)
  const odo = odoFromRecord(pmsRecord) ?? (Number(h.odometer) || 0)
  const nextPms = nextPmsFromRecord(pmsRecord)
  const recent = recentServiceFromRecord(pmsRecord) || (h.date ? new Date(h.date) : null)
  const bucket = roadworthyBucket(cls.overallStatus)
  return {
    plateNo: plate,
    brand: h.make || '',
    model: h.model || '',
    brandModel: h.make && h.model ? `${h.make} - ${h.model}` : (h.make || h.model || ''),
    yearModel: h.yearModel || '',
    assignedTo: h.technician || '',
    latestOdo: odo,
    roadworthy: bucket,
    company: h.client || null,
    branch: h.branch || null,
    nextPms: nextPms ? nextPms.toISOString() : null,
    recentService: recent ? recent.toISOString() : null,
    bookedSchedule: null,
    bookedBranch: null,
    overdueDays: overdueDays(nextPms),
    classification: cls,
    _raw: assessment,
  }
}

// Subscribe to the combined vehicle list. The callback is invoked whenever
// either collection updates. Returns an unsubscribe function.
//
//   watchVehicles({ company, branch, clientVisibleOnly }, cb)
//     cb({ vehicles, source, error, loading })
//       source: 'firestore' | 'unconfigured' | 'error'
//
// When company is provided, vehicles whose assessment's `header.client`
// doesn't match (case-insensitive) are dropped. When clientVisibleOnly is
// true, assessments whose review_status is not SENT_TO_CLIENT are dropped
// before the latest-per-plate calculation — fleet clients only see vetted
// data. No dummy fallback — if the Firestore read is empty or blocked, the
// callback reports it so the UI can show an empty state or an error banner.
export function watchVehicles(options, cb) {
  if (!db) {
    cb({ vehicles: [], source: 'unconfigured', error: null, loading: false })
    return () => {}
  }
  let assessments = []
  let pms = {}
  let ready = { a: false, p: false }

  const emit = () => {
    const visible = options?.clientVisibleOnly
      ? assessments.filter((a) => isVisibleToClient(a?.review_status))
      : assessments
    const latest = latestByPlate(visible)
    let rows = []
    for (const [plate, a] of latest) {
      rows.push(toVehicle(a, pms[plate]))
    }
    if (options?.company) {
      const target = String(options.company).toLowerCase().trim()
      rows = rows.filter((v) => (v.company || '').toLowerCase().trim() === target)
    }
    if (options?.branch) {
      const target = String(options.branch).toLowerCase().trim()
      rows = rows.filter((v) => (v.branch || '').toLowerCase().trim() === target)
    }
    cb({ vehicles: rows, source: 'firestore', error: null, loading: !(ready.a && ready.p) })
  }

  const onErr = (err) => {
    console.warn('[vehicles] listener error:', err?.code || err?.message)
    cb({ vehicles: [], source: 'error', error: err, loading: false })
  }

  const unsubA = onSnapshot(
    query(collection(db, 'assessments'), orderBy('submittedAt', 'desc')),
    (snap) => {
      assessments = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }))
      ready.a = true
      emit()
    },
    onErr,
  )
  const unsubP = onSnapshot(
    collection(db, 'pms_records'),
    (snap) => {
      const m = {}
      // Key pms by NORMALIZED plate (strip spaces) so assessment match works,
      // but preserve the raw doc id for any path that needs the original.
      for (const d of snap.docs) m[normalizePlate(d.id)] = { __rawId: d.id, ...d.data() }
      pms = m
      ready.p = true
      emit()
    },
    onErr,
  )

  return () => { try { unsubA() } catch {} try { unsubP() } catch {} }
}

// Fetch a single vehicle + service history for VehicleDetails drill-down.
// Returns { vehicle, history, source }. When Firestore has no record for the
// plate, returns { vehicle: null } so the page can show "not found".
//
// IMPORTANT: mg-fms stores plates WITH SPACES ("UFF 4915"). The URL param
// loses the space ("/vehicles/UFF4915"), so we must find the matching
// assessment by normalized comparison, then look up pms_records using the
// original plate (space and all) — the pms_records doc ID is the raw plate.
export async function loadVehicleWithHistory(plateRaw, options = {}) {
  const plate = normalizePlate(plateRaw)
  if (!db) return { vehicle: null, history: [], source: 'unconfigured' }
  try {
    const assessSnap = await new Promise((resolve, reject) => {
      const unsub = onSnapshot(
        query(collection(db, 'assessments'), orderBy('submittedAt', 'desc')),
        (s) => { unsub(); resolve(s) },
        (e) => { reject(e) },
      )
    })
    let matching = assessSnap.docs
      .map((d) => ({ _docId: d.id, ...d.data() }))
      .filter((a) => normalizePlate(a?.header?.plate) === plate)
    if (options.clientVisibleOnly) {
      matching = matching.filter((a) => isVisibleToClient(a?.review_status))
    }
    if (matching.length === 0) return { vehicle: null, history: [], source: 'firestore' }
    const originalPlate = matching[0]?.header?.plate || plate
    const pmsSnap = await getDoc(doc(db, 'pms_records', originalPlate))
    const pmsRecord = pmsSnap.exists() ? pmsSnap.data() : null
    const vehicle = toVehicle(matching[0], pmsRecord)
    const history = buildHistoryFromAssessments(matching, pmsRecord)
    return { vehicle, history, source: 'firestore' }
  } catch (err) {
    console.warn('[vehicles] detail load failed:', err)
    return { vehicle: null, history: [], source: 'error', error: err }
  }
}

function buildHistoryFromAssessments(assessments /* , pmsRecord */) {
  // One row per assessment / RWA, matching the MG-FMS "Assessment History"
  // card list in mg-fms-app/src/App.jsx:517.
  const sorted = [...assessments].sort(
    (x, y) => Date.parse(y.submittedAt || 0) - Date.parse(x.submittedAt || 0),
  )
  return sorted.map((a, i) => {
    const h = a?.header || {}
    const cls = a?.classification || {}
    return {
      rwa: a.rwaNumber || null,
      date: h.date || a.submittedAt || null,
      type: h.type || 'Assessment',
      technician: h.technician || '—',
      branch: h.branch || null,
      odometer: Number(h.odometer) || null,
      overallStatus: cls.overallStatus || null,
      failCriticalCount: cls.failCriticalCount || 0,
      monitorCount: cls.monitorCount || 0,
      dispatchAllowed: cls.dispatchAllowed !== false,
      supervisorCleared: Boolean(a.supervisorCleared),
      hasPms: Boolean(a.pmsData),
      resolvedByRwa: a.resolvedByRwa || null,
      isLatest: i === 0,
      // Detail payload used by the inline expand on VehicleDetails.
      itemResults: a.itemResults || {},
      pmsUpdates: a?.pmsData?.updates || {},
    }
  })
}

// Legacy API still used by the old MyFleet.jsx — kept for backward compat in
// case anything imports it. New code should use `watchVehicles` instead.
export async function loadVehiclesForUser(profile) {
  return new Promise((resolve) => {
    const unsub = watchVehicles(
      { company: profileCompany(profile), dummyFallback: true },
      ({ vehicles, source }) => {
        unsub()
        resolve({ rows: vehicles, source })
      },
    )
  })
}
