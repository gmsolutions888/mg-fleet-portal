// Service Quotations list — 3-party approval chain (Round 10).
//
// Customer view: only shows quotations that have been forwarded to the client
// (FOR_CLIENT_REVIEW / CLIENT_CLARIFICATION / CLIENT_REJECTED / APPROVED_FINAL).
// Big tap targets for Approve / Reject / Clarify on mobile.
//
// Staff view: every quotation in every status, so admin supervisors and MG
// Fleet managers can see what's sitting in their queue. Each row surfaces
// the single most relevant action based on the actor's role.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatMoney } from '../lib/dummyData'
import {
  QUOT_STATUS, QUOT_STATUS_LABELS, QUOT_ACTION,
  availableQuotationActions, effectiveQuotationStatus,
  transitionQuotation, watchReceipts,
} from '../lib/serviceReceipts'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import { isCustomer } from '../lib/roles'
import { profileCompany } from '../lib/vehicles'
import PageHero, { HeroStat } from '../components/ui/PageHero'

// Customer-visible statuses. Anything earlier than FOR_CLIENT_REVIEW is
// internal to MG Fleet + the branch.
const CUSTOMER_STATUSES = new Set([
  QUOT_STATUS.FOR_CLIENT_REVIEW,
  QUOT_STATUS.CLIENT_CLARIFICATION,
  QUOT_STATUS.CLIENT_REJECTED,
  QUOT_STATUS.APPROVED_FINAL,
])

const STAFF_TABS = [
  { key: 'NEEDS_ACTION',                label: 'Needs action' },
  { key: 'UNBILLED',                    label: 'Unbilled' },
  { key: QUOT_STATUS.DRAFT,             label: 'Draft' },
  { key: QUOT_STATUS.FOR_MG_FLEET_REVIEW, label: 'MG Fleet' },
  { key: QUOT_STATUS.FOR_CLIENT_REVIEW,   label: 'Client' },
  { key: QUOT_STATUS.CLIENT_CLARIFICATION, label: 'Clarify' },
  { key: QUOT_STATUS.APPROVED_FINAL,    label: 'Approved' },
  { key: QUOT_STATUS.CLIENT_REJECTED,   label: 'Rejected' },
  { key: 'ALL',                         label: 'All' },
]

const CUSTOMER_TABS = [
  { key: QUOT_STATUS.FOR_CLIENT_REVIEW,    label: 'For review' },
  { key: QUOT_STATUS.CLIENT_CLARIFICATION, label: 'Clarifying' },
  { key: QUOT_STATUS.APPROVED_FINAL,       label: 'Approved' },
  { key: QUOT_STATUS.CLIENT_REJECTED,      label: 'Rejected' },
  { key: 'ALL',                            label: 'All' },
]

