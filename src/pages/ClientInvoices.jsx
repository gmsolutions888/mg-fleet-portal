// Client Invoices — bills MG Fleet has raised against fleet clients. Used in
// two surfaces:
//   - /client-invoices         (staff view, all clients)
//   - /portal/invoices         (customer view, scoped to their company,
//                               read-only, no branch column, friendlier copy)
// Pass `customerView` to render the second mode.
//
// Tabs include OVERDUE as a virtual status (computed from dueAtIso vs now;
// invoices in OVERDUE are still persisted as OPEN).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatMoney, formatDate } from '../lib/dummyData'
import {
  CLIENT_INVOICE_STATUS,
  agingFor,
  effectiveStatus,
  watchClientInvoices,
} from '../lib/clientInvoices'
import { profileCompany } from '../lib/vehicles'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const STATUS_TABS = [
  { key: CLIENT_INVOICE_STATUS.OPEN, label: 'Open' },
  { key: 'OVERDUE',                  label: 'Overdue' },
  { key: CLIENT_INVOICE_STATUS.PAID, label: 'Paid' },
  { key: CLIENT_INVOICE_STATUS.VOID, label: 'Void' },
  { key: 'ALL',                      label: 'All' },
]

const BUCKET_LABELS = {
  CURRENT: 'Current',
  '1_30':  '1–30',
  '31_60': '31–60',
  '61_90': '61–90',
  '90_PLUS': '90+',
}

