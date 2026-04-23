// Assessment / inspection form for /appointments/:id/assess. Ported from
// mg-fms-app/src/App.jsx (InspectScreen + submit flow), rebuilt to live inside
// the portal's layout and to write to the SAME `assessments` collection
// mg-fms uses. On submit: writes the assessment doc, flips the parent
// appointment to DIAGNOSED (status kept as-is for back-compat with mg-fms
// status taxonomy), navigates to /assessments/{rwaNumber}.
//
// Deliberately OUT OF SCOPE for this first port (follow-on work):
//   - PMS sub-flow (31 items, next-due calc, parts/brand details)
//   - Supervisor override

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchContextDoc } from '../lib/notifications'
import { watchVehicles } from '../lib/vehicles'
import {
  ACTION_CFG, ALL_ITEMS, ASSESS_TYPES, CATEGORIES, DEFECT_CODES, PRE_DISPATCH_ITEMS,
  RC, SC, calcHealthScore, getAction, getActiveItems, healthColor,
} from '../lib/mgfms-catalog'
import {
  createAssessment, runEngine,
  getLatestAssessmentForPlate,
} from '../lib/assessments'
import PhotoCapture from '../components/PhotoCapture'

const RESULT_OPTIONS = ['pass', 'monitor', 'fail_critical', 'replaced', 'na']

// Draft storage. Keyed by appointment id (collision-proof — mg-fms used
// `plate|date` which broke if the same plate was inspected twice in one day).
const DRAFT_VERSION = 1
const draftKey = (appointmentId) => `mgfp.assessment.v${DRAFT_VERSION}.${appointmentId || 'standalone'}`

function loadDraft(appointmentId) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(draftKey(appointmentId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function saveDraft(appointmentId, payload) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(draftKey(appointmentId), JSON.stringify({ ...payload, savedAt: Date.now() }))
  } catch (err) {
    // Quota exceeded most likely — drafts are best-effort.
    console.warn('[assessment] draft save failed:', err?.message || err)
  }
}

function clearDraft(appointmentId) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(draftKey(appointmentId)) } catch {}
}

