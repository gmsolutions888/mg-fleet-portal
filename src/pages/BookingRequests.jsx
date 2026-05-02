// Booking Requests page — call center view of fleet client booking requests
// (PENDING_BOOKING status). Shows who requested, which vehicle, and when.
// "Book" action navigates to Service Bookings with the plate pre-filled and
// the booking panel auto-opened.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { watchAppointments, APPT_STATUS } from '../lib/appointments'
import { FLEET_COMPANIES } from '../lib/dummyData'
import StatusPill from '../components/ui/StatusPill'
import PageHero, { HeroStat } from '../components/ui/PageHero'
import Icon from '../components/ui/Icon'

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return formatDate(ts)
}

export default function BookingRequests() {
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState([])
  const [source, setSource] = useState('loading')
  const [clientFilter, setClientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    const unsub = watchAppointments({}, ({ rows, source }) => {
      setAppointments(rows)
      setSource(source)
    })
    return unsub
  }, [])

  // Show requests until branch approves (PENDING_BOOKING + PENDING_BRANCH_APPROVAL)
  const VISIBLE_STATUSES = new Set([APPT_STATUS.PENDING_BOOKING, APPT_STATUS.PENDING_BRANCH_APPROVAL])

  const requests = useMemo(() => {
    return appointments
      .filter((a) => VISIBLE_STATUSES.has(a.status))
      .sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0)
        const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0)
        return db - da
      })
  }, [appointments])

  // Get unique company names for the filter dropdown
  const companies = useMemo(() => {
    const set = new Set()
    for (const r of requests) {
      if (r.company) set.add(r.company)
    }
    return [...set].sort()
  }, [requests])

  const statusCounts = useMemo(() => ({
    ALL: requests.length,
    [APPT_STATUS.PENDING_BOOKING]: requests.filter((r) => r.status === APPT_STATUS.PENDING_BOOKING).length,
    [APPT_STATUS.PENDING_BRANCH_APPROVAL]: requests.filter((r) => r.status === APPT_STATUS.PENDING_BRANCH_APPROVAL).length,
  }), [requests])

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (clientFilter && r.company !== clientFilter) return false
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      return true
    })
  }, [requests, clientFilter, statusFilter])

  const handleBook = (appt) => {
    navigate(`/appointments?plate=${encodeURIComponent(appt.plateNo)}&company=${encodeURIComponent(appt.company || '')}&customer=${encodeURIComponent(appt.customer || '')}&requestId=${appt.id}&note=${encodeURIComponent(appt.note || '')}`)
  }

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="CALL CENTER"
        title="Booking Requests"
        subtitle={`${requests.length} pending request${requests.length === 1 ? '' : 's'} from fleet clients`}
        right={<HeroStat value={requests.length} label="PENDING" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Fleet client filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="input pl-9 w-full text-sm"
            >
              <option value="">All Fleet Clients</option>
              {companies.map((c) => (
                <option key={c} value={c}>{FLEET_COMPANIES.find((fc) => fc.code === c)?.name || c}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-400">{filtered.length} request{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'ALL', label: 'All' },
            { key: APPT_STATUS.PENDING_BOOKING, label: 'Pending Request' },
            { key: APPT_STATUS.PENDING_BRANCH_APPROVAL, label: 'Awaiting Branch' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                statusFilter === t.key
                  ? 'bg-brand text-white'
                  : 'bg-white border text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                statusFilter === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
              }`}>
                {statusCounts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-sm text-gray-400">
              No pending booking requests.
            </div>
          )}
          {filtered.map((a) => (
            <div key={a.id} className="bg-white rounded-2xl border-2 border-amber-200 overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <StatusPill status={a.status === APPT_STATUS.PENDING_BOOKING ? 'PENDING REQUEST' : 'AWAITING BRANCH APPROVAL'} size="sm" />
                  <div className="text-xs text-gray-400">{timeAgo(a.createdAt)}</div>
                </div>
                <div className="font-black text-gray-900 tracking-wide mt-2">{a.plateNo}</div>
                <div className="text-xs text-gray-500 uppercase mt-0.5">
                  {FLEET_COMPANIES.find((fc) => fc.code === a.company)?.name || a.company || '—'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{a.customer || '—'}</div>
                {a.note && a.note !== 'BOOKING REQUESTED BY FLEET CLIENT' && (
                  <div className="text-xs text-gray-400 mt-1 italic">{a.note}</div>
                )}
                <div className="text-[11px] text-gray-400 mt-1">{formatDate(a.createdAt)}</div>
              </div>
              {a.status === APPT_STATUS.PENDING_BOOKING && (
                <div className="px-4 pb-3">
                  <button
                    type="button"
                    onClick={() => handleBook(a)}
                    className="w-full text-sm bg-brand hover:bg-brand-dark text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                  >
                    <Icon name="calendar" className="w-4 h-4" />
                    Book this Request
                  </button>
                </div>
              )}
              {a.status === APPT_STATUS.PENDING_BRANCH_APPROVAL && (
                <div className="px-4 pb-3 text-[11px] text-gray-400 italic">Scheduled — awaiting branch approval</div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Fleet Client</th>
                  <th className="px-4 py-3 text-left font-medium">Plate Number</th>
                  <th className="px-4 py-3 text-left font-medium">Requested By</th>
                  <th className="px-4 py-3 text-left font-medium">Date Requested</th>
                  <th className="px-4 py-3 text-left font-medium">Notes</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No pending booking requests.</td></tr>
                )}
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <StatusPill status={a.status === APPT_STATUS.PENDING_BOOKING ? 'PENDING REQUEST' : 'AWAITING BRANCH APPROVAL'} size="sm" />
                    </td>
                    <td className="px-4 py-3 uppercase font-semibold">
                      {FLEET_COMPANIES.find((fc) => fc.code === a.company)?.name || a.company || '—'}
                    </td>
                    <td className="px-4 py-3 font-black text-brand">{a.plateNo}</td>
                    <td className="px-4 py-3">{a.customer || '—'}</td>
                    <td className="px-4 py-3">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                      {a.note && a.note !== 'BOOKING REQUESTED BY FLEET CLIENT' ? a.note : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.status === APPT_STATUS.PENDING_BOOKING ? (
                        <button
                          type="button"
                          onClick={() => handleBook(a)}
                          className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <Icon name="calendar" className="w-3.5 h-3.5" />
                          Book
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Awaiting branch</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
