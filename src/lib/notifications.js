// Notifications = cross-actor event feed. One doc per event; each doc carries
// audience routing fields (branch, company, forAdmins) and a per-user readBy[]
// array. Query path per role:
//   admin      → no filter (sees all)
//   staff 1-7  → where('branch', '==', profile.branch)
//   fleet 8-9  → where('company', '==', profile.company_id)
//
// A single doc can match multiple audience queries simultaneously. emitNotification
// is called by the other mutation libs (appointments, serviceReceipts,
// serviceUpdates); it fails quiet so the parent write still succeeds if
// notifications collection is denied by rules.

import {
  addDoc, arrayUnion, collection, doc, getDoc, limit, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { isCustomer } from './roles'

const WARRIOR_ROLES = new Set(['field_assessor', 'warrior', 'dispatcher', 'technician'])

const COLLECTION = 'notifications'
const LIST_LIMIT = 50

// Queries use single-field where() only — no composite indexes required.
// Sorting + limiting is done client-side in watchNotifications.
function audienceQuery(profile) {
  const base = collection(db, COLLECTION)
  const role = String(profile?.role || '').toLowerCase().trim()
  if (profile?.is_admin || role === 'general_manager' || role === 'finance' || role === 'finance_head') {
    return query(base, orderBy('createdAt', 'desc'), limit(LIST_LIMIT))
  }
  // Fleet clients — fetch all notifications with a company field set,
  // then filter client-side for flexible company matching.
  if (isCustomer(role)) {
    return { _customerFilter: true, base }
  }
  if (role === 'call_center') {
    return query(base, where('kind', '==', 'booking'))
  }
  if (profile?.branch) {
    return query(base, where('branch', '==', profile.branch))
  }
  if (!isCustomer(role)) {
    return query(base, where('kind', '==', 'booking'))
  }
  return null
}

export function watchNotifications(profile, cb) {
  if (!db || !profile) {
    cb({ rows: [], loading: false, error: null, source: db ? 'no-profile' : 'unconfigured' })
    return () => {}
  }
  const q = audienceQuery(profile)
  if (!q) {
    cb({ rows: [], loading: false, error: null, source: 'no-audience' })
    return () => {}
  }

  const role = String(profile?.role || '').toLowerCase().trim()
  const isWarrior = WARRIOR_ROLES.has(role)

  // Fleet client — fetch all, filter client-side by company (flexible match)
  if (q._customerFilter) {
    const companyId = (profile?.company_id || profile?.company || '').toLowerCase().trim()
    return onSnapshot(
      query(q.base),
      (snap) => {
        const uid = auth?.currentUser?.uid
        const rows = snap.docs
          .map((d) => {
            const data = { id: d.id, ...d.data() }
            data.read = uid ? (Array.isArray(data.readBy) && data.readBy.includes(uid)) : false
            return data
          })
          .filter((n) => {
            if (!n.company) return false
            const nc = n.company.toLowerCase().trim()
            return nc === companyId || nc.includes(companyId) || companyId.includes(nc)
          })
        rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
          return tb - ta
        })
        cb({ rows: rows.slice(0, LIST_LIMIT), loading: false, error: null, source: 'firestore' })
      },
      (err) => {
        console.warn('[notifications] listener error:', err)
        cb({ rows: [], loading: false, error: err, source: 'error' })
      },
    )
  }

  // Warriors need to cross-reference with their assigned appointments
  // to filter notifications to only their vehicles.
  if (isWarrior) {
    let notifRows = []
    let assignedPlates = new Set()
    let assignedIds = new Set()
    let readyN = false
    let readyA = false

    const emitFiltered = () => {
      if (!readyN || !readyA) return
      const uid = auth?.currentUser?.uid
      const filtered = notifRows.filter((n) => {
        // Show if the notification is about a vehicle assigned to this warrior
        if (n.plateNo && assignedPlates.has(n.plateNo.toUpperCase())) return true
        // Show if the notification references an appointment assigned to them
        if (n.appointmentId && assignedIds.has(n.appointmentId)) return true
        // Show if the notification was created by this user
        if (uid && n.createdBy === uid) return true
        return false
      })
      filtered.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return tb - ta
      })
      cb({ rows: filtered.slice(0, LIST_LIMIT), loading: false, error: null, source: 'firestore' })
    }

    const unsubN = onSnapshot(q, (snap) => {
      const uid = auth?.currentUser?.uid
      notifRows = snap.docs.map((d) => {
        const data = { id: d.id, ...d.data() }
        data.read = uid ? (Array.isArray(data.readBy) && data.readBy.includes(uid)) : false
        return data
      })
      readyN = true
      emitFiltered()
    }, (err) => {
      console.warn('[notifications] listener error:', err)
      cb({ rows: [], loading: false, error: err, source: 'error' })
    })

    // Watch appointments to know which plates/IDs are assigned to this warrior
    const mechanicName = (profile.name || '').toLowerCase().trim()
    const uid = auth?.currentUser?.uid
    const unsubA = onSnapshot(collection(db, 'appointments'), (snap) => {
      const plates = new Set()
      const ids = new Set()
      for (const d of snap.docs) {
        const a = d.data()
        const mech = (a.mechanic || '').toLowerCase().trim()
        if (mech === mechanicName || a.createdBy === uid) {
          plates.add((a.plateNo || '').toUpperCase())
          ids.add(d.id)
        }
      }
      assignedPlates = plates
      assignedIds = ids
      readyA = true
      emitFiltered()
    })

    return () => { unsubN(); unsubA() }
  }

  // Non-warrior roles — standard notification feed
  return onSnapshot(
    q,
    (snap) => {
      const uid = auth?.currentUser?.uid
      const rows = snap.docs.map((d) => {
        const data = { id: d.id, ...d.data() }
        data.read = uid ? (Array.isArray(data.readBy) && data.readBy.includes(uid)) : false
        return data
      })
      // Sort by createdAt descending and limit client-side
      rows.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0)
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0)
        return tb - ta
      })
      cb({ rows: rows.slice(0, LIST_LIMIT), loading: false, error: null, source: 'firestore' })
    },
    (err) => {
      console.warn('[notifications] listener error:', err)
      cb({ rows: [], loading: false, error: err, source: 'error' })
    },
  )
}