export default function ClientInvoices({ customerView = false }) {
  const { profile } = useAuth()
  const company = customerView ? (profileCompany(profile) || '').toString() : ''
  const [rows, setRows] = useState([])
  const [source, setSource] = useState('loading')
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState(CLIENT_INVOICE_STATUS.OPEN)
  const [now, setNow] = useState(new Date())

  // Tick once a minute so OVERDUE updates without a reload at day boundaries.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // Customers: scope to their own company. Bail early if no company on
    // profile (the user wasn't enrolled against a fleet company).
    if (customerView && !company) {
      setRows([]); setSource('no-company'); return () => {}
    }
    const opts = customerView ? { company } : {}
    const unsub = watchClientInvoices(opts, ({ rows, source }) => {
      setRows(rows); setSource(source)
    })
    return unsub
  }, [customerView, company])

  if (customerView && !company) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">No fleet company set on your profile</div>
          <div className="text-xs">Ask your account admin to link your account to your fleet company before invoices will appear here.</div>
        </div>
      </div>
    )
  }

  const decorated = useMemo(() => rows.map((r) => ({
    ...r,
    _eff: effectiveStatus(r, now),
    _aging: agingFor(r, now),
  })), [rows, now])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return decorated.filter((r) => {
      if (statusTab !== 'ALL' && r._eff !== statusTab) return false
      if (!term) return true
      return [r.code, r.plateNo, r.customer, r.company, r.quotationCode, r.branchInvoiceCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [decorated, search, statusTab])

  const counts = useMemo(() => {
    const c = {
      [CLIENT_INVOICE_STATUS.OPEN]: 0,
      OVERDUE: 0,
      [CLIENT_INVOICE_STATUS.PAID]: 0,
      [CLIENT_INVOICE_STATUS.VOID]: 0,
      ALL: rows.length,
    }
    for (const r of decorated) if (c[r._eff] != null) c[r._eff]++
    return c
  }, [decorated, rows.length])

  const buckets = useMemo(() => {
    const b = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_PLUS': 0 }
    const totals = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_PLUS': 0 }
    for (const r of decorated) {
      if (r.status !== CLIENT_INVOICE_STATUS.OPEN) continue
      const key = r._aging.bucket
      b[key]++
      totals[key] += Number(r.balanceDue ?? r.total) || 0
    }
    return { counts: b, totals }
  }, [decorated])

  const openReceivable = useMemo(() =>
    decorated
      .filter((r) => r.status === CLIENT_INVOICE_STATUS.OPEN)
      .reduce((s, r) => s + (Number(r.balanceDue ?? r.total) || 0), 0),
  [decorated])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow={customerView ? 'YOUR INVOICES' : 'CLIENT INVOICES'}
        title={customerView ? (company || 'Fleet') : 'MG Fleet receivables'}
        subtitle={`${rows.length} total · ${formatMoney(openReceivable)} ${customerView ? 'outstanding to MG Fleet' : 'outstanding'}`}
        right={<HeroStat value={counts.OVERDUE || 0} label="OVERDUE" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Aging buckets */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {Object.keys(BUCKET_LABELS).map((k) => (
            <BucketCard
              key={k}
              label={BUCKET_LABELS[k]}
              count={buckets.counts[k]}
              total={buckets.totals[k]}
              tone={k}
            />
          ))}
        </div>

        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {STATUS_TABS.map((t) => (
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

        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, plate, company, source…"
            className="input pl-9"
          />
        </div>

        <div className="lg:hidden space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">
              No client invoices match.
            </div>
          )}
          {filtered.map((r) => <InvoiceCard key={r.id || r.code} r={r} customerView={customerView} />)}
        </div>

        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Issued</th>
                  <th className="px-4 py-3 text-left font-medium">Due</th>
                  <th className="px-4 py-3 text-left font-medium">Plate</th>
                  {!customerView && <th className="px-4 py-3 text-left font-medium">Company</th>}
                  {!customerView && <th className="px-4 py-3 text-left font-medium">Branch</th>}
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr><td colSpan={customerView ? 7 : 9} className="px-4 py-8 text-center text-gray-400">No invoices yet.</td></tr>
                )}
                {filtered.map((r) => {
                  const balance = Number(r.balanceDue ?? r.total) || 0
                  return (
                    <tr key={r.id || r.code} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <Link to={`/client-invoices/${r.code}`} className="text-brand font-mono font-semibold hover:underline">
                          {r.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">{formatDate(r.issuedAtIso)}</td>
                      <td className="px-4 py-2 text-xs">
                        <DueCell invoice={r} />
                      </td>
                      <td className="px-4 py-2">
                        <Link to={`/vehicles/${r.plateNo}`} className="font-semibold text-gray-800 hover:text-brand">{r.plateNo}</Link>
                      </td>
                      {!customerView && <td className="px-4 py-2 text-xs font-mono text-gray-600 truncate max-w-[200px]">{r.company || '—'}</td>}
                      {!customerView && <td className="px-4 py-2 text-xs font-mono text-gray-600">{r.branch || '—'}</td>}
                      <td className="px-4 py-2 text-right font-bold">{formatMoney(r.total)}</td>
                      <td className="px-4 py-2 text-right">
                        {r.status === CLIENT_INVOICE_STATUS.PAID
                          ? <span className="text-green-700 text-xs">Paid</span>
                          : r.status === CLIENT_INVOICE_STATUS.VOID
                            ? <span className="text-gray-400 text-xs">—</span>
                            : <span className="font-bold text-gray-900">{formatMoney(balance)}</span>}
                      </td>
                      <td className="px-4 py-2 text-right"><StatusPill status={r._eff} size="sm" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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

function DueCell({ invoice }) {
  if (!invoice.dueAtIso) return <span className="text-gray-400">—</span>
  if (invoice.status !== CLIENT_INVOICE_STATUS.OPEN) {
    return <span className="text-gray-500">{formatDate(invoice.dueAtIso)}</span>
  }
  const days = invoice._aging?.daysPastDue || 0
  if (days <= 0) {
    return <span className="text-gray-700">{formatDate(invoice.dueAtIso)}</span>
  }
  return (
    <span className="text-red-700 font-bold">
      {formatDate(invoice.dueAtIso)}
      <span className="ml-1 text-[10px] font-bold uppercase tracking-wider">+{days}d</span>
    </span>
  )
}

function InvoiceCard({ r, customerView }) {
  const balance = Number(r.balanceDue ?? r.total) || 0
  return (
    <Link
      to={`/client-invoices/${r.code}`}
      className="block bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-mono font-black text-brand text-sm">{r.code}</div>
        <StatusPill status={r._eff} size="sm" />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-black text-gray-900 tracking-wide">{r.plateNo}</div>
        <div className="text-xl font-black text-gray-900">{formatMoney(r.total)}</div>
      </div>
      <div className="text-xs text-gray-500 uppercase truncate mt-0.5">
        {customerView ? (r.brandModel || r.customer || '—') : (r.company || '—')}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-gray-400">
        <span>Issued {formatDate(r.issuedAtIso)}{!customerView && ` · ${r.branch || '—'}`}</span>
        {r.status === CLIENT_INVOICE_STATUS.OPEN && (
          <span className={`font-bold ${(r._aging?.daysPastDue || 0) > 0 ? 'text-red-700' : 'text-gray-700'}`}>
            Bal {formatMoney(balance)}
          </span>
        )}
      </div>
    </Link>
  )
}
