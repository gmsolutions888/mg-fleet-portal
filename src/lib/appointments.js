// Appointments = the "Service Bookings" queue. New portal collection; not
// shared with mg-fms.

import {
  addDoc, collection, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { emitNotification, fetchContextDoc } from './notifications'
import { hasApprovedQuotationForPlate } from './serviceReceipts'

const COLLECTION = 'appointments'

// Status state machine. Fleet bookings (created with a `company`) start at
// PENDING_BRANCH_APPROVAL — a branch reviewer must approve before the unit can
// be marked arrived. Walk-ins skip the approval gate (BOOKED → ARRIVED).
//   PENDING_BRANCH_APPROVAL → CONFIRMED → ARRIVED → ONGOING → DIAGNOSED → COMPLETED
//   (TENTATIVE remains as the legacy "uncertain whether customer will show up"
//    flag, orthogonal to the approval gate.)
export const APPT_STATUS = Object.freeze({
  PENDING_BOOKING: 'PENDING_BOOKING',
  PENDING_BRANCH_APPROVAL: 'PENDING_BRANCH_APPROVAL',
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  TENTATIVE: 'TENTATIVE',
  ARRIVED: 'ARRIVED',
  ONGOING: 'ONGOING',
  DIAGNOSED: 'DIAGNOSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  PENDING: 'PENDING',
  NO_SHOW: 'NO SHOW',
})

export function watchAppointments(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured', loading: false, error: null }); return () => {} }
  // Round 31 — dummy fallback removed; production users now see an
  // empty list when there's no real data.
  // Drop orderBy when filtered to avoid composite-index requirement.
  let q
  if (options?.branch) {
    q = query(collection(db, COLLECTION), where('branch', '==', options.branch))
  } else {
    q = query(collection(db, COLLECTION), orderBy('scheduledAt', 'desc'))
  }
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (options?.branch) {
        rows.sort((a, b) => {
          const ax = Date.parse(a?.scheduledAt || '') || 0
          const bx = Date.parse(b?.scheduledAt || '') || 0
          return bx - ax
        })
      }
      cb({ rows, source: 'firestore', loading: false, error: null })
    },
    (err) => {
      console.warn('[appointments] listener error:', err)
      cb({ rows: [], source: 'error', loading: false, error: err })
    },
  )
}

