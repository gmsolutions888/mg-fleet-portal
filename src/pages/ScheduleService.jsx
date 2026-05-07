// Request for Service — fleet clients select vehicles to request a booking.
// Vehicles are grouped by urgency: overdue, upcoming PMS, and others.
// Already-booked vehicles are excluded. Submitting creates PENDING_BOOKING
// appointments and notifies the call center.
// Also shows a section of vehicles already requested with cancel option.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { watchVehicles, profileCompany } from '../lib/vehicles'
import { watchAppointments, requestBooking, updateAppointmentStatus, APPT_STATUS } from '../lib/appointments'
import { formatDate, formatDateTime } from '../lib/dummyData'
import VehicleImage from '../components/ui/VehicleImage'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

// All active statuses — used to exclude plates from "Available Vehicles"
const ACTIVE_STATUSES = new Set([
  APPT_STATUS.PENDING_BOOKING,
  APPT_STATUS.PENDING_BRANCH_APPROVAL,
  APPT_STATUS.BOOKED,
  APPT_STATUS.CONFIRMED,
  APPT_STATUS.TENTATIVE,
  APPT_STATUS.ARRIVED,
  APPT_STATUS.ONGOING,
  APPT_STATUS.DIAGNOSED,
  APPT_STATUS.PENDING,
])

// Pre-approval statuses — shown in "Requested Bookings" section
const REQUESTED_STATUSES = new Set([
  APPT_STATUS.PENDING_BOOKING,
  APPT_STATUS.PENDING_BRANCH_APPROVAL,
])

