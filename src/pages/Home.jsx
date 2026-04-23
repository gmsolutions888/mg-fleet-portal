// Staff "My Garage" dashboard — Card/List toggle. Reads appointments and
// vehicle lookup live from Firestore via watchAppointments + watchVehicles,
// falling back to dummy when the collections are empty.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/dummyData'
import { watchAppointments } from '../lib/appointments'
import { watchVehicles } from '../lib/vehicles'
import StatCard from '../components/ui/StatCard'
import StatusPill, { PipelineCard } from '../components/ui/StatusPill'
import VehicleImage from '../components/ui/VehicleImage'
import Icon from '../components/ui/Icon'

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
    const u1 = watchAppointments({ dummyFallback: true }, ({ rows, source }) => {
      setRaw(rows); setSource(source)
    })
    const u2 = watchVehicles({ dummyFallback: true }, ({ vehicles }) => setVehicles(vehicles))
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

  const byStatus = useMemo(() => {
    const m = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]))
    for (const a of appointments) {
      if (!m[a.status]) m[a.status] = []
      m[a.status].push(a)
    }
    return m
  }, [appointments])

  const summary = useMemo(() => {
    const carsInGarage = appointments.filter((a) => a.status !== 'COMPLETED' && a.status !== 'BOOKED' && a.status !== 'TENTATIVE').length
    const backlogs = appointments.filter((a) => ['ARRIVED', 'ONGOING', 'PENDING'].includes(a.status)).length
    return { carsInGarage, backlogs, scheduled: '—', walkins: '—' }
  }, [appointments])

  const filtered = filter === 'ALL' ? appointments : appointments.filter((a) => a.status === filter)

  return (
    <div className="p-3 sm:p-6 pb-20">
      <div className="flex items-start justify-between gap-2 mb-4">
        <h1 className="text-lg sm:text-2xl font-semibold text-gray-800 truncate">My Garage - {branch}</h1>
        {source === 'dummy' && <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 shrink-0">Demo data</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-3">
        <StatCard label="Cars in the Garage" value={summary.carsInGarage} icon={<Icon name="car" className="w-5 h-5" />} small />
        <StatCard label="Backlogs"           value={summary.backlogs}     icon={<Icon name="backlog" className="w-5 h-5" />} small />
        <StatCard label="Scheduled"          value={summary.scheduled}    icon={<Icon name="scheduled" className="w-5 h-5" />} small />
        <StatCard label="Walk-ins"           value={summary.walkins}      icon={<Icon name="walk" className="w-5 h-5" />} small />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4">
        {STATUS_ORDER.map((s) => (
          <PipelineCard key={s} label={STATUS_DISPLAY[s] || s} count={byStatus[s]?.length || 0} tone={STATUS_TONE[s]} />
        ))}
      </div>

      <div className="bg-white rounded-md border mb-4">
        <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700 flex items-center justify-between">
          <span>{today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })}</span>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setView(view === 'card' ? 'list' : 'card')} className="bg-gray-800 text-white px-3 py-1 rounded text-[11px] font-semibold">
              {view === 'card' ? 'List View ▾' : 'Card View ▾'}
            </button>
          </div>
        </div>

        {view === 'card' ? <CardView byStatus={byStatus} filter={filter} /> : <ListView rows={filtered} />}
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-gray-500 text-xs">Filter</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded">
          <option value="ALL">ALL</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  )
}

function CardView({ byStatus, filter }) {
  const statuses = filter === 'ALL' ? STATUS_ORDER : [filter]
  // On mobile/tablet the kanban layout is unusable (7 columns × vehicle cards
  // ≈ 1050px minimum). Collapse to a single column per status with the header
  // acting as a collapsible-style row — users scan one status at a time.
  // md+ keeps the wide kanban with its horizontal scroll so branch staff on
  // laptops still see the full pipeline at a glance.
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
                  <div className="col-span-full text-[11px] text-gray-400 italic border border-dashed rounded p-3">No vehicles</div>
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
                  <div className="text-[11px] text-gray-400 italic border border-dashed rounded p-3">No vehicles</div>
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
  const [menu, setMenu] = useState(false)
  return (
    <div className="bg-white border rounded-md p-2.5 shadow-sm">
      <div className="h-16 flex items-center justify-center mb-1">
        <VehicleImage model={appt.model} className="max-h-16 object-contain" />
      </div>
      <Link to={`/vehicles/${appt.plateNo}`} className="block text-sm font-bold text-gray-900 hover:text-brand">
        {appt.plateNo}{appt.company ? ` (${appt.company})` : ''}
      </Link>
      <div className="text-[10px] text-gray-500">
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
      <div className="mt-2 text-[10px] text-gray-600 bg-gray-50 rounded px-2 py-1 leading-tight">
        {appt.note ? `"${appt.note}"` : '-'}
      </div>
      <div className="relative mt-2">
        <button onClick={() => setMenu((v) => !v)} className="w-full bg-gray-900 text-white text-[11px] font-semibold rounded px-2 py-1 flex items-center justify-center gap-1">
          ACTIONS ▾
        </button>
        {menu && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10 text-[11px]">
            <MenuItem to={`/vehicles/${appt.plateNo}`}>View Details</MenuItem>
            <MenuItem to={`/appointments/${appt.id}/diagnose`}>Diagnose</MenuItem>
            <MenuItem to={`/appointments/${appt.id}/assign`}>Assign Mechanic</MenuItem>
            <MenuItem to={`/appointments/${appt.id}/update`}>Post Update</MenuItem>
            <MenuItem to={`/service-receipts/create?plate=${appt.plateNo}`}>Create Receipt</MenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ to, children }) {
  return <Link to={to} className="block px-3 py-1.5 hover:bg-gray-100 text-gray-700">{children}</Link>
}

function ListView({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
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
