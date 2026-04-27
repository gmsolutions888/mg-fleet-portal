// Service Receipts + Quotations. Portal-owned collection; not shared with
// mg-fms. Quotations use the same collection with a different `kind` field and
// status flow — a receipt ("kind: receipt") is the final billing doc; a
// quotation ("kind: quotation") is the pre-billing estimate that goes through
// the 3-party approval chain (admin supervisor → MG Fleet manager → fleet
// client, with a clarification-comment loop back to the supervisor).

import {
  addDoc, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, orderBy,
  query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { emitNotification, fetchContextDoc } from './notifications'
import {
  canApproveQuotations, canForwardToClient, canReviewAtBranch, isCustomer,
} from './roles'

const COLLECTION = 'serviceReceipts'

// ── Quotation approval chain ──────────────────────────────────────────────
//
// DRAFT
//   └→ FOR_MG_FLEET_REVIEW   (admin supervisor forwards)
// FOR_MG_FLEET_REVIEW
//   ├→ FOR_CLIENT_REVIEW     (MG Fleet manager forwards to client)
//   └→ DRAFT                 (MG Fleet manager bounces back with a comment)
// FOR_CLIENT_REVIEW
//   ├→ APPROVED_FINAL        (client approves — repair unblocked)
//   ├→ CLIENT_REJECTED       (client rejects — terminal for now)
//   └→ CLIENT_CLARIFICATION  (client posts a question; bounces to supervisor)
// CLIENT_CLARIFICATION
//   └→ DRAFT                 (supervisor re-opens to address the question)
//
// Legacy docs from before Round 10 still carry OPEN / APPROVED / DISAPPROVED.
// effectiveQuotationStatus() displays them as their new-chain equivalents; we
// don't mutate old docs on read.
export const QUOT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  FOR_MG_FLEET_REVIEW: 'FOR_MG_FLEET_REVIEW',
  FOR_CLIENT_REVIEW: 'FOR_CLIENT_REVIEW',
  CLIENT_CLARIFICATION: 'CLIENT_CLARIFICATION',
  CLIENT_REJECTED: 'CLIENT_REJECTED',
  APPROVED_FINAL: 'APPROVED_FINAL',
})

const LEGACY_STATUS_MAP = Object.freeze({
  OPEN: QUOT_STATUS.FOR_CLIENT_REVIEW,   // old Quotations.jsx showed Approve/Reject on OPEN → client was in the approver seat
  APPROVED: QUOT_STATUS.APPROVED_FINAL,
  DISAPPROVED: QUOT_STATUS.CLIENT_REJECTED,
  REJECTED: QUOT_STATUS.CLIENT_REJECTED,
})

// Non-mutating display coercion. Use everywhere status is read for UI.
export function effectiveQuotationStatus(quot) {
  if (!quot) return null
  const raw = quot.status
  if (!raw) return QUOT_STATUS.DRAFT
  return LEGACY_STATUS_MAP[raw] || raw
}

export const QUOT_STATUS_LABELS = Object.freeze({
  [QUOT_STATUS.DRAFT]:                'Draft',
  [QUOT_STATUS.FOR_MG_FLEET_REVIEW]:  'For MG Fleet Review',
  [QUOT_STATUS.FOR_CLIENT_REVIEW]:    'For Client Review',
  [QUOT_STATUS.CLIENT_CLARIFICATION]: 'Clarification Requested',
  [QUOT_STATUS.CLIENT_REJECTED]:      'Rejected',
  [QUOT_STATUS.APPROVED_FINAL]:       'Approved',
})

