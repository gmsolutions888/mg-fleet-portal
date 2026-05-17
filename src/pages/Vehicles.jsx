// Staff "Fleet" / all-vehicles list. Reads live from Firestore via watchVehicles
// with no company filter — staff see everything.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { watchVehicles, formatDate } from '../lib/vehicles'
import { watchFleetCompanies } from '../lib/fleetCompanies'
import { watchUsers } from '../lib/users'
import { getAllBrands, getAllModels } from '../lib/refVehicles'
import RoadworthyBadge from '../components/ui/RoadworthyBadge'
import VehicleImage from '../components/ui/VehicleImage'
import SlidePanel from '../components/ui/SlidePanel'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const ROADWORTHY_TABS = [
  { key: 'ALL',    label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'minor',  label: 'Minor' },
  { key: 'unfit',  label: 'Unfit' },
]

export default function Vehicles() {
  const { profile } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('ALL')
  const [officerFilter, setOfficerFilter] = useState('ALL')
  const [roadworthy, setRoadworthy] = useState('ALL')
  const [showAdd, setShowAdd] = useState(false)
  const [editVehicle, setEditVehicle] = useState(null)
  const [fleetCompanies, setFleetCompanies] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [singleAssign, setSingleAssign] = useState(null) // vehicle to assign officer to

  const fleetUsers = useMemo(() => {
    return allUsers
      .filter((u) => String(u.role || '').toLowerCase() === 'fleet_client' && u.is_active !== 0)
      .map((u) => ({ id: u.id, name: u.name || u.email || '—', email: u.email || '', company: u.company_id || u.company || '', role: u.role }))
  }, [allUsers])

  useEffect(() => {
    const u1 = watchVehicles({}, ({ vehicles, source }) => {
      setVehicles(vehicles); setSource(source)
    })
    const u2 = watchFleetCompanies((list) => setFleetCompanies(list))
    const u3 = watchUsers((list) => setAllUsers(list))
    return () => { u1?.(); u2?.(); u3?.() }
  }, [])

  const toggleSelect = (plateNo) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(plateNo)) next.delete(plateNo)
      else next.add(plateNo)
      return next
    })
  }
  const selectAllRows = () => {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map((v) => v.plateNo)))
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return vehicles.filter((v) => {
      if (company !== 'ALL') {
        if (company === 'WALK-IN') { if (v.company) return false }
        else {
          const vc = (v.company || '').toLowerCase().trim()
          const cf = company.toLowerCase().trim()
          if (!(vc === cf || vc.includes(cf) || cf.includes(vc))) return false
        }
      }
      if (roadworthy !== 'ALL' && v.roadworthy !== roadworthy) return false
      if (officerFilter !== 'ALL') {
        if (officerFilter === 'UNASSIGNED') { if (v.fleetOfficerId) return false }
        else if (v.fleetOfficerId !== officerFilter) return false
      }
      if (!term) return true
      return [v.plateNo, v.brandModel, v.yearModel, v.assignedTo, v.fleetOfficerName].join(' ').toLowerCase().includes(term)
    })
  }, [vehicles, search, company, roadworthy, officerFilter])

  const companies = useMemo(() => {
    const s = new Set()
    for (const v of vehicles) s.add(v.company || 'WALK-IN')
    return Array.from(s).sort()
  }, [vehicles])

  const counts = useMemo(() => {
    const c = { ALL: vehicles.length, active: 0, minor: 0, unfit: 0 }
    for (const v of vehicles) if (c[v.roadworthy] != null) c[v.roadworthy]++
    return c
  }, [vehicles])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="FLEET"
        title="All Vehicles"
        subtitle={`${vehicles.length} total · ${counts.active} active · ${counts.unfit} unfit`}
        right={<HeroStat value={vehicles.length} label="TOTAL" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Filter chips */}
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {ROADWORTHY_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setRoadworthy(t.key)}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                roadworthy === t.key ? 'bg-brand text-white' : 'bg-white border text-gray-700'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${roadworthy === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search + company + officer filter */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plate, model, driver, officer…"
              className="input pl-9"
            />
          </div>
          <select value={company} onChange={(e) => { setCompany(e.target.value); setSelected(new Set()); setOfficerFilter('ALL') }} className="input">
            <option value="ALL">All companies</option>
            {fleetCompanies.map((c) => (
              <option key={c.id} value={c.name}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
            ))}
            <option value="WALK-IN">Walk-in</option>
          </select>
          <select value={officerFilter} onChange={(e) => setOfficerFilter(e.target.value)} className="input">
            <option value="ALL">All officers</option>
            <option value="UNASSIGNED">Unassigned</option>
            {fleetUsers
              .filter((u) => {
                if (company === 'ALL' || company === 'WALK-IN') return true
                const cf = company.toLowerCase().trim()
                const uc = (u.company || '').toLowerCase().trim()
                return uc === cf || uc.includes(cf) || cf.includes(uc)
              })
              .map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))
            }
          </select>
        </div>

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">No vehicles match.</div>
          )}
          {rows.map((v, i) => <VehicleRowCard key={v.plateNo + i} v={v} />)}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  {company !== 'ALL' && company !== 'WALK-IN' && (
                    <th className="px-2 py-3 text-center font-medium w-8">
                      <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={selectAllRows} />
                    </th>
                  )}
                  <th className="px-3 py-3 text-center font-medium w-10"></th>
                  <th className="px-3 py-3 text-left font-medium">Plate No</th>
                  <th className="px-3 py-3 text-left font-medium">Brand/Model</th>
                  <th className="px-3 py-3 text-left font-medium">Year</th>
                  <th className="px-3 py-3 text-left font-medium">Company</th>
                  <th className="px-3 py-3 text-left font-medium">Assigned To</th>
                  <th className="px-3 py-3 text-left font-medium">Fleet Officer</th>
                  <th className="px-3 py-3 text-right font-medium">Odo</th>
                  <th className="px-3 py-3 text-left font-medium">Next PMS</th>
                  <th className="px-3 py-3 text-left font-medium">Roadworthy</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No vehicles match.</td></tr>
                )}
                {rows.map((v, i) => (
                  <tr key={v.plateNo + i} className={`hover:bg-gray-50 ${selected.has(v.plateNo) ? 'bg-brand/5' : ''}`}>
                    {company !== 'ALL' && company !== 'WALK-IN' && (
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={selected.has(v.plateNo)} onChange={() => toggleSelect(v.plateNo)} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => setEditVehicle(v)} className="text-gray-400 hover:text-brand text-[10px] font-bold">Edit</button>
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/vehicles/${v.plateNo}`} className="text-brand font-semibold hover:underline">{v.plateNo}</Link>
                    </td>
                    <td className="px-3 py-2">{v.brandModel}</td>
                    <td className="px-3 py-2">{v.yearModel}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{v.company || 'WALK-IN'}</td>
                    <td className="px-3 py-2">
                      <div className="uppercase text-sm">{v.assignedTo || '—'}</div>
                      {v.mobileNo && <div className="text-[10px] text-gray-400">{v.mobileNo}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {v.fleetOfficerName ? (
                        <div className="flex items-center gap-1.5">
                          <div>
                            <div className="text-sm font-medium">{v.fleetOfficerName}</div>
                            {v.fleetOfficerEmail && <div className="text-[10px] text-gray-400">{v.fleetOfficerEmail}</div>}
                          </div>
                          {v.company && <button onClick={() => setSingleAssign(v)} className="text-[9px] text-gray-400 hover:text-brand shrink-0">change</button>}
                        </div>
                      ) : v.company ? (
                        <button onClick={() => setSingleAssign(v)} className="text-[10px] font-bold text-brand hover:underline">Assign</button>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{v.latestOdo?.toLocaleString() || '-'}</td>
                    <td className="px-3 py-2">
                      <div>{formatDate(v.nextPms)}</div>
                      {v.branch && <div className="text-[10px] text-gray-400">{v.branch}</div>}
                    </td>
                    <td className="px-3 py-2"><RoadworthyBadge status={v.roadworthy} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bulk assign bar */}
      {selected.size > 0 && (
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

      {/* Floating Add Vehicle — hidden when bulk bar is showing */}
      {selected.size === 0 && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
          <button
            onClick={() => setShowAdd(true)}
            className="bg-brand hover:bg-brand-dark text-white px-4 sm:px-5 py-3 rounded-full font-bold text-sm flex items-center gap-2 shadow-xl"
          >
            <Icon name="plus" className="w-4 h-4" />
            Add Vehicle
          </button>
        </div>
      )}

      {/* Bulk Assign Fleet Officer modal */}
      {showBulkAssign && (
        <BulkAssignModal
          vehicles={vehicles}
          selected={selected}
          fleetUsers={fleetUsers}
          fleetCompanies={fleetCompanies}
          onClose={() => setShowBulkAssign(false)}
          onDone={() => { setShowBulkAssign(false); setSelected(new Set()) }}
        />
      )}

      {/* Single vehicle assign officer */}
      {singleAssign && (
        <BulkAssignModal
          vehicles={vehicles}
          selected={new Set([singleAssign.plateNo])}
          fleetUsers={fleetUsers}
          fleetCompanies={fleetCompanies}
          onClose={() => setSingleAssign(null)}
          onDone={() => setSingleAssign(null)}
        />
      )}

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Vehicle">
        <AddVehicleForm
          profile={profile}
          fleetCompanies={fleetCompanies}
          vehicles={vehicles}
          onClose={() => setShowAdd(false)}
        />
      </SlidePanel>

      <SlidePanel open={Boolean(editVehicle)} onClose={() => setEditVehicle(null)} title="Edit Vehicle">
        {editVehicle && (
          <EditVehicleForm
            vehicle={editVehicle}
            fleetCompanies={fleetCompanies}
            fleetUsers={fleetUsers}
            onClose={() => setEditVehicle(null)}
          />
        )}
      </SlidePanel>
    </div>
  )
}

function AddVehicleForm({ profile, fleetCompanies, vehicles, onClose }) {
  const [form, setForm] = useState({
    plateNo: '',
    make: '',
    model: '',
    yearModel: '',
    odometer: '',
    company: '',
    assignedTo: '',
    mobileNo: '',
    color: '',
    transmission: '',
    engineNo: '',
  })
  const [brands, setBrands] = useState([])
  const [models, setModels] = useState([])
  const [filteredModels, setFilteredModels] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [plateError, setPlateError] = useState(null)

  useEffect(() => {
    getAllBrands().then(setBrands)
    getAllModels().then(setModels)
  }, [])

  const update = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field === 'plateNo') {
      const plate = value.toUpperCase().replace(/\s+/g, '')
      const exists = vehicles.some((v) => v.plateNo === plate)
      setPlateError(exists ? 'This plate number already exists' : null)
    }
    if (field === 'make') {
      const brand = brands.find((b) => b.name === value)
      const makeId = brand?.caviteId
      setFilteredModels(makeId ? models.filter((m) => m.caviteMakeId === makeId) : [])
      setForm((f) => ({ ...f, make: value, model: '' }))
      return
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.plateNo.trim()) return
    const plate = form.plateNo.toUpperCase().replace(/\s+/g, '')
    if (vehicles.some((v) => v.plateNo === plate)) {
      setPlateError('This plate number already exists')
      return
    }
    setSaving(true); setError(null)
    try {
      const brand = brands.find((b) => b.name === form.make)
      const model = models.find((m) => m.name === form.model && m.caviteMakeId === brand?.caviteId)
      await addDoc(collection(db, 'assessments'), {
        id: Date.now(),
        rwaNumber: `RWA-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
        header: {
          plate,
          make: form.make.trim(),
          model: form.model.trim(),
          yearModel: form.yearModel.trim(),
          makeId: brand?.caviteId || null,
          modelId: model?.caviteId || null,
          client: form.company || null,
          branch: profile?.branch || null,
          technician: profile?.name || 'System',
          odometer: Number(form.odometer) || 0,
          type: 'Initial',
          date: new Date().toISOString().slice(0, 10),
        },
        itemResults: {},
        classification: { overallStatus: 'active', dispatchAllowed: true, failCriticalCount: 0, monitorCount: 0, totalBlockerCount: 0 },
        fmsStatus: 'synced',
        submittedAt: new Date().toISOString(),
        review_status: 'SENT_TO_CLIENT',
        createdBy: auth?.currentUser?.uid || null,
        _vehicleRegistration: true,
        vehicleMeta: {
          assignedTo: form.assignedTo.trim() || null,
          mobileNo: form.mobileNo.trim() || null,
          color: form.color.trim() || null,
          transmission: form.transmission || null,
          engineNo: form.engineNo.trim() || null,
        },
      })
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2 text-xs">{error}</div>}

      <Row label="Plate No. *">
        <input value={form.plateNo} onChange={(e) => update('plateNo', e.target.value.toUpperCase())} required className="input uppercase" placeholder="e.g. ABC1234" />
        {plateError && <div className="text-xs text-red-600 font-semibold mt-1">{plateError}</div>}
      </Row>

      <Row label="Make *">
        <select value={form.make} onChange={(e) => update('make', e.target.value)} required className="input">
          <option value="">— select make —</option>
          {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
      </Row>

      <Row label="Model *">
        <select value={form.model} onChange={(e) => update('model', e.target.value)} required className="input" disabled={!form.make}>
          <option value="">— select model —</option>
          {filteredModels.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </Row>

      <Row label="Year Model">
        <input value={form.yearModel} onChange={(e) => update('yearModel', e.target.value)} className="input" placeholder="e.g. 2024" />
      </Row>

      <Row label="Latest Odometer (km)">
        <input type="number" value={form.odometer} onChange={(e) => update('odometer', e.target.value)} className="input" placeholder="e.g. 15000" />
      </Row>

      <Row label="Fleet Company">
        <select value={form.company} onChange={(e) => update('company', e.target.value)} className="input">
          <option value="">— none (walk-in) —</option>
          {fleetCompanies.map((c) => (
            <option key={c.id} value={c.name}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
          ))}
        </select>
      </Row>

      <Row label="Assigned To">
        <input value={form.assignedTo} onChange={(e) => update('assignedTo', e.target.value)} className="input" placeholder="e.g. Juan Dela Cruz" />
      </Row>

      <Row label="Mobile No.">
        <input value={form.mobileNo} onChange={(e) => update('mobileNo', e.target.value)} className="input" placeholder="e.g. 09171234567" />
      </Row>

      <Row label="Color">
        <input value={form.color} onChange={(e) => update('color', e.target.value)} className="input" placeholder="e.g. White" />
      </Row>

      <Row label="Transmission">
        <select value={form.transmission} onChange={(e) => update('transmission', e.target.value)} className="input">
          <option value="">— select —</option>
          <option>Manual</option>
          <option>Automatic</option>
          <option>CVT</option>
        </select>
      </Row>

      <Row label="Engine No.">
        <input value={form.engineNo} onChange={(e) => update('engineNo', e.target.value)} className="input" placeholder="Optional" />
      </Row>

      <div className="pt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded font-semibold">Cancel</button>
        <button type="submit" disabled={saving || Boolean(plateError)} className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-5 py-2 rounded font-semibold">
          {saving ? 'Saving…' : 'Add Vehicle'}
        </button>
      </div>
    </form>
  )
}

function EditVehicleForm({ vehicle, fleetCompanies, fleetUsers, onClose }) {
  const raw = vehicle._raw || {}
  const meta = raw.vehicleMeta || {}
  const [form, setForm] = useState({
    make: vehicle.brand || '',
    model: vehicle.model || '',
    yearModel: vehicle.yearModel || '',
    odometer: vehicle.latestOdo || '',
    company: vehicle.company || '',
    assignedTo: vehicle.assignedTo || '',
    mobileNo: vehicle.mobileNo || '',
    color: vehicle.color || '',
    transmission: vehicle.transmission || '',
    engineNo: vehicle.engineNo || '',
    fleetOfficerId: vehicle.fleetOfficerId || '',
  })
  const [brands, setBrands] = useState([])
  const [models, setModels] = useState([])
  const [filteredModels, setFilteredModels] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Fleet users filtered by this vehicle's company
  const companyFleetUsers = useMemo(() => {
    if (!fleetUsers || !form.company) return fleetUsers || []
    const cf = form.company.toLowerCase().trim()
    return fleetUsers.filter((u) => {
      const uc = (u.company || '').toLowerCase().trim()
      return uc === cf || uc.includes(cf) || cf.includes(uc)
    })
  }, [fleetUsers, form.company])

  const selectedOfficer = useMemo(() => {
    return (fleetUsers || []).find((u) => u.id === form.fleetOfficerId) || null
  }, [fleetUsers, form.fleetOfficerId])

  useEffect(() => {
    getAllBrands().then((b) => {
      setBrands(b)
      getAllModels().then((m) => {
        setModels(m)
        const brand = b.find((br) => br.name === form.make)
        if (brand) setFilteredModels(m.filter((md) => md.caviteMakeId === brand.caviteId))
      })
    })
  }, [])

  const update = (field, value) => {
    if (field === 'make') {
      const brand = brands.find((b) => b.name === value)
      setFilteredModels(brand ? models.filter((m) => m.caviteMakeId === brand.caviteId) : [])
      setForm((f) => ({ ...f, make: value, model: '' }))
      return
    }
    setForm((f) => ({ ...f, [field]: value }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!raw._docId) { setError('Cannot find assessment doc to update'); return }
    setSaving(true); setError(null)
    try {
      const { doc: docRef, updateDoc: updDoc, serverTimestamp: srvTs } = await import('firebase/firestore')
      const { db: fireDb } = await import('../lib/firebase')
      const brand = brands.find((b) => b.name === form.make)
      const model = models.find((m) => m.name === form.model && m.caviteMakeId === brand?.caviteId)
      await updDoc(docRef(fireDb, 'assessments', raw._docId), {
        'header.make': form.make.trim(),
        'header.model': form.model.trim(),
        'header.yearModel': form.yearModel.trim(),
        'header.odometer': Number(form.odometer) || 0,
        'header.client': form.company || null,
        'header.makeId': brand?.caviteId || null,
        'header.modelId': model?.caviteId || null,
        vehicleMeta: {
          assignedTo: form.assignedTo.trim() || null,
          mobileNo: form.mobileNo.trim() || null,
          color: form.color.trim() || null,
          transmission: form.transmission || null,
          engineNo: form.engineNo.trim() || null,
          fleetOfficerId: selectedOfficer?.id || null,
          fleetOfficerName: selectedOfficer?.name || null,
          fleetOfficerEmail: selectedOfficer?.email || null,
        },
        updatedAt: srvTs(),
      })
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2 text-xs">{error}</div>}

      <Row label="Plate No.">
        <input value={vehicle.plateNo} disabled className="input bg-gray-50" />
      </Row>

      <Row label="Make *">
        <select value={form.make} onChange={(e) => update('make', e.target.value)} required className="input">
          <option value="">— select make —</option>
          {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
      </Row>

      <Row label="Model *">
        <select value={form.model} onChange={(e) => update('model', e.target.value)} required className="input" disabled={!form.make}>
          <option value="">— select model —</option>
          {filteredModels.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </Row>

      <Row label="Year Model">
        <input value={form.yearModel} onChange={(e) => update('yearModel', e.target.value)} className="input" />
      </Row>

      <Row label="Latest Odometer (km)">
        <input type="number" value={form.odometer} onChange={(e) => update('odometer', e.target.value)} className="input" />
      </Row>

      <Row label="Fleet Company">
        <select value={form.company} onChange={(e) => update('company', e.target.value)} className="input">
          <option value="">— none (walk-in) —</option>
          {fleetCompanies.map((c) => (
            <option key={c.id} value={c.name}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
          ))}
        </select>
      </Row>

      <Row label="Assigned To">
        <input value={form.assignedTo} onChange={(e) => update('assignedTo', e.target.value)} className="input" />
      </Row>

      <Row label="Mobile No.">
        <input value={form.mobileNo} onChange={(e) => update('mobileNo', e.target.value)} className="input" />
      </Row>

      <Row label="Color">
        <input value={form.color} onChange={(e) => update('color', e.target.value)} className="input" />
      </Row>

      <Row label="Transmission">
        <select value={form.transmission} onChange={(e) => update('transmission', e.target.value)} className="input">
          <option value="">— select —</option>
          <option>Manual</option>
          <option>Automatic</option>
          <option>CVT</option>
        </select>
      </Row>

      <Row label="Engine No.">
        <input value={form.engineNo} onChange={(e) => update('engineNo', e.target.value)} className="input" />
      </Row>

      <Row label="Fleet Officer">
        <select value={form.fleetOfficerId} onChange={(e) => update('fleetOfficerId', e.target.value)} className="input">
          <option value="">— not assigned —</option>
          {companyFleetUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>
      </Row>

      <div className="pt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded font-semibold">Cancel</button>
        <button type="submit" disabled={saving} className="text-sm bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-5 py-2 rounded font-semibold">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

function BulkAssignModal({ vehicles, selected, fleetUsers, fleetCompanies, onClose, onDone }) {
  const selectedVehicles = vehicles.filter((v) => selected.has(v.plateNo))
  // Auto-detect company if all selected vehicles share one
  const companies = [...new Set(selectedVehicles.map((v) => v.company).filter(Boolean))]
  const [companyFilter, setCompanyFilter] = useState(companies.length === 1 ? companies[0] : '')
  const [officerId, setOfficerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const filteredUsers = useMemo(() => {
    if (!companyFilter) return fleetUsers
    const cf = companyFilter.toLowerCase().trim()
    return fleetUsers.filter((u) => {
      const uc = (u.company || '').toLowerCase().trim()
      return uc === cf || uc.includes(cf) || cf.includes(uc)
    })
  }, [fleetUsers, companyFilter])

  const selectedUser = filteredUsers.find((u) => u.id === officerId)

  const submit = async () => {
    if (!officerId || !selectedUser) return
    setSaving(true); setError(null)
    try {
      // Find all assessment docs for selected plates and update vehicleMeta
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
          <div className="text-[10px] font-bold tracking-widest opacity-70">BULK ASSIGN</div>
          <div className="font-black text-lg mt-0.5">Assign Fleet Officer to {selected.size} vehicle{selected.size === 1 ? '' : 's'}</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Fleet Company</label>
            <input value={companyFilter || '—'} disabled className="input bg-gray-50" />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Fleet Officer *</label>
            <select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="input" required>
              <option value="">— select fleet user —</option>
              {filteredUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>

          {selectedUser && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
              <strong>{selectedUser.name}</strong> will be assigned as fleet officer for {selected.size} vehicle{selected.size === 1 ? '' : 's'}.
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

function Row({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function VehicleRowCard({ v }) {
  return (
    <Link
      to={`/vehicles/${v.plateNo}`}
      className="flex items-center gap-3 bg-white rounded-2xl border p-3 hover:shadow-md transition-shadow"
    >
      <div className="w-20 h-16 shrink-0 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden">
        <VehicleImage model={v.model} className="max-h-14 max-w-[4.5rem] object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-black text-base text-gray-900 tracking-wide">{v.plateNo}</div>
            <div className="text-xs text-gray-500 truncate">{v.brandModel || '—'} {v.yearModel || ''}</div>
          </div>
          <RoadworthyBadge status={v.roadworthy} size="sm" />
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-gray-600">
          <span className="font-mono text-gray-500 truncate">{v.company || 'WALK-IN'}</span>
          <span className="flex items-center gap-1 shrink-0">
            <Icon name="calendar" className="w-3 h-3 text-gray-400" />
            {formatDate(v.nextPms) || '-'}
          </span>
        </div>
      </div>
    </Link>
  )
}
