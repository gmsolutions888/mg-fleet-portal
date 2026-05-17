// Client-side billing snapshot — surfaces the status of money-things on
// the Portal dashboard so the client doesn't have to dig through tabs to
// answer "what do I need to act on?".
//
// Three buckets the client cares about:
//   1. Pending my approval — quotations sitting at FOR_CLIENT_REVIEW.
//   2. Open invoices — issued but not yet paid (broken into current vs
//      overdue).
//   3. Total outstanding — what they owe MG Fleet right now.
//
// Tappable: each card deep-links to the relevant filtered list. Empty
// state is friendly ("you're all caught up").

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney } from '../lib/dummyData'
import {
  CLIENT_INVOICE_STATUS, agingFor, watchClientInvoices,
} from '../lib/clientInvoices'
import {
  QUOT_STATUS, effectiveQuotationStatus, watchReceipts,
} from '../lib/serviceReceipts'

export default function ClientBillingSnapshot({ company, officerPlates }) {
  const [invoices, setInvoices] = useState([])
  const [quotations, setQuotations] = useState([])
  const [now, setNow] = useState(new Date())

  // Re-derive aging once a minute so the OVERDUE chip ticks at midnight.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!company) return () => {}
    const u1 = watchClientInvoices({ company }, ({ rows }) => setInvoices(rows))
    const u2 = watchReceipts({ kind: 'quotation', company }, ({ rows }) => setQuotations(rows))
    return () => { u1?.(); u2?.() }
  }, [company])

  // Filter by officer plates if scoped
  const scopedInvoices = useMemo(() => {
    if (!officerPlates) return invoices
    return invoices.filter((inv) => officerPlates.has((inv.plateNo || '').toUpperCase()))
  }, [invoices, officerPlates])

  const scopedQuotations = useMemo(() => {
    if (!officerPlates) return quotations
    return quotations.filter((q) => officerPlates.has((q.plateNo || '').toUpperCase()))
  }, [quotations, officerPlates])

  const stats = useMemo(() => {
    let openCount = 0
    let openTotal = 0
    let overdueCount = 0
    let overdueTotal = 0
    let paidCount = 0
    for (const inv of scopedInvoices) {
      if (inv.status === CLIENT_INVOICE_STATUS.OPEN) {
        const bal = Number(inv.balanceDue ?? inv.total) || 0
        openCount++
        openTotal += bal
        if (agingFor(inv, now).daysPastDue > 0) {
          overdueCount++
          overdueTotal += bal
        }
      } else if (inv.status === CLIENT_INVOICE_STATUS.PAID) {
        paidCount++
      }
    }
    let pendingApprovalCount = 0
    for (const q of scopedQuotations) {
      if (effectiveQuotationStatus(q) === QUOT_STATUS.FOR_CLIENT_REVIEW) {
        pendingApprovalCount++
      }
    }
    return { openCount, openTotal, overdueCount, overdueTotal, paidCount, pendingApprovalCount }
  }, [scopedInvoices, scopedQuotations, now])

  const allClear = stats.openCount === 0 && stats.pendingApprovalCount === 0

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-wider text-gray-800">
          <span>💳</span>
          <h2>Billing</h2>
        </div>
        <Link to="/portal/invoices" className="text-xs text-brand font-bold hover:underline">
          See all →
        </Link>
      </div>

      {allClear ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
          <div className="text-2xl mb-1">✅</div>
          <div className="font-bold text-emerald-800 text-sm">You're all caught up</div>
          <div className="text-xs text-emerald-700 mt-1">
            No quotations awaiting your approval and no open invoices.
            {stats.paidCount > 0 && ` ${stats.paidCount} invoice${stats.paidCount === 1 ? '' : 's'} paid in full.`}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <SnapshotCard
            to="/portal/quotations"
            tone={stats.pendingApprovalCount > 0 ? 'amber' : 'gray'}
            label="Awaiting your approval"
            value={stats.pendingApprovalCount}
            sub={stats.pendingApprovalCount === 0 ? 'Nothing to review' : 'Quotations'}
          />
          <SnapshotCard
            to="/portal/invoices"
            tone={stats.overdueCount > 0 ? 'red' : (stats.openCount > 0 ? 'sky' : 'gray')}
            label={stats.overdueCount > 0 ? 'Overdue invoices' : 'Open invoices'}
            value={stats.overdueCount > 0 ? stats.overdueCount : stats.openCount}
            sub={stats.overdueCount > 0
              ? `${formatMoney(stats.overdueTotal)} overdue`
              : (stats.openCount > 0 ? `${formatMoney(stats.openTotal)} due` : 'All paid')}
          />
          <SnapshotCard
            to="/portal/statement"
            tone="gray"
            label="Total outstanding"
            value={formatMoney(stats.openTotal)}
            sub="Statement of Account →"
            isMoney
          />
        </div>
      )}
    </section>
  )
}

function SnapshotCard({ to, tone, label, value, sub, isMoney }) {
  const palette = {
    gray:  'bg-white border-gray-200 text-gray-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    sky:   'bg-sky-50 border-sky-200 text-sky-900',
    red:   'bg-red-50 border-red-300 text-red-900',
  }
  const v = palette[tone] || palette.gray
  return (
    <Link to={to} className={`block rounded-2xl border-2 p-3 hover:shadow-md transition-shadow ${v}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</div>
      <div className={`font-black leading-tight mt-1 ${isMoney ? 'text-xl' : 'text-2xl'}`}>{value}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>
    </Link>
  )
}
