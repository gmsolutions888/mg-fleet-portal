// Service Receipts list — live Firestore backed.
//
// Mobile: card-per-receipt with prominent total + missing-parts chip.
// Desktop: keeps the paginated table for dense scanning.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDate, formatMoney } from '../lib/dummyData'
import { watchReceipts } from '../lib/serviceReceipts'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const PAGE_SIZES = [10, 25, 50, 100]
const STATUS_TABS = [
  { key: 'OPEN',      label: 'Open' },
  { key: 'PAID',      label: 'Paid' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'ALL',       label: 'All' },
]

export default function ServiceReceipts() {
  const { profile } = useAuth()
  const branch = (profile?.branch || 'MGCAVITE').toUpperCase()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('OPEN')
  const [pageSize, setPageSize] = useState(10)
  const [rows, setRows] = useState([])
  const [source, setSource] = useState('loading')

  useEffect(() => {
    const unsub = watchReceipts({ kind: 'receipt' }, ({ rows, source }) => {
      setRows(rows); setSource(source)
    })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (status !== 'ALL' && r.status !== status) return false
      if (!term) return true
      return [r.code, r.plateNo, r.customer, r.mechanic].join(' ').toLowerCase().includes(term)
    })
  }, [rows, search, status])

  const counts = useMemo(() => {
    const c = { OPEN: 0, PAID: 0, CANCELLED: 0, ALL: rows.length }
    for (const r of rows) if (c[r.status] != null) c[r.status]++
    return c
  }, [rows])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="SERVICE RECEIPTS"
        title={branch}
        subtitle={`${rows.length} total · ${counts.OPEN} open`}
        right={<HeroStat value={counts.OPEN} label="OPEN" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Status tabs */}
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                status === t.key ? 'bg-brand text-white' : 'bg-white border text-gray-700'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${status === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
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
            placeholder="Search code, plate, customer, mechanic…"
            className="input pl-9"
          />
        </div>

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">
              No service receipts match.
            </div>
          )}
          {filtered.slice(0, pageSize).map((r) => <ReceiptCard key={r.id || r.code} r={r} />)}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b gap-2 flex-wrap">
            <div className="text-sm text-gray-600">
              Show{' '}
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border rounded px-2 py-1 mx-1 text-sm">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              entries
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Date Created</th>
                  <th className="px-4 py-3 text-left font-medium">Plate No</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Mechanic</th>
                  <th className="px-4 py-3 text-left font-medium">Person In Charge</th>
                  <th className="px-4 py-3 text-center font-medium">Missing Parts</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No service receipts.</td></tr>
                )}
                {filtered.slice(0, pageSize).map((r) => (
                  <tr key={r.id || r.code} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link to={`/service-receipts/${r.code}`} className="text-brand font-mono font-semibold hover:underline">{r.code}</Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.dateCreated)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link to={`/vehicles/${r.plateNo}`} className="font-semibold text-gray-800 hover:text-brand">{r.plateNo}</Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap uppercase">{r.customer}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.mechanic}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.personInCharge}</td>
                    <td className="px-4 py-2 text-center">
                      {r.missingParts > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-red-500 text-white text-xs font-bold">{r.missingParts}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap font-semibold">{formatMoney(r.estimatedTotal)}</td>
                    <td className="px-4 py-2 text-right"><StatusPill status={r.status} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600 gap-2 flex-wrap">
            <div className="text-xs sm:text-sm">Showing 1 to {Math.min(filtered.length, pageSize)} of {filtered.length} entries</div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1 border rounded">Previous</button>
              <span className="px-2 py-1 bg-brand text-white rounded">1</span>
              <button className="px-3 py-1 border rounded">Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating + Create button — above the mobile bottom nav */}
      <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
        <Link
          to="/service-receipts/create"
          className="bg-brand hover:bg-brand-dark text-white px-4 sm:px-5 py-3 rounded-full font-bold text-sm flex items-center gap-2 shadow-xl"
        >
          <Icon name="plus" className="w-4 h-4" />
          New Receipt
        </Link>
      </div>
    </div>
  )
}

function ReceiptCard({ r }) {
  return (
    <Link
      to={`/service-receipts/${r.code}`}
      className="block bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-mono font-black text-brand text-sm">{r.code}</div>
        <StatusPill status={r.status} size="sm" />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-black text-gray-900 tracking-wide">{r.plateNo}</div>
        <div className="text-xl font-black text-gray-900">{formatMoney(r.estimatedTotal)}</div>
      </div>
      <div className="text-xs text-gray-500 uppercase mt-0.5 truncate">{r.customer}</div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-gray-400">
        <span>{formatDate(r.dateCreated)}{r.mechanic ? ` · ${r.mechanic}` : ''}</span>
        {r.missingParts > 0 && (
          <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">
            <Icon name="warn" className="w-3 h-3" />
            {r.missingParts} missing
          </span>
        )}
      </div>
    </Link>
  )
}
