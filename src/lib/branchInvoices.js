// Branch invoices — the bill a branch raises against MG Fleet once a fleet
// job is complete. This is the branch-payable side of the 3-party ledger;
// the MG-Fleet-to-client billing comes in Round 13.
//
// A branch invoice exists only when BOTH gates pass:
//   1. The source quotation is APPROVED_FINAL (no pending revisions).
//   2. The plate has at least one post-repair reassessment dated AFTER the
//      quote's APPROVED_FINAL timestamp, AND that reassessment is not
//      "deferred" (or has been supervisor-cleared if it is).
//
// Numbers are per-branch sequential via a Firestore counter — BIR-friendly
// gapless numbering scoped to the issuing branch.

import {
  addDoc, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, orderBy,
  query, runTransaction, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { emitNotification } from './notifications'
import { effectiveQuotationStatus, QUOT_STATUS } from './serviceReceipts'
// Aging / due-date helpers are shared with clientInvoices — same logic, same
// shape, just a different collection of OPEN invoices to walk.
import {
  agingFor as clientAgingFor,
  computeDueDateIso,
  effectiveStatus as clientEffectiveStatus,
  isOverdue as clientIsOverdue,
} from './clientInvoices'

// Branch ↔ MG Fleet settles on NET_30 by convention; not configurable per
// branch for now (the legacy contract is uniform across branches).
const BRANCH_PAYMENT_TERMS = 'NET_30'

const COLLECTION = 'branchInvoices'
const COUNTERS_COLLECTION = 'counters'

export const BRANCH_INVOICE_STATUS = Object.freeze({
  OPEN: 'OPEN',       // issued to MG Fleet, awaiting payment (Round 14)
  PAID: 'PAID',       // MG Fleet has settled this with the branch
  VOID: 'VOID',       // cancelled / credited out (pre-payment)
})

// ── Gate ──────────────────────────────────────────────────────────────────

// Pull the timestamp at which the quotation hit APPROVED_FINAL, from the
// audit trail. The chain can land on APPROVED_FINAL multiple times if
// revisions happened — we always want the LATEST approval (the one that
// cleared the most recent delta) because that's the one the post-repair
// reassessment has to follow.
export function quotationApprovedAtIso(quot) {
  const audit = quot?.audit || []
  let bestTs = 0
  let bestIso = null
  for (const a of audit) {
    if (a?.to === QUOT_STATUS.APPROVED_FINAL && a?.at) {
      const t = Date.parse(a.at)
      if (!isNaN(t) && t > bestTs) { bestTs = t; bestIso = a.at }
    }
  }
  return bestIso
}

// Given a set of assessments for a plate, find the latest one whose
// submittedAt is strictly after `afterIso`. Returns null if none exists.
function latestAssessmentAfter(assessments, afterIso) {
  const cutoff = afterIso ? Date.parse(afterIso) : 0
  let best = null
  let bestTs = 0
  for (const a of assessments) {
    const ts = Date.parse(a?.submittedAt || '') || 0
    if (ts <= cutoff) continue
    if (ts > bestTs) { best = a; bestTs = ts }
  }
  return best
}

// Gate check used by the UI and by generateBranchInvoice as a pre-flight.
//
// Returns { ok, reason, reassessment } — reassessment is the assessment doc
// that satisfied the gate (or null if not ready), so the UI can link to its
// RWA detail page.
//
// `plateAssessments` is any iterable of assessment docs already loaded by
// the caller (usually from watchVehicles / a one-shot assessments read).
export function canGenerateBranchInvoice(quot, plateAssessments = []) {
  if (!quot) return { ok: false, reason: 'No quotation.', reassessment: null }
  if (effectiveQuotationStatus(quot) !== QUOT_STATUS.APPROVED_FINAL) {
    return { ok: false, reason: 'Quotation has not been fully approved yet.', reassessment: null }
  }
  const approvedAt = quotationApprovedAtIso(quot)
  if (!approvedAt) {
    return { ok: false, reason: 'No approval timestamp on this quotation.', reassessment: null }
  }
  const latest = latestAssessmentAfter(plateAssessments, approvedAt)
  if (!latest) {
    return {
      ok: false,
      reason: 'Waiting for post-repair reassessment. The field assessor needs to re-inspect the unit after the repair before this can be invoiced.',
      reassessment: null,
    }
  }
  const status = String(latest?.classification?.overallStatus || '').toLowerCase()
  if (status === 'deferred' && !latest?.supervisorCleared) {
    return {
      ok: false,
      reason: 'Post-repair reassessment came back DEFERRED. Either address the open items with another round of repair, or have a supervisor override the block.',
      reassessment: latest,
    }
  }
  return { ok: true, reason: null, reassessment: latest }
}

// ── Per-branch sequential numbering ───────────────────────────────────────

async function nextInvoiceNumberForBranch(branch) {
  if (!db) throw new Error('Firestore not configured.')
  const safeBranch = String(branch || 'UNKNOWN').toUpperCase().replace(/\s+/g, '')
  const counterId = `branchInvoice_${safeBranch}`
  const counterRef = doc(db, COUNTERS_COLLECTION, counterId)
  const next = await runTransaction(db, async (txn) => {
    const snap = await txn.get(counterRef)
    const current = snap.exists() ? (Number(snap.data()?.value) || 0) : 0
    const nextValue = current + 1
    txn.set(counterRef, {
      value: nextValue,
      branch: safeBranch,
      kind: 'branchInvoice',
      updatedAt: serverTimestamp(),
    }, { merge: true })
    return nextValue
  })
  const padded = String(next).padStart(5, '0')
  return { sequence: next, code: `INV-${safeBranch}-${padded}`, branch: safeBranch }
}

// ── Watchers / fetchers ───────────────────────────────────────────────────

export function watchBranchInvoices(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured', error: null }); return () => {} }
  // Avoid where()+orderBy() composite-index requirement: drop orderBy
  // when filters are applied and sort client-side. Volume is small.
  const filters = []
  if (options?.branch)  filters.push(where('branch',  '==', options.branch))
  if (options?.company) filters.push(where('company', '==', options.company))
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
      console.warn('[branchInvoices] listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

export async function getBranchInvoiceByCode(code) {
  if (!db || !code) return null
  try {
    const direct = await getDoc(doc(db, COLLECTION, code))
    if (direct.exists()) return { id: direct.id, ...direct.data() }
  } catch {}
  const snap = await getDocs(query(collection(db, COLLECTION), where('code', '==', code)))
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }
  return null
}

// Live single-doc subscription for the detail page, so voiding / paying the
// invoice from another tab updates immediately.
export function watchBranchInvoiceByCode(code, cb) {
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
      console.warn('[branchInvoices] watch error:', err)
      cb({ invoice: null, source: 'error', error: err })
    },
  )
}

