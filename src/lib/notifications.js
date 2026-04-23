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

const COLLECTION = 'notifications'
const LIST_LIMIT = 50

function audienceQuery(profile) {
  const base = collection(db, COLLECTION)
  if (profile?.is_admin) {
    return query(base, orderBy('createdAt', 'desc'), limit(LIST_LIMIT))
  }
  if (isCustomer(profile?.role) && profile?.company_id) {
    return query(base, where('company', '==', profile.company_id), orderBy('createdAt', 'desc'), limit(LIST_LIMIT))
  }
  if (profile?.branch) {
    return query(base, where('branch', '==', profile.branch), orderBy('createdAt', 'desc'), limit(LIST_LIMIT))
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
  return onSnapshot(
    q,
    (snap) => {
      const uid = auth?.currentUser?.uid
      const rows = snap.docs.map((d) => {
        const data = { id: d.id, ...d.data() }
        data.read = uid ? (Array.isArray(data.readBy) && data.readBy.includes(uid)) : false
        return data
      })
      cb({ rows, loading: false, error: null, source: 'firestore' })
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