export async function createAppointment(payload) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  const now = new Date()
  const ref = await addDoc(collection(db, COLLECTION), {
    plateNo: (payload.plateNo || '').toUpperCase().replace(/\s+/g, ''),
    customer: payload.customer || '',
    customerType: payload.customerType || 'new',
    mobile: payload.mobile || '',
    company: payload.company || null,
    branch: payload.branch || 'MGCAVITE',
    mechanic: payload.mechanic || 'Not yet assigned',
    scheduledAt: payload.scheduledAt || now.toISOString(),
    scheduledTime: payload.scheduledTime || '8:00 AM',
    servicesInterested: payload.servicesInterested || [],
    customerIssues: payload.customerIssues || [],
    status: payload.status || (payload.company ? APPT_STATUS.PENDING_BRANCH_APPROVAL : APPT_STATUS.BOOKED),
    note: payload.note || 'SERVICE BOOKED',
    walkin: Boolean(payload.walkin),
    tentative: Boolean(payload.tentative),
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const plate = (payload.plateNo || '').toUpperCase().replace(/\s+/g, '')
  const fleet = Boolean(payload.company)
  emitNotification({
    kind: 'booking',
    title: fleet ? `New booking — ${plate}` : `Walk-in booking — ${plate}`,
    body: fleet
      ? `${payload.company} · ${payload.branch || 'MGCAVITE'} · ${payload.scheduledTime || ''}`.trim()
      : `${payload.customer || 'Walk-in'} · ${payload.branch || 'MGCAVITE'}`,
    plateNo: plate,
    appointmentId: ref.id,
    link: `/vehicles/${plate}`,
    branch: payload.branch || 'MGCAVITE',
    company: fleet ? payload.company : null,
  })
  return ref.id
}

export async function updateAppointmentStatus(id, nextStatus, note) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null

  // Round 11 gate — repair can only start on a fleet booking when the plate
  // has at least one APPROVED_FINAL quotation. Walk-ins (no company) skip
  // the gate by design. Pre-flight check so the UI gets a clear error before
  // Firestore gets the write.
  if (nextStatus === APPT_STATUS.ONGOING) {
    const current = await fetchContextDoc(COLLECTION, id)
    if (current?.company) {
      const approved = await hasApprovedQuotationForPlate(current.plateNo)
      if (!approved) {
        throw new Error('Cannot start repair: the quotation for this plate has not been fully approved yet.')
      }
    }
  }

  await updateDoc(doc(db, COLLECTION, id), {
    status: nextStatus,
    ...(note ? { note } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  // Only emit on milestone transitions so the feed doesn't flood.
  if (nextStatus === APPT_STATUS.ARRIVED) {
    const appt = await fetchContextDoc(COLLECTION, id)
    if (appt) {
      // Target the field assessors so the right person picks up the inspection.
      // The notification is still scoped to the branch (audience query) — the
      // target_roles tag just lets the inbox highlight relevant items.
      emitNotification({
        kind: 'arrival',
        title: `${appt.plateNo} — arrived, ready to assess`,
        body: `${appt.customer || ''} · ${appt.scheduledTime || ''}`.trim(),
        plateNo: appt.plateNo,
        appointmentId: id,
        link: `/appointments/${id}/assess`,
        branch: appt.branch || null,
        company: appt.company || null,
        target_roles: ['field_assessor', 'technician'],
      })
    }
  }
  if (nextStatus === APPT_STATUS.DIAGNOSED || nextStatus === APPT_STATUS.COMPLETED) {
    const appt = await fetchContextDoc(COLLECTION, id)
    if (appt) {
      const verb = nextStatus === APPT_STATUS.DIAGNOSED ? 'assessed' : 'service completed'
      emitNotification({
        kind: nextStatus === APPT_STATUS.COMPLETED ? 'service' : 'status',
        title: `${appt.plateNo} — ${verb}`,
        body: note || null,
        plateNo: appt.plateNo,
        appointmentId: id,
        link: `/vehicles/${appt.plateNo}`,
        branch: appt.branch || null,
        company: appt.company || null,
      })
    }
  }
}

// Active = anything still moving through the pipeline (not COMPLETED /
// CANCELLED / NO SHOW). Used by /vehicles/:plate to surface the in-flight
// booking so the user can jump straight to Assess.
const ACTIVE_STATUSES = [
  APPT_STATUS.PENDING_BRANCH_APPROVAL,
  APPT_STATUS.BOOKED,
  APPT_STATUS.CONFIRMED,
  APPT_STATUS.TENTATIVE,
  APPT_STATUS.ARRIVED,
  APPT_STATUS.ONGOING,
  APPT_STATUS.DIAGNOSED,
  APPT_STATUS.PENDING,
]

// One-shot fetch: active appointments for a plate, newest first. Returns []
// when none. Note: plate is normalized (uppercased + spaces stripped) at write
// time in createAppointment, so the input must already match that shape.
export async function getActiveAppointmentsByPlate(plate) {
  if (!db || !plate) return []
  const norm = String(plate).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('plateNo', '==', norm),
      where('status', 'in', ACTIVE_STATUSES),
    ))
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    rows.sort((a, b) => {
      const ax = Date.parse(a.scheduledAt || '') || 0
      const bx = Date.parse(b.scheduledAt || '') || 0
      return bx - ax
    })
    return rows
  } catch (err) {
    console.warn('[appointments] getActiveAppointmentsByPlate failed:', err)
    return []
  }
}

// Most recent appointment for a plate regardless of status. Used by the
// invoice gate-fail card to deep-link the user back into the assessment
// flow when the post-repair re-assessment hasn't happened yet.
export async function getMostRecentAppointmentByPlate(plate) {
  if (!db || !plate) return null
  const norm = String(plate).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('plateNo', '==', norm),
    ))
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    if (rows.length === 0) return null
    rows.sort((a, b) => {
      const ax = Date.parse(a.scheduledAt || '') || 0
      const bx = Date.parse(b.scheduledAt || '') || 0
      return bx - ax
    })
    return rows[0]
  } catch (err) {
    console.warn('[appointments] getMostRecentAppointmentByPlate failed:', err)
    return null
  }
}

// Branch admin approves a fleet booking → flips PENDING_BRANCH_APPROVAL to
// CONFIRMED and notifies the booking's MG Fleet manager (via branch + company
// audience). Caller is expected to have already gated on canReviewAtBranch /
// is_admin in the UI.
export async function approveBookingAtBranch(id) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, id), {
    status: APPT_STATUS.CONFIRMED,
    approvedBy: uid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const appt = await fetchContextDoc(COLLECTION, id)
  if (appt) {
    const plate = appt.plateNo
    const timeInfo = `${appt.scheduledTime || ''} · ${appt.branch || ''}`.trim()

    // Notify fleet client
    emitNotification({
      kind: 'booking',
      title: `Booking approved — ${plate}`,
      body: `Your vehicle ${plate} has been approved for service · ${timeInfo}`,
      plateNo: plate,
      appointmentId: id,
      link: '/portal/schedule-service',
      branch: null,
      company: appt.company || null,
      target_roles: ['fleet_client', 'fleet_client_manager'],
    })

    // Notify call center
    emitNotification({
      kind: 'booking',
      title: `Booking approved — ${plate}`,
      body: `Branch approved · ${appt.customer || 'Fleet client'} · ${timeInfo}`,
      plateNo: plate,
      appointmentId: id,
      link: '/booking-requests',
      branch: null,
      company: null,
      target_roles: ['call_center'],
    })

    // Notify branch (other branch staff)
    emitNotification({
      kind: 'booking',
      title: `Booking confirmed — ${plate}`,
      body: timeInfo,
      plateNo: plate,
      appointmentId: id,
      link: '/appointments',
      branch: appt.branch || null,
      company: null,
    })
  }
}

