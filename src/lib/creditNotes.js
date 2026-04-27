// Credit notes — the escape hatch for invoices that have already received
// payment (or in BIR-Philippines context, any invoice that has been
// BIR-filed and can no longer simply be voided). A credit note is a
// separate document that reduces the receivable on a source invoice.
//
// Both sides of the 3-party flow can have credit notes:
//   - kind: BRANCH ⇒ MG Fleet credits a branch invoice (i.e. claws back
//                    or reduces what MG Fleet owes the branch)
//   - kind: CLIENT ⇒ MG Fleet credits a client invoice (i.e. reduces
//                    what the client owes MG Fleet)
//
// Numbering is per-MG-Fleet single counter `CN-#####` regardless of kind —
// auditors prefer one continuous sequence, and the kind is a discriminator
// inside each doc.
//
// Issuance flow (transactional so we can't double-credit past the total):
//   1. Validate source invoice exists and is not VOID.
//   2. Compute new credit total: previous CN total + this amount.
//   3. Reject if (paymentsTotal + new CN total) > invoice.total.
//   4. Create CN doc.
//   5. Update source invoice: creditNotesTotal += amount, balanceDue -=
//      amount, creditNoteCodes append. If balanceDue ≤ 0, flip status to
//      PAID so existing UI gates (e.g. "can record payment") behave
//      correctly.
//
// Voiding a CN: allowed if status === ISSUED. Reverses the effects on the
// source invoice (balanceDue += amount, creditNotesTotal -= amount, status
// reverts from PAID → OPEN if applicable). Same transactional shape.

