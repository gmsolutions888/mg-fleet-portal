// PMS record form — /appointments/:id/pms. Ported from mg-fms PMSScreen
// (mg-fms-app/src/App.jsx:264). Writes to the same `pms_records/{plate}`
// Firestore doc mg-fms writes to, using the canonical plate (spaces
// preserved) via resolveCanonicalPlate so the two apps share one doc.
//
// Scope (first port):
//   - item checkboxes grouped by category (scheduled / brake / major /
//     troubleshooting)
//   - per-item brand + qty
//   - live "next due" computed from odometer + date + intervals
//   - existing record shown inline ("last done" / "next due" hints)
//
// Deliberately OUT OF SCOPE (follow-on rounds):
//   - photo capture + compression + base64 storage
//   - ECU scan codes
//   - labor-type tracking
//   - auto-link from inspection replaced items (INSP_TO_PMS)
//   - sessionStorage draft persistence
//   - pmsUrgency overdue/due-soon coloring

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchContextDoc } from '../lib/notifications'
import { INSP_TO_PMS, PMS_ITEMS } from '../lib/mgfms-catalog'
import { getAssessmentById } from '../lib/assessments'
import {
  buildPmsUpdates, calcNextDue, loadPmsRecord, resolveCanonicalPlate,
  savePmsRecord,
} from '../lib/pms'
import PhotoCapture from '../components/PhotoCapture'

const CATEGORY_TITLES = {
  scheduled: 'Scheduled Maintenance',
  brake: 'Braking',
  major: 'Major Service',
  troubleshooting: 'Troubleshooting',
}
const CATEGORY_ORDER = ['scheduled', 'brake', 'major', 'troubleshooting']

const ITEMS_BY_CAT = CATEGORY_ORDER.map((cat) => ({
  cat,
  title: CATEGORY_TITLES[cat],
  items: PMS_ITEMS.filter((p) => p.category === cat),
}))

