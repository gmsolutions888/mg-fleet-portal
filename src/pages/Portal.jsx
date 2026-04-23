// Fleet Customer Dashboard. Backed by Firestore via watchVehicles — falls back
// to dummy data if the collections return nothing.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { watchVehicles, profileCompany } from '../lib/vehicles'
import VehicleImage from '../components/ui/VehicleImage'
import OverdueChip from '../components/ui/OverdueChip'
import Icon from '../components/ui/Icon'

export default function Portal() {
  const { profile } = useAuth()
  // Preserve the profile's casing — mg-fms stores "Purefoods — San Miguel
  // Corporation" as the `header.client` value, and we want the label to read
  // the same way (not uppercased).
  const company = (profileCompany(profile) || '').toString()

  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')

  const clientVisibleOnly = isClientView(profile)

  useEffect(() => {
    if (!company) { setVehicles([]); setSource('no-company'); return () => {} }
    const unsub = watchVehicles({ company, clientVisibleOnly }, ({ vehicles, source }) => {
      setVehicles(vehicles); setSource(source)
    })
    return unsub
  }, [company, clientVisibleOnly])

  const { upcoming, overdue } = useMemo(() => splitByPm(vehicles), [vehicles])

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
    <div className="p-4 sm:p-6 pb-20">
      <div className="mb-4 bg-sky-50 border border-sky-200 text-sky-900 text-sm rounded-md px-3 sm:px-4 py-2 flex items-start sm:items-center gap-2 flex-wrap">
        <Icon name="phone" className="w-4 h-4 text-sky-700" />
        <span>
          Need assistance? Call Master Garage's fleet service hotline at{' '}
          <strong>(02) 888-8823</strong> or <strong>0918 227 3212</strong>.
        </span>
        {source === 'error' && <span className="ml-auto text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">Read blocked</span>}
      </div>

      <Section
        title="Upcoming Preventive Maintenance"
        accent="text-gray-800"
        empty={upcoming.length === 0 ? 'No upcoming PM at the moment.' : null}
      >
        {upcoming.map((v) => <VehicleDashCard key={v.plateNo} vehicle={v} tone="upcoming" />)}
      </Section>

      <Section
        title="Overdue Preventive Maintenance"
        accent="text-red-600"
        empty={overdue.length === 0 ? 'No overdue PM — all clear.' : null}
      >
        {overdue.map((v) => <VehicleDashCard key={v.plateNo} vehicle={v} tone="overdue" />)}
      </Section>

      <ServiceActivityChart />
    </div>
  )
}

function Section({ title, accent, empty, children }) {
  return (
    <section className="mb-6">
      <div className={`flex items-center gap-2 mb-3 font-semibold text-base ${accent}`}>
        <Icon name="tool" className="w-5 h-5" />
        <h2>{title}</h2>
      </div>
      {empty ? (
        <div className="bg-white border border-dashed rounded-md p-6 text-gray-400 text-sm text-center">{empty}</div>
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
      className="bg-white rounded-md border p-3 hover:shadow-md transition-shadow block"
    >
      <div className="h-20 flex items-center justify-center mb-2">
        <VehicleImage model={vehicle.model} className="max-h-20 object-contain" />
      </div>
      <div className="font-bold text-gray-900 tracking-wide">{vehicle.plateNo}</div>
      <div className="text-[11px] text-gray-500 mb-2">{vehicle.brandModel}</div>
      <div className="flex items-center gap-1 text-[11px] text-gray-600">
        <Icon name="user" className="w-3 h-3 text-gray-500" />
        <span className="truncate uppercase">{vehicle.assignedTo || '—'}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-gray-600 mt-1">
        <Icon name="calendar" className="w-3 h-3 text-gray-500" />
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

function ServiceActivityChart() {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const completed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]
  const scheduled = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0]
  const max = Math.max(...completed, ...scheduled, 4)
  return (
    <div className="bg-gray-900 text-white rounded-md mt-6 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="font-semibold text-sm flex items-center gap-2">
          <Icon name="car" className="w-4 h-4" />
          Service Activity
        </div>
        <select className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1">
          <option>2025</option>
          <option>2024</option>
        </select>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-center gap-4 text-xs text-gray-300 mb-3">
          <LegendItem color="bg-green-500" label="Completed Services" />
          <LegendItem color="bg-blue-500" label="Scheduled Services" />
        </div>
        <div className="grid grid-cols-12 gap-2 h-48 items-end">
          {MONTHS.map((m, i) => (
            <div key={m} className="flex flex-col items-center justify-end h-full">
              <div className="flex items-end gap-0.5 h-full">
                <div className="w-3 bg-green-500 rounded-t" style={{ height: `${(completed[i] / max) * 100}%` }} />
                <div className="w-3 bg-blue-500 rounded-t" style={{ height: `${(scheduled[i] / max) * 100}%` }} />
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{m}</div>
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
