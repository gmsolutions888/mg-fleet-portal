// Vehicle drill-down. Prefers real Firestore data via loadVehicleWithHistory,
// falls back to dummy for preview routes.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { loadVehicleWithHistory } from '../lib/vehicles'
import { getActiveAppointmentsByPlate, APPT_STATUS } from '../lib/appointments'
import { formatDate } from '../lib/dummyData'
import { compressImage } from '../lib/photos'
import VehicleImage from '../components/ui/VehicleImage'
import RoadworthyBadge from '../components/ui/RoadworthyBadge'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'
import PageHero from '../components/ui/PageHero'

// Matches mg-fms-app SC palette for overallStatus → label/color.
const STATUS_CFG = {
  active:      { label: 'Active',      badge: 'bg-green-100 text-green-700 border-green-200' },
  conditional: { label: 'Conditional', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  deferred:    { label: 'Deferred',    badge: 'bg-red-100 text-red-700 border-red-200' },
}
const statusCfg = (s) => STATUS_CFG[String(s || '').toLowerCase()] || { label: s || 'Unknown', badge: 'bg-gray-100 text-gray-600 border-gray-200' }

// Maps roadworthy bucket → PageHero tone so the banner color reflects status.
function roadworthyTone(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'active' || s === 'roadworthy' || s.includes('fit') && !s.includes('unfit') && !s.includes('limited')) return 'success'
  if (s === 'minor' || s.includes('minor') || s.includes('limited')) return 'warn'
  if (s === 'unfit' || s.includes('unfit') || s.includes('unroadworthy')) return 'danger'
  return 'dark'
}

