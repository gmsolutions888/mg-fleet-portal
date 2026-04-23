// Shared review-status state machine for assessments and quotations.
//
// Flow (both docs use the same field name `review_status`):
//
//   SUBMITTED ──► APPROVED_BY_BRANCH ──► SENT_TO_CLIENT  (terminal — visible)
//        │                │
//        │                └─► REJECTED_BY_FLEET_MANAGER  (back to branch)
//        │
//        └─► REJECTED_BY_BRANCH  (back to assessor / quotation author)
//
// Legacy docs written by mg-fms have no review_status field. They are treated
// as SENT_TO_CLIENT (grandfathered visible) so we don't suddenly hide existing
// assessments. New writes via createAssessment / createQuotation must stamp
// SUBMITTED.

export const REVIEW_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  APPROVED_BY_BRANCH: 'APPROVED_BY_BRANCH',
  SENT_TO_CLIENT: 'SENT_TO_CLIENT',
  REJECTED_BY_BRANCH: 'REJECTED_BY_BRANCH',
  REJECTED_BY_FLEET_MANAGER: 'REJECTED_BY_FLEET_MANAGER',
})

const VALID = new Set(Object.values(REVIEW_STATUS))

// Treat missing field as legacy/visible — see header note.
export function isVisibleToClient(status) {
  if (status == null) return true
  return status === REVIEW_STATUS.SENT_TO_CLIENT
}

// True if a branch reviewer should still see this in their queue.
export function isPendingBranchReview(status) {
  return status === REVIEW_STATUS.SUBMITTED
    || status === REVIEW_STATUS.REJECTED_BY_FLEET_MANAGER
}

// True if MG Fleet should still see this in their "to forward" queue.
export function isPendingFleetForward(status) {
  return status === REVIEW_STATUS.APPROVED_BY_BRANCH
}

// Display label + Tailwind tone for badges.
export function statusBadge(status) {
  switch (status) {
    case REVIEW_STATUS.SUBMITTED:
      return { label: 'Pending Branch Review', tone: 'bg-amber-100 text-amber-800 border-amber-200' }
    case REVIEW_STATUS.APPROVED_BY_BRANCH:
      return { label: 'Approved — Awaiting MG Fleet', tone: 'bg-blue-100 text-blue-800 border-blue-200' }
    case REVIEW_STATUS.SENT_TO_CLIENT:
      return { label: 'Sent to Client', tone: 'bg-green-100 text-green-800 border-green-200' }
    case REVIEW_STATUS.REJECTED_BY_BRANCH:
      return { label: 'Rejected by Branch', tone: 'bg-red-100 text-red-800 border-red-200' }
    case REVIEW_STATUS.REJECTED_BY_FLEET_MANAGER:
      return { label: 'Rejected by MG Fleet', tone: 'bg-red-100 text-red-800 border-red-200' }
    default:
      return { label: 'Legacy (no review)', tone: 'bg-gray-100 text-gray-600 border-gray-200' }
  }
}

// State machine. Returns the next status, or null if the transition is illegal.
// Transitions:
//   approve_at_branch:    SUBMITTED → APPROVED_BY_BRANCH
//   reject_at_branch:     SUBMITTED → REJECTED_BY_BRANCH
//   forward_to_client:    APPROVED_BY_BRANCH → SENT_TO_CLIENT
//   reject_at_fleet:      APPROVED_BY_BRANCH → REJECTED_BY_FLEET_MANAGER
//   resubmit:             REJECTED_* → SUBMITTED
export function nextStatus(current, action) {
  const c = current ?? REVIEW_STATUS.SUBMITTED
  if (!VALID.has(c)) return null
  if (action === 'approve_at_branch' && c === REVIEW_STATUS.SUBMITTED) return REVIEW_STATUS.APPROVED_BY_BRANCH
  if (action === 'reject_at_branch' && c === REVIEW_STATUS.SUBMITTED) return REVIEW_STATUS.REJECTED_BY_BRANCH
  if (action === 'forward_to_client' && c === REVIEW_STATUS.APPROVED_BY_BRANCH) return REVIEW_STATUS.SENT_TO_CLIENT
  if (action === 'reject_at_fleet' && c === REVIEW_STATUS.APPROVED_BY_BRANCH) return REVIEW_STATUS.REJECTED_BY_FLEET_MANAGER
  if (action === 'resubmit' && (c === REVIEW_STATUS.REJECTED_BY_BRANCH || c === REVIEW_STATUS.REJECTED_BY_FLEET_MANAGER)) return REVIEW_STATUS.SUBMITTED
  return null
}
