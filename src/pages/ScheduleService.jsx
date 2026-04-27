// Request for Service — fleet clients select vehicles to request a booking.
// Vehicles are grouped by urgency: overdue, upcoming PMS, and others.
// Already-booked vehicles are excluded. Submitting creates PENDING_BOOKING
// appointments and notifies the call center.
// Also shows a section of vehicles already requested with cancel option.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { watchVehicles, profileCompany } from '../lib/vehicles'
import { watchAppointments, requestBooking, updateAppointmentStatus, APPT_STATUS } from '../lib/appointments'
import { formatDate, formatDateTime } from '../lib/dummyData'
import VehicleImage from '../components/ui/VehicleImage'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

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

export default function ScheduleService() {
  const { profile } = useAuth()
  const company = (profileCompany(profile) || '').toString()
  const clientVisibleOnly = isClientView(profile)

  const [vehicles, setVehicles] = useState([])
  const [appointments, setAppointments] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(null)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!company) return () => {}
    const unsub = watchVehicles({ company, clientVisibleOnly }, ({ vehicles }) => {
      setVehicles(vehicles)
    })
    return unsub
  }, [company, clientVisibleOnly])

  useEffect(() => {
    const unsub = watchAppointments({ dummyFallback: false }, ({ rows }) => {
      setAppointments(rows)
    })
    return unsub
  }, [])

  // Active bookings for this company
  const activeBookings = useMemo(() => {
    return appointments.filter(
      (a) => ACTIVE_STATUSES.has(a.status) && a.company === company,
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

  // Split vehicles into groups
  const { overdue, upcoming, other } = useMemo(() => {
    const now = new Date()
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const overdue = []
    const upcoming = []
    const other = []

    for (const v of vehicles) {
      if (bookedPlates.has((v.plateNo || '').toUpperCase())) continue
      const next = v.nextPms ? new Date(v.nextPms) : null
      if (next && !isNaN(next) && next < now) {
        const daysOverdue = Math.floor((now - next) / (24 * 60 * 60 * 1000))
        overdue.push({ ...v, daysOverdue })
      } else if (next && !isNaN(next) && next <= in30) {
        const daysUntil = Math.floor((next - now) / (24 * 60 * 60 * 1000))
        upcoming.push({ ...v, daysUntil })
      } else {
        other.push(v)
      }
    }

    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil)
    return { overdue, upcoming, other }
  }, [vehicles, bookedPlates])

  const allAvailable = [...overdue, ...upcoming, ...other]

  function toggle(plateNo) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(plateNo)) next.delete(plateNo)
      else next.add(plateNo)
      return next
    })
  }

  function selectAll() {
    if (selected.size === allAvailable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allAvailable.map((v) => v.plateNo)))
    }
  }

  async function handleSubmit() {
    if (selected.size === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const toBook = allAvailable.filter((v) => selected.has(v.plateNo))
      await requestBooking(toBook, profile)
      setSuccess(`${toBook.length} vehicle${toBook.length === 1 ? '' : 's'} submitted for booking.`)
      setSelected(new Set())
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
          Contact your administrator to link your account to a fleet company.
        </div>
      </div>
    )
  }

  return (
    <div className="pb-28">
      <PageHero
        eyebrow="REQUEST FOR SERVICE"
        title="Select Vehicles"
        subtitle={`${allAvailable.length} available · ${activeBookings.length} requested`}
        right={<HeroStat value={activeBookings.length} label="REQUESTED" tone="solid" />}
      />

      {success && (
        <div className="mx-3 sm:mx-6 mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-semibold">
          {success}
        </div>
      )}
      {error && (
        <div className="mx-3 sm:mx-6 mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-5">

        {/* ── Requested Bookings ─────────────────────────────────── */}
        {activeBookings.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-sky-700 mb-2">
              Requested Bookings ({activeBookings.length})
            </div>
            <div className="space-y-2">
              {activeBookings.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-2xl border-2 border-sky-200 px-4 py-3 flex items-center gap-3"
                >
                  {/* Status icon */}
                  <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                    <Icon name="clock" className="w-5 h-5" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-gray-900 tracking-wide">{a.plateNo}</span>
                      <StatusPill status={a.status === APPT_STATUS.PENDING_BOOKING ? 'PENDING' : a.status} size="sm" />
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

                  {/* Cancel button */}
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

        {/* ── Available Vehicles ─────────────────────────────────── */}
        {allAvailable.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Available Vehicles
            </div>
            <button
              onClick={selectAll}
              className="text-xs font-bold text-gray-600 hover:text-gray-900"
            >
              {selected.size === allAvailable.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        )}

        {/* Overdue */}
        {overdue.length > 0 && (
          <VehicleGroup
            title="Overdue for Maintenance"
            tone="red"
            vehicles={overdue}
            selected={selected}
            onToggle={toggle}
            badgeRender={(v) => `${v.daysOverdue}d overdue`}
          />
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <VehicleGroup
            title="Upcoming Maintenance"
            tone="amber"
            vehicles={upcoming}
            selected={selected}
            onToggle={toggle}
            badgeRender={(v) => `Due in ${v.daysUntil}d`}
          />
        )}

        {/* Other */}
        {other.length > 0 && (
          <VehicleGroup
            title="Other Vehicles"
            tone="gray"
            vehicles={other}
            selected={selected}
            onToggle={toggle}
          />
        )}

        {allAvailable.length === 0 && activeBookings.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            No vehicles found for your fleet account.
          </div>
        )}

        {allAvailable.length === 0 && activeBookings.length > 0 && (
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
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-brand hover:bg-brand-dark text-white font-bold text-sm px-6 py-3 rounded-xl shadow disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Request Booking'}
          </button>
        </div>
      )}
    </div>
  )
}

function VehicleGroup({ title, tone, vehicles, selected, onToggle, badgeRender }) {
  const toneMap = {
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
    gray: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', badge: 'bg-gray-100 text-gray-600' },
  }
  const t = toneMap[tone] || toneMap.gray

  return (
    <div>
      <div className={`text-xs font-bold uppercase tracking-wider ${t.text} mb-2`}>
        {title} ({vehicles.length})
      </div>
      <div className="space-y-2">
        {vehicles.map((v) => {
          const checked = selected.has(v.plateNo)
          return (
            <button
              key={v.plateNo}
              type="button"
              onClick={() => onToggle(v.plateNo)}
              className={`w-full text-left rounded-2xl border-2 px-4 py-3 flex items-center gap-3 transition-colors ${
                checked
                  ? 'border-brand bg-brand/5'
                  : `${t.border} bg-white hover:bg-gray-50`
              }`}
            >
              {/* Checkbox */}
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                checked ? 'bg-brand border-brand' : 'border-gray-300 bg-white'
              }`}>
                {checked && (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="currentColor">
                    <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z" />
                  </svg>
                )}
              </div>

              {/* Vehicle image */}
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                <VehicleImage model={v.model} className="w-full h-full object-cover" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-black text-sm text-gray-900 tracking-wide">{v.plateNo}</span>
                  {badgeRender && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.badge}`}>
                      {badgeRender(v)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">{v.brandModel || '—'}</div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                  {v.recentService && (
                    <span>Last service: {formatDate(v.recentService)}</span>
                  )}
                  {v.latestOdo > 0 && (
                    <span>Odo: {Number(v.latestOdo).toLocaleString()} km</span>
                  )}
                  {!v.recentService && !(v.latestOdo > 0) && (
                    <span>No service history</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