export default function ScheduleService() {
  const { profile } = useAuth()
  const company = (profileCompany(profile) || '').toString()

  const [vehicles, setVehicles] = useState([])
  const [appointments, setAppointments] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(null)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [scheduleOption, setScheduleOption] = useState(null)
  const [preferredDate, setPreferredDate] = useState('')

  useEffect(() => {
    if (!company) return () => {}
    // Don't filter by clientVisibleOnly — fleet clients need to see all
    // their company's vehicles to request service bookings.
    const unsub = watchVehicles({ company }, ({ vehicles }) => {
      setVehicles(vehicles)
    })
    return unsub
  }, [company])

  useEffect(() => {
    const unsub = watchAppointments({ dummyFallback: false }, ({ rows }) => {
      setAppointments(rows)
    })
    return unsub
  }, [])

  const companyMatch = (apptCompany) => {
    if (!company || !apptCompany) return false
    const a = apptCompany.toLowerCase().trim()
    const c = company.toLowerCase().trim()
    return a === c || a.includes(c) || c.includes(a)
  }

  // All active bookings — used for plate exclusion
  const activeBookings = useMemo(() => {
    return appointments.filter(
      (a) => ACTIVE_STATUSES.has(a.status) && companyMatch(a.company),
    )
  }, [appointments, company])

  // Only pre-approval bookings — shown in "Requested Bookings" section
  const requestedBookings = useMemo(() => {
    return appointments.filter(
      (a) => REQUESTED_STATUSES.has(a.status) && companyMatch(a.company),
    )
  }, [appointments, company])

  // Plates that already have an active booking
  const bookedPlates = useMemo(() => {
    const s = new Set()
    for (const a of activeBookings) {
      s.add((a.plateNo || '').toUpperCase())
    }
    return s
  }, [activeBookings])

  // Available vehicles (exclude already-booked plates)
  const allAvailable = useMemo(() => {
    const now = new Date()
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    return vehicles
      .filter((v) => !bookedPlates.has((v.plateNo || '').toUpperCase()))
      .map((v) => {
        const next = v.nextPms ? new Date(v.nextPms) : null
        const isUpcoming = next && !isNaN(next) && next <= in30
        const isOverdue = next && !isNaN(next) && next < now
        const daysUntil = isUpcoming ? Math.floor((next - now) / (24 * 60 * 60 * 1000)) : null
        const daysOverdue = isOverdue ? Math.floor((now - next) / (24 * 60 * 60 * 1000)) : null
        return { ...v, isUpcoming, isOverdue, daysUntil, daysOverdue }
      })
  }, [vehicles, bookedPlates])

  // Filter
  const [filter, setFilter] = useState('ALL')

  const FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'upcoming', label: 'Upcoming PMS' },
    { key: 'minor', label: 'Minor Repairs Needed' },
    { key: 'unfit', label: 'Unfit for Use' },
  ]

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allAvailable
    if (filter === 'upcoming') return allAvailable.filter((v) => v.isUpcoming || v.isOverdue)
    return allAvailable.filter((v) => v.roadworthy === filter)
  }, [allAvailable, filter])

  const filterCounts = useMemo(() => ({
    ALL: allAvailable.length,
    upcoming: allAvailable.filter((v) => v.isUpcoming || v.isOverdue).length,
    minor: allAvailable.filter((v) => v.roadworthy === 'minor').length,
    unfit: allAvailable.filter((v) => v.roadworthy === 'unfit').length,
  }), [allAvailable])

  function toggle(plateNo) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(plateNo)) next.delete(plateNo)
      else next.add(plateNo)
      return next
    })
  }

  function selectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((v) => v.plateNo)))
    }
  }

  function openBookingModal() {
    if (selected.size === 0) return
    setScheduleOption(null)
    setPreferredDate('')
    setShowModal(true)
  }

  async function handleSubmit() {
    if (selected.size === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const toBook = allAvailable.filter((v) => selected.has(v.plateNo))
      const notes = scheduleOption === 'preferred' && preferredDate
        ? `Preferred date: ${preferredDate}`
        : 'Earliest date available'
      await requestBooking(
        toBook.map((v) => ({ ...v, notes })),
        profile,
      )
      setSuccess(`${toBook.length} vehicle${toBook.length === 1 ? '' : 's'} submitted for booking.`)
      setSelected(new Set())
      setShowModal(false)
      setTimeout(() => setSuccess(null), 5000)
    } catch (err) {
      console.error('[schedule-service] submit failed:', err)
      setError(err.message || 'Failed to submit booking request.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(appointmentId, plateNo) {
    if (cancelling) return
    setCancelling(appointmentId)
    setError(null)
    try {
      await updateAppointmentStatus(appointmentId, APPT_STATUS.CANCELLED, 'Cancelled by fleet client')
      setSuccess(`Booking for ${plateNo} cancelled.`)
      setTimeout(() => setSuccess(null), 4000)
    } catch (err) {
      console.error('[schedule-service] cancel failed:', err)
      setError(err.message || 'Failed to cancel booking.')
    } finally {
      setCancelling(null)
    }
  }

  if (!company) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">No fleet company on your profile</div>
          <div className="text-xs">Contact your administrator to link your account to a fleet company.</div>
          <div className="text-[10px] text-gray-500 mt-2">Debug: company_id={profile?.company_id || 'none'} | company={profile?.company || 'none'} | role={profile?.role || 'none'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-28">
      <PageHero
        eyebrow="REQUEST FOR SERVICE"
        title="Select Vehicles"
        subtitle={`${allAvailable.length} available · ${requestedBookings.length} pending`}
        right={<HeroStat value={requestedBookings.length} label="PENDING" tone="solid" />}
      />

      {success && (
        <div className="mx-3 sm:mx-6 mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-semibold">
          {success}
        </div>
      )}
      {error && !showModal && (
        <div className="mx-3 sm:mx-6 mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-5">

        {/* ── Requested Bookings ─────────────────────────────────── */}
        {requestedBookings.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-sky-700 mb-2">
              Requested Bookings ({requestedBookings.length})
            </div>
            <div className="space-y-2">
              {requestedBookings.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-2xl border-2 border-sky-200 px-4 py-3 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                    <Icon name="clock" className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-gray-900 tracking-wide">{a.plateNo}</span>
                      <StatusPill status={a.status === APPT_STATUS.PENDING_BOOKING ? 'PENDING REQUEST' : a.status === APPT_STATUS.PENDING_BRANCH_APPROVAL ? 'AWAITING BRANCH APPROVAL' : a.status} size="sm" />
                    </div>
                    <div className="text-xs text-gray-500 truncate">{a.brandModel || '—'}</div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                      {a.status === APPT_STATUS.PENDING_BOOKING && (
                        <span>Awaiting call center schedule</span>
                      )}
                      {a.status !== APPT_STATUS.PENDING_BOOKING && a.scheduledAt && (
                        <span>Scheduled: {formatDateTime(a.scheduledAt)}</span>
                      )}
                      {a.status !== APPT_STATUS.PENDING_BOOKING && !a.scheduledAt && (
                        <span>Status: {a.status}</span>
                      )}
                      {a.createdAt && (
                        <span>Requested: {formatDate(a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancel(a.id, a.plateNo)}
                    disabled={cancelling === a.id}
                    className="shrink-0 text-xs font-bold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {cancelling === a.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Filter tabs ─────────────────────────────────────── */}
        {allAvailable.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                  filter === f.key
                    ? 'bg-brand text-white'
                    : 'bg-white border text-gray-700 hover:bg-gray-50'
                }`}
              >
                {f.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  filter === f.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                }`}>
                  {filterCounts[f.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Available Vehicles ─────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {filter === 'ALL' ? 'Available Vehicles' : FILTERS.find((f) => f.key === filter)?.label} ({filtered.length})
            </div>
            <button
              onClick={selectAll}
              className="text-xs font-bold text-brand hover:text-brand-dark flex items-center gap-1.5"
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                selected.size === filtered.length && filtered.length > 0
                  ? 'bg-brand border-brand'
                  : 'border-gray-300 bg-white'
              }`}>
                {selected.size === filtered.length && filtered.length > 0 && (
                  <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="currentColor">
                    <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z" />
                  </svg>
                )}
              </div>
              {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        )}

        {/* Vehicle list */}
        {filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((v) => {
              const checked = selected.has(v.plateNo)
              const badge = v.isOverdue
                ? { text: `${v.daysOverdue}d overdue`, cls: 'bg-red-100 text-red-700' }
                : v.isUpcoming
                ? { text: `Due in ${v.daysUntil}d`, cls: 'bg-amber-100 text-amber-700' }
                : v.roadworthy === 'minor'
                ? { text: 'Minor repairs', cls: 'bg-amber-100 text-amber-700' }
                : v.roadworthy === 'unfit'
                ? { text: 'Unfit', cls: 'bg-red-100 text-red-700' }
                : null

              const borderTone = v.roadworthy === 'unfit'
                ? 'border-red-200'
                : v.roadworthy === 'minor'
                ? 'border-amber-200'
                : 'border-gray-200'

              return (
                <button
                  key={v.plateNo}
                  type="button"
                  onClick={() => toggle(v.plateNo)}
                  className={`w-full text-left rounded-2xl border-2 px-4 py-3 flex items-center gap-3 transition-colors ${
                    checked
                      ? 'border-brand bg-brand/5'
                      : `${borderTone} bg-white hover:bg-gray-50`
                  }`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked ? 'bg-brand border-brand' : 'border-gray-300 bg-white'
                  }`}>
                    {checked && (
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="currentColor">
                        <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z" />
                      </svg>
                    )}
                  </div>
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                    <VehicleImage model={v.model} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-gray-900 tracking-wide">{v.plateNo}</span>
                      {badge && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.text}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{v.brandModel || '—'}</div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                      {v.recentService && <span>Last service: {formatDate(v.recentService)}</span>}
                      {v.latestOdo > 0 && <span>Odo: {Number(v.latestOdo).toLocaleString()} km</span>}
                      {!v.recentService && !(v.latestOdo > 0) && <span>No service history</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {filtered.length === 0 && allAvailable.length > 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            No vehicles match this filter.
          </div>
        )}

        {allAvailable.length === 0 && requestedBookings.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            No vehicles found for your fleet account.
            <div className="text-[10px] text-gray-400 mt-2">
              Company: "{company}" | Vehicles loaded: {vehicles.length} | Booked plates: {bookedPlates.size} | Available: {allAvailable.length}
            </div>
          </div>
        )}

        {allAvailable.length === 0 && requestedBookings.length > 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            All your vehicles are already requested for service.
          </div>
        )}
      </div>

      {/* Sticky submit bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-30 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            <span className="font-black text-lg text-brand">{selected.size}</span>{' '}
            vehicle{selected.size === 1 ? '' : 's'} selected
          </div>
          <button
            onClick={openBookingModal}
            disabled={submitting}
            className="bg-brand hover:bg-brand-dark text-white font-bold text-sm px-6 py-3 rounded-xl shadow disabled:opacity-50"
          >
            Request Booking
          </button>
        </div>
      )}

      {/* Booking option modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-brand text-white px-5 py-4">
              <div className="text-[10px] font-bold tracking-widest opacity-70">BOOKING REQUEST</div>
              <div className="font-black text-lg mt-0.5">
                {selected.size} vehicle{selected.size === 1 ? '' : 's'} selected
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="text-sm font-semibold text-gray-700 mb-1">When would you like the service?</div>

              {/* Option 1: Preferred date */}
              <button
                type="button"
                onClick={() => setScheduleOption('preferred')}
                className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
                  scheduleOption === 'preferred'
                    ? 'border-brand bg-brand/5'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    scheduleOption === 'preferred' ? 'border-brand' : 'border-gray-300'
                  }`}>
                    {scheduleOption === 'preferred' && (
                      <div className="w-2.5 h-2.5 rounded-full bg-brand" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900">I have a preferred date</div>
                    <div className="text-xs text-gray-500 mt-0.5">Choose your preferred service date</div>
                  </div>
                </div>
              </button>

              {scheduleOption === 'preferred' && (
                <div className="pl-8">
                  <input
                    type="date"
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="input w-full"
                    required
                  />
                </div>
              )}

              {/* Option 2: Earliest available */}
              <button
                type="button"
                onClick={() => setScheduleOption('earliest')}
                className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
                  scheduleOption === 'earliest'
                    ? 'border-brand bg-brand/5'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    scheduleOption === 'earliest' ? 'border-brand' : 'border-gray-300'
                  }`}>
                    {scheduleOption === 'earliest' && (
                      <div className="w-2.5 h-2.5 rounded-full bg-brand" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900">Earliest date available</div>
                    <div className="text-xs text-gray-500 mt-0.5">Let the call center assign the soonest slot</div>
                  </div>
                </div>
              </button>
            </div>

            {error && (
              <div className="mx-5 mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="px-5 pb-5 flex gap-3">
              <button
                type="button"
                onClick={() => { setShowModal(false); setError(null) }}
                className="flex-1 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-3 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!scheduleOption || submitting || (scheduleOption === 'preferred' && !preferredDate)}
                className="flex-1 text-sm font-bold text-white bg-brand hover:bg-brand-dark disabled:opacity-40 px-4 py-3 rounded-xl shadow"
              >
                {submitting ? 'Submitting…' : 'Confirm Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

