// Staff "My Garage" dashboard — Card/List toggle. Reads appointments and
// vehicle lookup live from Firestore via watchAppointments + watchVehicles,
// falling back to dummy when the collections are empty.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/dummyData'
import { watchAppointments } from '../lib/appointments'
import { watchVehicles } from '../lib/vehicles'
import StatusPill, { PipelineCard } from '../components/ui/StatusPill'
import FinanceSnapshot from '../components/FinanceSnapshot'
import VehicleImage from '../components/ui/VehicleImage'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const STATUS_ORDER = ['PENDING_BRANCH_APPROVAL', 'BOOKED', 'ARRIVED', 'DIAGNOSED', 'ONGOING', 'PENDING', 'COMPLETED']
const STATUS_TONE = {
  PENDING_BRANCH_APPROVAL: 'amber',
  BOOKED: 'gray',
  ARRIVED: 'sky',
  DIAGNOSED: 'indigo',
  ONGOING: 'blue',
  PENDING: 'yellow',
  COMPLETED: 'green',
}

const HEADER_TEXT = {
  PENDING_BRANCH_APPROVAL: 'text-amber-600',
  BOOKED: 'text-gray-500',
  ARRIVED: 'text-sky-600',
  DIAGNOSED: 'text-indigo-600',
  ONGOING: 'text-blue-600',
  PENDING: 'text-yellow-600',
  COMPLETED: 'text-green-600',
}

// Pipeline cards use this short form so the label fits inside the chip.
const STATUS_DISPLAY = {
  PENDING_BRANCH_APPROVAL: 'PENDING APPROVAL',
}