// Allowed next-statuses from each state. Used both by transition validation
// and by the UI to know which buttons to show.
//
// Clarification requests skip the CLIENT_CLARIFICATION holding status and
// route straight back to DRAFT so the branch admin supervisor owns the
// response and can edit the line items directly. The client's note is
// preserved in the audit trail + comment thread so the supervisor has the
// full "why we're back at Draft" context.
// CLIENT_CLARIFICATION remains in the state machine only to handle any
// pre-existing docs stuck there from the initial Round 10 deploy.
const ALLOWED_NEXT = Object.freeze({
  [QUOT_STATUS.DRAFT]:                [QUOT_STATUS.FOR_MG_FLEET_REVIEW],
  [QUOT_STATUS.FOR_MG_FLEET_REVIEW]:  [QUOT_STATUS.FOR_CLIENT_REVIEW, QUOT_STATUS.DRAFT],
  [QUOT_STATUS.FOR_CLIENT_REVIEW]:    [QUOT_STATUS.APPROVED_FINAL, QUOT_STATUS.CLIENT_REJECTED, QUOT_STATUS.DRAFT],
  [QUOT_STATUS.CLIENT_CLARIFICATION]: [QUOT_STATUS.DRAFT],
  [QUOT_STATUS.CLIENT_REJECTED]:      [QUOT_STATUS.DRAFT],
  [QUOT_STATUS.APPROVED_FINAL]:       [],
})

// Short codes for the audit log entries (drives notification wording too).
// Not the same shape as status — some actions don't change status alone.
export const QUOT_ACTION = Object.freeze({
  FORWARD_TO_MGFLEET: 'forward_to_mgfleet',
  FORWARD_TO_CLIENT:  'forward_to_client',
  BOUNCE_TO_SUPERVISOR: 'bounce_to_supervisor',
  CLIENT_APPROVE:     'client_approve',
  CLIENT_REJECT:      'client_reject',
  CLIENT_CLARIFY:     'client_clarify',
  REOPEN_TO_DRAFT:    'reopen_to_draft',
  COMMENT:            'comment',
})

function actorRoleFor(profile) {
  if (!profile) return 'unknown'
  if (profile.is_admin && profile.role === 'mg_fleet_manager') return 'mg_fleet_manager'
  if (canForwardToClient(profile.role)) return 'mg_fleet_manager'
  if (profile.is_admin) return 'mg_fleet_manager' // shared-admin escape hatch acts as MG Fleet mgr
  if (canReviewAtBranch(profile.role)) return 'admin_supervisor'
  if (canApproveQuotations(profile.role) || isCustomer(profile.role)) return 'fleet_client'
  return profile.role || 'unknown'
}

export function availableQuotationActions(quot, profile) {
  if (!quot || !profile) return []
  const status = effectiveQuotationStatus(quot)
  const actor = actorRoleFor(profile)
  // is_admin is the portal-wide escape hatch: the shared-admin account plays
  // every role on both sides of the chain. Without this, a single admin
  // can't test end-to-end (and in prod, the admin acts as both MG Fleet mgr
  // AND client approver for their own company). Admin sees every action
  // permitted at the current status.
  const isAdminEscape = Boolean(profile.is_admin)
  const out = []

  const push = (key, label, nextStatus, tone = 'primary', requiresText = false) =>
    out.push({ key, label, nextStatus, tone, requiresText })

  if (status === QUOT_STATUS.DRAFT) {
    if (isAdminEscape || actor === 'admin_supervisor' || actor === 'mg_fleet_manager') {
      push(QUOT_ACTION.FORWARD_TO_MGFLEET, 'Forward to MG Fleet', QUOT_STATUS.FOR_MG_FLEET_REVIEW)
    }
  } else if (status === QUOT_STATUS.FOR_MG_FLEET_REVIEW) {
    if (isAdminEscape || actor === 'mg_fleet_manager') {
      push(QUOT_ACTION.FORWARD_TO_CLIENT, 'Forward to client', QUOT_STATUS.FOR_CLIENT_REVIEW)
      push(QUOT_ACTION.BOUNCE_TO_SUPERVISOR, 'Bounce back to supervisor', QUOT_STATUS.DRAFT, 'ghost', true)
    }
  } else if (status === QUOT_STATUS.FOR_CLIENT_REVIEW) {
    if (isAdminEscape || actor === 'fleet_client') {
      push(QUOT_ACTION.CLIENT_APPROVE, 'Approve', QUOT_STATUS.APPROVED_FINAL, 'primary')
      push(QUOT_ACTION.CLIENT_REJECT, 'Reject', QUOT_STATUS.CLIENT_REJECTED, 'danger', true)
      // Clarification bounces straight to DRAFT — supervisor owns the edit.
      push(QUOT_ACTION.CLIENT_CLARIFY, 'Request clarification', QUOT_STATUS.DRAFT, 'ghost', true)
    }
  } else if (status === QUOT_STATUS.CLIENT_CLARIFICATION) {
    // Legacy holding status — any pre-existing doc stuck here can be
    // re-opened so the supervisor can address the comment and resubmit.
    if (isAdminEscape || actor === 'admin_supervisor' || actor === 'mg_fleet_manager') {
      push(QUOT_ACTION.REOPEN_TO_DRAFT, 'Re-open as draft to address', QUOT_STATUS.DRAFT)
    }
  } else if (status === QUOT_STATUS.CLIENT_REJECTED) {
    if (isAdminEscape || actor === 'admin_supervisor' || actor === 'mg_fleet_manager') {
      push(QUOT_ACTION.REOPEN_TO_DRAFT, 'Re-open as draft', QUOT_STATUS.DRAFT, 'ghost')
    }
  }

  return out
}