import {
  addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, getDocs,
  onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { emitNotification } from './notifications'

const COLLECTION = 'creditNotes'
const COUNTERS_COLLECTION = 'counters'
const COUNTER_ID = 'creditNote'

export const CREDIT_NOTE_KIND = Object.freeze({
  BRANCH: 'BRANCH',  // applies to a branchInvoices doc
  CLIENT: 'CLIENT',  // applies to a clientInvoices doc
})

export const CREDIT_NOTE_STATUS = Object.freeze({
  ISSUED: 'ISSUED',
  VOID:   'VOID',
})

// Map kind → source collection name. Keep this in one place so issue/void
// don't drift.
function sourceCollection(kind) {
  if (kind === CREDIT_NOTE_KIND.BRANCH) return 'branchInvoices'
  if (kind === CREDIT_NOTE_KIND.CLIENT) return 'clientInvoices'
  throw new Error(`Unknown credit note kind: ${kind}`)
}

function profileDisplayName(profile) {
  return profile?.user_fullname || profile?.user_name || profile?.name || profile?.email || 'Unknown'
}

// ── Numbering ─────────────────────────────────────────────────────────────

async function nextCreditNoteNumber() {
  if (!db) throw new Error('Firestore not configured.')
  const counterRef = doc(db, COUNTERS_COLLECTION, COUNTER_ID)
  const next = await runTransaction(db, async (txn) => {
    const snap = await txn.get(counterRef)
    const current = snap.exists() ? (Number(snap.data()?.value) || 0) : 0
    const nextValue = current + 1
    txn.set(counterRef, {
      value: nextValue,
      kind: 'creditNote',
      updatedAt: serverTimestamp(),
    }, { merge: true })
    return nextValue
  })
  const padded = String(next).padStart(5, '0')
  return { sequence: next, code: `CN-${padded}` }
}

// ── Watchers / fetchers ───────────────────────────────────────────────────

export function watchCreditNotes(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured', error: null }); return () => {} }
  // Avoid where()+orderBy() composite-index requirement: drop orderBy
  // when filters are applied and sort client-side.
  const filters = []
  if (options?.kind)    filters.push(where('kind',    '==', options.kind))
  if (options?.company) filters.push(where('company', '==', options.company))
  if (options?.branch)  filters.push(where('branch',  '==', options.branch))
  const q = filters.length > 0
    ? query(collection(db, COLLECTION), ...filters)
    : query(collection(db, COLLECTION), orderBy('issuedAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (filters.length > 0) {
        rows.sort((a, b) => {
          const ax = Date.parse(a?.issuedAtIso || '') || 0
          const bx = Date.parse(b?.issuedAtIso || '') || 0
          return bx - ax
        })
      }
      cb({ rows, source: 'firestore', error: null })
    },
    (err) => {
      console.warn('[creditNotes] listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

export function watchCreditNotesForInvoice(sourceInvoiceId, cb) {
  if (!db || !sourceInvoiceId) { cb({ rows: [] }); return () => {} }
  const q = query(
    collection(db, COLLECTION),
    where('sourceInvoiceId', '==', sourceInvoiceId),
  )
  return onSnapshot(
    q,
    (snap) => {
      // Sort client-side (orderBy + where on different fields needs an index).
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => {
        const ta = Date.parse(a?.issuedAtIso || '') || 0
        const tb = Date.parse(b?.issuedAtIso || '') || 0
        return tb - ta
      })
      cb({ rows, source: 'firestore' })
    },
    (err) => {
      console.warn('[creditNotes] invoice listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

export function watchCreditNoteByCode(code, cb) {
  if (!db || !code) { cb({ creditNote: null, source: 'unconfigured' }); return () => {} }
  const q = query(collection(db, COLLECTION), where('code', '==', code))
  return onSnapshot(
    q,
    (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0]
        cb({ creditNote: { id: d.id, ...d.data() }, source: 'firestore' })
      } else {
        cb({ creditNote: null, source: 'firestore' })
      }
    },
    (err) => {
      console.warn('[creditNotes] watch error:', err)
      cb({ creditNote: null, source: 'error', error: err })
    },
  )
}

// Ad-hoc fetcher for callers that just need a one-shot list (e.g. the SOA
// report in 13.5 / 14).
export async function getCreditNotesForInvoice(sourceInvoiceId) {
  if (!db || !sourceInvoiceId) return []
  const snap = await getDocs(query(
    collection(db, COLLECTION),
    where('sourceInvoiceId', '==', sourceInvoiceId),
  ))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── Issue ─────────────────────────────────────────────────────────────────

// Sum of *issued* (non-VOID) credit notes against an invoice. Convenience
// helper for the UI; the transaction inside issueCreditNote re-derives this
// authoritatively before allowing a write.
export function issuedCreditTotal(creditNotes = []) {
  return creditNotes
    .filter((c) => c?.status === CREDIT_NOTE_STATUS.ISSUED)
    .reduce((s, c) => s + (Number(c?.amount) || 0), 0)
}

// Issue a credit note against a source invoice. Source must already exist
// and be not-VOID. Updates the source invoice's balanceDue / status in the
// same transaction.
//
// Inputs:
//   kind            — BRANCH | CLIENT
//   sourceInvoiceId — Firestore id of the branchInvoices/clientInvoices doc
//   amount          — positive number, ≤ remaining capacity
//   reason          — required string
//   note            — optional free text
//   items           — optional snapshot (line items being credited); for
//                     printing only, doesn't change accounting
//   byProfile       — current user profile for audit trail
export async function issueCreditNote({
  kind, sourceInvoiceId, amount, reason, note, items, byProfile,
} = {}) {
  if (!db) throw new Error('Firestore not configured.')
  if (!Object.values(CREDIT_NOTE_KIND).includes(kind)) throw new Error('Invalid credit note kind.')
  if (!sourceInvoiceId) throw new Error('Missing source invoice id.')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Credit amount must be positive.')
  const trimmedReason = (reason || '').trim()
  if (!trimmedReason) throw new Error('A reason is required to issue a credit note.')

  const { code, sequence } = await nextCreditNoteNumber()
  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const nowIso = new Date().toISOString()

  const sourceRef = doc(db, sourceCollection(kind), sourceInvoiceId)

  // Two-phase: we need to addDoc to creditNotes (auto-id) AND update the
  // source invoice atomically. addDoc isn't transactional, so we use a
  // transaction over the source invoice and a known-id new doc reference.
  // Approach: create the CN id up front, then use txn.set for both writes.
  const cnRef = doc(collection(db, COLLECTION))

  const result = await runTransaction(db, async (txn) => {
    const sSnap = await txn.get(sourceRef)
    if (!sSnap.exists()) throw new Error('Source invoice not found.')
    const src = sSnap.data()
    if (src.status === 'VOID') throw new Error('Cannot credit a voided invoice.')

    const total = Number(src.total) || 0
    const paymentsT = Number(src.paymentsTotal) || 0
    const prevCNTotal = Number(src.creditNotesTotal) || 0
    const remainingCapacity = total - paymentsT - prevCNTotal
    if (amt > remainingCapacity + 0.01) {
      throw new Error(`Credit exceeds remaining balance (₱${remainingCapacity.toFixed(2)} available).`)
    }
    const newCNTotal = prevCNTotal + amt
    const newBalance = Math.max(0, total - paymentsT - newCNTotal)
    const flipsToPaid = newBalance <= 0.01 && src.status !== 'PAID'

    // Build the CN payload. Denormalize fields for list rendering / SOA.
    const cnPayload = {
      code,
      sequence,
      kind,
      status: CREDIT_NOTE_STATUS.ISSUED,
      sourceInvoiceId,
      sourceInvoiceCode: src.code || null,
      amount: amt,
      reason: trimmedReason,
      note: (note || '').trim() || null,
      items: Array.isArray(items) ? items : null,

      // Denormalized for filtering / display.
      plateNo: src.plateNo || null,
      brandModel: src.brandModel || null,
      customer: src.customer || null,
      company: src.company || null,
      branch: src.branch || null,

      issuedAt: serverTimestamp(),
      issuedAtIso: nowIso,
      issuedBy: uid,
      issuedByName: byName,
    }

    txn.set(cnRef, cnPayload)
    txn.update(sourceRef, {
      creditNotesTotal: newCNTotal,
      creditNoteCodes: arrayUnion(code),
      balanceDue: newBalance,
      ...(flipsToPaid ? {
        status: 'PAID',
        paidAt: nowIso,
        paidBy: uid,
        paidByName: byName,
      } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })

    return { flipsToPaid, newBalance, payload: cnPayload, src }
  })

  // Audience: client-side notifications go to the company for CLIENT kind;
  // BRANCH kind is internal-only.
  emitNotification({
    kind: 'service',
    title: `Credit note ${code} issued`,
    body: `${result.src.code} · ${formatMoneyShort(amt)} · ${trimmedReason.slice(0, 60)}`,
    plateNo: result.src.plateNo || null,
    receiptId: cnRef.id,
    link: `/credit-notes/${code}`,
    branch: result.src.branch || null,
    company: kind === CREDIT_NOTE_KIND.CLIENT ? (result.src.company || null) : null,
  })

  return { id: cnRef.id, ...result.payload, issuedAt: nowIso }
}

// ── Void ──────────────────────────────────────────────────────────────────

// Void a credit note. Reverses its effect on the source invoice in the same
// transaction (adds the amount back to balanceDue, decrements
// creditNotesTotal, removes the code from creditNoteCodes, reverts PAID →
// OPEN if the CN was what flipped it).
export async function voidCreditNote(id, { reason, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing credit note id.')
  const trimmed = (reason || '').trim()
  if (!trimmed) throw new Error('A reason is required to void a credit note.')

  const cnRef = doc(db, COLLECTION, id)
  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const nowIso = new Date().toISOString()

  const result = await runTransaction(db, async (txn) => {
    const cSnap = await txn.get(cnRef)
    if (!cSnap.exists()) throw new Error('Credit note not found.')
    const cn = cSnap.data()
    if (cn.status !== CREDIT_NOTE_STATUS.ISSUED) {
      throw new Error('Only ISSUED credit notes can be voided.')
    }

    const sourceRef = doc(db, sourceCollection(cn.kind), cn.sourceInvoiceId)
    const sSnap = await txn.get(sourceRef)
    if (!sSnap.exists()) throw new Error('Source invoice no longer exists.')
    const src = sSnap.data()

    const amt = Number(cn.amount) || 0
    const total = Number(src.total) || 0
    const paymentsT = Number(src.paymentsTotal) || 0
    const prevCNTotal = Number(src.creditNotesTotal) || 0
    const newCNTotal = Math.max(0, prevCNTotal - amt)
    const newBalance = Math.max(0, total - paymentsT - newCNTotal)
    const wasPaid = src.status === 'PAID'
    const revertsToOpen = wasPaid && newBalance > 0.01

    txn.update(cnRef, {
      status: CREDIT_NOTE_STATUS.VOID,
      voidReason: trimmed,
      voidedBy: uid,
      voidedByName: byName,
      voidedAt: nowIso,
      updatedAt: serverTimestamp(),
    })
    txn.update(sourceRef, {
      creditNotesTotal: newCNTotal,
      creditNoteCodes: arrayRemove(cn.code),
      balanceDue: newBalance,
      ...(revertsToOpen ? {
        status: 'OPEN',
        paidAt: null,
        paidBy: null,
        paidByName: null,
      } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })

    return { revertsToOpen, newBalance, sourceCode: src.code, plateNo: src.plateNo, branch: src.branch, company: src.company, kind: cn.kind, code: cn.code, amount: amt }
  })

  emitNotification({
    kind: 'service',
    title: `Credit note ${result.code} voided`,
    body: `${result.sourceCode} · ${formatMoneyShort(result.amount)} · ${trimmed.slice(0, 60)}`,
    plateNo: result.plateNo || null,
    receiptId: id,
    link: `/credit-notes/${result.code}`,
    branch: result.branch || null,
    company: result.kind === CREDIT_NOTE_KIND.CLIENT ? (result.company || null) : null,
  })

  return { id, at: nowIso, ...result }
}

function formatMoneyShort(n) {
  if (!Number.isFinite(n)) return ''
  return `₱${Math.round(n).toLocaleString('en-PH')}`
}
