// Client invoices — bills MG Fleet raises against the fleet client once a job
// has cleared the same gate that unlocked the branch invoice (APPROVED_FINAL
// quotation + post-repair reassessment). This is the client-receivable side
// of the 3-party ledger; the branch-payable side is `branchInvoices.js`.
//
// One client invoice is generated per branch invoice (1:1 pass-through). The
// items and totals are snapshotted from the source quotation so later quote
// edits don't retroactively change what the client was billed.
//
// Numbering is per-MG-Fleet sequential (single counter, since the issuer is
// always MG Fleet) — `CINV-#####`.
//
// Payment terms (`CASH`, `NET_30`, `NET_60`, `NET_90`) are read from the fleet
// company at issue time and snapshotted to the invoice, so changing a
// company's terms later does NOT shift due dates on already-issued invoices.
//
// "OVERDUE" is computed, not stored — derived from dueDate vs now in helpers
// so there's no need for a daily cron to flip statuses. Persisted statuses
// are only OPEN / PAID / VOID.

import {
  addDoc, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, orderBy,
  query, runTransaction, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { emitNotification } from './notifications'

const COLLECTION = 'clientInvoices'
const COUNTERS_COLLECTION = 'counters'
const COUNTER_ID = 'clientInvoice'

export const CLIENT_INVOICE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
})

export const PAYMENT_TERMS = Object.freeze({
  CASH:   'CASH',
  NET_30: 'NET_30',
  NET_60: 'NET_60',
  NET_90: 'NET_90',
})

export const PAYMENT_TERMS_LABEL = Object.freeze({
  CASH:   'Cash on receipt',
  NET_30: 'Net 30 days',
  NET_60: 'Net 60 days',
  NET_90: 'Net 90 days',
})

export const PAYMENT_METHODS = Object.freeze([
  'Cash', 'Cheque', 'Bank Transfer', 'Online', 'Other',
])

// ── Aging / due-date helpers ──────────────────────────────────────────────

function termDays(terms) {
  switch (String(terms || '').toUpperCase()) {
    case 'NET_90': return 90
    case 'NET_60': return 60
    case 'NET_30': return 30
    case 'CASH':   return 0
    default:       return 30 // sensible fallback
  }
}