// Branch admin rejects a fleet booking → flips to CANCELLED with a reason.
// Caller is expected to gate on canReviewAtBranch / is_admin.
export async function rejectBookingAtBranch(id, reason) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  const note = reason ? `Rejected by branch: ${reason}` : 'Rejected by branch'
  await updateDoc(doc(db, COLLECTION, id), {
    status: APPT_STATUS.CANCELLED,
    rejectedBy: uid,
    rejectedAt: serverTimestamp(),
    rejectionReason: reason || null,
    note,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const appt = await fetchContextDoc(COLLECTION, id)
  if (appt) {
    const plate = appt.plateNo
    const reasonText = reason || 'No reason provided'

    // Notify fleet client
    emitNotification({
      kind: 'booking',
      title: `Booking rejected — ${plate}`,
      body: `Your booking for ${plate} was rejected · ${reasonText}`,
      plateNo: plate,
      appointmentId: id,
      link: '/portal/schedule-service',
      branch: null,
      company: appt.company || null,
      target_roles: ['fleet_client', 'fleet_client_manager'],
    })

    // Notify call center
    emitNotification({
      kind: 'booking',
      title: `Booking rejected — ${plate}`,
      body: `Branch rejected · ${appt.customer || 'Fleet client'} · ${reasonText}`,
      plateNo: plate,
      appointmentId: id,
      link: '/booking-requests',
      branch: null,
      company: null,
      target_roles: ['call_center'],
    })
  }
}

// Fleet client requests a booking — creates an appointment with PENDING_BOOKING
// status. Call center will assign the schedule. One appointment per plate.
export async function requestBooking(vehicles, profile) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  const company = profile?.company_id || profile?.company || null
  const clientName = profile?.name || profile?.email || 'Fleet Client'
  const ids = []

  for (const v of vehicles) {
    const plate = (v.plateNo || '').toUpperCase().replace(/\s+/g, '')
    if (!plate) continue
    const ref = await addDoc(collection(db, COLLECTION), {
      plateNo: plate,
      brandModel: v.brandModel || '',
      customer: clientName,
      company: company,
      branch: null,
      mechanic: 'Not yet assigned',
      scheduledAt: null,
      scheduledTime: null,
      status: APPT_STATUS.PENDING_BOOKING,
      note: v.notes || 'BOOKING REQUESTED BY FLEET CLIENT',
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
    ids.push(ref.id)

    emitNotification({
      kind: 'booking',
      title: `Booking request — ${plate}`,
      body: `${company || 'Fleet client'} · ${clientName} · pending schedule`,
      plateNo: plate,
      appointmentId: ref.id,
      link: `/appointments`,
      branch: null,
      company: null, // target internal staff, not the fleet client
      target_roles: ['call_center'],
    })
  }

  return ids
}

export async function assignMechanic(id, mechanicName) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, id), {
    mechanic: mechanicName || 'Not yet assigned',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const appt = await fetchContextDoc(COLLECTION, id)
  if (appt) {
    const plate = appt.plateNo
    const title = `${plate} assigned to ${mechanicName || 'Mechanic'}`

    // Notify branch users
    emitNotification({
      kind: 'status',
      title,
      body: `${appt.customer || 'Customer'} · ${appt.scheduledTime || ''} · ${appt.branch || ''}`.trim(),
      plateNo: plate,
      appointmentId: id,
      link: `/appointments`,
      branch: appt.branch || null,
      company: null,
      target_roles: ['admin_supervisor', 'admin_assistance', 'operations_manager'],
    })

    // Notify the assigned warrior/assessor directly — they pick this up
    // via the plateNo cross-reference in the warrior notification filter.
    emitNotification({
      kind: 'status',
      title: `${plate} assigned to ${mechanicName || 'Mechanic'}`,
      body: `${appt.customer || 'Customer'} · ${appt.branch || ''}`.trim(),
      plateNo: plate,
      appointmentId: id,
      link: `/home`,
      branch: appt.branch || null,
      company: null,
      target_roles: ['field_assessor', 'warrior', 'dispatcher', 'technician'],
    })
  }
}
