// My Fleet — customer-scoped vehicle table backed by Firestore `assessments` +
// `pms_records`. Falls back to dummy data if the collections are empty or the
// user's company isn't set yet.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { watchVehicles, profileCompany } from '../lib/vehicles'
import { fleetStats, pmStats, formatDate } from '../lib/dummyData'
import StatCard from '../components/ui/StatCard'
import RoadworthyBadge from '../components/ui/RoadworthyBadge'
import Icon from '../components/ui/Icon'

const PAGE_SIZES = [10, 25, 50, 100]

export default function MyFleet() {
  const { profile } = useAuth()
  const company = (profileCompany(profile) || '').toString()

  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const clientVisibleOnly = isClientView(profile)

  useEffect(() => {
    if (!company) { setVehicles([]); setSource('no-company'); setLoading(false); return () => {} }
    const unsub = watchVehicles(
      { company, clientVisibleOnly },
      ({ vehicles, source, error, loading }) => {
        setVehicles(vehicles); setSource(source); setLoading(loading); setError(error)
      },
    )
    return unsub
  }, [company, clientVisibleOnly])

  if (!company) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">My Fleet</h1>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">No fleet company set on your profile</div>
          <div className="text-xs">
            Your account doesn't have a <code>company_id</code> yet, so we don't know which fleet to list.
            An admin can assign one at <code>/admin/users</code>.
          </div>
        </div>
      </div>
    )
  }

  const stats = useMemo(() => fleetStats(vehicles), [vehicles])
  const pm = useMemo(() => pmStats(vehicles), [vehicles])

  return (
    <div className="p-4 sm:p-6 pb-16">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 truncate">My Fleet - {company}</h1>
        <DataSource source={source} error={error} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Fleet"                             value={stats.total}  tone="dark"  icon={<Icon name="car" className="w-5 h-5" />} />
        <StatCard label="Active/Roadworthy"                       value={stats.active} tone="green" icon={<Icon name="check" className="w-5 h-5" />} />
        <StatCard label="Minor Repairs Needed & Under Observation" value={stats.minor}  tone="amber" icon={<Icon name="tool" className="w-5 h-5" />} />
        <StatCard label="Unfit for Use / Unroadworthy"            value={stats.unfit}  tone="red"   icon={<Icon name="warn" className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <StatCard compact label="DUE FOR PREVENTIVE MAINTENANCE THIS MONTH" value={pm.dueThisMonth} tone="dark" />
        <StatCard compact label="SCHEDULED FOR PREVENTIVE MAINTENANCE"      value={pm.scheduled}    tone="dark" />
        <StatCard compact label="OVERDUE FOR PREVENTIVE MAINTENANCE"        value={pm.overdue}      tone="dark" />
      </div>

      <FleetTable vehicles={vehicles} loading={loading} />
    </div>
  )
}

function DataSource({ source, error }) {
  if (source === 'firestore') return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
      <span className="w-2 h-2 rounded-full bg-green-500" /> Live data
    </span>
  )
  if (source === 'error') return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" title={error?.message || ''}>
      <span className="w-2 h-2 rounded-full bg-red-500" /> Read blocked by Firestore rules
    </span>
  )
  return null
}

function FleetTable({ vehicles, loading }) {
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('ALL')
  const [sort, setSort] = useState({ field: 'plateNo', dir: 'asc' })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return vehicles.filter((v) => {
      if (filter !== 'ALL' && v.roadworthy !== filter) return false
      if (!term) return true
      const hay = [v.plateNo, v.brandModel, v.yearModel, v.assignedTo, v.latestOdo, v.branch].join(' ').toLowerCase()
      return hay.includes(term)
    })
  }, [vehicles, search, filter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const av = a[sort.field], bv = b[sort.field]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    if (sort.dir === 'desc') arr.reverse()
    return arr
  }, [filtered, sort])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageRows = sorted.slice((current - 1) * pageSize, current * pageSize)

  return (
    <div className="bg-white rounded-md shadow-sm border">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="text-sm text-gray-600">
          Show{' '}
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="border rounded px-2 py-1 mx-1 text-sm">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries
        </div>
        <div className="text-sm text-gray-600">
          Search:{' '}
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="border rounded px-2 py-1 text-sm ml-1" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <Th label="Plate No"        field="plateNo"        sort={sort} setSort={setSort} />
              <Th label="Brand/Model"     field="brandModel"     sort={sort} setSort={setSort} />
              <Th label="Year Model"      field="yearModel"      sort={sort} setSort={setSort} />
              <Th label="Assigned To"     field="assignedTo"     sort={sort} setSort={setSort} />
              <Th label="Latest Odo"      field="latestOdo"      sort={sort} setSort={setSort} />
              <Th label="Recent Service"  field="recentService"  sort={sort} setSort={setSort} />
              <Th label="Next PMS"        field="nextPms"        sort={sort} setSort={setSort} />
              <Th label="Booked Schedule" field="bookedSchedule" sort={sort} setSort={setSort} />
              <Th label="Roadworthy"      field="roadworthy"     sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (<tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>)}
            {!loading && pageRows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                {vehicles.length === 0 ? 'No vehicles for your company yet.' : 'No matches for the current filter/search.'}
              </td></tr>
            )}
            {pageRows.map((v, i) => (
              <tr key={v.plateNo + i} className={i % 2 ? 'bg-white' : 'bg-gray-50/40'}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link to={`/vehicles/${v.plateNo}`} className="text-brand hover:underline font-semibold">{v.plateNo}</Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{v.brandModel}</td>
                <td className="px-4 py-2 whitespace-nowrap">{v.yearModel}</td>
                <td className="px-4 py-2 whitespace-nowrap uppercase">{v.assignedTo || '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{v.latestOdo ? v.latestOdo.toLocaleString() : '-'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(v.recentService)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(v.nextPms)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {v.bookedSchedule ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Icon name="calendar" className="w-4 h-4 text-green-600" />
                      {formatDate(v.bookedSchedule)}
                      {v.bookedBranch && <span className="text-gray-500 ml-1">({v.bookedBranch})</span>}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap"><RoadworthyBadge status={v.roadworthy} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between px-4 py-3 border-t text-sm text-gray-600 gap-2">
        <div>
          Showing {sorted.length === 0 ? 0 : (current - 1) * pageSize + 1} to{' '}
          {Math.min(current * pageSize, sorted.length)} of {sorted.length} entries
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            <span className="text-xs text-gray-500">Filters</span>
            <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1) }} className="bg-gray-900 text-white border rounded px-2 py-1 text-xs">
              <option value="ALL">ALL</option>
              <option value="active">Active / Roadworthy</option>
              <option value="minor">Minor Repairs Needed</option>
              <option value="unfit">Unfit for Use</option>
            </select>
          </div>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current === 1} className="px-3 py-1 border rounded disabled:opacity-40">Previous</button>
          <span className="px-2">{current} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={current === totalPages} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}

function Th({ label, field, sort, setSort }) {
  const active = sort.field === field
  const dir = active ? sort.dir : null
  return (
    <th
      onClick={() => setSort({ field, dir: active && dir === 'asc' ? 'desc' : 'asc' })}
      className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-gray-600 cursor-pointer select-none"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-gray-400 text-[10px]">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅'}</span>
      </span>
    </th>
  )
}