function profileDisplayName(profile) {
  return (
    profile?.user_fullname ||
    profile?.user_name ||
    profile?.name ||
    profile?.email ||
    'Unknown'
  )
}

// Core writer for the chain. All chain transitions go through here so the
// audit trail, comments, and notifications stay consistent.
//
// payload: { action, nextStatus, text?, byProfile }
//   action    — one of QUOT_ACTION. Drives notification wording.
//   nextStatus — one of QUOT_STATUS. Validated against ALLOWED_NEXT.
//   text      — required for clarify / reject / bounce. Becomes both the
//               audit note AND a comment thread entry so the whole
//               conversation is visible in one place.
//   byProfile — current user's profile (needed for byName + actor role).
export async function transitionQuotation(id, { action, nextStatus, text, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing quotation id.')
  if (!action || !nextStatus) throw new Error('Missing action or nextStatus.')

  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) throw new Error('Quotation not found.')
  const quot = { id: snap.id, ...snap.data() }
  if (quot.kind !== 'quotation') throw new Error('Only quotations use the approval chain.')

  const currentStatus = effectiveQuotationStatus(quot)
  const allowed = ALLOWED_NEXT[currentStatus] || []
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Cannot go from ${currentStatus} to ${nextStatus}.`)
  }

  // Round 39 — block forward transitions when any line is unpriced.
  // Reverse / lateral moves (rejection, clarification request, reopen
  // as draft) are still allowed; only the forward path needs every
  // line priced so the client never sees a quote with ₱0 totals.
  const FORWARD_STATUSES = new Set([
    QUOT_STATUS.FOR_MG_FLEET_REVIEW,
    QUOT_STATUS.FOR_CLIENT_REVIEW,
    QUOT_STATUS.APPROVED_FINAL,
  ])
  if (FORWARD_STATUSES.has(nextStatus)) {
    const unpriced = (quot.items || []).filter((i) => Number(i.unitCost) <= 0)
    if (unpriced.length > 0) {
      const codes = unpriced.map((i) => i.description || 'untitled item').slice(0, 3).join(', ')
      const more = unpriced.length > 3 ? ` and ${unpriced.length - 3} more` : ''
      throw new Error(`${unpriced.length} line item${unpriced.length === 1 ? '' : 's'} still at ₱0 (${codes}${more}). Set unit costs before forwarding.`)
    }
  }

  const uid = auth?.currentUser?.uid || null
  const byName = profileDisplayName(byProfile)
  const byRole = actorRoleFor(byProfile)
  const note = (text || '').trim() || null
  const nowIso = new Date().toISOString()

  const auditEntry = {
    action,
    from: currentStatus,
    to: nextStatus,
    by: uid,
    byName,
    byRole,
    at: nowIso,
    note,
  }

  const writes = {
    status: nextStatus,
    audit: arrayUnion(auditEntry),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }

  // If the action carries a note (bounce, reject, clarify), mirror it into
  // the comment thread so all three parties see the conversation in one spot.
  if (note) {
    writes.comments = arrayUnion({
      kind: 'action',
      action,
      by: uid,
      byName,
      byRole,
      at: nowIso,
      text: note,
    })
  }

  await updateDoc(doc(db, COLLECTION, id), writes)

  // Notifications per action. Audience routing (branch vs. company) is
  // already handled by emitNotification — we set branch/company on the
  // notification doc and let watchNotifications filter.
  const code = quot.code || id
  const plate = quot.plateNo || ''
  const notifBase = {
    plateNo: plate,
    receiptId: id,
    link: `/service-receipts/${code}`,
    branch: quot.branch || null,
  }

  if (action === QUOT_ACTION.FORWARD_TO_MGFLEET) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} forwarded for MG Fleet review`,
      body: `${plate} · awaiting ${byRole === 'admin_supervisor' ? 'MG Fleet manager' : 'review'}`.trim(),
      company: null, // admin-audience only at this hop
    })
  } else if (action === QUOT_ACTION.FORWARD_TO_CLIENT) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} — awaiting your approval`,
      body: `${plate} · forwarded by MG Fleet`,
      company: quot.company || null, // target the client
    })
  } else if (action === QUOT_ACTION.BOUNCE_TO_SUPERVISOR) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} returned for revision`,
      body: note || 'MG Fleet requested changes',
      company: null,
    })
  } else if (action === QUOT_ACTION.CLIENT_APPROVE) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} — APPROVED by client`,
      body: `${plate} · repair unblocked`,
      company: null, // client just clicked; notify MG Fleet + branch
    })
  } else if (action === QUOT_ACTION.CLIENT_REJECT) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} rejected by client`,
      body: note || null,
      company: null,
    })
  } else if (action === QUOT_ACTION.CLIENT_CLARIFY) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Client requested clarification — ${code}`,
      body: note || 'See comment thread.',
      company: null, // alert MG Fleet + supervisor
    })
  } else if (action === QUOT_ACTION.REOPEN_TO_DRAFT) {
    emitNotification({
      ...notifBase,
      kind: 'approval',
      title: `Quotation ${code} re-opened as draft`,
      body: `${plate} · ready for supervisor revision`,
      company: null,
    })
  }

  return { id, from: currentStatus, to: nextStatus, at: nowIso }
}

// Can this profile edit the line items on this quotation right now? Only at
// DRAFT status and only for the supervisor/admin who owns the draft — fleet
// clients never edit; MG Fleet manager forwards without editing (the intent
// of bouncing back is to let the supervisor revise).
export function canEditQuotation(quot, profile) {
  if (!quot || !profile) return false
  if (effectiveQuotationStatus(quot) !== QUOT_STATUS.DRAFT) return false
  if (profile.is_admin) return true
  const actor = actorRoleFor(profile)
  return actor === 'admin_supervisor'
}

// Update the line items (and notes) on a DRAFT quotation. Recomputes labor +
// materials totals so downstream callers don't have to. Appends an audit
// entry so the revision shows up in the approval trail.
export async function updateQuotationItems(id, { items, notes, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing quotation id.')

  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) throw new Error('Quotation not found.')
  const quot = { id: snap.id, ...snap.data() }
  if (quot.kind !== 'quotation') throw new Error('Only quotations can be edited via this helper.')
  if (!canEditQuotation(quot, byProfile)) {
    throw new Error('Quotation is not editable in its current state.')
  }

  const cleaned = (items || []).map((i) => ({
    type: i.type || 'Parts/Materials',
    qty: Number(i.qty) || 1,
    description: String(i.description || '').toUpperCase(),
    unitCost: Number(i.unitCost) || 0,
    subTotal: (Number(i.qty) || 1) * (Number(i.unitCost) || 0),
  }))
  const laborTotal = cleaned.filter((i) => i.type === 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const materialsTotal = cleaned.filter((i) => i.type !== 'Labor').reduce((s, i) => s + i.subTotal, 0)

  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()
  const byName = profileDisplayName(byProfile)
  const byRole = actorRoleFor(byProfile)

  await updateDoc(doc(db, COLLECTION, id), {
    items: cleaned,
    laborTotal,
    materialsTotal,
    estimatedTotal: laborTotal + materialsTotal,
    notes: notes ?? quot.notes ?? '',
    audit: arrayUnion({
      action: 'edit_items',
      from: QUOT_STATUS.DRAFT,
      to: QUOT_STATUS.DRAFT,
      by: uid,
      byName,
      byRole,
      at: nowIso,
      note: `Revised to ${cleaned.length} item${cleaned.length === 1 ? '' : 's'} (${formatCurrencyShort(laborTotal + materialsTotal)})`,
    }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })

  return { id, itemCount: cleaned.length, estimatedTotal: laborTotal + materialsTotal }
}

function formatCurrencyShort(n) {
  if (!Number.isFinite(n)) return ''
  return `₱${Math.round(n).toLocaleString('en-PH')}`
}

// Can this profile add a mid-repair revision to an APPROVED_FINAL quotation?
// Only supervisors / admins, only from APPROVED_FINAL, AND only before a
// branch invoice has been issued. Round 39: once we've billed the branch
// invoice off this quote, the quote is locked — you can't retroactively
// add line items to a job that's already been invoiced. The path forward
// is a credit note (Round 15) or a new quotation, not a back-edit.
export function canAddRevision(quot, profile) {
  if (!quot || !profile) return false
  if (effectiveQuotationStatus(quot) !== QUOT_STATUS.APPROVED_FINAL) return false
  if (quot.branchInvoiceCode || quot.branchInvoiceId || quot.branchInvoicedAt) return false
  if (profile.is_admin) return true
  const actor = actorRoleFor(profile)
  return actor === 'admin_supervisor'
}

// Current revision round on a quotation. Legacy / unmigrated docs default to
// 1 (the original approved set). Every addQuotationRevision call increments.
export function currentRevisionRound(quot) {
  const n = Number(quot?.revisionRound)
  return Number.isFinite(n) && n > 0 ? n : 1
}

// Append new line items to an APPROVED_FINAL quotation and re-start the
// approval chain for the delta. Existing items are preserved verbatim — the
// supervisor can't retroactively edit approved items mid-repair. The UI
// surfaces "what's new" by grouping items by their revisionRound stamp.
//
// payload: { newItems: [{type, qty, description, unitCost}], notes?, byProfile }
export async function addQuotationRevision(id, { newItems, notes, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  if (!id) throw new Error('Missing quotation id.')
  const incoming = (newItems || []).filter((i) => i && String(i.description || '').trim())
  if (incoming.length === 0) throw new Error('Add at least one line item to revise.')
  // Round 39 — revisions reset the chain to FOR_MG_FLEET_REVIEW, so
  // they must come in already priced. Block submission of any
  // unpriced revision items.
  const unpriced = incoming.filter((i) => Number(i.unitCost) <= 0)
  if (unpriced.length > 0) {
    throw new Error(`${unpriced.length} new revision item${unpriced.length === 1 ? '' : 's'} still at ₱0. Set unit costs before adding the revision.`)
  }

  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) throw new Error('Quotation not found.')
  const quot = { id: snap.id, ...snap.data() }
  if (quot.kind !== 'quotation') throw new Error('Only quotations can be revised.')
  if (!canAddRevision(quot, byProfile)) {
    if (quot.branchInvoiceCode || quot.branchInvoiceId) {
      throw new Error(`Quotation is locked — branch invoice ${quot.branchInvoiceCode || ''} already issued. Use a credit note or a new quotation instead of revising.`)
    }
    throw new Error('Revisions can only be added to approved quotations by a supervisor or admin.')
  }

  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()
  const byName = profileDisplayName(byProfile)
  const byRole = actorRoleFor(byProfile)
  const nextRevision = currentRevisionRound(quot) + 1

  const stampedNew = incoming.map((i) => {
    const qty = Number(i.qty) || 1
    const unitCost = Number(i.unitCost) || 0
    return {
      type: i.type || 'Parts/Materials',
      qty,
      description: String(i.description || '').toUpperCase(),
      unitCost,
      subTotal: qty * unitCost,
      // Revision provenance — carried per-item so the UI can group and
      // highlight what's new without needing a separate subcollection.
      revisionRound: nextRevision,
      addedAt: nowIso,
      addedBy: uid,
      addedByName: byName,
    }
  })

  const merged = [...(quot.items || []), ...stampedNew]
  const laborTotal = merged.filter((i) => i.type === 'Labor').reduce((s, i) => s + (i.subTotal || i.qty * i.unitCost), 0)
  const materialsTotal = merged.filter((i) => i.type !== 'Labor').reduce((s, i) => s + (i.subTotal || i.qty * i.unitCost), 0)
  const newGrand = laborTotal + materialsTotal
  const deltaTotal = stampedNew.reduce((s, i) => s + i.subTotal, 0)

  const auditEntry = {
    action: 'add_revision',
    from: QUOT_STATUS.APPROVED_FINAL,
    to: QUOT_STATUS.FOR_MG_FLEET_REVIEW,
    by: uid,
    byName,
    byRole,
    at: nowIso,
    note: `Revision ${nextRevision}: +${stampedNew.length} item${stampedNew.length === 1 ? '' : 's'} (${formatCurrencyShort(deltaTotal)})`,
  }

  await updateDoc(doc(db, COLLECTION, id), {
    items: merged,
    laborTotal,
    materialsTotal,
    estimatedTotal: newGrand,
    notes: notes ?? quot.notes ?? '',
    revisionRound: nextRevision,
    // Revisions re-run the chain — MG Fleet manager reviews, then client
    // approves the delta before the supervisor can continue the extra work.
    status: QUOT_STATUS.FOR_MG_FLEET_REVIEW,
    audit: arrayUnion(auditEntry),
    comments: arrayUnion({
      kind: 'action',
      action: 'add_revision',
      by: uid,
      byName,
      byRole,
      at: nowIso,
      text: auditEntry.note,
    }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })

  emitNotification({
    kind: 'approval',
    title: `Quotation ${quot.code || id} — Revision ${nextRevision} for review`,
    body: `${quot.plateNo || ''} · ${stampedNew.length} new item${stampedNew.length === 1 ? '' : 's'} (${formatCurrencyShort(deltaTotal)})`.trim(),
    plateNo: quot.plateNo || null,
    receiptId: id,
    link: `/service-receipts/${quot.code || id}`,
    branch: quot.branch || null,
    company: null, // internal hop — client learns about it when MG Fleet forwards
  })

  return { id, revision: nextRevision, delta: deltaTotal, estimatedTotal: newGrand }
}

// One-shot: does this plate have at least one APPROVED_FINAL quotation? Used
// by the appointment ONGOING gate (Round 11) to block repair-start until the
// fleet client has signed off on the scope.
//
// Plate match is normalized (uppercase, no spaces) to tolerate user input
// drift.
export async function hasApprovedQuotationForPlate(plateRaw) {
  if (!db || !plateRaw) return false
  const norm = String(plateRaw).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('kind', '==', 'quotation'),
      where('plateNo', '==', norm),
    ))
    for (const d of snap.docs) {
      const data = d.data()
      if (effectiveQuotationStatus(data) === QUOT_STATUS.APPROVED_FINAL) return true
    }
    return false
  } catch (err) {
    console.warn('[quotation] hasApprovedQuotationForPlate failed:', err?.message || err)
    return false
  }
}

// Returns the most recent APPROVED_FINAL quotation doc for a plate, or
// null if none. Used by the post-assessment CTA to switch from "Create
// Quotation" to "Proceed to Invoice" once an approved quote exists for
// the plate (typically after a re-assessment closes the loop).
export async function getApprovedQuotationForPlate(plateRaw) {
  if (!db || !plateRaw) return null
  const norm = String(plateRaw).toUpperCase().replace(/\s+/g, '')
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('kind', '==', 'quotation'),
      where('plateNo', '==', norm),
    ))
    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((q) => effectiveQuotationStatus(q) === QUOT_STATUS.APPROVED_FINAL)
    if (candidates.length === 0) return null
    // Sort by createdAt / updatedAt desc, newest first.
    candidates.sort((a, b) => {
      const ax = Date.parse(a.updatedAt?.toDate?.()?.toISOString?.() || a.updatedAt || a.createdAt || 0) || 0
      const bx = Date.parse(b.updatedAt?.toDate?.()?.toISOString?.() || b.updatedAt || b.createdAt || 0) || 0
      return bx - ax
    })
    return candidates[0]
  } catch (err) {
    console.warn('[quotation] getApprovedQuotationForPlate failed:', err?.message || err)
    return null
  }
}

// Free-text comment, posted without changing status. Any party in the chain
// can add one. Shows up in the same thread as action-notes.
export async function addQuotationComment(id, { text, byProfile }) {
  if (!db) throw new Error('Firestore not configured.')
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('Comment text is required.')

  const uid = auth?.currentUser?.uid || null
  const nowIso = new Date().toISOString()
  const byName = profileDisplayName(byProfile)
  const byRole = actorRoleFor(byProfile)

  await updateDoc(doc(db, COLLECTION, id), {
    comments: arrayUnion({
      kind: 'comment',
      by: uid,
      byName,
      byRole,
      at: nowIso,
      text: trimmed,
    }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })

  return { id, at: nowIso }
}

export function watchReceipts(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured', loading: false, error: null }); return () => {} }
  // Round 31 — dummy fallback removed; production users now see an
  // empty list when there's no real data.
  // Round 27.2 fix — drop orderBy when filters are applied to avoid
  // requiring composite indexes for every where+order combo.
  const filters = []
  if (options?.kind) filters.push(where('kind', '==', options.kind))
  if (options?.branch) filters.push(where('branch', '==', options.branch))
  if (options?.company) filters.push(where('company', '==', options.company))
  const q = filters.length > 0
    ? query(collection(db, COLLECTION), ...filters)
    : query(collection(db, COLLECTION), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (filters.length > 0) {
        rows.sort((a, b) => {
          const ax = Date.parse(
            a?.createdAt?.toDate?.()?.toISOString?.() || a?.createdAt || a?.created_at || '',
          ) || 0
          const bx = Date.parse(
            b?.createdAt?.toDate?.()?.toISOString?.() || b?.createdAt || b?.created_at || '',
          ) || 0
          return bx - ax
        })
      }
      cb({ rows, source: 'firestore', loading: false, error: null })
    },
    (err) => {
      console.warn('[serviceReceipts] listener error:', err)
      cb({ rows: [], source: 'error', loading: false, error: err })
    },
  )
}

// Live subscription by code. Used by ServiceReceiptDetails so the approval
// chain's status + audit trail + comments update in real time without the
// user having to reload — especially important while two parties are going
// back and forth over the comment thread.
export function watchReceiptByCode(code, cb) {
  if (!db || !code) { cb({ receipt: null, source: 'unconfigured' }); return () => {} }
  // Fall back to direct-id fetch if not found by code — covers the rare case
  // of someone pasting a Firestore doc id in the URL.
  const q = query(collection(db, COLLECTION), where('code', '==', code))
  let unsubCode = null
  let unsubId = null
  try {
    unsubCode = onSnapshot(q, async (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0]
        cb({ receipt: { id: d.id, ...d.data() }, source: 'firestore' })
        return
      }
      // No match by code — try as doc id, one-shot only so we don't double-listen.
      try {
        const direct = await getDoc(doc(db, COLLECTION, code))
        if (direct.exists()) {
          cb({ receipt: { id: direct.id, ...direct.data() }, source: 'firestore' })
        } else {
          cb({ receipt: null, source: 'firestore' })
        }
      } catch (err) {
        cb({ receipt: null, source: 'error', error: err })
      }
    }, (err) => {
      console.warn('[serviceReceipts] watchReceiptByCode failed:', err)
      cb({ receipt: null, source: 'error', error: err })
    })
  } catch (err) {
    cb({ receipt: null, source: 'error', error: err })
  }
  return () => { try { unsubCode?.() } catch {} try { unsubId?.() } catch {} }
}

export async function getReceipt(codeOrId) {
  if (!db) return null
  // First try as a direct doc id
  try {
    const direct = await getDoc(doc(db, COLLECTION, codeOrId))
    if (direct.exists()) return { id: direct.id, ...direct.data() }
  } catch {}
  // Fall back to finding by `code`
  const snap = await new Promise((resolve, reject) => {
    const unsub = onSnapshot(
      query(collection(db, COLLECTION), where('code', '==', codeOrId)),
      (s) => { unsub(); resolve(s) },
      reject,
    )
  })
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }
  return null
}

export async function createReceipt(kind, data) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  const prefix = kind === 'quotation' ? 'SQ' : 'Q'
  const branch = (data.branch || 'MGCAVITE').toUpperCase()
  const legacyId = Date.now().toString(36).toUpperCase()
  const code = data.code || `${prefix}-${branch}-${legacyId}`

  const items = (data.items || []).map((i) => ({
    type: i.type || 'Parts/Materials',
    qty: Number(i.qty) || 1,
    description: String(i.description || '').toUpperCase(),
    unitCost: Number(i.unitCost) || 0,
    subTotal: (Number(i.qty) || 1) * (Number(i.unitCost) || 0),
  }))

  const laborTotal = items.filter((i) => i.type === 'Labor').reduce((s, i) => s + i.subTotal, 0)
  const materialsTotal = items.filter((i) => i.type !== 'Labor').reduce((s, i) => s + i.subTotal, 0)

  const ref = await addDoc(collection(db, COLLECTION), {
    kind,
    code,
    plateNo: (data.plateNo || '').toUpperCase().replace(/\s+/g, ''),
    brandModel: data.brandModel || '',
    latestOdo: Number(data.latestOdo) || 0,
    customer: data.customer || '',
    mobile: data.mobile || '',
    company: data.company || null,
    branch,
    mechanic: data.mechanic || '',
    personInCharge: data.personInCharge || '',
    scheduleType: data.scheduleType || 'SCHEDULED',
    items,
    laborTotal,
    materialsTotal,
    estimatedTotal: laborTotal + materialsTotal,
    missingParts: Number(data.missingParts) || 0,
    notes: data.notes || '',
    // Round 30 — link back to the assessment that drove this quote so
    // the client can review findings before approving + downstream
    // pages can deep-link to it.
    sourceAssessmentRwa: data.sourceAssessmentRwa || null,
    // Quotations start at DRAFT and walk the approval chain; receipts stay
    // on the legacy OPEN/PAID/CANCELLED flow until Round 12.
    status: kind === 'quotation' ? QUOT_STATUS.DRAFT : 'OPEN',
    audit: kind === 'quotation'
      ? [{
          action: 'create',
          from: null,
          to: QUOT_STATUS.DRAFT,
          by: uid,
          byName: profileDisplayName(data.byProfile || null),
          byRole: actorRoleFor(data.byProfile || null),
          at: new Date().toISOString(),
          note: null,
        }]
      : [],
    comments: [],
    createdAt: serverTimestamp(),
    dateCreated: new Date().toISOString().slice(0, 10),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const fleet = Boolean(data.company)
  const plate = (data.plateNo || '').toUpperCase().replace(/\s+/g, '')
  emitNotification({
    kind: kind === 'quotation' ? 'quotation' : 'service',
    title: kind === 'quotation'
      ? `Quotation ${code} drafted for ${plate}`
      : `Receipt ${code} issued for ${plate}`,
    // Quotations start as drafts — client doesn't see them until the
    // supervisor + MG Fleet manager forward through the approval chain.
    body: kind === 'quotation' ? 'Draft — awaiting supervisor forward' : null,
    plateNo: plate,
    receiptId: ref.id,
    link: kind === 'quotation' ? `/service-receipts/${code}` : `/service-receipts/${code}`,
    branch,
    // Receipts notify the fleet client directly; quotations stay internal
    // until forwarded through the chain.
    company: kind === 'quotation' ? null : (fleet ? data.company : null),
  })
  return { id: ref.id, code }
}

export async function setReceiptStatus(id, nextStatus) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  await updateDoc(doc(db, COLLECTION, id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  const rec = await fetchContextDoc(COLLECTION, id)
  if (!rec) return
  const isQuote = rec.kind === 'quotation'
  const code = rec.code || id
  const plate = rec.plateNo || ''
  let title = null
  let notifyCompany = rec.company || null
  if (nextStatus === 'APPROVED' || nextStatus === 'DISAPPROVED' || nextStatus === 'REJECTED') {
    title = `Quotation ${code} ${nextStatus.toLowerCase()} by ${rec.company || 'client'}`
    // Client just clicked the button — don't notify them of their own action.
    notifyCompany = null
  } else if (nextStatus === 'PAID') {
    title = `Receipt ${code} paid — ${plate}`
  } else if (nextStatus === 'CANCELLED') {
    title = `${isQuote ? 'Quotation' : 'Receipt'} ${code} cancelled`
    notifyCompany = null
  }
  if (!title) return
  emitNotification({
    kind: isQuote ? 'approval' : 'service',
    title,
    plateNo: plate,
    receiptId: id,
    link: isQuote ? '/quotations' : `/service-receipts/${code}`,
    branch: rec.branch || null,
    company: notifyCompany,
  })
}
