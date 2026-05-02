// My Mechanics (Mechanic Assignment) — matches
// "MG Operations - Mechanic Assignment" mockup. Lists mechanics with their
// currently-assigned vehicles; shows an "Assign Now" button for idle mechanics.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/dummyData'
import { watchVehicles } from '../lib/vehicles'
import { watchAppointments } from '../lib/appointments'
import { watchUsers } from '../lib/users'

const ASSESSOR_ROLES = new Set(['field_assessor', 'warrior', 'dispatcher', 'technician'])
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'
import CalendarPicker from '../components/ui/CalendarPicker'

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function MyMechanics() {
  const { profile } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [appointments, setAppointments] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [showCalendar, setShowCalendar] = useState(false)
  const [rescheduleTarget, setRescheduleTarget] = useState(null)
  const [showRescheduleCalendar, setShowRescheduleCalendar] = useState(false)
  const [scheduleUpdates, setScheduleUpdates] = useState({})
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const u1 = watchVehicles({}, ({ vehicles }) => setVehicles(vehicles))
    const u2 = watchAppointments({}, ({ rows }) => setAppointments(rows))
    const u3 = watchUsers((list) => setAllUsers(list))
    return () => { u1?.(); u2?.(); u3?.() }
  }, [])

  // Assessors/warriors from Firestore users, filtered by the current user's branch
  const userBranch = (profile?.branch || '').toUpperCase().trim()
  const isFleetMgr = String(profile?.role || '').toLowerCase() === 'general_manager'

  const mechanics = useMemo(() => {
    return allUsers
      .filter((u) => {
        if (!ASSESSOR_ROLES.has(String(u.role || '').toLowerCase())) return false
        if (u.is_active === 0) return false
        // Fleet manager sees all; branch users see only their branch
        if (!isFleetMgr && userBranch) {
          return (u.branch || '').toUpperCase().trim() === userBranch
        }
        return true
      })
      .map((u) => ({ id: u.id, name: u.name || u.email || '—', branch: u.branch || null }))
  }, [allUsers, userBranch, isFleetMgr])

  // Group appointments by mechanic
  const groups = useMemo(() => {
    const m = {}
    for (const mech of mechanics) m[mech.name] = []
    const activeStatuses = new Set(['BOOKED', 'CONFIRMED', 'TENTATIVE', 'ARRIVED', 'ONGOING', 'DIAGNOSED', 'PENDING'])
    for (const a of appointments) {
      if (!a.mechanic || a.mechanic === 'Not yet assigned') continue
      if (!activeStatuses.has(a.status)) continue
      if (!m[a.mechanic]) m[a.mechanic] = []
      const v = vehicles.find((x) => x.plateNo === a.plateNo)
      m[a.mechanic].push({ ...a, brandModel: v?.brandModel || '' })
    }
    return m
  }, [vehicles, appointments, mechanics])

  const mechsWith = Object.entries(groups).filter(([_, list]) => list.length > 0)
  const mechsWithout = Object.entries(groups).filter(([_, list]) => list.length === 0)

  const today = new Date()
  const isToday = sameDay(selectedDate, today)
  const dateLabel = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  function handleDateSelect(date) {
    setSelectedDate(date)
    setShowCalendar(false)
  }

  function handleReschedule(appointmentId, mechanic) {
    setRescheduleTarget({ appointmentId, mechanic })
    setShowRescheduleCalendar(true)
  }

  function handleRescheduleConfirm(newDate) {
    if (!rescheduleTarget) return
    setScheduleUpdates((prev) => ({ ...prev, [rescheduleTarget.appointmentId]: newDate.toISOString() }))
    setToast(`Schedule updated for ${rescheduleTarget.mechanic}`)
    setShowRescheduleCalendar(false)
    setRescheduleTarget(null)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="pb-20">
      <PageHero
        eyebrow="MY MECHANICS"
        title={`${mechanics.length} mechanic${mechanics.length === 1 ? '' : 's'}`}
        subtitle={dateLabel}
        right={<HeroStat value={mechsWith.length} label="ASSIGNED" tone="solid" />}
      />

      {/* Status tiles */}
      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <SummaryTile label="Assigned"    value={mechsWith.length}    tone="green" />
          <SummaryTile label="Idle"        value={mechsWithout.length} tone="amber" />
        </div>
      </div>

      <div className="px-3 sm:px-6 pt-5 space-y-4">
        {/* Mobile: date selector + card list */}
        <div className="lg:hidden space-y-3">
          <div className="relative">
            <button
              onClick={() => setShowCalendar(!showCalendar)}
              className="w-full flex items-center justify-between bg-white border rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <span>{isToday ? `Today — ${dateLabel}` : dateLabel}</span>
              <Icon name="calendar" className="w-4 h-4 text-gray-500" />
            </button>
            {showCalendar && (
              <CalendarPicker value={selectedDate} onChange={handleDateSelect} onClose={() => setShowCalendar(false)} />
            )}
          </div>
          {mechsWith.length === 0 && mechsWithout.length === mechanics.length && (
            <div className="bg-white rounded-2xl border px-4 py-8 text-center text-sm text-gray-500">
              No mechanic assignments for this date.
            </div>
          )}
          {mechsWith.map(([name, list]) => (
            <MechanicCardGroup key={name} name={name} list={list} onReschedule={handleReschedule} />
          ))}
          {mechsWithout.map(([name]) => (
            <IdleCard key={name} name={name} />
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700 flex items-center justify-between">
            <span>{isToday ? `Today — ${dateLabel}` : dateLabel}</span>
            <div className="flex items-center gap-1 relative">
              <button className="text-gray-500 hover:text-gray-800 p-1"><Icon name="print" className="w-4 h-4" /></button>
              <button onClick={() => setShowCalendar(!showCalendar)} className="text-gray-500 hover:text-gray-800 p-1">
                <Icon name="calendar" className="w-4 h-4" />
              </button>
              {showCalendar && (
                <CalendarPicker value={selectedDate} onChange={handleDateSelect} onClose={() => setShowCalendar(false)} />
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Plate No</th>
                  <th className="px-4 py-2 text-left font-medium">Brand/Model</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Person In Charge</th>
                  <th className="px-4 py-2 text-left font-medium">Date/Time Arrived</th>
                  <th className="px-4 py-2 text-right font-medium">Service Status</th>
                  <th className="px-4 py-2 text-right font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {mechsWith.map(([name, list]) => (
                  <MechanicBlock key={name} name={name} list={list} onReschedule={handleReschedule} />
                ))}
                {mechsWithout.map(([name]) => (
                  <MechanicIdle key={name} name={name} />
                ))}
                {mechsWith.length === 0 && mechsWithout.length === mechanics.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                      No mechanic assignments for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reschedule modal */}
      {showRescheduleCalendar && rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowRescheduleCalendar(false); setRescheduleTarget(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Reschedule Assignment</h3>
            <p className="text-xs text-gray-500 mb-3">Pick a new date for {rescheduleTarget.mechanic}</p>
            <RescheduleCalendar value={selectedDate} onChange={handleRescheduleConfirm} />
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// Inline calendar for the reschedule modal (not a popover).
function RescheduleCalendar({ value, onChange }) {
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const today = new Date()
  const [vy, setVy] = useState((value || today).getFullYear())
  const [vm, setVm] = useState((value || today).getMonth())
  const first = new Date(vy, vm, 1)
  const startDay = first.getDay()
  const dim = new Date(vy, vm + 1, 0).getDate()
  const prevDim = new Date(vy, vm, 0).getDate()
  const cells = []
  for (let i = startDay - 1; i >= 0; i--) cells.push({ day: prevDim - i, out: true })
  for (let d = 1; d <= dim; d++) cells.push({ day: d, out: false })
  while (cells.length < 42) cells.push({ day: cells.length - startDay - dim + 1, out: true })

  const sd = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const prev = () => { if (vm === 0) { setVm(11); setVy(vy - 1) } else setVm(vm - 1) }
  const next = () => { if (vm === 11) { setVm(0); setVy(vy + 1) } else setVm(vm + 1) }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button onClick={prev} className="p-1 hover:bg-gray-100 rounded-lg text-gray-600">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
        </button>
        <span className="text-sm font-bold text-gray-800">{MONTHS[vm]} {vy}</span>
        <button onClick={next} className="p-1 hover:bg-gray-100 rounded-lg text-gray-600">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M8.6 16.6L10 18l6-6-6-6-1.4 1.4L13.2 12z"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-gray-400 mb-1">
        {DAYS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {cells.map((c, i) => {
          const thisDate = c.out ? null : new Date(vy, vm, c.day)
          const isSel = thisDate && value && sd(thisDate, value)
          const isToday = thisDate && sd(thisDate, today)
          return (
            <button key={i} onClick={() => !c.out && onChange(new Date(vy, vm, c.day))} disabled={c.out}
              className={[
                'w-8 h-8 mx-auto rounded-full flex items-center justify-center transition-colors',
                c.out ? 'text-gray-300 cursor-default' : 'hover:bg-gray-100 cursor-pointer',
                isSel ? 'bg-gray-800 text-white hover:bg-gray-900' : '',
                isToday && !isSel ? 'ring-2 ring-gray-800 font-bold' : '',
              ].join(' ')}
            >{c.day}</button>
          )
        })}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, tone }) {
  const map = {
    green: 'bg-green-600',
    amber: 'bg-amber-500',
  }
  return (
    <div className={`${map[tone]} text-white rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function MechanicCardGroup({ name, list, onReschedule }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-xs font-black shrink-0">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="font-bold text-sm text-gray-900">{name}</div>
        </div>
        <span className="bg-green-100 text-green-700 rounded-full px-2.5 py-0.5 text-[10px] font-bold">
          {list.length} active
        </span>
      </div>
      <div className="divide-y">
        {list.map((a) => (
          <div key={a.id} className="px-4 py-3 hover:bg-gray-50">
            <div className="flex items-center justify-between gap-2 mb-1">
              <Link to={`/vehicles/${a.plateNo}`} className="font-black text-sm text-gray-900 tracking-wide hover:text-brand">
                {a.plateNo}
              </Link>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onReschedule?.(a.id, name)}
                  className="text-gray-400 hover:text-gray-700 p-0.5"
                  title="Reschedule"
                >
                  <Icon name="calendar" className="w-3.5 h-3.5" />
                </button>
                <StatusPill status={a.status} size="sm" />
              </div>
            </div>
            <div className="text-xs text-gray-600">{a.brandModel || '—'}</div>
            <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className="uppercase">{a.customer}</span>
              {a.arrivedAt && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>{formatDateTime(a.arrivedAt)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IdleCard({ name }) {
  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-black shrink-0">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-gray-900 truncate">{name}</div>
          <div className="text-[11px] text-amber-700 italic">Idle — no vehicle assigned</div>
        </div>
      </div>
      <button className="shrink-0 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
        Assign
      </button>
    </div>
  )
}

function MechanicBlock({ name, list, onReschedule }) {
  return (
    <>
      <tr className="bg-yellow-50 border-y">
        <td colSpan={8} className="px-4 py-2 font-semibold text-gray-800">
          {name} ({list.length})
        </td>
      </tr>
      {list.map((a) => (
        <tr key={a.id} className="hover:bg-gray-50">
          <td className="px-4 py-2">
            <span className="inline-flex items-center gap-1 text-xs text-gray-600">
              <Icon name="scheduled" className="w-4 h-4 text-sky-600" />
              SCHEDULED
            </span>
          </td>
          <td className="px-4 py-2">
            <Link to={`/vehicles/${a.plateNo}`} className="text-brand font-semibold hover:underline">{a.plateNo}</Link>
          </td>
          <td className="px-4 py-2">{a.brandModel}</td>
          <td className="px-4 py-2 uppercase">{a.customer}</td>
          <td className="px-4 py-2">{name}</td>
          <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-600">
            {a.arrivedAt ? formatDateTime(a.arrivedAt) : '-'}
          </td>
          <td className="px-4 py-2 text-right"><StatusPill status={a.status} size="sm" /></td>
          <td className="px-4 py-2 text-right">
            <button
              onClick={() => onReschedule?.(a.id, name)}
              className="text-gray-400 hover:text-gray-700 p-1"
              title="Reschedule"
            >
              <Icon name="calendar" className="w-4 h-4" />
            </button>
          </td>
        </tr>
      ))}
    </>
  )
}

function MechanicIdle({ name }) {
  return (
    <>
      <tr className="bg-yellow-50 border-y">
        <td colSpan={8} className="px-4 py-2 font-semibold text-gray-800">
          {name} (0)
        </td>
      </tr>
      <tr>
        <td colSpan={8} className="px-4 py-2 text-sm text-gray-500">
          No assigned vehicle.{' '}
          <button className="ml-3 bg-gray-800 hover:bg-gray-900 text-white text-xs px-3 py-1 rounded">
            Assign Now
          </button>
        </td>
      </tr>
    </>
  )
}