// Compute the due date for an invoice. Pure function — does not touch DB.
export function computeDueDateIso(issuedAtIso, terms) {
  if (!issuedAtIso) return null
  const t = Date.parse(issuedAtIso)
  if (isNaN(t)) return null
  const d = new Date(t + termDays(terms) * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

// Aging snapshot for a given invoice as of `now`. Returns:
//   { daysPastDue, bucket }  bucket ∈ CURRENT | 1_30 | 31_60 | 61_90 | 90_PLUS
// PAID and VOID always come back as { daysPastDue: 0, bucket: 'CURRENT' }.
export function agingFor(invoice, now = new Date()) {
  if (!invoice) return { daysPastDue: 0, bucket: 'CURRENT' }
  if (invoice.status !== CLIENT_INVOICE_STATUS.OPEN) {
    return { daysPastDue: 0, bucket: 'CURRENT' }
  }
  const due = invoice.dueAtIso ? Date.parse(invoice.dueAtIso) : null
  if (!due) return { daysPastDue: 0, bucket: 'CURRENT' }
  const days = Math.floor((now.getTime() - due) / (24 * 60 * 60 * 1000))
  if (days <= 0)   return { daysPastDue: 0, bucket: 'CURRENT' }
  if (days <= 30)  return { daysPastDue: days, bucket: '1_30' }
  if (days <= 60)  return { daysPastDue: days, bucket: '31_60' }
  if (days <= 90)  return { daysPastDue: days, bucket: '61_90' }
  return { daysPastDue: days, bucket: '90_PLUS' }
}

// Convenience: returns true if the OPEN invoice is past its due date. PAID
// and VOID invoices are never overdue.
export function isOverdue(invoice, now = new Date()) {
  return agingFor(invoice, now).daysPastDue > 0
}

// Effective status for UI rendering: OPEN+overdue ⇒ "OVERDUE". Persisted
// status is unchanged.
export function effectiveStatus(invoice, now = new Date()) {
  if (!invoice) return null
  if (invoice.status === CLIENT_INVOICE_STATUS.OPEN && isOverdue(invoice, now)) {
    return 'OVERDUE'
  }
  return invoice.status
}

// Sum of all recorded payments. Defensive against malformed entries.
export function paymentsTotal(invoice) {
  const arr = Array.isArray(invoice?.payments) ? invoice.payments : []
  return arr.reduce((s, p) => s + (Number(p?.amount) || 0), 0)
}

// Active (non-VOID) credit-note total stamped on the invoice by the
// creditNotes module. Credits behave like payments for balance purposes
// but are tracked in their own collection so they can be voided/reversed
// independently.
export function creditNotesTotal(invoice) {
  return Number(invoice?.creditNotesTotal) || 0
}

export function balanceDue(invoice) {
  return Math.max(0, (Number(invoice?.total) || 0) - paymentsTotal(invoice) - creditNotesTotal(invoice))
}

// ── Numbering ─────────────────────────────────────────────────────────────

async function nextInvoiceNumber() {
  if (!db) throw new Error('Firestore not configured.')
  const counterRef = doc(db, COUNTERS_COLLECTION, COUNTER_ID)
  const next = await runTransaction(db, async (txn) => {
    const snap = await txn.get(counterRef)
    const current = snap.exists() ? (Number(snap.data()?.value) || 0) : 0
    const nextValue = current + 1
    txn.set(counterRef, {
      value: nextValue,
      kind: 'clientInvoice',
      updatedAt: serverTimestamp(),
    }, { merge: true })
    return nextValue
  })
  const padded = String(next).padStart(5, '0')
  return { sequence: next, code: `CINV-${padded}` }
}

// ── Watchers / fetchers ───────────────────────────────────────────────────

export function watchClientInvoices(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured', error: null }); return () => {} }
  // When filtering by `company`, Firestore needs a composite index to
  // combine where('company') + orderBy('issuedAt'). Sort client-side
  // instead so the page works without an index deploy. Volume is low
  // (tens to low-hundreds per company) — sorting in JS is free here.
  const q = options?.company
    ? query(collection(db, COLLECTION), where('company', '==', options.company))
    : query(collection(db, COLLECTION), orderBy('issuedAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (options?.company) {
        rows.sort((a, b) => {
          const ax = Date.parse(a?.issuedAtIso || '') || 0
          const bx = Date.parse(b?.issuedAtIso || '') || 0
          return bx - ax
        })
      }
      cb({ rows, source: 'firestore', error: null })
    },
    (err) => {
      console.warn('[clientInvoices] listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

export function watchClientInvoiceByCode(code, cb) {
  if (!db || !code) { cb({ invoice: null, source: 'unconfigured' }); return () => {} }
  const q = query(collection(db, COLLECTION), where('code', '==', code))
  return onSnapshot(
    q,
    (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0]
        cb({ invoice: { id: d.id, ...d.data() }, source: 'firestore' })
      } else {
        cb({ invoice: null, source: 'firestore' })
      }
    },
    (err) => {
      console.warn('[clientInvoices] watch error:', err)
      cb({ invoice: null, source: 'error', error: err })
    },
  )
}

// "Has this branch invoice already produced a client invoice?" — used by the
// UI to avoid offering Generate twice and to deep-link from the branch
// invoice detail page.
export async function findClientInvoiceForBranchInvoice(branchInvoiceId) {
  if (!db || !branchInvoiceId) return null
  const snap = await getDocs(query(
    collection(db, COLLECTION),
    where('branchInvoiceId', '==', branchInvoiceId),
    where('status', 'in', [CLIENT_INVOICE_STATUS.OPEN, CLIENT_INVOICE_STATUS.PAID]),
  ))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// ── Generate ──────────────────────────────────────────────────────────────

function profileDisplayName(profile) {
  return profile?.user_fullname || profile?.user_name || profile?.name || profile?.email || 'Unknown'
}

// Generate a client invoice from a branch invoice. The branch invoice already
// captured the items + totals (snapshotted from the quote at issue time), so
// the client invoice copies those forward unchanged.
//
// Required input:
//   branchInvoiceId — Firestore id of the source branchInvoices doc
//   companyTerms    — the fleet company's payment terms at issue time
//                     (caller supplies it after reading fleetCompanies; we
//                     don't read fleetCompanies here to keep the dependency
//                     surface narrow)
//   byProfile       — current user profile, for the audit trail
//
// Idempotent-ish: if a non-VOID client invoice already exists for this
// branch invoice, it's returned instead of creating a second.
export async function generateClientInvoice(branchInvoiceId, { companyTerms, byProfile } = {}) {
  if (!db) throw new Error('Firestore not configured.')
  if (!branchInvoiceId) throw new Error('Missing branch invoice id.')

  const existing = await findClientInvoiceForBranchInvoice(branchInvoiceId)
  if (existing) return existing

  const biSnap = await getDoc(doc(db, 'branchInvoices', branchInvoiceId))
  if (!biSnap.exists()) throw new Error('Branch invoice not found.')
  const bi = { id: biSnap.id, ...biSnap.data() }
  if (bi.status === 'VOID') {
    throw new Error('Cannot bill a VOIDed branch invoice.')
  }
  if (!bi.company) {
    throw new Error('This branch invoice is for a walk-in customer, not a fleet client. No client invoice needed.')
  }

  const terms = String(companyTerms || PAYMENT_TERMS.NET_30).toUpperCase()
  if (!Object.values(PAYMENT_TERMS).includes(terms)) {
    throw new Error(`Unknown payment terms: ${terms}`)
  }

  const { code, sequence } = await nextInvoiceNumber()
  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()
  const byName = profileDisplayName(byProfile)
  const dueAtIso = computeDueDateIso(nowIso, terms)

  const items = (bi.items || []).map((i) => ({
    type: i.type || 'Parts/Materials',
    qty: Number(i.qty) || 1,
    description: i.description || '',
    unitCost: Number(i.unitCost) || 0,
    subTotal: Number(i.subTotal) || (Number(i.qty) || 1) * (Number(i.unitCost) || 0),
    revisionRound: i.revisionRound || 1,
  }))
  const laborTotal = Number(bi.laborTotal) || items.filter((i) => i.type === 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const materialsTotal = Number(bi.materialsTotal) || items.filter((i) => i.type !== 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const total = Number(bi.total) || (laborTotal + materialsTotal)

  const payload = {
    code,
    sequence,
    status: CLIENT_INVOICE_STATUS.OPEN,

    // Sources / cross-links.
    branchInvoiceId,
    branchInvoiceCode: bi.code || null,
    quotationId: bi.quotationId || null,
    quotationCode: bi.quotationCode || null,
    reassessmentRwa: bi.reassessmentRwa || null,
    reassessmentAt: bi.reassessmentAt || null,

    // Denormalized customer/vehicle for fast list rendering.
    plateNo: bi.plateNo || null,
    brandModel: bi.brandModel || null,
    customer: bi.customer || null,
    company: bi.company,            // required (we threw above if missing)
    branch: bi.branch || null,      // which branch did the work — for staff filtering

    // Snapshotted line items + totals.
    items,
    laborTotal,
    materialsTotal,
    total,

    // Terms snapshot.
    paymentTerms: terms,
    dueAtIso,

    // Payments / balance.
    payments: [],
    paymentsTotal: 0,
    balanceDue: total,

    issuedAt: serverTimestamp(),
    issuedAtIso: nowIso,
    issuedBy: uid,
    issuedByName: byName,
  }

  const ref = await addDoc(collection(db, COLLECTION), payload)

  // Cross-stamp the branch invoice so the UI can deep-link.
  try {
    await updateDoc(doc(db, 'branchInvoices', branchInvoiceId), {
      clientInvoiceId: ref.id,
      clientInvoiceCode: code,
      clientInvoicedAt: nowIso,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  } catch (err) {
    console.warn('[clientInvoices] failed to stamp branch invoice:', err?.message || err)
  }

  emitNotification({
    kind: 'service',
    title: `Client invoice ${code} issued`,
    body: `${bi.plateNo || ''} · ${bi.company || ''} · ${formatMoneyShort(total)}`.trim(),
    plateNo: bi.plateNo || null,
    receiptId: ref.id,
    link: `/client-invoices/${code}`,
    branch: bi.branch || null,
    company: bi.company,            // visible to the client
  })

  return { id: ref.id, ...payload, issuedAt: nowIso }
}

// ── Void ──────────────────────────────────────────────────────────────────

export async function voidClientInvoice(id, { reason, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing invoice id.')
  const trimmed = (reason || '').trim()
  if (!trimmed) throw new Error('A reason is required to void an invoice.')

  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) throw new Error('Invoice not found.')
  const inv = snap.data()
  if (inv.status !== CLIENT_INVOICE_STATUS.OPEN) {
    throw new Error('Only OPEN invoices can be voided.')
  }
  if (paymentsTotal(inv) > 0) {
    throw new Error('This invoice has recorded payments. Issue a credit note instead (Round 15).')
  }

  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const nowIso = new Date().toISOString()

  await updateDoc(doc(db, COLLECTION, id), {
    status: CLIENT_INVOICE_STATUS.VOID,
    voidReason: trimmed,
    voidedBy: uid,
    voidedByName: byName,
    voidedAt: nowIso,
    updatedAt: serverTimestamp(),
  })

  emitNotification({
    kind: 'service',
    title: `Client invoice ${inv.code} voided`,
    body: trimmed,
    plateNo: inv.plateNo || null,
    receiptId: id,
    link: `/client-invoices/${inv.code}`,
    branch: inv.branch || null,
    company: inv.company || null,
  })

  return { id, at: nowIso }
}

// ── Record payment ────────────────────────────────────────────────────────

// Append a payment to the invoice. If the cumulative payments meet or exceed
// the total, the status auto-flips to PAID. Partial payments leave the
// invoice OPEN with a reduced balanceDue.
//
// Uses a transaction so two simultaneous payment records don't race past the
// total or both flip status.
export async function recordPayment(id, { amount, method, reference, paidAtIso, note, byProfile } = {}) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing invoice id.')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Payment amount must be a positive number.')
  const m = (method || '').trim()
  if (!m) throw new Error('Payment method is required.')

  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const nowIso = new Date().toISOString()
  const paidIso = paidAtIso || nowIso

  const ref = doc(db, COLLECTION, id)
  const result = await runTransaction(db, async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists()) throw new Error('Invoice not found.')
    const inv = snap.data()
    if (inv.status === CLIENT_INVOICE_STATUS.VOID) {
      throw new Error('Cannot record payment on a voided invoice.')
    }
    const prevTotal = (inv.payments || []).reduce((s, p) => s + (Number(p?.amount) || 0), 0)
    const newPaymentsTotal = prevTotal + amt
    const total = Number(inv.total) || 0
    const cnTotal = Number(inv.creditNotesTotal) || 0
    const remaining = total - prevTotal - cnTotal
    if (amt > remaining + 0.01) {
      throw new Error(`Payment exceeds outstanding balance (₱${remaining.toFixed(2)} remaining).`)
    }
    const newBalance = Math.max(0, total - newPaymentsTotal - cnTotal)
    const flipsToPaid = newBalance <= 0.01

    const payment = {
      amount: amt,
      method: m,
      reference: (reference || '').trim() || null,
      paidAt: paidIso,
      note: (note || '').trim() || null,
      recordedBy: uid,
      recordedByName: byName,
      recordedAt: nowIso,
    }

    txn.update(ref, {
      payments: arrayUnion(payment),
      paymentsTotal: newPaymentsTotal,
      balanceDue: newBalance,
      ...(flipsToPaid ? {
        status: CLIENT_INVOICE_STATUS.PAID,
        paidAt: nowIso,
        paidBy: uid,
        paidByName: byName,
      } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })

    return { flipsToPaid, newBalance, newPaymentsTotal, invoiceCode: inv.code, plateNo: inv.plateNo, branch: inv.branch, company: inv.company }
  })

  if (result.flipsToPaid) {
    emitNotification({
      kind: 'service',
      title: `Client invoice ${result.invoiceCode} fully paid`,
      body: `${result.plateNo || ''} · ${result.company || ''}`.trim(),
      plateNo: result.plateNo || null,
      receiptId: id,
      link: `/client-invoices/${result.invoiceCode}`,
      branch: result.branch || null,
      company: result.company || null,
    })
  } else {
    emitNotification({
      kind: 'service',
      title: `Payment recorded — ${result.invoiceCode}`,
      body: `${formatMoneyShort(amt)} · balance ${formatMoneyShort(result.newBalance)}`,
      plateNo: result.plateNo || null,
      receiptId: id,
      link: `/client-invoices/${result.invoiceCode}`,
      branch: result.branch || null,
      company: result.company || null,
    })
  }

  return { id, ...result, paidAt: paidIso }
}

function formatMoneyShort(n) {
  if (!Number.isFinite(n)) return ''
  return `₱${Math.round(n).toLocaleString('en-PH')}`
}