export default function VehicleDetails() {
  const { plateNo } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const clientVisibleOnly = isClientView(profile)
  const isClient = clientVisibleOnly
  const [state, setState] = useState({ loading: true, vehicle: null, history: [], source: null })
  const [activeAppts, setActiveAppts] = useState([])

  useEffect(() => {
    let cancelled = false
    loadVehicleWithHistory(plateNo, { clientVisibleOnly }).then((res) => {
      if (!cancelled) setState({ loading: false, ...res })
    })
    if (!clientVisibleOnly) {
      getActiveAppointmentsByPlate(plateNo).then((rows) => {
        if (!cancelled) setActiveAppts(rows)
      })
    }
    return () => { cancelled = true }
  }, [plateNo, clientVisibleOnly])

  const currentAppt = activeAppts[0] || null

  const vehicle = state.vehicle
  const history = state.history || []

  if (state.loading) return <div className="p-4 sm:p-6 text-gray-500">Loading vehicle…</div>
  if (!vehicle) {
    return (
      <div className="pb-20">
        <PageHero
          eyebrow="VEHICLE"
          title={plateNo}
          subtitle="No assessment on record"
          tone="dark"
        />
        <div className="px-3 sm:px-6 pt-4 space-y-4">
          {currentAppt && !isClient && (
            <CurrentBookingCard appt={currentAppt} navigate={navigate} />
          )}
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-2xl p-4">
            <div className="font-semibold mb-1">No assessment found for plate {plateNo}</div>
            <div className="text-xs">
              {currentAppt
                ? <>This vehicle has an active booking but hasn't been assessed yet. Use the <strong>Assess</strong> button above to start.</>
                : <>This plate doesn't match any assessment yet. Create a booking from <button onClick={() => navigate('/appointments')} className="underline font-semibold">Service Bookings</button>, then mark it arrived and click Assess.</>
              }
            </div>
          </div>
        </div>
      </div>
    )
  }

  const cls = vehicle.classification || {}
  const subtitleParts = [
    vehicle.brandModel,
    vehicle.yearModel,
    vehicle.latestOdo ? `${vehicle.latestOdo.toLocaleString()} km` : null,
  ].filter(Boolean)

  return (
    <div className="pb-20">
      <PageHero
        eyebrow={vehicle.company ? vehicle.company.toUpperCase() : 'VEHICLE'}
        title={vehicle.plateNo}
        subtitle={subtitleParts.join(' · ')}
        tone={roadworthyTone(vehicle.roadworthy)}
        right={<RoadworthyBadge status={vehicle.roadworthy} />}
      />

      {state.source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {currentAppt && !isClient && (
          <CurrentBookingCard appt={currentAppt} navigate={navigate} />
        )}

        <Card title="Vehicle Information" icon={<Icon name="car" className="w-4 h-4" />}>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="w-full sm:w-40 shrink-0 flex items-center justify-center bg-gray-50 rounded-xl h-32 sm:h-auto">
              <VehicleImage model={vehicle.model} className="max-h-32 object-contain" />
            </div>
            <div className="flex-1 text-sm">
              <InfoRow label="Brand/Model" value={vehicle.brandModel || '—'} />
              <InfoRow label="Year Model" value={vehicle.yearModel || '—'} />
              <InfoRow label="Color" value={vehicle.color || '—'} />
              <InfoRow label="Transmission" value={vehicle.transmission || '—'} />
              <InfoRow label="Engine No" value={vehicle.engineNo || '—'} />
              <InfoRow label="Latest Odometer" value={vehicle.latestOdo?.toLocaleString() || '—'} />
              <div className="border-t my-2" />
              <InfoRow label="Assigned To" value={vehicle.assignedTo || '—'} uppercase />
              <InfoRow label="Mobile No." value={vehicle.mobileNo || '—'} />
              <InfoRow label="Company" value={vehicle.company || '—'} />
            </div>
          </div>
        </Card>

        <Card title="Next Service" icon={<Icon name="calendar" className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <InfoBlock label="Next service schedule" value={formatDate(vehicle.nextPms) || '—'} sub="Or on next km trigger" />
            <InfoBlock
              label="Booked schedule"
              value={formatDate(vehicle.bookedSchedule) === '-' ? 'No schedule set' : formatDate(vehicle.bookedSchedule)}
              sub={vehicle.bookedBranch || null}
            />
            <InfoBlock
              label="Latest assessment"
              value={(cls.overallStatus || vehicle.roadworthy || 'unknown').toString().toUpperCase()}
              sub={cls.failCriticalCount != null ? `${cls.failCriticalCount} critical · ${cls.monitorCount || 0} monitor` : null}
            />
            <InfoBlock label="Service center" value={vehicle.branch || 'Information not available'} />
          </div>
        </Card>

        <Card title={`Assessment History (${history.length})`} icon={<Icon name="doc" className="w-4 h-4" />}>
          {history.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">
              No assessments on record for this plate.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((a) => {
                const cfg = statusCfg(a.overallStatus)
                const key = a.rwa || a.date
                const clickable = Boolean(a.rwa)
                return (
                  <button
                    key={key}
                    onClick={() => clickable && navigate(`/assessments/${encodeURIComponent(a.rwa)}`)}
                    disabled={!clickable}
                    className={`w-full text-left rounded-xl p-3 border transition-all ${
                      clickable ? 'hover:shadow-sm cursor-pointer' : 'cursor-default opacity-70'
                    } ${a.isLatest ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between mb-0.5 gap-2">
                      <span className="font-black text-gray-900 text-sm font-mono truncate">{a.rwa || '—'}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {a.isLatest && (
                          <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">Latest</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        {clickable && <span className="text-gray-400 text-sm">›</span>}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 break-words">
                      {formatDate(a.date)} · {a.type} · {a.technician}
                      {a.odometer ? ` · ${a.odometer.toLocaleString()} km` : ''}
                      {a.branch ? ` · ${a.branch}` : ''}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
                      {a.failCriticalCount > 0 && (
                        <span className="text-red-600 font-semibold">🚨 {a.failCriticalCount} critical</span>
                      )}
                      {a.monitorCount > 0 && (
                        <span className="text-amber-600 font-semibold">⚠️ {a.monitorCount} monitor</span>
                      )}
                      {!a.dispatchAllowed ? (
                        <span className="text-red-600 font-semibold">⛔ Hold</span>
                      ) : (
                        <span className="text-green-700 font-semibold">✓ Cleared</span>
                      )}
                      {a.supervisorCleared && (
                        <span className="text-blue-600 font-semibold">👤 Supervisor Cleared</span>
                      )}
                      {a.hasPms && (
                        <span className="text-green-700 font-semibold">🔧 PMS</span>
                      )}
                      {a.resolvedByRwa && (
                        <span className="text-gray-500">resolved by {a.resolvedByRwa}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        {/* ── Service Logs Outside MG ──────────────────────────────────────── */}
        <ServiceLogs plateNo={vehicle.plateNo} profile={profile} />
      </div>
    </div>
  )
}

function ServiceLogs({ plateNo, profile }) {
  const isFleetMgr = String(profile?.role || '').toLowerCase() === 'general_manager'
  const [logs, setLogs] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [viewLog, setViewLog] = useState(null)

  const handleDelete = async (logId) => {
    setDeleting(logId)
    try {
      const { deleteDoc, doc: docRef } = await import('firebase/firestore')
      await deleteDoc(docRef(db, 'serviceLogs', logId))
    } catch (err) {
      console.error('[serviceLogs] delete failed:', err)
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }
  const emptyItem = () => ({ type: 'Parts/Materials', qty: 1, description: '', unitCost: 0 })
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), notes: '', photos: [], items: [{ type: 'Labor', qty: 1, description: '', unitCost: 0 }, emptyItem()] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    if (!db || !plateNo) return
    const q = query(
      collection(db, 'serviceLogs'),
      where('plateNo', '==', plateNo.toUpperCase().replace(/\s+/g, '')),
    )
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => {
        const ta = a.date || a.createdAt?.toMillis?.() || 0
        const tb = b.date || b.createdAt?.toMillis?.() || 0
        return tb > ta ? 1 : ta > tb ? -1 : 0
      })
      setLogs(rows)
    })
    return unsub
  }, [plateNo])

  const handlePhoto = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const compressed = await compressImage(f)
      setForm((prev) => ({ ...prev, photos: [...prev.photos, compressed] }))
    } catch (err) {
      console.error('[serviceLogs] photo compress failed:', err)
    }
  }

  const removePhoto = (idx) => {
    setForm((prev) => ({ ...prev, photos: prev.photos.filter((_, i) => i !== idx) }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(null)
    try {
      const items = form.items.filter((i) => i.description.trim()).map((i) => ({
        type: i.type,
        qty: Number(i.qty) || 1,
        description: i.description.trim(),
        unitCost: Number(i.unitCost) || 0,
        subTotal: (Number(i.qty) || 1) * (Number(i.unitCost) || 0),
      }))
      const total = items.reduce((s, i) => s + i.subTotal, 0)
      await addDoc(collection(db, 'serviceLogs'), {
        plateNo: plateNo.toUpperCase().replace(/\s+/g, ''),
        date: form.date,
        items,
        total,
        notes: form.notes.trim(),
        photos: form.photos,
        createdAt: serverTimestamp(),
        createdBy: auth?.currentUser?.uid || null,
        createdByName: profile?.name || profile?.email || null,
      })
      setForm({ date: new Date().toISOString().slice(0, 10), notes: '', photos: [], items: [{ type: 'Labor', qty: 1, description: '', unitCost: 0 }, emptyItem()] })
      setShowForm(false)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={`Service Logs Outside MG (${logs.length})`} icon={<Icon name="tool" className="w-4 h-4" />}>
      {isFleetMgr && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-3 text-xs bg-brand hover:bg-brand-dark text-white px-3 py-2 rounded-lg font-bold flex items-center gap-1.5"
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add Service Log
        </button>
      )}

      {showForm && (
        <form onSubmit={submit} className="mb-4 bg-gray-50 border rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">New Service Log</div>
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Date of Service *</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className="input max-w-xs" />
          </div>

          {/* Line items */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Line Items</label>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border rounded-lg overflow-hidden">
                <thead className="bg-gray-100 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-28">Type</th>
                    <th className="px-2 py-1.5 text-center w-14">Qty</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-right w-24">Unit Cost</th>
                    <th className="px-2 py-1.5 text-right w-24">Subtotal</th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y">
                  {form.items.map((item, idx) => {
                    const sub = (Number(item.qty) || 0) * (Number(item.unitCost) || 0)
                    return (
                      <tr key={idx}>
                        <td className="px-2 py-1">
                          <select value={item.type} onChange={(e) => { const items = [...form.items]; items[idx] = { ...items[idx], type: e.target.value }; setForm({ ...form, items }) }} className="input text-xs py-1 px-1">
                            <option>Labor</option>
                            <option>Parts/Materials</option>
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min="1" value={item.qty} onChange={(e) => { const items = [...form.items]; items[idx] = { ...items[idx], qty: e.target.value }; setForm({ ...form, items }) }} className="input text-xs py-1 px-1 w-14 text-center" />
                        </td>
                        <td className="px-2 py-1">
                          <input value={item.description} onChange={(e) => { const items = [...form.items]; items[idx] = { ...items[idx], description: e.target.value }; setForm({ ...form, items }) }} className="input text-xs py-1 px-1 w-full" placeholder="e.g. Engine Oil Change" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min="0" value={item.unitCost} onChange={(e) => { const items = [...form.items]; items[idx] = { ...items[idx], unitCost: e.target.value }; setForm({ ...form, items }) }} className="input text-xs py-1 px-1 w-24 text-right" />
                        </td>
                        <td className="px-2 py-1 text-right font-semibold">{sub.toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                        <td className="px-2 py-1 text-center">
                          {form.items.length > 1 && (
                            <button type="button" onClick={() => { const items = form.items.filter((_, i) => i !== idx); setForm({ ...form, items }) }} className="text-red-400 hover:text-red-600 text-sm font-bold">✕</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500">Total</td>
                    <td className="px-2 py-2 text-right font-black text-sm">{form.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitCost) || 0), 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-2 text-center">
                      <button type="button" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="w-5 h-5 rounded-full bg-brand hover:bg-brand-dark text-white text-xs font-bold flex items-center justify-center shadow">+</button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Service Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="input w-full"
              placeholder="Additional notes..."
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Attach Images</label>
            <div className="flex gap-2 flex-wrap">
              {form.photos.map((src, i) => (
                <div key={i} className="relative w-16 h-16">
                  <img src={src} className="w-16 h-16 rounded-lg object-cover border border-gray-200" alt="" />
                  <button type="button" onClick={() => removePhoto(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full text-xs font-bold flex items-center justify-center shadow">✕</button>
                </div>
              ))}
              {form.photos.length < 5 && (
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-brand hover:text-brand cursor-pointer transition-colors">
                  <Icon name="plus" className="w-5 h-5" />
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </label>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs font-bold text-white bg-brand hover:bg-brand-dark disabled:opacity-40 px-4 py-2 rounded-lg shadow">{saving ? 'Saving…' : 'Save Log'}</button>
          </div>
        </form>
      )}

      {logs.length === 0 && !showForm && (
        <div className="py-6 text-center text-gray-400 text-sm">No service logs outside MG yet.</div>
      )}

      {logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                <th className="px-3 py-2 text-left font-medium">Photos</th>
                <th className="px-3 py-2 text-left font-medium">Added By</th>
                {isFleetMgr && <th className="px-3 py-2 w-8"></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <button onClick={() => setViewLog(log)} className="text-brand hover:underline font-semibold">{log.date || '—'}</button>
                  </td>
                  <td className="px-3 py-2">
                    {log.items?.length > 0 ? (
                      <div className="space-y-0.5">
                        {log.items.map((item, i) => (
                          <div key={i} className="text-xs flex items-baseline gap-1.5">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.type === 'Labor' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{item.type === 'Labor' ? 'L' : 'P'}</span>
                            <span className="text-gray-700">{item.qty > 1 ? `${item.qty}× ` : ''}{item.description}</span>
                            <span className="text-gray-400 ml-auto whitespace-nowrap">{(item.subTotal || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                    ) : log.type ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${log.type === 'Parts Replacement' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{log.type}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-right font-semibold whitespace-nowrap">{log.total != null ? log.total.toLocaleString('en', { minimumFractionDigits: 2 }) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 max-w-[200px] whitespace-normal">{log.notes || '—'}</td>
                  <td className="px-3 py-2">
                    {log.photos?.length > 0 ? (
                      <div className="flex gap-1">
                        {log.photos.map((src, i) => (
                          <img key={i} src={src} className="w-10 h-10 rounded object-cover border border-gray-200 cursor-pointer hover:opacity-80" alt="" onClick={() => setLightbox(src)} />
                        ))}
                      </div>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-gray-400 whitespace-nowrap">{log.createdByName || '—'}</td>
                  {isFleetMgr && (
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setConfirmDelete(log)}
                        disabled={deleting === log.id}
                        className="text-red-400 hover:text-red-600 text-[10px] font-bold disabled:opacity-40"
                      >
                        {deleting === log.id ? '...' : '✕'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View service log detail modal */}
      {viewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setViewLog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-brand text-white px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold tracking-widest opacity-70">SERVICE LOG</div>
                <div className="font-black text-lg mt-0.5">{viewLog.date || '—'}</div>
              </div>
              <button onClick={() => setViewLog(null)} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-lg font-bold">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Line items */}
              {viewLog.items?.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Items</div>
                  <table className="min-w-full text-xs border rounded-lg overflow-hidden">
                    <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Type</th>
                        <th className="px-2 py-1.5 text-center">Qty</th>
                        <th className="px-2 py-1.5 text-left">Description</th>
                        <th className="px-2 py-1.5 text-right">Unit Cost</th>
                        <th className="px-2 py-1.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {viewLog.items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.type === 'Labor' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{item.type}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center">{item.qty}</td>
                          <td className="px-2 py-1.5">{item.description}</td>
                          <td className="px-2 py-1.5 text-right">{(Number(item.unitCost) || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{(Number(item.subTotal) || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={4} className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500">Total</td>
                        <td className="px-2 py-2 text-right font-black">{(Number(viewLog.total) || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : viewLog.type && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Type</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${viewLog.type === 'Parts Replacement' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{viewLog.type}</span>
                  {viewLog.replacedParts && <div className="text-xs text-blue-700 font-semibold mt-1">🔩 {viewLog.replacedParts}</div>}
                </div>
              )}

              {/* Notes */}
              {viewLog.notes && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Notes</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{viewLog.notes}</div>
                </div>
              )}

              {/* Photos */}
              {viewLog.photos?.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Photos ({viewLog.photos.length})</div>
                  <div className="flex gap-2 flex-wrap">
                    {viewLog.photos.map((src, i) => (
                      <img key={i} src={src} className="w-24 h-24 rounded-lg object-cover border border-gray-200 cursor-pointer hover:shadow-md" alt="" onClick={() => { setViewLog(null); setTimeout(() => setLightbox(src), 100) }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className="text-[10px] text-gray-400 pt-2 border-t">
                Added by {viewLog.createdByName || '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4">
              <div className="text-sm font-bold text-red-700 mb-2">Delete Service Log</div>
              <div className="text-sm text-gray-600">Delete this service log from {confirmDelete.date || '—'}?</div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} className="flex-1 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-3 rounded-xl">Cancel</button>
              <button type="button" onClick={() => handleDelete(confirmDelete.id)} disabled={deleting === confirmDelete.id} className="flex-1 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 px-4 py-3 rounded-xl shadow">
                {deleting === confirmDelete.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 text-white rounded-full text-2xl font-bold flex items-center justify-center z-50">✕</button>
          <img src={lightbox} className="max-w-full max-h-full object-contain rounded-lg" alt="Full view" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </Card>
  )
}

// Compact card for an in-flight booking — rebuilt in brand red to match the
// rest of round 2. Action buttons stack on mobile so they're all tappable.
const WARRIOR_ROLES = new Set(['field_assessor', 'warrior', 'dispatcher', 'technician'])

function CurrentBookingCard({ appt, navigate }) {
  const { profile } = useAuth()
  const role = String(profile?.role || '').toLowerCase()
  const isWarrior = WARRIOR_ROLES.has(role)
  const canAssess = appt.status === APPT_STATUS.ARRIVED || appt.status === APPT_STATUS.ONGOING
  const canRecordPms = [APPT_STATUS.ARRIVED, APPT_STATUS.ONGOING, APPT_STATUS.DIAGNOSED].includes(appt.status)
  return (
    <div className="bg-white border-2 border-brand/20 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-brand text-white px-4 py-2.5 text-sm font-bold flex items-center gap-2">
        <Icon name="calendar" className="w-4 h-4" />
        Current Booking
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={appt.status} size="sm" />
          <span className="text-sm text-gray-700">
            {formatDate(appt.scheduledAt)}{appt.scheduledTime ? ` · ${appt.scheduledTime}` : ''}
          </span>
          {appt.branch && <span className="text-gray-500 text-xs">· {appt.branch}</span>}
        </div>
        <div className="text-xs text-gray-500">
          {appt.customer || '—'}{appt.company ? ` · ${appt.company}` : ''}
          {appt.mechanic && appt.mechanic !== 'Not yet assigned' ? ` · ${appt.mechanic}` : ''}
        </div>
        {appt.note && <div className="text-xs text-gray-600 italic">"{appt.note}"</div>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {!isWarrior && (
            <button
              onClick={() => navigate('/appointments')}
              className="col-span-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg font-semibold"
            >
              Open Booking
            </button>
          )}
          {canAssess && (
            <button
              onClick={() => navigate(`/appointments/${appt.id}/assess`)}
              className="text-xs bg-brand hover:bg-brand-dark text-white px-3 py-2.5 rounded-lg font-semibold"
            >
              Assess →
            </button>
          )}
          {canRecordPms && (
            <button
              onClick={() => navigate(`/appointments/${appt.id}/pms`)}
              className="text-xs bg-green-700 hover:bg-green-800 text-white px-3 py-2.5 rounded-lg font-semibold"
            >
              Record PMS →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Card({ title, icon, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider border-b flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function InfoRow({ label, value, uppercase, mono, strong }) {
  return (
    <div className="flex justify-between gap-2 py-1">
      <span className="text-xs text-gray-500 shrink-0">{label}:</span>
      <span className={`${uppercase ? 'uppercase ' : ''}${mono ? 'font-mono text-xs ' : ''}${strong ? 'font-bold text-green-700 ' : ''}text-gray-900 text-right`}>
        {value}
      </span>
    </div>
  )
}

function InfoBlock({ label, value, sub }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
