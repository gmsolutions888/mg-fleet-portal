// Assessments = the shared roadworthiness/inspection collection. mg-fms writes
// here too, so field names and doc shape must match mg-fms exactly.
//
// Ports (from mg-fms-app/src/App.jsx):
//   - runEngine           (line 191)  — classification + dispatch rules
//   - RWA number format   (line 889)  — `RWA-YYYY-<last6 of Date.now()>`
//   - assessment shape    (line 894)  — { id, rwaNumber, header, itemResults,
//                                        classification, pmsData, fmsStatus,
//                                        submittedAt, resolvesRwa }
// And from mg-fms-app/src/firebase.js:
//   - sanitizeForFirestore (line 27)  — strip undefined before write.
//     FMS_KNOWN_ISSUES §1 flagged that NaN bypassed the original; this port
//     coerces NaN to null too.

import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { ALL_ITEMS } from './mgfms-catalog'
import { emitNotification } from './notifications'
import { trimPhotosToFit } from './photos'
import { REVIEW_STATUS } from './reviewStatus'

// Single-doc read by id. Returns the assessment doc + id, or null if missing.
// Used by the PMS form to auto-link "replaced" inspection items into the
// matching PMS items (mg-fms INSP_TO_PMS flow).
export async function getAssessmentById(id) {
  if (!db || !id) return null
  const snap = await getDoc(doc(db, 'assessments', id))
  if (!snap.exists()) return null
  return { _docId: snap.id, ...snap.data() }
}

// ── sanitizer ────────────────────────────────────────────────────────────
// Deep-walks any value and replaces `undefined` and `NaN` with `null`, which
// Firestore accepts. Arrays and plain objects recurse; primitives pass through.
export function sanitizeForFirestore(obj) {
  if (obj === undefined || obj === null) return null
  if (typeof obj === 'number' && Number.isNaN(obj)) return null
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore)
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, sanitizeForFirestore(v)]),
  )
}

// ── rule engine (port of mg-fms runEngine, v1.1) ─────────────────────────
export function runEngine(itemResults) {
  let hasFail = false, hasMonitor = false, hasCompliance = false
  const blockers = []
  let failCritCount = 0, monCount = 0, replacedCount = 0

  for (const item of ALL_ITEMS) {
    const r = itemResults?.[item.code]
    if (!r?.resultCode) continue
    if (r.resultCode === 'fail_critical') {
      hasFail = true
      failCritCount++
      if (item.isCompliance) hasCompliance = true
      if (item.isCritical || item.holdUnit) blockers.push(item.code)
    }
    if (r.resultCode === 'monitor') { hasMonitor = true; monCount++ }
    if (r.resultCode === 'replaced') { replacedCount++ }
  }

  const compliance = hasCompliance ? 'non_compliant' : 'compliant'
  let status, dispatch
  if (hasFail) { status = 'deferred'; dispatch = false }
  else if (hasMonitor) { status = 'conditional'; dispatch = true }
  else { status = 'active'; dispatch = true }

  let reassessmentDue = null
  if (status === 'deferred' || status === 'conditional') {
    const d = new Date()
    d.setDate(d.getDate() + (status === 'deferred' ? 3 : 30))
    reassessmentDue = d.toISOString().slice(0, 10)
  }

  return {
    overallStatus: status,
    technicalStatus: status,
    complianceStatus: compliance,
    dispatchAllowed: dispatch,
    dispatchBlockers: blockers,
    failCriticalCount: failCritCount,
    monitorCount: monCount,
    replacedCount,
    reassessmentRequired: hasFail || hasMonitor,
    reassessmentDue,
    totalBlockerCount: blockers.length,
  }
}

// ── RWA number ───────────────────────────────────────────────────────────
export function generateRwa(now = Date.now()) {
  const year = new Date(now).getFullYear()
  return `RWA-${year}-${String(now).slice(-6)}`
}

// ── write a new assessment + flip the appointment to DIAGNOSED ───────────
//
// payload: { appointmentId, header, itemResults, pmsData? }
//   header shape matches mg-fms `a.header`:
//     { plate, make, model, yearModel, client, branch, technician, odometer,
//       type, date }
//
// returns { id, rwaNumber, classification }
export async function createAssessment({ appointmentId, header, itemResults, pmsData }) {
  if (!db) throw new Error('Firestore not configured.')

  const now = Date.now()
  const rwaNumber = generateRwa(now)
  const classification = runEngine(itemResults || {})

  const assessment = {
    id: now, // mg-fms stores this alongside the auto doc id
    rwaNumber,
    header: { ...header },
    itemResults: { ...(itemResults || {}) },
    classification,
    pmsData: pmsData || null,
    fmsStatus: 'synced',
    submittedAt: new Date(now).toISOString(),
    appointmentId: appointmentId || null, // portal-only linkage
    createdBy: auth?.currentUser?.uid || null,
    // Branch admin must approve, then MG Fleet must forward, before clients see it.
    review_status: REVIEW_STATUS.SUBMITTED,
  }

  // Trim photos if the doc exceeds ~900KB, so we stay under Firestore's 1MiB
  // per-doc ceiling. mg-fms parity — see mg-fms-app/src/App.jsx:899.
  const ref = await addDoc(
    collection(db, 'assessments'),
    sanitizeForFirestore(trimPhotosToFit(assessment)),
  )

  // Flip the appointment to DIAGNOSED so the pipeline stage advances. This is
  // separate from updateAppointmentStatus because we also want to stamp the
  // RWA number onto the appointment for cross-linking.
  if (appointmentId) {
    try {
      await updateDoc(doc(db, 'appointments', appointmentId), sanitizeForFirestore({
        status: 'DIAGNOSED',
        rwaNumber,
        assessmentId: ref.id,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null,
      }))
    } catch (err) {
      console.warn('[assessments] failed to flip appointment → DIAGNOSED:', err)
    }
  }

  emitNotification({
    kind: 'status',
    title: `${header.plate} — diagnosed (${classification.overallStatus.toUpperCase()})`,
    body: classification.dispatchAllowed
      ? `${rwaNumber} · ${classification.failCriticalCount} critical · ${classification.monitorCount} monitor`
      : `${rwaNumber} · ⛔ Unit on hold`,
    plateNo: header.plate,
    appointmentId: appointmentId || null,
    link: `/assessments/${rwaNumber}`,
    branch: header.branch || null,
    company: header.client || null,
  })

  return { id: ref.id, rwaNumber, classification }
}
