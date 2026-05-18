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

import {
  addDoc, collection, doc, getDoc, getDocs, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
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

// Latest assessment for a plate, ignoring resolved ones by default. Used by
// Re-Assessment: we want to pre-fill from whatever the most recent inspection
// said. Plates are normalized to uppercase no-space so queries match mg-fms's
// write format.
export async function getLatestAssessmentForPlate(plateRaw) {
  if (!db || !plateRaw) return null
  const plate = String(plateRaw).toUpperCase().replace(/\s+/g, '')
  try {
    // Fire one broad query (no composite index needed) and filter client-side.
    // Plate counts are small enough per customer that this is fine.
    const snap = await getDocs(query(collection(db, 'assessments'), orderBy('submittedAt', 'desc')))
    // First try unresolved
    for (const d of snap.docs) {
      const data = d.data()
      const p = String(data?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
      if (p === plate && !data.resolvedByRwa) return { _docId: d.id, ...data }
    }
    // Fallback: return the most recent even if resolved (needed for Re-Assessment)
    for (const d of snap.docs) {
      const data = d.data()
      const p = String(data?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
      if (p === plate) return { _docId: d.id, ...data }
    }
    return null
  } catch (err) {
    console.warn('[assessments] getLatestAssessmentForPlate failed:', err?.message || err)
    return null
  }
}

// Every assessment for a plate, newest first. Used by finance features
// (Round 12 invoicing gate) to check for a post-repair reassessment. Same
// scan-and-filter pattern as getOutstandingDeferredForPlate — fine at
// fleet-customer scale, fold into an indexed `header.plate` field later
// if the assessments collection grows past ~low thousands.
export async function getAssessmentsForPlate(plateRaw) {
  if (!db || !plateRaw) return []
  const plate = String(plateRaw).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(
      collection(db, 'assessments'),
      orderBy('submittedAt', 'desc'),
    ))
    const out = []
    for (const d of snap.docs) {
      const data = d.data()
      const p = String(data?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
      if (p === plate) out.push({ _docId: d.id, ...data })
    }
    return out
  } catch (err) {
    console.warn('[assessments] getAssessmentsForPlate failed:', err?.message || err)
    return []
  }
}

// All outstanding (not-yet-resolved) deferred assessments for a plate. Used
// when submitting a Re-Assessment that comes back active/conditional — we
// stamp resolvedByRwa/resolvedAt on these so the fleet view stops flagging
// them.
export async function getOutstandingDeferredForPlate(plateRaw) {
  if (!db || !plateRaw) return []
  const plate = String(plateRaw).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(collection(db, 'assessments'), orderBy('submittedAt', 'desc')))
    const out = []
    for (const d of snap.docs) {
      const data = d.data()
      const p = String(data?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
      if (p !== plate) continue
      if (data.resolvedByRwa) continue
      if (data?.classification?.overallStatus !== 'deferred') continue
      out.push({ _docId: d.id, ...data })
    }
    return out
  } catch (err) {
    console.warn('[assessments] getOutstandingDeferredForPlate failed:', err?.message || err)
    return []
  }
}

// Supervisor override — lets a branch admin release a unit whose assessment
// was flagged dispatch-blocked, by stamping a clearance record on the
// assessment doc. The original `classification.dispatchAllowed: false` is
// preserved on purpose so the audit trail stays honest ("originally blocked,
// overridden by X on Y") — consumers gate on `supervisorCleared` separately.
//
// Field names match what AssessmentView already renders for historic cleared
// units (supervisorName / supervisorTs / supervisorRemarks) so mg-fms can
// keep displaying either side's overrides.
//
// payload: { name, remarks }
//   remarks is required (the "why") and trimmed before write.
//
// Internal-only — no fleet-client notification on override.
export async function clearDispatchBySupervisor(assessmentDocId, { name, remarks }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!assessmentDocId) throw new Error('Missing assessment id.')
  const reason = (remarks || '').trim()
  if (!reason) throw new Error('A reason is required for supervisor override.')

  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()

  await updateDoc(doc(db, 'assessments', assessmentDocId), sanitizeForFirestore({
    supervisorCleared: true,
    supervisorClearedBy: uid,
    supervisorName: name || null,
    supervisorTs: nowIso,
    supervisorRemarks: reason,
  }))

  // Re-fetch so the notification body can quote the plate + RWA. Failure here
  // is non-fatal; the override already landed.
  try {
    const snap = await getDoc(doc(db, 'assessments', assessmentDocId))
    if (snap.exists()) {
      const a = snap.data()
      emitNotification({
        kind: 'status',
        title: `⚠ Manual clearance — ${a.header?.plate || 'unit'}`,
        body: `${a.rwaNumber || ''} cleared by ${name || 'supervisor'}: ${reason.slice(0, 120)}`.trim(),
        plateNo: a.header?.plate || null,
        appointmentId: a.appointmentId || null,
        link: `/assessments/${a.rwaNumber || ''}`,
        branch: a.header?.branch || null,
        // Internal audit only — do NOT notify the fleet client on manual override.
        company: null,
      })
    }
  } catch (err) {
    console.warn('[assessments] override notification skipped:', err?.message || err)
  }

  return { id: assessmentDocId, at: nowIso, reason }
}

