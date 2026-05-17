// My Fleet — customer-scoped vehicle list backed by Firestore `assessments`
// + `pms_records`. Mobile-first card list, desktop retains the paginated
// table for density.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { watchVehicles, profileCompany, isOfficerScoped } from '../lib/vehicles'
import { watchUsers } from '../lib/users'
import { watchAppointments, APPT_STATUS } from '../lib/appointments'
import { fleetStats, pmStats, formatDate, formatDateTime } from '../lib/dummyData'
import RoadworthyBadge from '../components/ui/RoadworthyBadge'
import VehicleImage from '../components/ui/VehicleImage'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const PAGE_SIZES = [10, 25, 50, 100]

export default function MyFleet() {
  const { profile } = useAuth()
  const company = (profileCompany(profile) || '').toString()

  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const clientVisibleOnly = isClientView(profile)
  const isManager = String(profile?.role || '').toLowerCase() === 'fleet_client_manager'
  const officerScoped = isOfficerScoped(profile)
  const uid = profile?.id || null

  const [appointments, setAppointments] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [officerFilter, setOfficerFilter] = useState('ALL')
  const [selected, setSelected] = useState(new Set())
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [singleAssign, setSingleAssign] = useState(null)

  const fleetUsers = useMemo(() => {
    return allUsers
      .filter((u) => String(u.role || '').toLowerCase() === 'fleet_client' && u.is_active !== 0)
      .filter((u) => {
        if (!company) return true
        const uc = (u.company_id || u.company || '').toLowerCase().trim()
        const cf = company.toLowerCase().trim()
        return uc === cf || uc.includes(cf) || cf.includes(uc)
      })
      .map((u) => ({ id: u.id, name: u.name || u.email || '—', email: u.email || '' }))
  }, [allUsers, company])

  useEffect(() => {
    if (!company) { setVehicles([]); setSource('no-company'); setLoading(false); return () => {} }
    const u1 = watchVehicles(
      { company, clientVisibleOnly },
      ({ vehicles, source, error, loading }) => {
        setVehicles(vehicles); setSource(source); setLoading(loading); setError(error)
      },
    )
    const u2 = watchAppointments({ dummyFallback: false }, ({ rows }) => setAppointments(rows))
    const u3 = isManager ? watchUsers((list) => setAllUsers(list)) : null
    return () => { u1?.(); u2?.(); u3?.() }
  }, [company, clientVisibleOnly])

  // Enrich vehicles with booked schedule from active appointments
  const BOOKED_STATUSES = new Set([
    APPT_STATUS.PENDING_BOOKING, APPT_STATUS.PENDING_BRANCH_APPROVAL,
    APPT_STATUS.BOOKED, APPT_STATUS.CONFIRMED, APPT_STATUS.TENTATIVE,
    APPT_STATUS.ARRIVED, APPT_STATUS.ONGOING,
  ])

  const enrichedVehicles = useMemo(() => {
    const apptByPlate = {}
    for (const a of appointments) {
      if (!BOOKED_STATUSES.has(a.status)) continue
      if (company && a.company !== company) continue
      const plate = (a.plateNo || '').toUpperCase()
      if (!apptByPlate[plate] || (a.scheduledAt && !apptByPlate[plate].scheduledAt)) {
        apptByPlate[plate] = a
      }
    }
    let result = vehicles.map((v) => {
      const appt = apptByPlate[(v.plateNo || '').toUpperCase()]
      if (!appt) return v
      return {
        ...v,
        bookedSchedule: appt.scheduledAt || null,
        bookedBranch: appt.branch || null,
        bookedStatus: appt.status || null,
      }
    })
    // Fleet client users only see their assigned vehicles
    if (officerScoped && uid) {
      result = result.filter((v) => v.fleetOfficerId === uid)
    }
    // Fleet client manager: apply officer filter dropdown
    if (isManager && officerFilter !== 'ALL') {
      if (officerFilter === 'UNASSIGNED') result = result.filter((v) => !v.fleetOfficerId)
      else result = result.filter((v) => v.fleetOfficerId === officerFilter)
    }
    return result
  }, [vehicles, appointments, company, officerScoped, isManager, officerFilter, uid])

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

  const stats = useMemo(() => fleetStats(enrichedVehicles), [enrichedVehicles])
  const pm = useMemo(() => pmStats(enrichedVehicles), [enrichedVehicles])

  return (
    <div className="pb-20">
      <PageHero
        eyebrow="MY FLEET"
        title={company}
        subtitle={`${stats.total} vehicle${stats.total === 1 ? '' : 's'} · ${pm.overdue} overdue · ${pm.dueThisMonth} due this month`}
        right={<HeroStat value={stats.total} label="TOTAL" tone="solid" />}
      />

      {/* Floating status tiles — overlap the hero for the mg-fms look */}
      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatusTile label="Active" value={stats.active} tone="green" />
          <StatusTile label="Minor"  value={stats.minor}  tone="amber" />
          <StatusTile label="Unfit"  value={stats.unfit}  tone="red" />
        </div>
      </div>

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" title={error?.message || ''}>
          Read blocked by Firestore rules
        </div>
      )}

      <div className="px-3 sm:px-6 pt-5 space-y-4">
        {/* Fleet officer filter — manager only */}
        {isManager && fleetUsers.length > 0 && (
          <select value={officerFilter} onChange={(e) => setOfficerFilter(e.target.value)} className="input max-w-xs">
            <option value="ALL">All Fleet Officers</option>
            <option value="UNASSIGNED">Unassigned</option>
            {fleetUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}

        {/* PM quick stats in compact row */}
        <div className="grid grid-cols-3 gap-2">
          <PmTile label="Due this month"      value={pm.dueThisMonth} />
          <PmTile label="Scheduled"           value={pm.scheduled} />
          <PmTile label="Overdue"             value={pm.overdue} tone="danger" />
        </div>

        {/* Mobile: card list. Desktop: keep the existing dense table. */}
        <MobileList vehicles={enrichedVehicles} loading={loading} isManager={isManager} onAssign={setSingleAssign} />
        <div className="hidden lg:block">
          <FleetTable vehicles={enrichedVehicles} loading={loading} isManager={isManager} selected={selected} onToggle={(p) => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })} onSelectAll={() => setSelected((s) => s.size === enrichedVehicles.length ? new Set() : new Set(enrichedVehicles.map((v) => v.plateNo)))} onAssign={setSingleAssign} />
        </div>
      </div>

      {/* Bulk assign bar — manager only */}
      {isManager && selected.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-30 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            <span className="font-black text-lg text-brand">{selected.size}</span> vehicle{selected.size === 1 ? '' : 's'} selected
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg font-bold">Clear</button>
            <button onClick={() => setShowBulkAssign(true)} className="text-sm text-white bg-brand hover:bg-brand-dark px-4 py-2 rounded-lg font-bold">Assign Fleet Officer</button>
          </div>
        </div>
      )}

      {/* Bulk assign modal */}
      {showBulkAssign && (
        <AssignOfficerModal
          selected={selected}
          fleetUsers={fleetUsers}
          onClose={() => setShowBulkAssign(false)}
          onDone={() => { setShowBulkAssign(false); setSelected(new Set()) }}
        />
      )}

      {/* Single assign modal */}
      {singleAssign && (
        <AssignOfficerModal
          selected={new Set([singleAssign.plateNo])}
          fleetUsers={fleetUsers}
          onClose={() => setSingleAssign(null)}
          onDone={() => setSingleAssign(null)}
        />
      )}
    </div>
  )
}

