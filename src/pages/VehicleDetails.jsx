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
              <InfoRow label="Company" value={vehicle.company || '—'} />
              <InfoRow label="Branch" value={vehicle.branch || '—'} />
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
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), type: 'Preventive Maintenance', notes: '', replacedParts: '', photos: [] })
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
      await addDoc(collection(db, 'serviceLogs'), {
        plateNo: plateNo.toUpperCase().replace(/\s+/g, ''),
        date: form.date,
        type: form.type,
        replacedParts: form.type === 'Parts Replacement' ? form.replacedParts.trim() : null,
        notes: form.notes.trim(),
        photos: form.photos,
        createdAt: serverTimestamp(),
        createdBy: auth?.currentUser?.uid || null,
        createdByName: profile?.name || profile?.email || null,
      })
      setForm({ date: new Date().toISOString().slice(0, 10), type: 'Preventive Maintenance', notes: '', replacedParts: '', photos: [] })
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Date of Service *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className="input" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Type *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
                <option>Preventive Maintenance</option>
                <option>Parts Replacement</option>
              </select>
            </div>
          </div>

          {form.type === 'Parts Replacement' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Replaced Parts *</label>
              <input
                value={form.replacedParts}
                onChange={(e) => setForm({ ...form, replacedParts: e.target.value })}
                className="input w-full"
                placeholder="e.g. Brake pads, Oil filter, Spark plugs"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Service Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="input w-full"
              placeholder="Describe the service performed..."
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
          <table className="min-w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Replaced Parts</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                <th className="px-3 py-2 text-left font-medium">Photos</th>
                <th className="px-3 py-2 text-left font-medium">Added By</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs">{log.date || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${log.type === 'Parts Replacement' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {log.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-blue-700 font-semibold">{log.replacedParts || '—'}</td>
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
                  <td className="px-3 py-2 text-[10px] text-gray-400">{log.createdByName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
function CurrentBookingCard({ appt, navigate }) {
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
          <button
            onClick={() => navigate('/appointments')}
            className="col-span-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg font-semibold"
          >
            Open Booking
          </button>
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
