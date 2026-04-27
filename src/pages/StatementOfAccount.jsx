// Statement of Account — printable per-company aging document. Two surfaces:
//   - Staff:    /reports/soa/:company   (param-driven)
//   - Customer: /portal/statement       (reads from profile)
// Both render the same component. Customer view hides nothing (clients
// should see exactly what they owe, broken down by invoice).

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatMoney, formatDate } from '../lib/dummyData'
import {
  CLIENT_INVOICE_STATUS, agingFor, watchClientInvoices,
} from '../lib/clientInvoices'
import { profileCompany } from '../lib/vehicles'
import Icon from '../components/ui/Icon'
import PageHero from '../components/ui/PageHero'

export default function StatementOfAccount({ customerView = false }) {
  const { profile } = useAuth()
  const { company: companyParam } = useParams()
  const company = customerView
    ? (profileCompany(profile) || '').toString()
    : decodeURIComponent(companyParam || '')

  const [rows, setRows] = useState([])
  const [source, setSource] = useState('loading')
  const [now] = useState(new Date())

  useEffect(() => {
    if (!company) { setRows([]); setSource('no-company'); return () => {} }
    const unsub = watchClientInvoices({ company }, ({ rows, source }) => {
      setRows(rows); setSource(source)
    })
    return unsub
  }, [company])

  const open = useMemo(() => {
    return rows
      .filter((r) => r.status === CLIENT_INVOICE_STATUS.OPEN)
      .map((r) => ({ ...r, _aging: agingFor(r, now) }))
      .sort((a, b) => Date.parse(a.issuedAtIso || 0) - Date.parse(b.issuedAtIso || 0))
  }, [rows, now])

  const totals = useMemo(() => {
    const t = { count: open.length, outstanding: 0, overdue: 0, bucketTotal: { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_PLUS': 0 } }
    for (const inv of open) {
      const bal = Number(inv.balanceDue ?? inv.total) || 0
      t.outstanding += bal
      t.bucketTotal[inv._aging.bucket] += bal
      if (inv._aging.bucket !== 'CURRENT') t.overdue += bal
    }
    return t
  }, [open])

  if (!company) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          {customerView
            ? 'No fleet company set on your profile — ask your admin to link it.'
            : 'No company selected.'}
        </div>
      </div>
    )
  }

  return (
    <div className="pb-32">
      <PageHero
        eyebrow={customerView ? 'YOUR ACCOUNT' : 'STATEMENT OF ACCOUNT'}
        title={company}
        subtitle={`${totals.count} open invoice${totals.count === 1 ? '' : 's'} · ${formatMoney(totals.outstanding)} outstanding · As of ${formatDate(now.toISOString())}`}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Aging totals card — also useful at top of a printed SOA */}
        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Aging Summary
          </div>
          <div className="grid grid-cols-5 divide-x">
            <Bucket label="Current" total={totals.bucketTotal.CURRENT} />
            <Bucket label="1–30"    total={totals.bucketTotal['1_30']}  warn />
            <Bucket label="31–60"   total={totals.bucketTotal['31_60']} warn />
            <Bucket label="61–90"   total={totals.bucketTotal['61_90']} warn />
            <Bucket label="90+"     total={totals.bucketTotal['90_PLUS']} warn strong />
          </div>
          <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest">Total Outstanding</span>
            <span className="text-2xl font-black">{formatMoney(totals.outstanding)}</span>
          </div>
        </div>

        {open.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-500 text-sm">
            No open invoices for this company. The account is paid in full.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
              Open Invoices ({open.length})
            </div>

            {/* Mobile: stacked */}
            <div className="lg:hidden divide-y">
              {open.map((inv) => <SoaRowCard key={inv.id || inv.code} inv={inv} />)}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Invoice</th>
                    <th className="px-4 py-2 text-left font-medium">Plate</th>
                    <th className="px-4 py-2 text-left font-medium">Issued</th>
                    <th className="px-4 py-2 text-left font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Paid</th>
                    <th className="px-4 py-2 text-right font-medium">Credits</th>
                    <th className="px-4 py-2 text-right font-medium">Balance</th>
                    <th className="px-4 py-2 text-center font-medium">Aging</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {open.map((inv) => {
                    const balance = Number(inv.balanceDue ?? inv.total) || 0
                    const paid = Number(inv.paymentsTotal) || 0
                    const credits = Number(inv.creditNotesTotal) || 0
                    const days = inv._aging.daysPastDue
                    return (
                      <tr key={inv.id || inv.code}>
                        <td className="px-4 py-2">
                          <Link to={`/client-invoices/${inv.code}`} className="text-brand font-mono font-semibold hover:underline">
                            {inv.code}
                          </Link>
                        </td>
                        <td className="px-4 py-2 font-bold text-gray-800">{inv.plateNo}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{formatDate(inv.issuedAtIso)}</td>
                        <td className={`px-4 py-2 text-xs ${days > 0 ? 'text-red-700 font-bold' : 'text-gray-600'}`}>
                          {inv.dueAtIso ? formatDate(inv.dueAtIso) : '—'}
                          {days > 0 && <span className="ml-1 text-[10px]">+{days}d</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatMoney(inv.total)}</td>
                        <td className="px-4 py-2 text-right text-green-700">{paid > 0 ? `−${formatMoney(paid)}` : '—'}</td>
                        <td className="px-4 py-2 text-right text-amber-700">{credits > 0 ? `−${formatMoney(credits)}` : '—'}</td>
                        <td className="px-4 py-2 text-right font-black text-gray-900">{formatMoney(balance)}</td>
                        <td className="px-4 py-2 text-center">
                          <AgingBadge bucket={inv._aging.bucket} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2">
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-right font-bold uppercase tracking-widest text-[11px] text-gray-700">
                      Total Outstanding
                    </td>
                    <td className="px-4 py-3 text-right font-black text-gray-900 text-lg">{formatMoney(totals.outstanding)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="text-[11px] text-gray-500 italic px-1">
          Statement generated {formatDate(now.toISOString())}. Includes only OPEN invoices; paid and voided invoices are excluded.
          Credits column reflects credit notes already issued against each invoice.
        </div>
      </div>

      {/* Sticky bar — Print + Back */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.05)] print:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <div className="px-3 sm:px-6 py-3 grid grid-cols-2 gap-2">
          <Link
            to={customerView ? '/portal/invoices' : '/reports/receivables'}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            ← Back
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-brand hover:bg-brand-dark text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icon name="print" className="w-4 h-4" />
            Print Statement
          </button>
        </div>
      </div>
    </div>
  )
}

function Bucket({ label, total, warn = false, strong = false }) {
  const empty = !total
  return (
    <div className="px-2 sm:px-4 py-3 text-center">
      <div className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${strong ? 'text-red-700' : warn ? 'text-amber-700' : 'text-gray-500'}`}>
        {label}
      </div>
      <div className={`text-[11px] sm:text-sm font-black mt-1 ${empty ? 'text-gray-300' : strong ? 'text-red-700' : warn ? 'text-amber-700' : 'text-gray-900'}`}>
        {empty ? '—' : formatMoney(total)}
      </div>
    </div>
  )
}

function AgingBadge({ bucket }) {
  const styles = {
    CURRENT:  'bg-gray-100 text-gray-700',
    '1_30':   'bg-amber-100 text-amber-800',
    '31_60':  'bg-orange-200 text-orange-900',
    '61_90':  'bg-rose-200 text-rose-900',
    '90_PLUS':'bg-red-600 text-white',
  }
  const labels = { CURRENT: 'Current', '1_30': '1–30', '31_60': '31–60', '61_90': '61–90', '90_PLUS': '90+' }
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${styles[bucket] || styles.CURRENT}`}>
      {labels[bucket] || 'Current'}
    </span>
  )
}

function SoaRowCard({ inv }) {
  const balance = Number(inv.balanceDue ?? inv.total) || 0
  const paid = Number(inv.paymentsTotal) || 0
  const credits = Number(inv.creditNotesTotal) || 0
  const days = inv._aging.daysPastDue
  return (
    <Link to={`/client-invoices/${inv.code}`} className="block p-4 hover:bg-gray-50">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-mono font-black text-brand text-sm">{inv.code}</div>
        <AgingBadge bucket={inv._aging.bucket} />
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div className="font-bold text-gray-900">{inv.plateNo}</div>
        <div className="text-lg font-black text-gray-900">{formatMoney(balance)}</div>
      </div>
      <div className="text-[11px] text-gray-500 mt-1">
        Issued {formatDate(inv.issuedAtIso)}
        {inv.dueAtIso && ` · Due ${formatDate(inv.dueAtIso)}`}
        {days > 0 && <span className="text-red-700 font-bold"> · +{days}d</span>}
      </div>
      {(paid > 0 || credits > 0) && (
        <div className="text-[11px] text-gray-500 mt-1">
          Total {formatMoney(inv.total)}
          {paid > 0 && ` · paid ${formatMoney(paid)}`}
          {credits > 0 && ` · credited ${formatMoney(credits)}`}
        </div>
      )}
    </Link>
  )
}