// Check "has this quotation already been invoiced" so the UI doesn't offer
// the Generate button twice. Returns the existing invoice or null.
export async function findInvoiceForQuotation(quotationId) {
  if (!db || !quotationId) return null
  const snap = await getDocs(query(
    collection(db, COLLECTION),
    where('quotationId', '==', quotationId),
    where('status', 'in', [BRANCH_INVOICE_STATUS.OPEN, BRANCH_INVOICE_STATUS.PAID]),
  ))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// ── Create / void ─────────────────────────────────────────────────────────

function profileDisplayName(profile) {
  return profile?.user_fullname || profile?.user_name || profile?.name || profile?.email || 'Unknown'
}

// Generate a branch invoice from an approved + reassessed quotation. Runs
// the gate (so the caller gets a clear error if anything's off), then writes
// the invoice with a per-branch sequential code. Idempotent-ish: if the
// quotation already has a non-VOID invoice, returns that one instead of
// creating a second.
//
// `plateAssessments` must be supplied by the caller (same iterable used for
// canGenerateBranchInvoice) so the UI and the writer agree on which
// reassessment unlocked the gate.
export async function generateBranchInvoice(quotationId, { byProfile, plateAssessments = [] } = {}) {
  if (!db) throw new Error('Firestore not configured.')
  if (!quotationId) throw new Error('Missing quotation id.')

  // Short-circuit if an invoice already exists for this quotation.
  const existing = await findInvoiceForQuotation(quotationId)
  if (existing) return existing

  // Load the quotation fresh (don't trust stale props from the caller).
  const qSnap = await getDoc(doc(db, 'serviceReceipts', quotationId))
  if (!qSnap.exists()) throw new Error('Quotation not found.')
  const quot = { id: qSnap.id, ...qSnap.data() }
  if (quot.kind !== 'quotation') throw new Error('Only quotations can be invoiced through this path.')

  const gate = canGenerateBranchInvoice(quot, plateAssessments)
  if (!gate.ok) throw new Error(gate.reason || 'Gate check failed.')

  const { code, sequence, branch } = await nextInvoiceNumberForBranch(quot.branch)
  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()
  const byName = profileDisplayName(byProfile)

  // Items snapshot — copy from the quotation at invoice time so later quot
  // revisions don't silently change what the branch already billed for.
  const items = (quot.items || []).map((i) => ({
    type: i.type || 'Parts/Materials',
    qty: Number(i.qty) || 1,
    description: i.description || '',
    unitCost: Number(i.unitCost) || 0,
    subTotal: Number(i.subTotal) || (Number(i.qty) || 1) * (Number(i.unitCost) || 0),
    revisionRound: i.revisionRound || 1,
  }))
  const laborTotal = items.filter((i) => i.type === 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const materialsTotal = items.filter((i) => i.type !== 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const total = laborTotal + materialsTotal

  const payload = {
    code,
    sequence,
    branch,
    status: BRANCH_INVOICE_STATUS.OPEN,

    // Links back to the sources.
    quotationId,
    quotationCode: quot.code || null,
    reassessmentRwa: gate.reassessment?.rwaNumber || null,
    reassessmentAt:  gate.reassessment?.submittedAt || null,
    reassessmentStatus: gate.reassessment?.classification?.overallStatus || null,
    supervisorCleared: Boolean(gate.reassessment?.supervisorCleared),

    // Denormalized for list rendering without extra reads.
    plateNo: quot.plateNo || null,
    brandModel: quot.brandModel || null,
    customer: quot.customer || null,
    company: quot.company || null,

    items,
    laborTotal,
    materialsTotal,
    total,

    // Payment terms snapshot. Branch ↔ MG Fleet is uniformly NET_30.
    paymentTerms: BRANCH_PAYMENT_TERMS,
    dueAtIso: computeDueDateIso(nowIso, BRANCH_PAYMENT_TERMS),

    // Payment ledger.
    payments: [],
    paymentsTotal: 0,
    balanceDue: total,

    issuedAt: serverTimestamp(),
    issuedAtIso: nowIso,
    issuedBy: uid,
    issuedByName: byName,
  }

  const ref = await addDoc(collection(db, COLLECTION), payload)

  // Stamp the source quotation so the UI knows it's been invoiced and any
  // revisitor can jump straight to the invoice.
  try {
    await updateDoc(doc(db, 'serviceReceipts', quotationId), {
      branchInvoiceId: ref.id,
      branchInvoiceCode: code,
      branchInvoicedAt: nowIso,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  } catch (err) {
    console.warn('[branchInvoices] failed to stamp quotation:', err?.message || err)
  }

  emitNotification({
    kind: 'service',
    title: `Branch invoice ${code} issued`,
    body: `${quot.plateNo || ''} · ${quot.company || ''} · ${formatMoneyShort(total)}`.trim(),
    plateNo: quot.plateNo || null,
    receiptId: ref.id,
    link: `/branch-invoices/${code}`,
    branch,
    // Internal hop only — branch ↔ MG Fleet. Client doesn't see branch-side
    // billing; they see the MG-Fleet-to-client bill when Round 13 ships.
    company: null,
  })

  return { id: ref.id, ...payload, issuedAt: nowIso }
}

export async function voidBranchInvoice(id, { reason, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing invoice id.')
  const trimmed = (reason || '').trim()
  if (!trimmed) throw new Error('A reason is required to void an invoice.')

  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) throw new Error('Invoice not found.')
  const inv = snap.data()
  if (inv.status !== BRANCH_INVOICE_STATUS.OPEN) {
    throw new Error('Only OPEN invoices can be voided.')
  }
  if (paymentsTotal(inv) > 0) {
    throw new Error('This invoice has recorded payments. Issue a credit note instead (Round 15).')
  }

  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const nowIso = new Date().toISOString()

  await updateDoc(doc(db, COLLECTION, id), {
    status: BRANCH_INVOICE_STATUS.VOID,
    voidReason: trimmed,
    voidedBy: uid,
    voidedByName: byName,
    voidedAt: nowIso,
    updatedAt: serverTimestamp(),
  })

  emitNotification({
    kind: 'service',
    title: `Branch invoice ${inv.code} voided`,
    body: trimmed,
    plateNo: inv.plateNo || null,
    receiptId: id,
    link: `/branch-invoices/${inv.code}`,
    branch: inv.branch || null,
    company: null,
  })

  return { id, at: nowIso }
}

// ── Payment recording ─────────────────────────────────────────────────────

export function paymentsTotal(invoice) {
  const arr = Array.isArray(invoice?.payments) ? invoice.payments : []
  return arr.reduce((s, p) => s + (Number(p?.amount) || 0), 0)
}

// Active (non-VOID) credit-note total stamped onto the invoice by the
// creditNotes module. Subtracted from the balance just like payments.
export function creditNotesTotal(invoice) {
  return Number(invoice?.creditNotesTotal) || 0
}

export function balanceDue(invoice) {
  return Math.max(0, (Number(invoice?.total) || 0) - paymentsTotal(invoice) - creditNotesTotal(invoice))
}

// Aging proxies — exact same logic as client invoices, just with the branch
// invoice doc as input. Branch invoices created before 14 ship don't carry
// a dueAtIso; the helpers safely return CURRENT in that case.
export function agingFor(invoice, now) { return clientAgingFor(invoice, now) }
export function isOverdue(invoice, now) { return clientIsOverdue(invoice, now) }
export function effectiveBranchStatus(invoice, now) { return clientEffectiveStatus(invoice, now) }

// Append a payment to a branch invoice. Mirrors recordPayment in
// clientInvoices: transactional so two simultaneous writes don't race past
// the total or both flip status. Auto-flips to PAID when balance hits zero.
export async function recordBranchPayment(id, { amount, method, reference, paidAtIso, note, byProfile } = {}) {
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
    if (inv.status === BRANCH_INVOICE_STATUS.VOID) {
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
        status: BRANCH_INVOICE_STATUS.PAID,
        paidAt: nowIso,
        paidBy: uid,
        paidByName: byName,
      } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })

    return { flipsToPaid, newBalance, newPaymentsTotal, invoiceCode: inv.code, plateNo: inv.plateNo, branch: inv.branch }
  })

  emitNotification({
    kind: 'service',
    title: result.flipsToPaid
      ? `Branch invoice ${result.invoiceCode} fully paid`
      : `Payment recorded — ${result.invoiceCode}`,
    body: result.flipsToPaid
      ? `${result.plateNo || ''} · ${result.branch || ''}`.trim()
      : `${formatMoneyShort(amt)} · balance ${formatMoneyShort(result.newBalance)}`,
    plateNo: result.plateNo || null,
    receiptId: id,
    link: `/branch-invoices/${result.invoiceCode}`,
    branch: result.branch || null,
    company: null, // branch hop is internal — client doesn't see it
  })

  return { id, ...result, paidAt: paidIso }
}

function formatMoneyShort(n) {
  if (!Number.isFinite(n)) return ''
  return `₱${Math.round(n).toLocaleString('en-PH')}`
}
