// Helpers for the users collection. mg-fms writes these docs with
// `{ role, name, branch, email, createdAt }` (createdAt as an ISO string).
// We extend that with `company_id`, `is_admin`, `quotation_approver` for the
// portal's needs without breaking mg-fms (mg-fms ignores unknown fields).

import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { getPendingInvite, clearPendingInvite } from './invites'

const COLLECTION = 'users'

export function watchUsers(onNext, onError) {
  if (!db) { onNext([]); return () => {} }
  const q = query(collection(db, COLLECTION), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[users] subscription failed:', err)
      if (onError) onError(err)
    },
  )
}

export async function getUser(uid) {
  if (!db) return null
  const snap = await getDoc(doc(db, COLLECTION, uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateUser(uid, patch) {
  if (!db) throw new Error('Firestore not configured.')
  const clean = { ...patch }
  // Don't let caller silently wipe required fields.
  delete clean.id
  clean.updatedAt = serverTimestamp()
  clean.updatedBy = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, uid), clean)
}

export async function createUserDoc(data) {
  if (!db) throw new Error('Firestore not configured.')
  const ref = await addDoc(collection(db, COLLECTION), {
    name: (data.name || '').trim(),
    email: (data.email || '').trim() || null,
    role: data.role || 'field_assessor',
    branch: (data.branch || '').trim() || null,
    is_active: 1,
    createdAt: serverTimestamp(),
    createdBy: auth?.currentUser?.uid || null,
  })
  return ref.id
}

export async function deleteUserDoc(uid) {
  if (!db) throw new Error('Firestore not configured.')
  await deleteDoc(doc(db, COLLECTION, uid))
}

// Called right after an invited user signs in via the email link. Creates
// their users/{uid} doc from the pending invite and clears the invite.
export async function promotePendingToUser(uid, email) {
  if (!db) throw new Error('Firestore not configured.')
  const invite = await getPendingInvite(email)
  if (!invite) {
    // No invite — fall back to a minimal user doc so the app still works.
    await setDoc(doc(db, COLLECTION, uid), {
      email,
      name: email.split('@')[0],
      role: 'customer',
      createdAt: serverTimestamp(),
      source: 'unknown-email-link',
    }, { merge: true })
    return null
  }
  await setDoc(doc(db, COLLECTION, uid), {
    email: invite.email,
    name: invite.name,
    role: invite.role,
    branch: invite.branch || null,
    company_id: invite.company || null,
    is_admin: Boolean(invite.is_admin),
    quotation_approver: Boolean(invite.quotation_approver),
    createdAt: serverTimestamp(),
    source: 'invite',
    invited_by: invite.invited_by,
  }, { merge: true })
  try { await clearPendingInvite(email) } catch {}
  return invite
}
