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
import QuickFixForm, { clearQuickFixDraft } from './QuickFixForm'


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

  // Quick Fix handler — the QuickFixForm hands us the patched itemResults
  // and pmsData (labor types etc.). We push through the same createAssessment
  // path so auto-resolve + notifications happen identically to the full flow.
  const onSubmitQuickFix = async (patchedItemResults, pmsData) => {
    setSaving(true); setError(null)
    try {
      const { rwaNumber } = await createAssessment({
        appointmentId,
        header: {
          ...header,
          odometer: header.odometer ? Number(header.odometer) : null,
        },
        itemResults: patchedItemResults,
        pmsData,
      })
      clearDraft(appointmentId)
      clearQuickFixDraft(appointmentId)
      navigate(`/assessments/${rwaNumber}`)
    } catch (err) {
      console.error('[assessment] createAssessment (quickfix) failed', err)
      setError(err.message || String(err))
      setSaving(false)
      // Re-throw so QuickFixForm shows its inline error too.
      throw err
    }
  }

  // Quick Fix mode takes over the whole body — the normal inspection flow
  // doesn't render. Uses its own sticky submit bar.
  if (header.type === 'Re-Assessment' && reassessMode === 'quickfix' && prevAssessment) {
    return (
      <QuickFixForm
        appointmentId={appointmentId}
        prevAssessment={prevAssessment}
        header={header}
        onBack={() => setReassessMode(null)}
        onSubmit={onSubmitQuickFix}
      />
    )
  }

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
        <div className="mx-3 sm:mx-4 space-y-3">
          {activeCategories.map((cat, idx) => (
            <CategoryBlock
              key={cat.code}
              cat={cat}
              open={openCat === cat.code}
              onToggle={() => setOpenCat(openCat === cat.code ? null : cat.code)}
              onComplete={idx < activeCategories.length - 1 ? () => setOpenCat(activeCategories[idx + 1].code) : null}
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
      // QuickFixForm takes over the whole page when this mode is active —
      // see the early-return in AssessmentForm. This banner should never
      // render in that case, but return null as a safety.
      return null
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

// Port of mg-fms-app CatCard (App.jsx:250) — color-coded progress bar, chip
// counts, mark-all-pass CTA, next-category CTA, all-done green tint.
function CategoryBlock({ cat, open, onToggle, onComplete, itemResults, setResult }) {
  const total = cat.items.length
  const done = cat.items.filter((i) => itemResults[i.code]?.resultCode).length
  const fails = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'fail_critical').length
  const mons = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'monitor').length
  const replaced = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'replaced').length
  const pct = total ? Math.round((done / total) * 100) : 0
  const bar = fails > 0 ? 'bg-red-500' : mons > 0 ? 'bg-amber-500' : done === total && total > 0 ? 'bg-green-500' : 'bg-gray-300'
  const allDone = done === total && total > 0
  const allClear = allDone && fails === 0 && mons === 0

  // Mark every unrated item in this category as Pass — the "you know the rest
  // are fine, don't make me tap 30 times" escape hatch. Matches mg-fms
  // quickPassAll (CatCard).
  const markAllPass = () => {
    for (const item of cat.items) {
      if (!itemResults[item.code]?.resultCode) {
        setResult(item.code, {
          resultCode: 'pass',
          defectCode: null,
          partReplaced: null,
          partQty: null,
          afterMeasure: null,
          note: null,
          photos: null,
        })
      }
    }
  }

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all ${allClear ? 'border-green-200 bg-green-50/30' : 'bg-white border-gray-200'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-black/5"
      >
        <span className="text-xl shrink-0">{allClear ? '✅' : cat.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-gray-800 text-sm truncate">{cat.label}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {fails > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">{fails}✕</span>}
              {mons > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">{mons}⚠</span>}
              {replaced > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{replaced}🔩</span>}
              <span className="text-[11px] text-gray-400">{done}/{total}</span>
              <span className="text-gray-300 text-xs">{open ? '▲' : '▼'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-gray-400">{pct}%</span>
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 sm:px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {cat.items.map((item) => (
            <ItemRow key={item.code} item={item} result={itemResults[item.code] || {}} setResult={setResult} />
          ))}
          {done < total && (
            <button
              type="button"
              onClick={markAllPass}
              className="w-full py-3 border-2 border-dashed border-green-400 text-green-700 rounded-xl font-bold text-sm hover:bg-green-50 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              ✓ Mark all remaining as Pass ({total - done} item{total - done === 1 ? '' : 's'})
            </button>
          )}
          {allDone && onComplete && (
            <button
              type="button"
              onClick={onComplete}
              className="w-full py-3 bg-gray-800 text-white rounded-xl font-bold text-sm active:scale-95 flex items-center justify-center gap-2"
            >
              Next Category →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Port of mg-fms-app InspItem (App.jsx:208). Faithful visual + behavioral
// parity: tap-to-clear results, auto-classify measurables, color-coded
// borders, HOLD/CRIT/LTO chips, tappable defect chips, replacement details
// card, photos on any flagged item, per-item note.
function ItemRow({ item, result, setResult }) {
  const v = result || {}
  const isReplaced = v.resultCode === 'replaced'
  const isFailOrMonitor = v.resultCode === 'fail_critical' || v.resultCode === 'monitor'
  const showDefectBlock = isFailOrMonitor || isReplaced
  const action = getAction(item, v.resultCode)
  const actCfg = ACTION_CFG[action]

  // Tap a result button: toggles. Tap the already-active button to clear.
  // When the new result is "cleared" (pass / na / toggle-off), any captured
  // defect/part/after/note/photos get wiped — mirrors mg-fms InspItem.
  const setCode = (code) => {
    const same = code === v.resultCode
    const clear = same || code === 'pass' || code === 'na'
    setResult(item.code, {
      resultCode: same ? null : code,
      defectCode: clear ? null : v.defectCode,
      partReplaced: clear ? null : v.partReplaced,
      partQty: clear ? null : v.partQty,
      afterMeasure: clear ? null : v.afterMeasure,
      note: clear ? null : v.note,
      photos: clear ? null : v.photos,
    })
  }

  // Measurable "Before" input — auto-classifies against the threshold.
  // Empty clears the result; below threshold → fail_critical; at/above → pass.
  const setMeasure = (val) => {
    const auto = val !== ''
      ? (parseFloat(val) < item.threshold ? 'fail_critical' : 'pass')
      : null
    setResult(item.code, { measuredValue: val, resultCode: auto })
  }

  const setPhotos = (photos) => setResult(item.code, { photos })

  const border =
    v.resultCode === 'fail_critical' ? 'border-red-400 bg-red-50' :
    v.resultCode === 'monitor'       ? 'border-amber-400 bg-amber-50' :
    v.resultCode === 'replaced'      ? 'border-blue-400 bg-blue-50' :
    v.resultCode === 'pass'          ? 'border-green-400 bg-green-50' :
    v.resultCode === 'na'            ? 'border-gray-300 bg-gray-50' :
                                       'border-gray-200 bg-white'

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all ${border}`}>
      <div className="px-4 pt-3 pb-2.5">
        <div className="flex items-start gap-2 mb-2">
          <span className="font-semibold text-gray-800 text-sm leading-snug flex-1 break-words">{item.label}</span>
          <div className="flex gap-1 shrink-0">
            {item.holdUnit && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-md font-bold">HOLD</span>}
            {item.isCritical && !item.holdUnit && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-md font-bold">CRIT</span>}
            {item.isCompliance && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">LTO</span>}
          </div>
        </div>

        {/* Measurable Before input — inline with unit + threshold + auto-classified result pill */}
        {item.type === 'measurable' && (
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-400 mb-0.5">Before</span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={v.measuredValue ?? ''}
                onChange={(e) => setMeasure(e.target.value)}
                className="w-20 border-2 border-gray-200 focus:border-blue-500 rounded-xl px-2 py-2 text-sm font-bold text-center focus:outline-none bg-white"
              />
            </div>
            <span className="text-xs text-gray-400 mt-4">{item.unit}</span>
            {item.thresholdLabel && <span className="text-[11px] text-gray-400 italic mt-4">{item.thresholdLabel}</span>}
            {v.resultCode && v.resultCode !== 'replaced' && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-4 ${RC[v.resultCode]?.light}`}>
                {RC[v.resultCode]?.label}
              </span>
            )}
          </div>
        )}

        {/* 5-button grid: icon above label, tap active to clear */}
        <div className="grid grid-cols-5 gap-1.5">
          {['pass', 'monitor', 'fail_critical', 'replaced', 'na'].map((code) => {
            const active = v.resultCode === code
            const cfg = RC[code]
            return (
              <button
                key={code}
                type="button"
                onClick={() => setCode(code)}
                className={`py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 ${active ? `${cfg.bg} text-white shadow-md` : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
              >
                <div className="text-base leading-none">{cfg.icon}</div>
                <div className="mt-0.5 leading-none" style={{ fontSize: '10px' }}>{cfg.label}</div>
              </button>
            )
          })}
        </div>

        {/* Action chip — "Monitor", "Repair Required", "Hold Unit", etc. */}
        {v.resultCode && action !== 'NONE' && (
          <div className={`mt-2 inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${actCfg.bg} ${actCfg.color}`}>
            {actCfg.label}
          </div>
        )}
        {isReplaced && (
          <div className="mt-2 ml-1 inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
            🔩 Replaced on-site — resolved
          </div>
        )}
      </div>

      {/* Expanded block — defect chips, replacement details, photos, note. */}
      {showDefectBlock && (
        <div className="px-4 pb-4 pt-2 border-t border-dashed border-gray-300 space-y-3">
          {Array.isArray(item.defects) && item.defects.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                {isReplaced ? 'Defect Found (Before Replacement)' : 'Defect Type'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.defects.map((dc) => (
                  <button
                    key={dc}
                    type="button"
                    onClick={() => setResult(item.code, { defectCode: v.defectCode === dc ? null : dc })}
                    className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-all ${
                      v.defectCode === dc
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-red-400'
                    }`}
                  >
                    {DEFECT_CODES[dc] || dc}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isReplaced && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-3">
              <div className="text-[11px] font-black text-blue-700 uppercase tracking-wide">🔩 Replacement Details</div>
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Part / Material Replaced *</div>
                <input
                  type="text"
                  placeholder="e.g. Brake pad set (front), Engine oil filter…"
                  value={v.partReplaced || ''}
                  onChange={(e) => setResult(item.code, { partReplaced: e.target.value })}
                  className="w-full border-2 border-blue-200 focus:border-blue-500 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none bg-white"
                />
              </div>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[100px]">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Quantity</div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setResult(item.code, { partQty: Math.max(1, (v.partQty || 1) - 1) })} className="w-9 h-9 bg-white border-2 border-blue-200 rounded-lg font-black text-lg text-gray-600 flex items-center justify-center active:scale-95">−</button>
                    <span className="text-lg font-black text-gray-800 w-10 text-center">{v.partQty || 1}</span>
                    <button type="button" onClick={() => setResult(item.code, { partQty: (v.partQty || 1) + 1 })} className="w-9 h-9 bg-white border-2 border-blue-200 rounded-lg font-black text-lg text-gray-600 flex items-center justify-center active:scale-95">+</button>
                  </div>
                </div>
                {item.type === 'measurable' && (
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">After ({item.unit})</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={v.afterMeasure ?? ''}
                        onChange={(e) => setResult(item.code, { afterMeasure: e.target.value })}
                        className="w-24 border-2 border-blue-200 focus:border-blue-500 rounded-xl px-2 py-2 text-sm font-bold text-center focus:outline-none bg-white"
                      />
                      <span className="text-xs text-gray-400">{item.unit}</span>
                      {v.afterMeasure && parseFloat(v.afterMeasure) >= item.threshold && <span className="text-[11px] font-bold text-green-600">✓ OK</span>}
                      {v.afterMeasure && parseFloat(v.afterMeasure) < item.threshold && <span className="text-[11px] font-bold text-red-600">Still low</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              {isReplaced ? 'Photos (Before / After)' : 'Photos (max 3)'}
            </div>
            <PhotoCapture photos={v.photos || []} onChange={setPhotos} max={3} />
          </div>

          <div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Note</div>
            <input
              type="text"
              placeholder={isReplaced ? 'e.g. Replaced during inspection, parts from stock…' : 'Add note (optional)…'}
              value={v.note || ''}
              onChange={(e) => setResult(item.code, { note: e.target.value })}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  )
}