export async function markRead(id) {
  if (!db || !id) return
  const uid = auth?.currentUser?.uid
  if (!uid) return
  try {
    await updateDoc(doc(db, COLLECTION, id), { readBy: arrayUnion(uid) })
  } catch (err) {
    console.warn('[notifications] markRead failed:', err)
  }
}

export async function markAllRead(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return
  await Promise.all(ids.map((id) => markRead(id)))
}

export async function emitNotification(spec) {
  if (!db) return
  const uid = auth?.currentUser?.uid || null
  try {
    await addDoc(collection(db, COLLECTION), {
      kind: spec.kind || 'service',
      title: spec.title || '',
      body: spec.body || null,
      plateNo: spec.plateNo || null,
      appointmentId: spec.appointmentId || null,
      receiptId: spec.receiptId || null,
      link: spec.link || null,
      branch: spec.branch || null,
      company: spec.company || null,
      forAdmins: spec.forAdmins !== false,
      // Optional role targeting — when set, the inbox highlights this notif
      // for users whose role is in the list. Audience routing (branch/company)
      // is unchanged; this is a UI hint, not a hard filter.
      target_roles: Array.isArray(spec.target_roles) && spec.target_roles.length
        ? spec.target_roles
        : null,
      readBy: [],
      createdAt: serverTimestamp(),
      createdBy: uid,
    })
  } catch (err) {
    console.warn('[notifications] emit failed (rules?):', err)
  }
}

// Convenience fetch for "what's the branch/company/plate on this appointment/receipt?"
// Used by the mutation libs after a status change so they don't need to force
// every call site to hand-pass the context.
export async function fetchContextDoc(collectionName, id) {
  if (!db || !id) return null
  try {
    const snap = await getDoc(doc(db, collectionName, id))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (err) {
    console.warn('[notifications] fetchContextDoc failed:', err)
    return null
  }
}
