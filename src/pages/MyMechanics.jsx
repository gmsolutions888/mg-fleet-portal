// My Mechanics (Mechanic Assignment) — matches
// "MG Operations - Mechanic Assignment" mockup. Lists mechanics with their
// currently-assigned vehicles; shows an "Assign Now" button for idle mechanics.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { APPOINTMENTS, MECHANICS, formatDateTime } from '../lib/dummyData'
import { watchVehicles } from '../lib/vehicles'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

export default function MyMechanics() {
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    const unsub = watchVehicles({}, ({ vehicles }) => setVehicles(vehicles))
    return unsub
  }, [])

  // Group appointments by mechanic.
  const groups = useMemo(() => {
    const m = {}
    for (const mech of MECHANICS) m[mech.name] = []
    for (const a of APPOINTMENTS) {
      if (a.mechanic && a.mechanic !== 'Not yet assigned') {
        if (!m[a.mechanic]) m[a.mechanic] = []
        const v = vehicles.find((x) => x.plateNo === a.plateNo)
        m[a.mechanic].push({ ...a, brandModel: v?.brandModel || '' })
      }
    }
    return m
  }, [vehicles])

  const mechsWith = Object.entries(groups).filter(([_, list]) => list.length > 0)
  const mechsWithout = Object.entries(groups).filter(([_, list]) => list.length === 0)

  const today = new Date()
  const todayLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="pb-20">
      <PageHero
        eyebrow="MY MECHANICS"
        title={`${MECHANICS.length} mechanic${MECHANICS.length === 1 ? '' : 's'}`}
        subtitle={todayLabel}
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
        {/* Mobile card list */}
        <div className="lg:hidden space-y-3">
          {mechsWith.map(([name, list]) => (
            <MechanicCardGroup key={name} name={name} list={list} />
          ))}
          {mechsWithout.map(([name]) => (
            <IdleCard key={name} name={name} />
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700 flex items-center justify-between">
            <span>{todayLabel}</span>
            <div className="flex items-center gap-1">
              <button className="text-gray-500 hover:text-gray-800 p-1"><Icon name="print" className="w-4 h-4" /></button>
              <button className="text-gray-500 hover:text-gray-800 p-1"><Icon name="calendar" className="w-4 h-4" /></button>
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
                </tr>
              </thead>
              <tbody>
                {mechsWith.map(([name, list]) => (
                  <MechanicBlock key={name} name={name} list={list} />
                ))}
                {mechsWithout.map(([name]) => (
                  <MechanicIdle key={name} name={name} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

function MechanicCardGroup({ name, list }) {
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
          <Link key={a.id} to={`/vehicles/${a.plateNo}`} className="block px-4 py-3 hover:bg-gray-50">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-black text-sm text-gray-900 tracking-wide">{a.plateNo}</span>
              <StatusPill status={a.status} size="sm" />
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
          </Link>
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

function MechanicBlock({ name, list }) {
  return (
    <>
      <tr className="bg-yellow-50 border-y">
        <td colSpan={7} className="px-4 py-2 font-semibold text-gray-800">
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
        </tr>
      ))}
    </>
  )
}

function MechanicIdle({ name }) {
  return (
    <>
      <tr className="bg-yellow-50 border-y">
        <td colSpan={7} className="px-4 py-2 font-semibold text-gray-800">
          {name} (0)
        </td>
      </tr>
      <tr>
        <td colSpan={7} className="px-4 py-2 text-sm text-gray-500">
          No assigned vehicle.{' '}
          <button className="ml-3 bg-gray-800 hover:bg-gray-900 text-white text-xs px-3 py-1 rounded">
            Assign Now
          </button>
        </td>
      </tr>
    </>
  )
}