export default function Quotations({ unbilledOnly = false, customerView: customerViewProp }) {
  const { profile } = useAuth()
  const customerView = customerViewProp ?? isCustomer(profile?.role)
  const companyFilter = customerView ? (profileCompany(profile) || '').toString() : null

  const [rows, setRows] = useState([])
  const [source, setSource] = useState('loading')
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState(customerView ? QUOT_STATUS.FOR_CLIENT_REVIEW : 'NEEDS_ACTION')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const opts = { kind: 'quotation' }
    if (companyFilter) opts.company = companyFilter
    const unsub = watchReceipts(opts, ({ rows, source }) => {
      setRows(rows); setSource(source)
    })
    return unsub
  }, [companyFilter])

  // Apply customer visibility filter once, then filter UI the rest downstream.
  const visible = useMemo(() => {
    if (!customerView) return rows
    return rows.filter((r) => CUSTOMER_STATUSES.has(effectiveQuotationStatus(r)))
  }, [rows, customerView])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return visible.filter((q) => {
      const s = effectiveQuotationStatus(q)
      if (statusTab === 'NEEDS_ACTION') {
        const actions = availableQuotationActions(q, profile)
        if (actions.length === 0) return false
      } else if (statusTab === 'UNBILLED') {
        // Round 28 — unbilled = not yet APPROVED_FINAL. Same semantics
        // as the legacy /quotations/unbilled route's unbilledOnly prop.
        if (s === QUOT_STATUS.APPROVED_FINAL) return false
      } else if (statusTab !== 'ALL' && s !== statusTab) {
        return false
      }
      if (unbilledOnly && s === QUOT_STATUS.APPROVED_FINAL) return false
      if (!term) return true
      return [q.code, q.plateNo, q.customer].filter(Boolean).join(' ').toLowerCase().includes(term)
    })
  }, [visible, search, statusTab, unbilledOnly, profile])

  const counts = useMemo(() => {
    const c = {
      NEEDS_ACTION: 0,
      UNBILLED: 0,
      ALL: visible.length,
      [QUOT_STATUS.DRAFT]: 0,
      [QUOT_STATUS.FOR_MG_FLEET_REVIEW]: 0,
      [QUOT_STATUS.FOR_CLIENT_REVIEW]: 0,
      [QUOT_STATUS.CLIENT_CLARIFICATION]: 0,
      [QUOT_STATUS.APPROVED_FINAL]: 0,
      [QUOT_STATUS.CLIENT_REJECTED]: 0,
    }
    for (const q of visible) {
      const s = effectiveQuotationStatus(q)
      if (c[s] != null) c[s]++
      if (availableQuotationActions(q, profile).length > 0) c.NEEDS_ACTION++
      if (s !== QUOT_STATUS.APPROVED_FINAL) c.UNBILLED++
    }
    return c
  }, [visible, profile])

  const tabs = customerView ? CUSTOMER_TABS : STAFF_TABS

  const runAction = async (q, action) => {
    if (!q.id || busy) return
    setBusy(q.id); setError(null)
    try {
      await transitionQuotation(q.id, {
        action: action.key,
        nextStatus: action.nextStatus,
        text: action.text || null,
        byProfile: profile,
      })
    } catch (err) {
      console.error('[quotation] transition failed:', err)
      setError(err.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const title = unbilledOnly ? 'Services for Quotation' : 'Service Quotations'
  const needsActionCount = counts.NEEDS_ACTION

  return (
    <div className="pb-24">
      <PageHero
        eyebrow={unbilledOnly ? 'SERVICES FOR QUOTATION' : 'QUOTATIONS'}
        title={title}
        subtitle={customerView
          ? (needsActionCount > 0 ? `${needsActionCount} awaiting your response` : 'All caught up')
          : `${visible.length} total · ${needsActionCount} need your action`}
        right={<HeroStat value={needsActionCount} label="TO ACT" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules.
        </div>
      )}
      {error && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Action failed: {error}
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Status tabs */}
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatusTab(t.key)}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                statusTab === t.key ? 'bg-brand text-white' : 'bg-white border text-gray-700'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${statusTab === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, plate, customer…"
            className="input pl-9"
          />
        </div>

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-sm">
              <div className="text-gray-400">No quotations match.</div>
              {!customerView && rows.length === 0 && (
                <div className="text-xs text-gray-500 mt-3">
                  Quotations are created from assessments.{' '}
                  <Link to="/appointments" className="text-brand font-bold hover:underline">Open Service Bookings →</Link>
                </div>
              )}
            </div>
          )}
          {filtered.map((q) => (
            <QuotationCard
              key={q.id || q.code}
              q={q}
              profile={profile}
              busy={busy === q.id}
              onAction={(action) => runAction(q, action)}
            />
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Plate No</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No quotations.</td></tr>
                )}
                {filtered.map((q) => {
                  const status = effectiveQuotationStatus(q)
                  const actions = availableQuotationActions(q, profile)
                  return (
                    <tr key={q.id || q.code} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono font-semibold text-brand">{q.code}</td>
                      <td className="px-4 py-2">{formatDate(q.dateCreated)}</td>
                      <td className="px-4 py-2">
                        <Link to={`/vehicles/${q.plateNo}`} className="font-semibold hover:underline">{q.plateNo}</Link>
                      </td>
                      <td className="px-4 py-2 uppercase">{q.customer}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatMoney(q.estimatedTotal)}</td>
                      <td className="px-4 py-2 text-right">
                        <StatusPill status={QUOT_STATUS_LABELS[status] || status} size="sm" />
                      </td>
                      <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                        <Link to={`/service-receipts/${q.code}`} className="text-brand hover:underline">View</Link>
                        {actions.length === 1 && !actions[0].requiresText && (
                          <button
                            disabled={busy === q.id}
                            onClick={() => runAction(q, actions[0])}
                            className="ml-3 text-brand font-semibold hover:underline disabled:opacity-40"
                          >
                            {actions[0].label}
                          </button>
                        )}
                        {(actions.length > 1 || (actions.length === 1 && actions[0].requiresText)) && (
                          <Link to={`/service-receipts/${q.code}`} className="ml-3 text-brand font-semibold hover:underline">
                            Act →
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {!customerView && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
          <Link
            to="/appointments"
            className="bg-brand hover:bg-brand-dark text-white px-4 sm:px-5 py-3 rounded-full font-bold text-sm flex items-center gap-2 shadow-xl"
            title="Quotations start from a booking → assessment. This takes you to the Bookings list."
          >
            <Icon name="plus" className="w-4 h-4" />
            New from Booking
          </Link>
        </div>
      )}
    </div>
  )
}

// Mobile quotation card. For actions that don't need text (e.g. "Forward to
// MG Fleet", "Approve"), render inline buttons; actions that need text
// (Reject, Clarify, Bounce) kick over to the detail view where the full
// comment thread lives.
function QuotationCard({ q, profile, busy, onAction }) {
  const status = effectiveQuotationStatus(q)
  const statusLabel = QUOT_STATUS_LABELS[status] || status
  const actions = availableQuotationActions(q, profile)
  const code = q.code
  const viewPath = `/service-receipts/${code}`

  // Split: inline one-tap vs. text-required (punt to detail view).
  const inlineActions = actions.filter((a) => !a.requiresText)
  const textActions   = actions.filter((a) =>  a.requiresText)

  // Highlight card when the CURRENT user has an action to take.
  const highlight = actions.length > 0

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${highlight ? 'border-amber-300 ring-1 ring-amber-200' : ''}`}>
      <Link to={viewPath} className="block p-4 hover:bg-gray-50">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="font-mono font-black text-brand text-sm">{code}</div>
          <StatusPill status={statusLabel} size="sm" />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-black text-gray-900 tracking-wide">{q.plateNo}</div>
          <div className="text-xl font-black text-gray-900">{formatMoney(q.estimatedTotal)}</div>
        </div>
        <div className="text-xs text-gray-500 uppercase mt-0.5 truncate">{q.customer}</div>
        <div className="text-[11px] text-gray-400 mt-1">{formatDate(q.dateCreated)}</div>
      </Link>

      {actions.length > 0 && (
        <div className={`p-3 border-t ${highlight ? 'bg-amber-50/60' : 'bg-gray-50'}`}>
          {inlineActions.length > 0 && (
            <div className={`grid ${inlineActions.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
              {inlineActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(action)}
                  className={`text-sm font-bold px-3 py-3 rounded-xl active:scale-95 transition-transform disabled:opacity-40 ${toneClasses(action.tone)}`}
                >
                  {toneLabel(action)}
                </button>
              ))}
            </div>
          )}
          {textActions.length > 0 && (
            <Link
              to={viewPath}
              className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-gray-600 hover:text-brand"
            >
              Open to {textActions.map((a) => a.label.toLowerCase()).join(' / ')} →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function toneClasses(tone) {
  switch (tone) {
    case 'danger': return 'bg-white border-2 border-red-300 text-red-600 hover:bg-red-50'
    case 'ghost':  return 'bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50'
    case 'primary':
    default:       return 'bg-green-600 hover:bg-green-700 text-white shadow'
  }
}

function toneLabel(action) {
  if (action.key === QUOT_ACTION.CLIENT_APPROVE) return `✓ ${action.label}`
  if (action.key === QUOT_ACTION.CLIENT_REJECT)  return `✕ ${action.label}`
  return action.label
}
