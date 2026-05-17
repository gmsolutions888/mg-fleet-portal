// Fleet Customer Dashboard. Backed by Firestore via watchVehicles — falls back
// to dummy data if the collections return nothing.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { watchVehicles, profileCompany, isOfficerScoped } from '../lib/vehicles'
import VehicleImage from '../components/ui/VehicleImage'
import OverdueChip from '../components/ui/OverdueChip'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'
import ClientBillingSnapshot from '../components/ClientBillingSnapshot'
import OverduePortalAlert from '../components/OverduePortalAlert'

export default function Portal() {
  const { profile } = useAuth()
  // Preserve the profile's casing — mg-fms stores "Purefoods — San Miguel
  // Corporation" as the `header.client` value, and we want the label to read
  // the same way (not uppercased).
  const company = (profileCompany(profile) || '').toString()

  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')

  const clientVisibleOnly = isClientView(profile)

  const officerScoped = isOfficerScoped(profile)
  const uid = profile?.id || null

  useEffect(() => {
    if (!company) { setVehicles([]); setSource('no-company'); return () => {} }
    const unsub = watchVehicles({ company, clientVisibleOnly }, ({ vehicles, source }) => {
      const filtered = officerScoped && uid ? vehicles.filter((v) => v.fleetOfficerId === uid) : vehicles
      setVehicles(filtered); setSource(source)
    })
    return unsub
  }, [company, clientVisibleOnly, officerScoped, uid])

  const { upcoming, overdue } = useMemo(() => splitByPm(vehicles), [vehicles])
  const fleetStats = useMemo(() => computeStats(vehicles), [vehicles])

  if (!company) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">No fleet company set on your profile</div>
          <div className="text-xs">
            Your account doesn't have a <code>company_id</code> yet, so the portal doesn't know which fleet to show.
            An admin can assign one at <code>/admin/users</code> (edit your row, pick a Fleet Company, save).
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-20">
      <PageHero
        eyebrow="FLEET DASHBOARD"
        title={company}
        subtitle={`${fleetStats.total} vehicle${fleetStats.total === 1 ? '' : 's'} · ${overdue.length} overdue · ${upcoming.length} upcoming`}
        right={<HeroStat value={fleetStats.total} label="FLEET" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules for your role.
        </div>
      )}

      <OverduePortalAlert company={company} />

      {/* Quick stats row — compact, tappable ideally */}
      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile label="Active"  value={fleetStats.active} tone="green" />
          <StatTile label="Minor"   value={fleetStats.minor}  tone="amber" />
          <StatTile label="Unfit"   value={fleetStats.unfit}  tone="red" />
        </div>
      </div>

      <div className="px-3 sm:px-6 pt-5 space-y-5">
        <ClientBillingSnapshot company={company} officerPlates={officerScoped && uid ? new Set(vehicles.map((v) => v.plateNo)) : null} />

        <Section
          title="Overdue Preventive Maintenance"
          icon="warn"
          tone="danger"
          emptyLabel="No overdue PM — you're all clear. 🎉"
          count={overdue.length}
        >
          {overdue.map((v) => <VehicleDashCard key={v.plateNo} vehicle={v} tone="overdue" />)}
        </Section>

        <Section
          title="Upcoming Preventive Maintenance"
          icon="calendar"
          tone="neutral"
          emptyLabel="No upcoming PM scheduled."
          count={upcoming.length}
        >
          {upcoming.map((v) => <VehicleDashCard key={v.plateNo} vehicle={v} tone="upcoming" />)}
        </Section>

        {/* Help card — replaces the blue hotline banner */}
        <a
          href="tel:+6328888823"
          className="flex items-center gap-3 bg-white border rounded-2xl p-4 hover:shadow-md transition-shadow"
        >
          <div className="w-11 h-11 rounded-full bg-brand/10 text-brand flex items-center justify-center shrink-0">
            <Icon name="phone" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">Need assistance?</div>
            <div className="text-xs text-gray-500 leading-snug">
              Tap to call Master Garage fleet hotline<br className="sm:hidden" />
              <span className="font-mono text-gray-700">(02) 888-8823 · 0918 227 3212</span>
            </div>
          </div>
          <span className="text-gray-300 text-xl leading-none shrink-0">›</span>
        </a>

        <ServiceActivityChart />
      </div>
    </div>
  )
}

