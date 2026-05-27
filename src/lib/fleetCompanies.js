import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'

const COLLECTION = 'fleetCompanies'

// Live subscription to the list, ordered by name. Returns unsubscribe.
export function watchFleetCompanies(onNext, onError) {
  if (!db) {
    onNext([])
    return () => {}
  }
  const q = query(collection(db, COLLECTION), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[fleetCompanies] subscription failed:', err)
      if (onError) onError(err)
    },
  )
}

const VALID_PAYMENT_TERMS = ['CASH', 'NET_30', 'NET_60', 'NET_90']

function normalizeWritable(data) {
  const terms = String(data.paymentTerms || 'NET_30').toUpperCase()
  const hasBrokerMarkup = Boolean(data.hasBrokerMarkup)
  const rawPct = Number(data.brokerMarkupPercent) || 0
  const payload = {
    name: (data.name || '').trim(),
    code: (data.code || '').trim().toUpperCase(),
    contactEmail: (data.contactEmail || '').trim(),
    contactPhone: (data.contactPhone || '').trim(),
    paymentTerms: VALID_PAYMENT_TERMS.includes(terms) ? terms : 'NET_30',
    isActive: data.isActive !== false,
    hasBrokerMarkup,
    brokerMarkupPercent: hasBrokerMarkup ? Math.min(100, Math.max(0, rawPct)) : 0,
  }
  if (!payload.name) throw new Error('Company name is required.')
  if (!payload.code) throw new Error('Company code is required.')
  return payload
}

export async function createFleetCompany(data) {
  if (!db) throw new Error('Firestore is not configured.')
  const uid = auth?.currentUser?.uid || null
  const ref = await addDoc(collection(db, COLLECTION), {
    ...normalizeWritable(data),
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  return ref.id
}

export async function updateFleetCompany(id, data) {
  if (!db) throw new Error('Firestore is not configured.')
  const uid = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, id), {
    ...normalizeWritable(data),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

// Look up a fleet company by its display name. Used when the only handle we
// have is the denormalized `company` string on a branch invoice / quotation
// (the portal joins on name, not on id, to stay compatible with mg-fms).
// Returns null if not found.
export async function getFleetCompanyByName(name) {
  if (!db || !name) return null
  const snap = await getDocs(query(collection(db, COLLECTION), where('name', '==', name)))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export async function setFleetCompanyActive(id, isActive) {
  if (!db) throw new Error('Firestore is not configured.')
  const uid = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, id), {
    isActive: Boolean(isActive),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}