export default function Home() {
  const { profile } = useAuth()
  const branch = (profile?.branch || 'MGCAVITE').toUpperCase()
  const [view, setView] = useState('card')
  const [filter, setFilter] = useState('ALL')
  const today = new Date()

  const [raw, setRaw] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')

  useEffect(() => {
    const u1 = watchAppointments({}, ({ rows, source }) => {
      setRaw(rows); setSource(source)
    })
    const u2 = watchVehicles({}, ({ vehicles }) => setVehicles(vehicles))
    return () => { u1?.(); u2?.() }
  }, [])

  const appointments = useMemo(() => raw.map((a) => {
    const v = vehicles.find((x) => x.plateNo === a.plateNo)
    return {
      ...a,
      brandModel: v?.brandModel || '',
      model: v?.model || '',
      yearModel: v?.yearModel || '',
      company: a.company || v?.company || '',
    }
  }), [raw, vehicles])

  // CONFIRMED is what fleet bookings flip to after branch approval; it's
  // functionally identical to BOOKED (scheduled, awaiting arrival), so we
  // collapse both into the same kanban lane to avoid the post-approval
  // gap the user reported.
  const lane = (status) => (status === 'CONFIRMED' ? 'BOOKED' : status)

  const byStatus = useMemo(() => {
    const m = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]))
    for (const a of appointments) {
      const k = lane(a.status)
      if (!m[k]) m[k] = []
      m[k].push(a)
    }
    return m
  }, [appointments])

  const summary = useMemo(() => {
    // "In garage" = the unit is physically here (ARRIVED through PENDING).
    // Booked / confirmed / tentative haven't shown up yet; pending-approval
    // hasn't even cleared the schedule.
    const inGarageStatuses = new Set(['ARRIVED', 'DIAGNOSED', 'ONGOING', 'PENDING'])
    const carsInGarage = appointments.filter((a) => inGarageStatuses.has(a.status)).length
    const backlogs = appointments.filter((a) => ['ARRIVED', 'ONGOING', 'PENDING'].includes(a.status)).length
    const pendingApproval = appointments.filter((a) => a.status === 'PENDING_BRANCH_APPROVAL').length
    return { carsInGarage, backlogs, pendingApproval }
  }, [appointments])

  const filtered = filter === 'ALL'
    ? appointments
    : appointments.filter((a) => lane(a.status) === filter)

  const todayLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="pb-20">
      <PageHero
        eyebrow="MY GARAGE"
        title={branch}
        subtitle={todayLabel}
        right={<HeroStat value={summary.carsInGarage} label="IN GARAGE" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules for the appointments collection.
        </div>
      )}

      {/* Floating status tiles — overlap the hero */}
      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryTile label="Backlogs"         value={summary.backlogs}        tone="sky" />
          <SummaryTile label="Pending approval" value={summary.pendingApproval} tone="amber" />
          <SummaryTile label="Cars in garage"   value={summary.carsInGarage}    tone="gray" />
        </div>
      </div>

      <div className="px-3 sm:px-6 pt-5 space-y-4">
        <FinanceSnapshot profile={profile} />

        {/* Pipeline row — color-coded counts */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {STATUS_ORDER.map((s) => (
            <PipelineCard key={s} label={STATUS_DISPLAY[s] || s} count={byStatus[s]?.length || 0} tone={STATUS_TONE[s]} />
          ))}
        </div>

        {/* Day view header */}
        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-700 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-500">{todayLabel}</span>
            <div className="flex items-center gap-2 text-xs">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">
                <option value="ALL">ALL</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_DISPLAY[s] || s}</option>)}
              </select>
              <button
                onClick={() => setView(view === 'card' ? 'list' : 'card')}
                className="bg-gray-900 text-white px-3 py-1 rounded text-[11px] font-semibold"
              >
                {view === 'card' ? 'List' : 'Cards'}
              </button>
            </div>
          </div>

          {view === 'card' ? <CardView byStatus={byStatus} filter={filter} /> : <ListView rows={filtered} />}
        </div>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, tone = 'gray' }) {
  const map = {
    sky:   'bg-sky-500',
    amber: 'bg-amber-500',
    gray:  'bg-gray-800',
  }
  return (
    <div className={`${map[tone]} text-white rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90 leading-tight">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function CardView({ byStatus, filter }) {
  const statuses = filter === 'ALL' ? STATUS_ORDER : [filter]
  return (
    <div className="p-3 sm:p-4">
      {/* Mobile & tablet: stacked list of status sections */}
      <div className="space-y-5 lg:hidden">
        {statuses.map((s) => {
          const rows = byStatus[s] || []
          if (filter === 'ALL' && rows.length === 0) return null
          return (
            <div key={s}>
              <div className={`text-[11px] font-bold uppercase tracking-wider pb-2 flex items-center justify-between ${HEADER_TEXT[s] || 'text-gray-600'}`}>
                <span>{STATUS_DISPLAY[s] || s}</span>
                <span className="text-gray-400">{rows.length}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {rows.map((a) => <AppointmentCard key={a.id} appt={a} />)}
                {rows.length === 0 && (
                  <div className="col-span-full text-[11px] text-gray-400 italic border border-dashed rounded-xl p-3">No vehicles</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop: kanban with horizontal scroll fallback */}
      <div className="hidden lg:block overflow-x-auto">
        <div className="grid grid-cols-7 gap-3 min-w-[1050px]">
          {statuses.map((s) => (
            <div key={s}>
              <div className={`text-[11px] font-bold uppercase tracking-wider pb-2 ${HEADER_TEXT[s] || 'text-gray-600'}`}>{STATUS_DISPLAY[s] || s} →</div>
              <div className="space-y-3">
                {(byStatus[s] || []).map((a) => <AppointmentCard key={a.id} appt={a} />)}
                {(!byStatus[s] || byStatus[s].length === 0) && (
                  <div className="text-[11px] text-gray-400 italic border border-dashed rounded-xl p-3">No vehicles</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppointmentCard({ appt }) {
  // Mechanic assignment is part of the assessment flow now (Round 16). If a
  // mechanic isn't picked yet, route the user through AssignMechanic first
  // so they can pick one, then on save it bounces them into /assess.
  const hasMechanic = appt.mechanic && appt.mechanic !== 'Not yet assigned'
  const assessHref = hasMechanic
    ? `/appointments/${appt.id}/assess`
    : `/appointments/${appt.id}/assign?then=assess`

  return (
    <div className="bg-white border rounded-2xl p-2.5 shadow-sm">
      <div className="h-16 flex items-center justify-center mb-1">
        <VehicleImage model={appt.model} className="max-h-16 object-contain" />
      </div>
      <Link to={`/vehicles/${appt.plateNo}`} className="block text-sm font-black text-gray-900 hover:text-brand tracking-wide">
        {appt.plateNo}
      </Link>
      {appt.company && <div className="text-[10px] text-brand font-bold truncate">{appt.company}</div>}
      <div className="text-[10px] text-gray-500 truncate">
        {(appt.brandModel || '').replace('Toyota - ', '')} {appt.yearModel}
      </div>

      {appt.scheduledAt && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-600">
          <Icon name="calendar" className="w-3 h-3 text-sky-600" />
          {formatDateTime(appt.scheduledAt)}
        </div>
      )}
      <div className="flex items-center gap-1 text-[10px] text-gray-600">
        <Icon name="user" className="w-3 h-3 text-gray-500" />
        <span className="uppercase truncate">{appt.customer}</span>
      </div>
      {appt.mechanic && appt.mechanic !== 'Not yet assigned' ? (
        <div className="flex items-center gap-1 text-[10px] text-gray-600">
          <Icon name="tool" className="w-3 h-3 text-gray-500" />
          <span className="uppercase truncate">{appt.mechanic}</span>
        </div>
      ) : (
        <div className="text-[10px] text-gray-400 italic">Not yet assigned</div>
      )}
      <div className="mt-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg px-2 py-1 leading-tight">
        {appt.note ? `"${appt.note}"` : '-'}
      </div>
      <Link
        to={assessHref}
        className="block mt-2 w-full bg-gray-900 hover:bg-black text-white text-[11px] font-bold rounded-lg px-2 py-1.5 text-center"
      >
        ASSESS
      </Link>
    </div>
  )
}

function ListView({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Vehicle</th>
            <th className="px-4 py-2 text-left font-medium">Scheduled</th>
            <th className="px-4 py-2 text-left font-medium">Customer</th>
            <th className="px-4 py-2 text-left font-medium">Mechanic</th>
            <th className="px-4 py-2 text-left font-medium">Latest Update</th>
            <th className="px-4 py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No vehicles.</td></tr>}
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link to={`/vehicles/${a.plateNo}`} className="text-brand font-bold hover:underline">{a.plateNo}</Link>
                <div className="text-[10px] text-gray-500">{(a.brandModel || '').replace('Toyota - ', '')} {a.yearModel}</div>
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-600">{a.scheduledAt ? formatDateTime(a.scheduledAt) : '-'}</td>
              <td className="px-4 py-2 whitespace-nowrap uppercase text-xs text-gray-700">{a.customer}</td>
              <td className="px-4 py-2 whitespace-nowrap uppercase text-xs text-gray-700">
                {a.mechanic && a.mechanic !== 'Not yet assigned' ? a.mechanic : <span className="italic text-gray-400 normal-case">Not assigned</span>}
              </td>
              <td className="px-4 py-2 text-xs text-gray-600">"{a.note}"</td>
              <td className="px-4 py-2 text-right"><StatusPill status={a.status} size="sm" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