export default function AssessmentForm() {
  const { id: appointmentId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  // Hydrate from any saved draft synchronously so the user sees their work
  // immediately on remount instead of a flash of empty inputs.
  const initialDraft = useMemo(() => loadDraft(appointmentId), [appointmentId])

  const [appointment, setAppointment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [vehicles, setVehicles] = useState([])

  const [header, setHeader] = useState(() => initialDraft?.header || {
    plate: '', make: '', model: '', yearModel: '',
    client: '', branch: '', technician: '', odometer: '',
    type: 'Initial', date: new Date().toISOString().slice(0, 10),
  })
  const [itemResults, setItemResults] = useState(() => initialDraft?.itemResults || {})
  const [openCat, setOpenCat] = useState(CATEGORIES[0]?.code || null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draftSavedAt, setDraftSavedAt] = useState(initialDraft?.savedAt || null)
  const [draftRestored] = useState(Boolean(initialDraft))

  // Re-Assessment state. When the user picks "Re-Assessment" as the type:
  //   1. Fetch the most recent assessment for this plate (`prevAssessment`).
  //   2. Show a mode chooser (Full Re-Assessment / Quick Fix).
  //   3. Pre-fill non-flagged items from prevAssessment so only fail_critical
  //      / monitor items need re-answering.
  // Matches mg-fms-app/src/App.jsx (startReassess + screen="reassess-mode").
  const [prevAssessment, setPrevAssessment] = useState(initialDraft?.prevAssessment || null)
  const [prevLoading, setPrevLoading] = useState(false)
  const [reassessMode, setReassessMode] = useState(initialDraft?.reassessMode || null)
  const prefilledKeyRef = useRef('')

  // Load the parent appointment + vehicle registry in parallel. Only fires
  // once per appointmentId — `profile` is captured at first load so later
  // profile updates don't clobber the user's edits. Prefill is non-destructive:
  // only EMPTY fields get filled, so a restored draft (or any manual edit)
  // always wins.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchContextDoc('appointments', appointmentId).then((appt) => {
      if (cancelled) return
      setAppointment(appt)
      setHeader((h) => ({
        ...h,
        plate: h.plate || appt?.plateNo || '',
        branch: h.branch || appt?.branch || profile?.branch || '',
        client: h.client || appt?.company || '',
        technician: h.technician || (
          appt?.mechanic && appt.mechanic !== 'Not yet assigned'
            ? appt.mechanic
            : (profile?.user_fullname || profile?.displayName || '')
        ),
      }))
      setLoading(false)
    })
    const unsub = watchVehicles({}, ({ vehicles: rows }) => {
      if (!cancelled) setVehicles(rows || [])
    })
    return () => { cancelled = true; unsub?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId])

  // If the plate matches a registered vehicle, prefill make/model/year/odometer
  // on first match. Runs only when the vehicle list arrives AFTER the header
  // settles, and only fills empty fields so manual edits aren't clobbered.
  useEffect(() => {
    if (!header.plate || vehicles.length === 0) return
    const v = vehicles.find((x) => x.plateNo === header.plate)
    if (!v) return
    setHeader((h) => ({
      ...h,
      make: h.make || v.brand || '',
      model: h.model || v.model || '',
      yearModel: h.yearModel || v.yearModel || '',
      client: h.client || v.company || '',
      odometer: h.odometer || (v.latestOdo ? String(v.latestOdo) : ''),
    }))
  }, [header.plate, vehicles])

  // Persist the in-progress form to localStorage on every change so a refresh,
  // tab close, or accidental nav doesn't lose work. Debounced via a 600ms
  // trailing timer — typing into a text field doesn't write 30 times.
  const saveTimerRef = useRef(null)
  useEffect(() => {
    if (loading) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveDraft(appointmentId, { header, itemResults, prevAssessment, reassessMode })
      setDraftSavedAt(Date.now())
    }, 600)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [appointmentId, header, itemResults, prevAssessment, reassessMode, loading])

  // When the type flips to Re-Assessment, fetch the latest unresolved
  // assessment for this plate. If there isn't one, we can't do a proper
  // Re-Assessment — warn the user and let them pick a different type.
  useEffect(() => {
    if (header.type !== 'Re-Assessment') {
      setPrevAssessment(null)
      setReassessMode(null)
      return
    }
    if (!header.plate) return
    // Skip if the draft already has the prev loaded for the same plate.
    if (prevAssessment && prevAssessment?.header?.plate?.toUpperCase() === header.plate.toUpperCase()) return
    let cancelled = false
    setPrevLoading(true)
    getLatestAssessmentForPlate(header.plate).then((prev) => {
      if (cancelled) return
      setPrevAssessment(prev || null)
      setPrevLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.type, header.plate])

  // Compute the active item set for the current (type, prevAssessment) combo.
  // `null` = all items active (Initial / Periodic). A Set = only those codes.
  const activeItemSet = useMemo(
    () => getActiveItems(header.type, prevAssessment),
    [header.type, prevAssessment],
  )

  // Pre-fill logic matching mg-fms:
  //   Pre-Dispatch: fill non-critical items as `na` so inspector sees fewer.
  //   Re-Assessment: copy previous results for items that weren't flagged;
  //                  flagged items stay blank so they must be re-rated.
  // Runs once per (type × prevAssessment) change to avoid wiping edits.
  useEffect(() => {
    if (loading) return
    const key = `${header.type}|${prevAssessment?._docId || prevAssessment?.id || ''}`
    if (prefilledKeyRef.current === key) return
    prefilledKeyRef.current = key

    if (header.type === 'Pre-Dispatch') {
      setItemResults((prev) => {
        const next = { ...prev }
        for (const i of ALL_ITEMS) {
          if (!PRE_DISPATCH_ITEMS.has(i.code) && !next[i.code]?.resultCode) {
            next[i.code] = { resultCode: 'na' }
          }
        }
        return next
      })
    } else if (header.type === 'Re-Assessment' && prevAssessment) {
      const flagged = activeItemSet instanceof Set ? activeItemSet : new Set()
      setItemResults((prev) => {
        const next = { ...prev }
        for (const i of ALL_ITEMS) {
          if (flagged.has(i.code)) continue // needs re-rating
          const r = prevAssessment.itemResults?.[i.code]
          if (r && !next[i.code]?.resultCode) next[i.code] = { ...r }
        }
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.type, prevAssessment, loading])

  // Live classification + score. Recomputed on every itemResult change.
  const classification = useMemo(() => runEngine(itemResults), [itemResults])
  const score = useMemo(
    () => calcHealthScore(classification, itemResults),
    [classification, itemResults],
  )
  const sc = SC[classification.overallStatus] || SC.active
  const hc = healthColor(score)

  // Active = the items the inspector actually has to rate. For Initial /
  // Periodic that's every item. For Pre-Dispatch it's safety-critical items.
  // For Re-Assessment it's previously-flagged items only.
  const activeItems = useMemo(() => {
    if (!(activeItemSet instanceof Set)) return ALL_ITEMS
    return ALL_ITEMS.filter((i) => activeItemSet.has(i.code))
  }, [activeItemSet])

  const activeCategories = useMemo(() => {
    if (!(activeItemSet instanceof Set)) return CATEGORIES
    return CATEGORIES
      .map((c) => ({ ...c, items: c.items.filter((i) => activeItemSet.has(i.code)) }))
      .filter((c) => c.items.length > 0)
  }, [activeItemSet])

  const answered = useMemo(
    () => activeItems.filter((i) => {
      const r = itemResults?.[i.code]
      return r?.resultCode && r.resultCode !== 'na'
    }).length,
    [activeItems, itemResults],
  )
  const totalItems = activeItems.length

  const setResult = (code, patch) => {
    setItemResults((prev) => ({
      ...prev,
      [code]: { ...(prev[code] || {}), ...patch },
    }))
  }

  const canSubmit = answered > 0 && header.plate && header.technician && !saving

  const onSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      const { rwaNumber } = await createAssessment({
        appointmentId,
        header: {
          ...header,
          odometer: header.odometer ? Number(header.odometer) : null,
        },
        itemResults,
      })
      // Submit succeeded — draft is no longer needed.
      clearDraft(appointmentId)
      navigate(`/assessments/${rwaNumber}`)
    } catch (err) {
      console.error('[assessment] createAssessment failed', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  const onDiscardDraft = () => {
    if (!window.confirm('Discard saved draft and reset the form?')) return
    clearDraft(appointmentId)
    setHeader({
      plate: '', make: '', model: '', yearModel: '',
      client: '', branch: '', technician: '', odometer: '',
      type: 'Initial', date: new Date().toISOString().slice(0, 10),
    })
    setItemResults({})
    setPrevAssessment(null)
    setReassessMode(null)
    setDraftSavedAt(null)
    prefilledKeyRef.current = ''
  }

  if (loading) return <div className="p-4 sm:p-6 text-sm text-gray-500">Loading appointment…</div>

  const progressPct = totalItems ? Math.round((answered / totalItems) * 100) : 0

  return (
    <div className="pb-28">
      {/* ── Live status banner (uses gradient tied to classification) ─ */}
      <div className={`bg-gradient-to-b ${sc.grad} text-white px-4 pt-5 pb-5`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-[10px] tracking-widest font-bold text-white/60">
            INSPECTION · {header.plate || '—'}
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            {draftRestored && (
              <span className="bg-white/15 rounded-full px-2 py-0.5 font-semibold">Draft restored</span>
            )}
            {draftSavedAt && (
              <span className="text-white/70" title={new Date(draftSavedAt).toLocaleString()}>
                Saved {timeAgo(draftSavedAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black uppercase tracking-wide text-white/80">Live Classification</div>
            <div className="text-2xl font-black mt-0.5">{sc.label}</div>
            <div className="text-xs text-white/70 mt-1">
              {answered}/{totalItems} items · {classification.failCriticalCount} critical · {classification.monitorCount} monitor
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] font-bold tracking-widest text-white/60">HEALTH</div>
            <div className={`text-3xl font-black bg-white rounded-xl px-3 py-1 ${hc.text}`}>{score}</div>
          </div>
        </div>
        {/* Progress bar */}
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

      {/* Context strip (desktop-only) — mobile Topbar already shows title */}
      <div className="hidden md:flex items-center justify-between px-4 sm:px-6 pt-3 text-xs">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:underline">← Back</button>
        <div className="flex items-center gap-3">
          {(draftSavedAt || draftRestored) && (
            <button onClick={onDiscardDraft} className="text-red-600 hover:underline">Discard draft</button>
          )}
          {appointment && (
            <div className="text-gray-500">
              Appt <span className="font-mono">{appointmentId.slice(0, 6)}</span> · {appointment.status}
            </div>
          )}
        </div>
      </div>

      {/* Mobile discard-draft button (hero hides it) */}
      {(draftSavedAt || draftRestored) && (
        <div className="md:hidden px-3 pt-3 flex justify-end">
          <button onClick={onDiscardDraft} className="text-[11px] text-red-600 font-semibold hover:underline">
            Discard draft
          </button>
        </div>
      )}

      {/* ── Vehicle & header ─────────────────────────────────────── */}
      <div className="m-3 sm:m-4 bg-white border rounded-xl p-3 sm:p-4">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">Vehicle & Header</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="Plate">
            <input value={header.plate} onChange={(e) => setHeader((h) => ({ ...h, plate: e.target.value.toUpperCase() }))} className="input w-full uppercase" />
          </Field>
          <Field label="Date">
            <input type="date" value={header.date} onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} className="input w-full" />
          </Field>
          <Field label="Make"><input value={header.make} onChange={(e) => setHeader((h) => ({ ...h, make: e.target.value }))} className="input w-full" /></Field>
          <Field label="Model"><input value={header.model} onChange={(e) => setHeader((h) => ({ ...h, model: e.target.value }))} className="input w-full" /></Field>
          <Field label="Year"><input value={header.yearModel} onChange={(e) => setHeader((h) => ({ ...h, yearModel: e.target.value }))} className="input w-full" /></Field>
          <Field label="Odometer (km)"><input type="number" value={header.odometer} onChange={(e) => setHeader((h) => ({ ...h, odometer: e.target.value }))} className="input w-full" /></Field>
          <Field label="Client / Fleet"><input value={header.client} onChange={(e) => setHeader((h) => ({ ...h, client: e.target.value }))} className="input w-full" /></Field>
          <Field label="Branch"><input value={header.branch} onChange={(e) => setHeader((h) => ({ ...h, branch: e.target.value }))} className="input w-full" /></Field>
          <Field label="Technician"><input value={header.technician} onChange={(e) => setHeader((h) => ({ ...h, technician: e.target.value }))} className="input w-full" /></Field>
          <Field label="Type">
            <select value={header.type} onChange={(e) => { setHeader((h) => ({ ...h, type: e.target.value })); prefilledKeyRef.current = '' }} className="input w-full">
              {ASSESS_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* ── Type-specific banner + Re-Assessment mode chooser ────── */}
      <TypeBanner
        type={header.type}
        plate={header.plate}
        prevAssessment={prevAssessment}
        prevLoading={prevLoading}
        activeItems={activeItems}
        reassessMode={reassessMode}
        setReassessMode={setReassessMode}
      />

      {/* ── Inspection categories ───────────────────────────────── */}
      {activeCategories.length === 0 ? (
        <div className="mx-3 sm:mx-4 bg-white border border-dashed rounded-xl p-6 text-center text-gray-400 text-sm">
          {header.type === 'Re-Assessment' && !prevAssessment
            ? 'No previous assessment to re-check. Pick another type.'
            : 'No items to rate for this type.'}
        </div>
      ) : (
        <div className="mx-3 sm:mx-4 space-y-2">
          {activeCategories.map((cat, idx) => (
            <CategoryBlock
              key={cat.code}
              cat={cat}
              stepIndex={idx + 1}
              stepCount={activeCategories.length}
              open={openCat === cat.code}
              onToggle={() => setOpenCat(openCat === cat.code ? null : cat.code)}
              itemResults={itemResults}
              setResult={setResult}
            />
          ))}
        </div>
      )}

      {/* ── Sticky submit bar ───────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0))' }}
      >
        {error && <div className="text-[11px] text-red-700 flex-1 truncate">Save failed: {error}</div>}
        <div className={`text-[11px] sm:text-xs flex-1 min-w-0 ${error ? 'hidden' : ''}`}>
          {answered === 0 ? (
            <span className="text-gray-500">Rate at least one item to submit.</span>
          ) : (
            <span className="text-gray-700">
              <span className="font-bold">{answered}/{totalItems}</span>
              <span className="text-gray-500"> · preview: </span>
              <span className="font-bold">{sc.label}</span>
              {!classification.dispatchAllowed && <span className="text-red-700 font-bold"> · ⛔ hold</span>}
            </span>
          )}
        </div>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow active:scale-95 transition-transform shrink-0"
        >
          {saving ? 'Submitting…' : 'Submit'}
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

// Per-type context strip + (for Re-Assessment) mode chooser. Mirrors
// mg-fms-app/src/App.jsx screen="reassess-mode" + the orange/blue filter
// banners in screen="inspect".
function TypeBanner({ type, plate, prevAssessment, prevLoading, activeItems, reassessMode, setReassessMode }) {
  if (type === 'Pre-Dispatch') {
    return (
      <div className="mx-3 sm:mx-4 mb-3 bg-blue-600 text-white rounded-xl px-3 py-2.5 flex items-center gap-2 text-xs font-bold">
        <span>🚛</span>
        Pre-Dispatch — safety-critical items only · {activeItems.length} item{activeItems.length === 1 ? '' : 's'}
      </div>
    )
  }
  if (type === 'Re-Assessment') {
    if (!plate) {
      return (
        <div className="mx-3 sm:mx-4 mb-3 bg-amber-50 border-2 border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          Enter a plate number above to load the previous assessment.
        </div>
      )
    }
    if (prevLoading) {
      return (
        <div className="mx-3 sm:mx-4 mb-3 bg-gray-100 rounded-xl p-3 text-xs text-gray-500 animate-pulse">
          Loading previous assessment for {plate}…
        </div>
      )
    }
    if (!prevAssessment) {
      return (
        <div className="mx-3 sm:mx-4 mb-3 bg-amber-50 border-2 border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          No previous assessment found for <span className="font-mono font-bold">{plate}</span>. Pick a different assessment type, or assess this vehicle as <strong>Initial</strong> first.
        </div>
      )
    }
    // Got a previous assessment. Show the mode chooser if no mode is
    // selected yet. Once a mode is chosen, show a condensed header.
    const flaggedCount = activeItems.length
    const prevRwa = prevAssessment.rwaNumber
    if (!reassessMode) {
      return (
        <div className="mx-3 sm:mx-4 mb-3 space-y-3">
          <div className="bg-white border rounded-xl p-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Previous assessment</div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-black text-sm text-gray-900 font-mono">{prevRwa}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {prevAssessment.header?.date} · {prevAssessment.header?.branch || '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-red-700">{flaggedCount}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">flagged</div>
              </div>
            </div>
          </div>
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest text-center">Choose mode</div>
          <button
            type="button"
            onClick={() => setReassessMode('quickfix')}
            className="w-full bg-white rounded-2xl border-2 border-blue-300 p-4 text-left hover:border-blue-500 active:scale-[0.99] transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center text-2xl shrink-0">🔧</div>
              <div className="flex-1">
                <div className="font-black text-gray-900">Quick Fix</div>
                <div className="text-xs text-gray-500 mt-0.5">Document parts already replaced. Skip inspection, go straight to replacement details.</div>
                <div className="text-[11px] text-blue-700 font-bold mt-1">Best when repair is already complete</div>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setReassessMode('full')}
            className="w-full bg-white rounded-2xl border-2 border-gray-300 p-4 text-left hover:border-red-500 active:scale-[0.99] transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center text-2xl shrink-0">🔁</div>
              <div className="flex-1">
                <div className="font-black text-gray-900">Full Re-Assessment</div>
                <div className="text-xs text-gray-500 mt-0.5">Re-inspect {flaggedCount} flagged item{flaggedCount === 1 ? '' : 's'} with pass / monitor / fail / replaced.</div>
                <div className="text-[11px] text-red-700 font-bold mt-1">Best when some items still need inspection</div>
              </div>
            </div>
          </button>
        </div>
      )
    }
    if (reassessMode === 'quickfix') {
      // Quick Fix screen itself ships in 6c. For now show a placeholder with
      // a way back to the mode picker.
      return (
        <div className="mx-3 sm:mx-4 mb-3 bg-blue-50 border-2 border-blue-200 rounded-xl p-4 space-y-2">
          <div className="text-sm font-bold text-blue-900">Quick Fix mode</div>
          <div className="text-xs text-blue-800">
            A dedicated Quick Fix screen (document replaced parts + labor) is the next step. For now, mark items below as <strong>Replaced</strong> to record repairs.
          </div>
          <button type="button" onClick={() => setReassessMode(null)} className="text-[11px] text-blue-700 font-bold hover:underline">← Switch mode</button>
        </div>
      )
    }
    return (
      <div className="mx-3 sm:mx-4 mb-3 bg-orange-50 border-2 border-orange-200 rounded-xl p-3 flex items-start gap-2 text-xs text-orange-900">
        <span>🔁</span>
        <div className="flex-1">
          <div className="font-bold">Full Re-Assessment — {flaggedCount} flagged item{flaggedCount === 1 ? '' : 's'}</div>
          <div className="mt-0.5">Re-rate each flagged item. Non-flagged items from <span className="font-mono font-bold">{prevRwa}</span> have been pre-filled.</div>
        </div>
        <button type="button" onClick={() => setReassessMode(null)} className="text-[10px] text-orange-700 font-bold hover:underline shrink-0">Change</button>
      </div>
    )
  }
  return null
}

// Friendly relative time for the draft indicator. No deps.
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function CategoryBlock({ cat, stepIndex, stepCount, open, onToggle, itemResults, setResult }) {
  const fails = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'fail_critical').length
  const mons = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'monitor').length
  const answered = cat.items.filter((i) => itemResults[i.code]?.resultCode).length
  const complete = answered === cat.items.length && cat.items.length > 0
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
            complete ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 border'
          }`}>
            {complete ? '✓' : stepIndex}
          </span>
          <span className="text-lg shrink-0">{cat.icon}</span>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 leading-none">
              Step {stepIndex} of {stepCount}
            </div>
            <div className="font-semibold text-sm text-gray-800 truncate">
              {cat.label} <span className="text-xs text-gray-400 font-normal">({answered}/{cat.items.length})</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          {fails > 0 && <span className="text-red-600 font-bold">🚨 {fails}</span>}
          {mons > 0 && <span className="text-amber-600 font-bold">⚠ {mons}</span>}
          <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        </div>
      </button>
      {open && (
        <div className="border-t divide-y">
          {cat.items.map((item) => (
            <ItemRow key={item.code} item={item} result={itemResults[item.code] || {}} setResult={setResult} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, result, setResult }) {
  const action = getAction(item, result.resultCode)
  const actionCfg = ACTION_CFG[action]
  const showDefect = result.resultCode === 'fail_critical' || result.resultCode === 'monitor'
  const showMeasure = item.type === 'measurable'
  const showPart = result.resultCode === 'replaced'

  return (
    <div className="px-3 sm:px-4 py-3">
      {/* Mobile (<lg): stacked — label on top, result buttons wrap below.
          Desktop (lg+): side-by-side like before, label left, buttons right. */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800 break-words">
            {item.label}
            {item.isCritical && <span className="ml-1.5 text-[10px] text-red-600 font-bold">CRITICAL</span>}
            {item.holdUnit && <span className="ml-1.5 text-[10px] text-red-900 font-bold">HOLD</span>}
            {item.isCompliance && <span className="ml-1.5 text-[10px] text-blue-600 font-bold">COMPLIANCE</span>}
          </div>
          {item.thresholdLabel && (
            <div className="text-[11px] text-gray-500 mt-0.5">{item.thresholdLabel}</div>
          )}
        </div>
        <div className="mt-2 lg:mt-0 grid grid-cols-5 gap-1 lg:flex lg:flex-wrap lg:justify-end lg:gap-1">
          {RESULT_OPTIONS.map((rc) => {
            const active = result.resultCode === rc
            const cfg = RC[rc]
            return (
              <button
                key={rc}
                type="button"
                onClick={() => setResult(item.code, { resultCode: active ? undefined : rc })}
                className={`text-[10px] sm:text-[11px] px-1 sm:px-2 py-2 sm:py-1 rounded-lg lg:rounded font-bold transition leading-tight text-center ${active ? `${cfg.bg} text-white` : `${cfg.light} hover:opacity-80`}`}
              >
                <span className="block lg:inline">{cfg.icon}</span>
                <span className="block lg:inline lg:ml-0.5">{cfg.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {(showDefect || showMeasure || showPart) && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {showMeasure && (
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-500 mb-0.5">
                Measured {item.unit ? `(${item.unit})` : ''}
              </span>
              <input
                type="number"
                step="0.01"
                value={result.measuredValue ?? ''}
                onChange={(e) => setResult(item.code, { measuredValue: e.target.value })}
                className="input w-full"
                placeholder={item.threshold != null ? `min ${item.threshold}` : ''}
              />
            </label>
          )}
          {showDefect && (
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Defect</span>
              <select
                value={result.defectCode || ''}
                onChange={(e) => setResult(item.code, { defectCode: e.target.value || undefined })}
                className="input w-full"
              >
                <option value="">— select —</option>
                {Object.entries(DEFECT_CODES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
          )}
          {showPart && (
            <>
              <label className="block">
                <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Part Replaced</span>
                <input
                  value={result.partReplaced || ''}
                  onChange={(e) => setResult(item.code, { partReplaced: e.target.value })}
                  className="input w-full"
                  placeholder="Brand / description"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Qty</span>
                <input
                  type="number" min="1"
                  value={result.partQty || 1}
                  onChange={(e) => setResult(item.code, { partQty: Number(e.target.value) || 1 })}
                  className="input w-full"
                />
              </label>
              <div className="sm:col-span-2">
                <PhotoCapture
                  label="Photos (before / new part / after)"
                  photos={result.photos || []}
                  onChange={(next) => setResult(item.code, { photos: next })}
                />
              </div>
            </>
          )}
          <label className="block sm:col-span-2">
            <span className="block text-[10px] font-medium text-gray-500 mb-0.5">Note</span>
            <input
              value={result.note || ''}
              onChange={(e) => setResult(item.code, { note: e.target.value })}
              className="input w-full"
              placeholder="Optional remarks"
            />
          </label>
        </div>
      )}

      {result.resultCode && action !== 'NONE' && (
        <div className={`mt-2 inline-block text-[10px] font-semibold px-2 py-0.5 rounded ${actionCfg.bg} ${actionCfg.color}`}>
          {actionCfg.label}
        </div>
      )}
    </div>
  )
}