function StatTile({ label, value, tone }) {
  const map = {
    green: { bg: 'bg-green-600', text: 'text-white' },
    amber: { bg: 'bg-amber-500', text: 'text-white' },
    red:   { bg: 'bg-red-600',   text: 'text-white' },
  }
  const c = map[tone] || map.green
  return (
    <div className={`${c.bg} ${c.text} rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function Section({ title, icon, tone, emptyLabel, count, children }) {
  const accent = tone === 'danger' ? 'text-red-700' : 'text-gray-800'
  const iconTone = tone === 'danger' ? 'text-red-600' : 'text-gray-500'
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className={`flex items-center gap-2 font-bold text-sm uppercase tracking-wider ${accent}`}>
          <Icon name={icon} className={`w-4 h-4 ${iconTone}`} />
          <h2>{title}</h2>
        </div>
        <span className="text-xs text-gray-400">{count || 0}</span>
      </div>
      {count === 0 ? (
        <div className="bg-white border border-dashed rounded-2xl p-5 text-gray-400 text-sm text-center">{emptyLabel}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {children}
        </div>
      )}
    </section>
  )
}

function VehicleDashCard({ vehicle, tone }) {
  const overdue = tone === 'overdue'
  return (
    <Link
      to={`/vehicles/${vehicle.plateNo}`}
      className={`bg-white rounded-2xl border p-3 hover:shadow-md transition-shadow block ${overdue ? 'border-red-200' : ''}`}
    >
      <div className="h-20 flex items-center justify-center mb-2">
        <VehicleImage model={vehicle.model} className="max-h-20 object-contain" />
      </div>
      <div className="font-black text-gray-900 tracking-wide">{vehicle.plateNo}</div>
      <div className="text-[11px] text-gray-500 mb-2 truncate">{vehicle.brandModel}</div>
      <div className="flex items-center gap-1 text-[11px] text-gray-600">
        <Icon name="user" className="w-3 h-3 text-gray-400" />
        <span className="truncate uppercase">{vehicle.assignedTo || '—'}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-gray-600 mt-1">
        <Icon name="calendar" className="w-3 h-3 text-gray-400" />
        <span>{fmt(vehicle.nextPms)}</span>
        {overdue ? (
          <OverdueChip days={vehicle.overdueDays} />
        ) : (
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-1" />
        )}
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-gray-600">
        <span>{vehicle.latestOdo?.toLocaleString() || '-'}</span>
        <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-[10px] font-semibold">
          {vehicle.branch || '—'}
        </span>
      </div>
    </Link>
  )
}

function fmt(d) {
  if (!d) return '-'
  const dd = new Date(d)
  if (isNaN(dd)) return '-'
  const mm = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  return `${mm}/${day}/${dd.getFullYear()}`
}

function splitByPm(vehicles, now = new Date()) {
  const upcoming = [], overdue = []
  for (const v of vehicles) {
    if (v.overdueDays) { overdue.push(v); continue }
    if (v.nextPms) {
      const d = new Date(v.nextPms)
      if (!isNaN(d) && d < now) { overdue.push({ ...v, overdueDays: Math.floor((now - d) / 86400000) }); continue }
    }
    upcoming.push(v)
  }
  upcoming.sort((a, b) => new Date(a.nextPms || 0) - new Date(b.nextPms || 0))
  overdue.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0))
  return { upcoming: upcoming.slice(0, 6), overdue: overdue.slice(0, 9) }
}

function computeStats(vehicles) {
  let active = 0, minor = 0, unfit = 0
  for (const v of vehicles) {
    const s = String(v.roadworthy || '').toLowerCase()
    if (s === 'active' || s === 'roadworthy') active++
    else if (s === 'minor' || s.includes('minor') || s.includes('limited')) minor++
    else if (s === 'unfit' || s.includes('unfit') || s.includes('unroadworthy')) unfit++
  }
  return { total: vehicles.length, active, minor, unfit }
}

function ServiceActivityChart() {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const completed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]
  const scheduled = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0]
  const max = Math.max(...completed, ...scheduled, 4)
  return (
    <div className="bg-gray-900 text-white rounded-2xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="font-semibold text-sm flex items-center gap-2">
          <Icon name="car" className="w-4 h-4" />
          Service Activity
        </div>
        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1">
          <option>2025</option>
          <option>2024</option>
        </select>
      </div>
      <div className="px-4 sm:px-5 py-4">
        <div className="flex items-center gap-4 text-xs text-gray-300 mb-3">
          <LegendItem color="bg-green-500" label="Completed" />
          <LegendItem color="bg-blue-500" label="Scheduled" />
        </div>
        <div className="grid grid-cols-12 gap-1 sm:gap-2 h-40 sm:h-48 items-end">
          {MONTHS.map((m, i) => (
            <div key={m} className="flex flex-col items-center justify-end h-full">
              <div className="flex items-end gap-0.5 h-full">
                <div className="w-2 sm:w-3 bg-green-500 rounded-t" style={{ height: `${(completed[i] / max) * 100}%` }} />
                <div className="w-2 sm:w-3 bg-blue-500 rounded-t" style={{ height: `${(scheduled[i] / max) * 100}%` }} />
              </div>
              <div className="text-[9px] sm:text-[10px] text-gray-400 mt-1">{m}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-sm inline-block ${color}`} />
      <span>{label}</span>
    </div>
  )
}
