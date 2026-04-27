// Receivables aging report. Internal-only. Aggregates client invoices by
// company and surfaces an aging breakdown (Current / 1-30 / 31-60 / 61-90 /
// 90+) so finance can see at a glance which clients are dragging their
// feet. Click a company to see its full Statement of Account (printable).
//
// Pure derived view — no new collection. Reads watchClientInvoices() and
// rolls up.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney } from '../lib/dummyData'
import {
  CLIENT_INVOICE_STATUS, agingFor, watchClientInvoices,
} from '../lib/clientInvoices'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const BUCKET_KEYS = ['CURRENT', '1_30', '31_60', '61_90', '90_PLUS']
const BUCKET_LABELS = {
  CURRENT: 'Current',
  '1_30':  '1–30',
  '31_60': '31–60',
  '61_90': '61–90',
  '90_PLUS': '90+',
}

export default function ReceivablesReport() {
  const [rows, setRows] = useState([])
  const [source, setSource] = useState('loading')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const unsub = watchClientInvoices({}, ({ rows, source }) => {
      setRows(rows); setSource(source)
    })
    return unsub
  }, [])

  const byCompany = useMemo(() => groupByCompany(rows, now), [rows, now])
  const totals = useMemo(() => sumTotals(byCompany), [byCompany])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="REPORTS"
        title="Receivables Aging"
        subtitle={byCompany.length === 0
          ? 'No outstanding client invoices.'
          : `${byCompany.length} company${byCompany.length === 1 ? '' : 'ies'} · ${formatMoney(totals.outstanding)} outstanding · ${formatMoney(totals.overdue)} overdue`}
        right={<HeroStat value={byCompany.length} label="CLIENTS" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Total aging summary row */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {BUCKET_KEYS.map((k) => (
            <BucketCard
              key={k}
              label={BUCKET_LABELS[k]}
              count={totals.bucketCount[k]}
              total={totals.bucketTotal[k]}
              tone={k}
            />
          ))}
        </div>

        {byCompany.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            No clients carrying an open balance. Either everyone is paid up, or no client invoices have been issued yet.
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="lg:hidden space-y-3">
              {byCompany.map((c) => <CompanyCard key={c.company} c={c} />)}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Company</th>
                      <th className="px-4 py-3 text-center font-medium">Open</th>
                      {BUCKET_KEYS.map((k) => (
                        <th key={k} className="px-4 py-3 text-right font-medium">{BUCKET_LABELS[k]}</th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                      <th className="px-4 py-3 text-right font-medium">SOA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {byCompany.map((c) => (
                      <tr key={c.company} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-bold text-gray-900">{c.company}</td>
                        <td className="px-4 py-3 text-center text-xs font-bold text-gray-700">{c.openCount}</td>
                        {BUCKET_KEYS.map((k) => (
                          <td key={k} className={`px-4 py-3 text-right text-xs ${c.bucketTotal[k] > 0 && k !== 'CURRENT' ? 'text-red-700 font-bold' : 'text-gray-600'}`}>
                            {c.bucketTotal[k] > 0 ? formatMoney(c.bucketTotal[k]) : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-black text-gray-900">{formatMoney(c.outstanding)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/reports/soa/${encodeURIComponent(c.company)}`}
                            className="text-brand hover:text-brand-dark font-bold text-xs"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2">
                    <tr>
                      <td className="px-4 py-3 font-bold text-gray-700 uppercase text-[11px] tracking-widest">Total</td>
                      <td className="px-4 py-3 text-center font-bold text-gray-900">{totals.openCount}</td>
                      {BUCKET_KEYS.map((k) => (
                        <td key={k} className={`px-4 py-3 text-right text-xs font-bold ${k !== 'CURRENT' && totals.bucketTotal[k] > 0 ? 'text-red-700' : 'text-gray-700'}`}>
                          {totals.bucketTotal[k] > 0 ? formatMoney(totals.bucketTotal[k]) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-black text-gray-900">{formatMoney(totals.outstanding)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CompanyCard({ c }) {
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="font-bold text-gray-900 text-sm break-words flex-1 min-w-0">{c.company}</div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Outstanding</div>
          <div className="text-lg font-black text-gray-900">{formatMoney(c.outstanding)}</div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1 mb-3">
        {BUCKET_KEYS.map((k) => (
          <div key={k} className={`text-center rounded-lg p-1.5 ${c.bucketTotal[k] > 0 && k !== 'CURRENT' ? 'bg-red-50' : 'bg-gray-50'}`}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{BUCKET_LABELS[k]}</div>
            <div className={`text-[11px] font-bold ${c.bucketTotal[k] > 0 && k !== 'CURRENT' ? 'text-red-700' : 'text-gray-700'}`}>
              {c.bucketTotal[k] > 0 ? formatMoney(c.bucketTotal[k]) : '—'}
            </div>
          </div>
        ))}
      </div>
      <Link
        to={`/reports/soa/${encodeURIComponent(c.company)}`}
        className="block bg-brand hover:bg-brand-dark text-white text-center font-bold text-sm py-2.5 rounded-xl"
      >
        View Statement of Account →
      </Link>
    </div>
  )
}

function BucketCard({ label, count, total, tone }) {
  const toneClasses = {
    CURRENT:  'bg-gray-50 border-gray-200',
    '1_30':   'bg-amber-50 border-amber-200',
    '31_60':  'bg-orange-50 border-orange-200',
    '61_90':  'bg-rose-50 border-rose-200',
    '90_PLUS':'bg-red-100 border-red-300',
  }
  return (
    <div className={`rounded-xl border p-2 sm:p-3 ${toneClasses[tone] || ''}`}>
      <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-sm sm:text-base font-black text-gray-900 leading-tight">{count}</div>
      <div className="text-[9px] sm:text-[10px] text-gray-500 truncate">{formatMoney(total)}</div>
    </div>
  )
}

function emptyBuckets() { return { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_PLUS': 0 } }

function groupByCompany(rows, now) {
  const open = rows.filter((r) => r.status === CLIENT_INVOICE_STATUS.OPEN)
  const map = new Map()
  for (const inv of open) {
    const key = inv.company || '— Unknown —'
    if (!map.has(key)) {
      map.set(key, {
        company: key,
        openCount: 0,
        outstanding: 0,
        bucketCount: emptyBuckets(),
        bucketTotal: emptyBuckets(),
      })
    }
    const entry = map.get(key)
    const bal = Number(inv.balanceDue ?? inv.total) || 0
    const aging = agingFor(inv, now)
    entry.openCount++
    entry.outstanding += bal
    entry.bucketCount[aging.bucket]++
    entry.bucketTotal[aging.bucket] += bal
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding)
}

function sumTotals(byCompany) {
  const r = {
    openCount: 0,
    outstanding: 0,
    overdue: 0,
    bucketCount: emptyBuckets(),
    bucketTotal: emptyBuckets(),
  }
  for (const c of byCompany) {
    r.openCount += c.openCount
    r.outstanding += c.outstanding
    for (const k of BUCKET_KEYS) {
      r.bucketCount[k] += c.bucketCount[k]
      r.bucketTotal[k] += c.bucketTotal[k]
      if (k !== 'CURRENT') r.overdue += c.bucketTotal[k]
    }
  }
  return r
}