// Stamp resolvedByRwa / resolvedAt onto a list of assessment docs. Returns
// the count of writes that succeeded. Doesn't throw on individual failures —
// we don't want one bad doc to block the main re-assessment submit.
export async function markAssessmentsResolved(docs, byRwa, atIso) {
  if (!db || !Array.isArray(docs) || docs.length === 0) return 0
  let n = 0
  for (const d of docs) {
    if (!d?._docId) continue
    try {
      await updateDoc(doc(db, 'assessments', d._docId), {
        resolvedByRwa: byRwa,
        resolvedAt: atIso,
      })
      n++
    } catch (err) {
      console.warn('[assessments] resolve failed for', d.rwaNumber, err?.message || err)
    }
  }
  return n
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
export async function createAssessment({ appointmentId, header, itemResults, pmsData, labors, otherLabor, ecuScan }) {
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
    // Round 18 — labor types declared at assessment time. Used by the
    // smart-quote prefill to bundle multiple inspection findings under
    // one labor line (e.g. several PMS items → one "Preventive
    // Maintenance Service" line). Optional — older assessments without
    // this field still work; the prefill falls back to per-item labor.
    labors: Array.isArray(labors) ? labors : null,
    otherLabor: otherLabor || null,
    ecuScan: ecuScan || null,
    fmsStatus: 'synced',
    submittedAt: new Date(now).toISOString(),
    appointmentId: appointmentId || null, // portal-only linkage
    createdBy: auth?.currentUser?.uid || null,
    // Branch admin must approve, then MG Fleet must forward, before clients see it.
    review_status: REVIEW_STATUS.SUBMITTED,
  }

  // Auto-resolve linkage: when a Re-Assessment comes back active or
  // conditional, any outstanding deferred assessments for this plate get
  // stamped resolvedByRwa + resolvedAt so the fleet view stops flagging
  // them. Port of mg-fms-app/src/App.jsx:891–898.
  let resolvesRwa = null
  let resolvesRwaList = null
  if (header.type === 'Re-Assessment' && classification.overallStatus !== 'deferred') {
    try {
      const outstanding = await getOutstandingDeferredForPlate(header.plate)
      if (outstanding.length > 0) {
        resolvesRwa = outstanding[0].rwaNumber || null
        resolvesRwaList = outstanding.map((d) => d.rwaNumber).filter(Boolean)
        if (resolvesRwaList.length <= 1) resolvesRwaList = null
      }
      // Flag on the new assessment so the detail view can show what it closed.
      if (resolvesRwa) assessment.resolvesRwa = resolvesRwa
      if (resolvesRwaList) assessment.resolvesRwaList = resolvesRwaList
    } catch (err) {
      console.warn('[assessments] resolve-lookup failed:', err?.message || err)
    }
  }

  // Trim photos if the doc exceeds ~900KB, so we stay under Firestore's 1MiB
  // per-doc ceiling. mg-fms parity — see mg-fms-app/src/App.jsx:899.
  const ref = await addDoc(
    collection(db, 'assessments'),
    sanitizeForFirestore(trimPhotosToFit(assessment)),
  )

  // Now stamp the resolved pointer on the deferred docs themselves. Done
  // AFTER the new doc lands so its RWA number is real. Failures here only
  // log a warning — the new assessment is already saved.
  if (resolvesRwa) {
    try {
      const outstanding = await getOutstandingDeferredForPlate(header.plate)
      if (outstanding.length > 0) {
        await markAssessmentsResolved(outstanding, rwaNumber, new Date(now).toISOString())
      }
    } catch (err) {
      console.warn('[assessments] resolve-stamp failed:', err?.message || err)
    }
  }

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

  const isReAssessment = header.type === 'Re-Assessment'
  const isQuickFix = pmsData?.notes === 'Quick Fix'
  const hasReplacedItems = Object.values(assessment.itemResults || {}).some((r) => r.resultCode === 'replaced')

  if (isReAssessment || isQuickFix || hasReplacedItems) {
    // Re-Assessment or Quick Fix — notify branch that fixes are done, ready to invoice
    const fixType = isQuickFix ? 'Quick fix' : 'Re-assessment'
    emitNotification({
      kind: 'status',
      title: `${header.plate} — ${fixType} completed. Ready to invoice`,
      body: `${rwaNumber} · ${fixType} by ${header.technician || 'assessor'}`,
      plateNo: header.plate,
      appointmentId: appointmentId || null,
      link: `/assessments/${rwaNumber}`,
      branch: header.branch || null,
      company: null,
      target_roles: ['admin_supervisor', 'admin_assistance', 'operations_manager'],
    })
  } else {
    // Initial / Periodic assessment
    emitNotification({
      kind: 'status',
      title: `${header.plate} — assessed (${classification.overallStatus.toUpperCase()})`,
      body: classification.dispatchAllowed
        ? `${rwaNumber} · ${classification.failCriticalCount} critical · ${classification.monitorCount} monitor`
        : `${rwaNumber} · ⛔ Unit on hold`,
      plateNo: header.plate,
      appointmentId: appointmentId || null,
      link: `/assessments/${rwaNumber}`,
      branch: header.branch || null,
      company: header.client || null,
    })

    // Notify branch supervisors that assessment is ready for quotation
    emitNotification({
      kind: 'quotation',
      title: `${header.plate} — ready for quotation`,
      body: `${rwaNumber} · Assessment completed by ${header.technician || 'assessor'} · awaiting quotation`,
      plateNo: header.plate,
      appointmentId: appointmentId || null,
      link: `/assessments/${rwaNumber}`,
      branch: header.branch || null,
      company: null,
      target_roles: ['admin_supervisor', 'admin_assistance', 'operations_manager'],
    })
  }

  return { id: ref.id, rwaNumber, classification }
}