export default function PmsRecord() {
  const { id: appointmentId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [appointment, setAppointment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [canonicalPlate, setCanonicalPlate] = useState('')
  const [existing, setExisting] = useState({})
  const [activeCat, setActiveCat] = useState('scheduled')

  const [plate, setPlate] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [odometer, setOdometer] = useState('')
  const [technician, setTechnician] = useState('')
  const [checked, setChecked] = useState({})
  const [details, setDetails] = useState({})
  const [autoLinked, setAutoLinked] = useState({}) // { [pmsCode]: inspCode } — prefill provenance

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const autoLinkedRef = useRef(false)

  // Load appointment → resolve canonical plate → load existing pms_records.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const appt = await fetchContextDoc('appointments', appointmentId)
      if (cancelled) return
      setAppointment(appt)
      const rawPlate = appt?.plateNo || ''
      setPlate(rawPlate)
      setTechnician(
        appt?.mechanic && appt.mechanic !== 'Not yet assigned'
          ? appt.mechanic
          : (profile?.user_fullname || profile?.displayName || ''),
      )
      if (!rawPlate) { setLoading(false); return }
      const canonical = await resolveCanonicalPlate(rawPlate)
      if (cancelled) return
      setCanonicalPlate(canonical)
      const rec = await loadPmsRecord(canonical)
      if (cancelled) return
      setExisting(rec || {})
      // Prefill odometer from the most recent lastOdo in the record.
      const lastOdo = Object.values(rec || {})
        .map((r) => r?.lastOdo)
        .filter((n) => typeof n === 'number')
        .reduce((max, n) => (n > max ? n : max), 0)
      if (lastOdo > 0) setOdometer(String(lastOdo))
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId])

  // When plate is edited manually, re-resolve canonical.
  useEffect(() => {
    if (loading) return
    let cancelled = false
    resolveCanonicalPlate(plate).then((c) => { if (!cancelled) setCanonicalPlate(c) })
    return () => { cancelled = true }
  }, [plate, loading])

  // Auto-link (mg-fms INSP_TO_PMS flow). Fires once after appointment loads:
  // if the appointment is tied to an assessment whose inspection items are
  // marked `replaced`, check the matching PMS items and prefill brand/qty
  // with the inspection's partReplaced/partQty. Skips any PMS codes the user
  // has already touched so we don't clobber manual edits on navigation.
  useEffect(() => {
    if (loading || autoLinkedRef.current) return
    if (!appointment?.assessmentId) return
    autoLinkedRef.current = true
    let cancelled = false
    getAssessmentById(appointment.assessmentId).then((asmt) => {
      if (cancelled || !asmt?.itemResults) return
      const nextChecked = {}
      const nextDetails = {}
      const prov = {}
      for (const [inspCode, pmsCode] of Object.entries(INSP_TO_PMS)) {
        const r = asmt.itemResults[inspCode]
        if (r?.resultCode !== 'replaced') continue
        nextChecked[pmsCode] = true
        nextDetails[pmsCode] = {
          brand: r.partReplaced || '',
          qty: r.partQty || 1,
          photos: r.photos || [],
        }
        prov[pmsCode] = inspCode
      }
      if (Object.keys(nextChecked).length === 0) return
      setChecked((prev) => ({ ...nextChecked, ...prev })) // prev wins — don't clobber user
      setDetails((prev) => ({ ...nextDetails, ...prev }))
      setAutoLinked(prov)
    })
    return () => { cancelled = true }
  }, [loading, appointment])

  const toggle = (code) => {
    setChecked((prev) => {
      const now = !prev[code]
      if (now) {
        setDetails((d) => ({ ...d, [code]: d[code] || { brand: '', qty: 1 } }))
      }
      return { ...prev, [code]: now }
    })
  }

  const setDetail = (code, patch) => {
    setDetails((d) => ({
      ...d,
      [code]: { ...(d[code] || { brand: '', qty: 1, photos: [] }), ...patch },
    }))
  }

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  )

  const canSubmit = !saving && !loading && selectedCount > 0 && plate && odometer

  const onSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      const updates = buildPmsUpdates({
        items: PMS_ITEMS,
        checked,
        details,
        ctx: {
          date,
          odometer,
          performedBy: technician,
          rwaNumber: appointment?.rwaNumber || null,
          branch: appointment?.branch || profile?.branch || null,
        },
      })
      await savePmsRecord(canonicalPlate || plate, updates)
      navigate(-1)
    } catch (err) {
      console.error('[pms] savePmsRecord failed', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  if (loading) return <div className="p-4 sm:p-6 text-sm text-gray-500">Loading appointment…</div>

  const totalItems = ITEMS_BY_CAT.reduce((n, g) => n + g.items.length, 0)
  const progressPct = totalItems ? Math.round((selectedCount / totalItems) * 100) : 0

  return (
    <div className="pb-28">
      {/* Hero — gradient + summary */}
      <div className="bg-gradient-to-b from-green-700 to-green-600 text-white px-4 pt-5 pb-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-[10px] tracking-widest font-bold text-white/60">
            PMS RECORD · {plate || '—'}
          </div>
          {appointment ? (
            <div className="text-[10px] text-white/70">
              Appt <span className="font-mono">{appointmentId.slice(0, 6)}</span>
              {appointment.rwaNumber && <> · <span className="font-mono">{appointment.rwaNumber}</span></>}
            </div>
          ) : (
            <div className="text-[10px] text-amber-200">Standalone mode</div>
          )}
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black uppercase tracking-wide text-white/80">Preventive Maintenance</div>
            <div className="text-2xl font-black mt-0.5">{selectedCount} item{selectedCount === 1 ? '' : 's'} selected</div>
            <div className="text-xs text-white/70 mt-1">
              {odometer ? `${Number(odometer).toLocaleString()} km` : 'odometer not set'} · {date}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] font-bold tracking-widest text-white/60">SELECTED</div>
            <div className="text-3xl font-black bg-white rounded-xl px-3 py-1 text-green-700">{selectedCount}</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-white/70 mb-1">
            <span>PROGRESS</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="m-3 sm:m-4 bg-white border rounded-2xl p-3 sm:p-4">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">PMS Context</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="Plate">
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="input w-full uppercase" />
            {canonicalPlate && canonicalPlate !== plate && (
              <div className="text-[10px] text-blue-600 mt-1">Canonical: <span className="font-mono">{canonicalPlate}</span></div>
            )}
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-full" />
          </Field>
          <Field label="Odometer (km)*">
            <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} className="input w-full" required />
          </Field>
          <Field label="Technician">
            <input value={technician} onChange={(e) => setTechnician(e.target.value)} className="input w-full" />
          </Field>
        </div>
      </div>

      {/* ── Category tabs ────────────────────────────────────────── */}
      <div className="mx-3 sm:mx-4 flex gap-1 mb-2 overflow-x-auto">
        {ITEMS_BY_CAT.map((g) => {
          const sel = g.items.filter((i) => checked[i.code]).length
          const active = activeCat === g.cat
          return (
            <button
              key={g.cat}
              onClick={() => setActiveCat(g.cat)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md whitespace-nowrap ${active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {g.title}
              {sel > 0 && <span className={`ml-1.5 text-[10px] px-1.5 rounded-full ${active ? 'bg-white text-gray-900' : 'bg-green-600 text-white'}`}>{sel}</span>}
            </button>
          )
        })}
      </div>

      {/* ── Items ────────────────────────────────────────────────── */}
      <div className="mx-3 sm:mx-4 bg-white border rounded-2xl divide-y overflow-hidden">
        {(ITEMS_BY_CAT.find((g) => g.cat === activeCat)?.items || []).map((item) => (
          <PmsRow
            key={item.code}
            item={item}
            checked={!!checked[item.code]}
            detail={details[item.code] || { brand: '', qty: 1, photos: [] }}
            existing={existing[item.code]}
            autoLinkedFrom={autoLinked[item.code] || null}
            odometer={odometer}
            date={date}
            onToggle={() => toggle(item.code)}
            onBrand={(v) => setDetail(item.code, { brand: v })}
            onQty={(n) => setDetail(item.code, { qty: Math.max(1, n) })}
            onPhotos={(next) => setDetail(item.code, { photos: next })}
          />
        ))}
      </div>

      {/* ── Sticky submit bar ───────────────────────────────────── */}
      <div
        className="fixed bottom-[3.5rem] md:bottom-0 left-0 right-0 z-40 bg-white border-t px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        {error && <div className="text-[11px] text-red-700 flex-1 truncate">Save failed: {error}</div>}
        <div className={`text-[11px] sm:text-xs flex-1 min-w-0 ${error ? 'hidden' : ''}`}>
          {selectedCount === 0 ? (
            <span className="text-gray-500">Tick at least one PMS item.</span>
          ) : (
            <span className="text-gray-700">
              <span className="font-bold">{selectedCount}</span> selected
              {canonicalPlate ? <> · merge into <span className="font-mono font-bold">{canonicalPlate}</span></> : null}
            </span>
          )}
        </div>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow active:scale-95 transition-transform shrink-0"
        >
          {saving ? 'Saving…' : 'Save PMS'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  )
}

function PmsRow({ item, checked, detail, existing, autoLinkedFrom, odometer, date, onToggle, onBrand, onQty, onPhotos }) {
  const { nextOdo, nextDate } = calcNextDue(odometer, date, item.kmInterval, item.monthInterval)
  return (
    <div className={`px-4 py-3 ${checked ? 'bg-green-50' : ''}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-start gap-3 text-left">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 ${checked ? 'bg-green-600 border-green-600' : 'border-gray-300'}`}>
          {checked && <span className="text-white text-[11px] font-black">✓</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm">{item.icon}</span>
            <span className="font-semibold text-sm text-gray-800">{item.label}</span>
            {autoLinkedFrom && checked && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"
                title={`Auto-linked from inspection item ${autoLinkedFrom}`}
              >
                from assessment
              </span>
            )}
          </div>
          {existing && !checked && (
            <div className="text-[11px] text-gray-500 mt-0.5">
              Last: <span className="font-mono">{existing.lastDate}</span>
              {existing.nextDate && <> · Next: <span className="font-mono">{existing.nextDate}</span></>}
              {existing.nextOdo && <> / {Number(existing.nextOdo).toLocaleString()} km</>}
            </div>
          )}
          {checked && (
            <div className="text-[11px] text-green-700 font-semibold mt-0.5">
              Next due:{' '}
              {nextOdo ? `${nextOdo.toLocaleString()} km` : '—'}
              {nextDate ? ` · ${nextDate}` : ''}
            </div>
          )}
        </div>
        <div className="text-right shrink-0 text-[11px] text-gray-400">
          {item.kmInterval ? <div>{item.kmInterval.toLocaleString()} km</div> : <div className="text-blue-400 font-bold">On-demand</div>}
          {item.monthInterval ? <div>{item.monthInterval} mo</div> : null}
        </div>
      </button>
      {checked && (
        <div className="mt-2 ml-8 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2">
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Part / Brand</span>
              <input
                value={detail.brand}
                onChange={(e) => onBrand(e.target.value)}
                className="input w-full"
                placeholder="e.g. Metax 5W-40, Bosch filter"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Qty</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => onQty((detail.qty || 1) - 1)} className="w-7 h-7 bg-white border rounded font-bold">−</button>
                <span className="w-8 text-center font-bold">{detail.qty || 1}</span>
                <button type="button" onClick={() => onQty((detail.qty || 1) + 1)} className="w-7 h-7 bg-white border rounded font-bold">+</button>
              </div>
            </label>
          </div>
          <PhotoCapture
            label="Service Photos"
            photos={detail.photos || []}
            onChange={onPhotos}
          />
        </div>
      )}
    </div>
  )
}