function AssignOfficerModal({ selected, fleetUsers, onClose, onDone }) {
  const [officerId, setOfficerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedUser = fleetUsers.find((u) => u.id === officerId)

  const submit = async () => {
    if (!officerId || !selectedUser) return
    setSaving(true); setError(null)
    try {
      const assessSnap = await getDocs(query(collection(db, 'assessments')))
      const updates = []
      for (const d of assessSnap.docs) {
        const plate = String(d.data()?.header?.plate || '').toUpperCase().replace(/\s+/g, '')
        if (selected.has(plate)) {
          updates.push(updateDoc(doc(db, 'assessments', d.id), {
            'vehicleMeta.fleetOfficerId': selectedUser.id,
            'vehicleMeta.fleetOfficerName': selectedUser.name,
            'vehicleMeta.fleetOfficerEmail': selectedUser.email,
            updatedAt: serverTimestamp(),
          }))
        }
      }
      await Promise.all(updates)
      onDone()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-brand text-white px-5 py-4">
          <div className="text-[10px] font-bold tracking-widest opacity-70">ASSIGN FLEET OFFICER</div>
          <div className="font-black text-lg mt-0.5">{selected.size} vehicle{selected.size === 1 ? '' : 's'}</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Fleet Officer *</label>
            <select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="input" required>
              <option value="">— select fleet officer —</option>
              {fleetUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>
          {selectedUser && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
              <strong>{selectedUser.name}</strong> will be assigned as fleet officer.
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-3 rounded-xl">Cancel</button>
          <button type="button" onClick={submit} disabled={!officerId || saving} className="flex-1 text-sm font-bold text-white bg-brand hover:bg-brand-dark disabled:opacity-40 px-4 py-3 rounded-xl shadow">
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusTile({ label, value, tone }) {
  const map = {
    green: 'bg-green-600',
    amber: 'bg-amber-500',
    red:   'bg-red-600',
  }
  return (
    <div className={`${map[tone]} text-white rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function PmTile({ label, value, tone }) {
  const isDanger = tone === 'danger'
  return (
    <div className={`rounded-xl border px-3 py-2 flex flex-col ${isDanger ? 'bg-red-50 border-red-200' : 'bg-white'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${isDanger ? 'text-red-700' : 'text-gray-500'}`}>{label}</div>
      <div className={`text-xl font-black mt-0.5 ${isDanger ? 'text-red-700' : 'text-gray-800'}`}>{value ?? 0}</div>
    </div>
  )
}

function MobileList({ vehicles, loading, isManager, onAssign }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return vehicles.filter((v) => {
      if (filter !== 'ALL' && v.roadworthy !== filter) return false
      if (!term) return true
      const hay = [v.plateNo, v.brandModel, v.yearModel, v.assignedTo, v.branch].join(' ').toLowerCase()
      return hay.includes(term)
    })
  }, [vehicles, search, filter])

  return (
    <div className="lg:hidden space-y-3">
      {/* Search + filter row */}
      <div className="bg-white rounded-2xl border p-3 space-y-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plate, model, driver…"
          className="input"
        />
        <div className="flex gap-1.5 overflow-x-auto">
          {[
            ['ALL', 'All'],
            ['active', 'Active'],
            ['minor', 'Minor'],
            ['unfit', 'Unfit'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                filter === value ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">Loading vehicles…</div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">
          {vehicles.length === 0 ? 'No vehicles for your company yet.' : 'No matches for the current filter.'}
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((v) => <VehicleCard key={v.plateNo} vehicle={v} />)}
      </div>
    </div>
  )
}

function VehicleCard({ vehicle }) {
  return (
    <Link
      to={`/vehicles/${vehicle.plateNo}`}
      className="flex items-center gap-3 bg-white rounded-2xl border p-3 hover:shadow-md transition-shadow"
    >
      <div className="w-20 h-16 shrink-0 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden">
        <VehicleImage model={vehicle.model} className="max-h-14 max-w-[4.5rem] object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-black text-base text-gray-900 tracking-wide">{vehicle.plateNo}</div>
            <div className="text-xs text-gray-500 truncate">{vehicle.brandModel || '—'} {vehicle.yearModel || ''}</div>
          </div>
          <RoadworthyBadge status={vehicle.roadworthy} size="sm" />
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-gray-600">
          <span className="flex items-center gap-1 min-w-0">
            <Icon name="user" className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="uppercase truncate">{vehicle.assignedTo || 'Unassigned'}</span>
            {vehicle.fleetOfficerName && <span className="text-gray-400">· {vehicle.fleetOfficerName}</span>}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <Icon name="calendar" className="w-3 h-3 text-gray-400" />
            {formatDate(vehicle.nextPms) || '-'}
          </span>
        </div>
        {vehicle.bookedStatus && (
          <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] rounded px-2 py-1 ${
            vehicle.bookedStatus === 'CONFIRMED' || vehicle.bookedStatus === 'BOOKED'
              ? 'text-green-700 bg-green-50'
              : vehicle.bookedStatus === 'PENDING_BRANCH_APPROVAL'
              ? 'text-amber-700 bg-amber-50'
              : 'text-sky-700 bg-sky-50'
          }`}>
            <Icon name="calendar" className="w-3 h-3" />
            {vehicle.bookedSchedule
              ? <span>Booked: {formatDateTime(vehicle.bookedSchedule)}</span>
              : <span>Awaiting schedule</span>}
            {vehicle.bookedBranch && <span>· {vehicle.bookedBranch}</span>}
            <span className={`font-bold px-1.5 py-0.5 rounded-full text-[9px] ml-auto ${
              vehicle.bookedStatus === 'CONFIRMED' || vehicle.bookedStatus === 'BOOKED'
                ? 'bg-green-200 text-green-800'
                : vehicle.bookedStatus === 'PENDING_BRANCH_APPROVAL'
                ? 'bg-amber-200 text-amber-800'
                : 'bg-sky-200 text-sky-800'
            }`}>
              {vehicle.bookedStatus === 'CONFIRMED' || vehicle.bookedStatus === 'BOOKED' ? 'Approved'
                : vehicle.bookedStatus === 'PENDING_BRANCH_APPROVAL' ? 'Pending Approval'
                : 'Pending Schedule'}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}

function FleetTable({ vehicles, loading, isManager, selected, onToggle, onSelectAll, onAssign }) {
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
    <div className="bg-white rounded-2xl shadow-sm border">
      <div className="flex items-center justify-between px-4 py-3 border-b gap-2 flex-wrap">
        <div className="text-sm text-gray-600">
          Show{' '}
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="border rounded px-2 py-1 mx-1 text-sm">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries
        </div>
        <div className="text-sm text-gray-600 flex items-center gap-1">
          <span>Search:</span>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b">
            <tr>
              {isManager && (
                <th className="px-2 py-3 text-center w-8">
                  <input type="checkbox" checked={selected?.size === vehicles.length && vehicles.length > 0} onChange={onSelectAll} />
                </th>
              )}
              <Th label="Plate No"        field="plateNo"        sort={sort} setSort={setSort} />
              <Th label="Brand/Model"     field="brandModel"     sort={sort} setSort={setSort} />
              <Th label="Year Model"      field="yearModel"      sort={sort} setSort={setSort} />
              <Th label="Assigned To"     field="assignedTo"     sort={sort} setSort={setSort} />
              <Th label="Fleet Officer"   field="fleetOfficerName" sort={sort} setSort={setSort} />
              <Th label="Latest Odo"      field="latestOdo"      sort={sort} setSort={setSort} />
              <Th label="Recent Service"  field="recentService"  sort={sort} setSort={setSort} />
              <Th label="Next PMS"        field="nextPms"        sort={sort} setSort={setSort} />
              <Th label="Booked Schedule" field="bookedSchedule" sort={sort} setSort={setSort} />
              <Th label="Roadworthy"      field="roadworthy"     sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (<tr><td colSpan={isManager ? 11 : 10} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>)}
            {!loading && pageRows.length === 0 && (
              <tr><td colSpan={isManager ? 11 : 10} className="px-4 py-8 text-center text-gray-400">
                {vehicles.length === 0 ? 'No vehicles for your company yet.' : 'No matches for the current filter/search.'}
              </td></tr>
            )}
            {pageRows.map((v, i) => (
              <tr key={v.plateNo + i} className={`${i % 2 ? 'bg-white' : 'bg-gray-50/40'} ${selected?.has(v.plateNo) ? '!bg-brand/5' : ''}`}>
                {isManager && (
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={selected?.has(v.plateNo)} onChange={() => onToggle(v.plateNo)} />
                  </td>
                )}
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link to={`/vehicles/${v.plateNo}`} className="text-brand hover:underline font-semibold">{v.plateNo}</Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{v.brandModel}</td>
                <td className="px-4 py-2 whitespace-nowrap">{v.yearModel}</td>
                <td className="px-4 py-2 whitespace-nowrap uppercase">{v.assignedTo || '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {v.fleetOfficerName ? (
                    <div className="flex items-center gap-1.5">
                      <span>{v.fleetOfficerName}</span>
                      {isManager && <button onClick={() => onAssign(v)} className="text-[9px] text-gray-400 hover:text-brand">change</button>}
                    </div>
                  ) : isManager ? (
                    <button onClick={() => onAssign(v)} className="text-[10px] font-bold text-brand hover:underline">Assign</button>
                  ) : (
                    <span className="text-gray-400 italic text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{v.latestOdo ? v.latestOdo.toLocaleString() : '-'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(v.recentService)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(v.nextPms)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {v.bookedSchedule ? (
                    <div className="inline-flex flex-col gap-1">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Icon name="calendar" className={`w-4 h-4 ${v.bookedStatus === 'CONFIRMED' || v.bookedStatus === 'BOOKED' ? 'text-green-600' : 'text-amber-500'}`} />
                        {formatDate(v.bookedSchedule)}
                        {v.bookedBranch && <span className="text-gray-500 ml-1">({v.bookedBranch})</span>}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${
                        v.bookedStatus === 'CONFIRMED' || v.bookedStatus === 'BOOKED'
                          ? 'bg-green-100 text-green-700'
                          : v.bookedStatus === 'PENDING_BRANCH_APPROVAL'
                          ? 'bg-amber-100 text-amber-700'
                          : v.bookedStatus === 'PENDING_BOOKING'
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {v.bookedStatus === 'CONFIRMED' || v.bookedStatus === 'BOOKED' ? 'Approved'
                          : v.bookedStatus === 'PENDING_BRANCH_APPROVAL' ? 'Pending Approval'
                          : v.bookedStatus === 'PENDING_BOOKING' ? 'Pending Schedule'
                          : v.bookedStatus || '—'}
                      </span>
                    </div>
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
