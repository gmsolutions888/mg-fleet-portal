// Quick Fix screen — port of mg-fms-app/src/App.jsx QuickFixScreen.
// Used for Re-Assessments where the repair is already complete and the
// inspector just needs to document what was replaced (per flagged item)
// plus the labor types performed. On submit, flagged items flip to
// `replaced` with part/qty/photos/note, and the whole thing goes through
// the same createAssessment path as a full re-assessment.
//
// Inputs: prevAssessment (required — the Re-Assessment target), header
// (plate/odometer/date/technician/branch/client/type), onSubmit(patchedItems,
// pmsData), onBack (back to mode chooser).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_ITEMS, DEFECT_CODES, INSP_TO_PMS, LABOR_TYPES, PMS_MAP,
} from '../lib/mgfms-catalog'
import { getApprovedQuotationForPlate } from '../lib/serviceReceipts'
import PhotoCapture from '../components/PhotoCapture'

const DRAFT_VERSION = 1
const draftKey = (appointmentId) => `mgfp.quickfix.v${DRAFT_VERSION}.${appointmentId || 'standalone'}`

function loadDraft(appointmentId, draftId) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(draftKey(appointmentId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.key !== draftId) return null
    return parsed
  } catch { return null }
}

function saveDraft(appointmentId, payload) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(draftKey(appointmentId), JSON.stringify(payload)) } catch {}
}

export function clearQuickFixDraft(appointmentId) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(draftKey(appointmentId)) } catch {}
}

export default function QuickFixForm({ appointmentId, prevAssessment, header, onSubmit, onBack }) {
  const flagged = useMemo(() => ALL_ITEMS.filter((i) => {
    const r = prevAssessment?.itemResults?.[i.code]
    return r?.resultCode === 'fail_critical' || r?.resultCode === 'monitor'
  }), [prevAssessment])

  const draftId = (prevAssessment?.rwaNumber || header?.plate || '') + '|' + (header?.date || '')
  const draft = useMemo(() => loadDraft(appointmentId, draftId), [appointmentId, draftId])

  const [repairs, setRepairs] = useState(() => {
    if (draft?.repairs) return draft.repairs
    const init = {}
    for (const i of flagged) {
      init[i.code] = { skip: false, partReplaced: '', qty: 1, afterMeasure: '', note: '', photos: [] }
    }
    return init
  })
  const [laborTypes, setLaborTypes] = useState(draft?.laborTypes || {})
  const [otherLabor, setOtherLabor] = useState(draft?.otherLabor || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Round 38 — prefill partReplaced + qty from the approved quote
  // for this plate. Matches each flagged item to a quote line via
  // its PMS-link label first, then falls back to the inspection
  // item's own label. Skips items the user has already started
  // filling in. Runs once per mount.
  const [quoteCode, setQuoteCode] = useState(null)
  useEffect(() => {
    if (!header?.plate) return
    let cancelled = false
    ;(async () => {
      try {
        const quot = await getApprovedQuotationForPlate(header.plate)
        if (cancelled || !quot || !Array.isArray(quot.items)) return
        setQuoteCode(quot.code || null)

        // Build a list of non-Labor quote lines with cleaned descriptions
        // (strip "(Monitor) " / "Replace " / defect-suffix) so substring
        // match against inspection-item labels is reliable.
        const partsLines = quot.items
          .filter((qi) => qi.type !== 'Labor')
          .map((qi) => {
            let clean = String(qi.description || '').trim()
            clean = clean.replace(/^\([^)]*\)\s+/, '')        // (Monitor)
            clean = clean.replace(/^Replace\s+/i, '')           // verb
            clean = clean.replace(/\s+—\s+.*$/, '')             // — defect
            return { ...qi, _clean: clean.toUpperCase() }
          })

        if (partsLines.length === 0) return

        setRepairs((prev) => {
          const next = { ...prev }
          for (const item of flagged) {
            const cur = prev[item.code]
            // Don't overwrite anything the assessor already touched.
            if (cur?.partReplaced || cur?.skip) continue

            // Try the PMS-linked label first ("Engine Oil"), then the
            // inspection item's own label ("Engine oil — condition & level").
            const pmsCode = INSP_TO_PMS[item.code]
            const candidates = [
              pmsCode && PMS_MAP[pmsCode]?.label,
              item.label,
            ].filter(Boolean).map((s) => String(s).toUpperCase())

            let match = null
            for (const candidate of candidates) {
              match = partsLines.find((line) =>
                line._clean.includes(candidate) || candidate.includes(line._clean),
              )
              if (match) break
            }
            if (match) {
              next[item.code] = {
                ...cur,
                partReplaced: match._clean,           // cleaned name, no verb
                qty: Number(match.qty) || cur?.qty || 1,
                _fromQuote: quot.code || true,         // surfaced as a small badge
              }
            }
          }
          return next
        })
      } catch (err) {
        console.warn('[QuickFix] quote prefill failed:', err)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header?.plate])

  // Persist draft on change.
  const saveTimerRef = useRef(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveDraft(appointmentId, { key: draftId, repairs, laborTypes, otherLabor })
    }, 600)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [appointmentId, draftId, repairs, laborTypes, otherLabor])

  const updateRepair = (code, field, value) =>
    setRepairs((prev) => ({ ...prev, [code]: { ...prev[code], [field]: value } }))
  const setPhotos = (code, photos) =>
    setRepairs((prev) => ({ ...prev, [code]: { ...prev[code], photos } }))

  const repairedCount = flagged.filter((i) => !repairs[i.code]?.skip).length
  const skippedCount = flagged.length - repairedCount
  const laborCount = Object.values(laborTypes).filter(Boolean).length

  // All non-skipped items must have a part name, and any measurable item
  // must have an "after" reading. Port of mg-fms-app QuickFixScreen:442.
  const canSubmit = flagged.length > 0 && flagged.every((i) => {
    const r = repairs[i.code]
    if (!r) return false
    if (r.skip) return true
    if (!r.partReplaced || !r.partReplaced.trim()) return false
    if (i.type === 'measurable' && !r.afterMeasure) return false
    return true
  })

  // Round 23 — when the user clicks Submit on incomplete work, find the
  // first issue, scroll to it, focus the missing field, and surface a
  // specific message. Better than a silently-disabled button.
  const findFirstBlocker = () => {
    if (flagged.length === 0) return { kind: 'no-flagged' }
    for (const i of flagged) {
      const r = repairs[i.code] || {}
      if (r.skip) continue
      if (!r.partReplaced || !r.partReplaced.trim()) {
        return { kind: 'missing-part', item: i, fieldId: `fix-${i.code}-part`, message: `Enter the part replaced for "${i.label}", or mark it Skip.` }
      }
      if (i.type === 'measurable' && !r.afterMeasure) {
        return { kind: 'missing-measure', item: i, fieldId: `fix-${i.code}-measure`, message: `Enter the after-repair measurement (${i.unit || ''}) for "${i.label}".` }
      }
      // No explicit Repair/Skip pick yet — r.skip is undefined.
      if (r.skip == null && !r.partReplaced) {
        return { kind: 'undecided', item: i, fieldId: null, message: `Pick Repair or Skip for "${i.label}".` }
      }
    }
    return null
  }

  const jumpTo = (blocker) => {
    if (!blocker) return
    const cardId = blocker.item ? `fix-item-${blocker.item.code}` : null
    if (cardId) {
      const el = document.getElementById(cardId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // Focus a beat after scroll starts so the smooth-scroll isn't interrupted.
    if (blocker.fieldId) {
      setTimeout(() => {
        const input = document.getElementById(blocker.fieldId)
        if (input) input.focus()
      }, 250)
    }
    setError(blocker.message)
  }

  const handleSubmit = async () => {
    if (saving) return
    if (!canSubmit) {
      const blocker = findFirstBlocker()
      jumpTo(blocker)
      return
    }
    setSaving(true); setError(null)
    try {
      // Patch the item results: flagged items become `replaced` with the
      // recorded part/qty/photos. Non-flagged items carry over unchanged.
      const newItemResults = { ...(prevAssessment.itemResults || {}) }
      for (const i of flagged) {
        const r = repairs[i.code]
        if (r.skip) continue
        const prev = prevAssessment.itemResults?.[i.code] || {}
        newItemResults[i.code] = {
          resultCode: 'replaced',
          defectCode: prev.defectCode || null,
          measuredValue: prev.measuredValue,
          partReplaced: r.partReplaced.trim(),
          partQty: r.qty || 1,
          afterMeasure: r.afterMeasure || undefined,
          note: r.note?.trim() || undefined,
          photos: r.photos || [],
        }
      }

      // pmsData carries labor types + a "Quick Fix" note. Auto-linking
      // replaced items into PMS updates is the PMS form's job — mg-fms also
      // builds `updates` inside pmsData from INSP_TO_PMS but the portal's
      // PMS flow lives as a separate page; leaving `updates` empty is OK.
      const pmsData = {
        laborTypes: LABOR_TYPES.filter((lt) => laborTypes[lt.code]).map((lt) => ({ code: lt.code, label: lt.label })),
        otherLabor: laborTypes.LBR_OTHER && otherLabor.trim() ? otherLabor.trim() : null,
        notes: 'Quick Fix',
      }
      await onSubmit(newItemResults, pmsData)
    } catch (err) {
      console.error('[quickfix] submit failed', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="pb-32">
      {/* Blue strip — matches mg-fms's Quick Fix banner */}
      <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center gap-2">
        <span>🔧</span>
        <span className="text-xs font-bold">Quick Fix — flagged items will be marked Replaced</span>
      </div>

      <div className="px-3 sm:px-4 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} className="text-xs text-gray-500 font-bold hover:underline">
            ← Change mode
          </button>
          <div className="text-[11px] text-gray-500">
            {repairedCount} to repair{skippedCount > 0 ? ` · ${skippedCount} skip` : ''}
          </div>
        </div>

        {flagged.length === 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-sm font-semibold text-gray-500">No flagged items from the previous assessment.</div>
          </div>
        )}

        {flagged.map((item) => {
          const r = repairs[item.code] || {}
          const prev = prevAssessment.itemResults?.[item.code] || {}
          const isCrit = prev.resultCode === 'fail_critical'
          const skipped = r.skip
          return (
            <div
              key={item.code}
              id={`fix-item-${item.code}`}
              className={`rounded-2xl border-2 overflow-hidden ${skipped ? 'border-gray-300 opacity-70' : isCrit ? 'border-red-300' : 'border-amber-300'} bg-white scroll-mt-4`}
            >
              <div className={`px-4 py-3 flex items-start gap-2 ${skipped ? 'bg-gray-100' : isCrit ? 'bg-red-50' : 'bg-amber-50'}`}>
                <span className={`shrink-0 text-xs font-black px-2 py-1 rounded-lg ${isCrit ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
                  {isCrit ? 'CRIT' : 'MON'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-800 text-sm break-words">{item.label}</div>
                  {prev.defectCode && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Defect: {DEFECT_CODES?.[prev.defectCode] || prev.defectCode}
                    </div>
                  )}
                  {prev.measuredValue !== undefined && prev.measuredValue !== '' && (
                    <div className="text-xs text-red-600 font-semibold mt-0.5">
                      Before: {prev.measuredValue}{item.unit || ''}
                      {item.threshold ? ` · Min ${item.threshold}${item.unit || ''}` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 pt-3 pb-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateRepair(item.code, 'skip', false)}
                  className={`py-2.5 rounded-xl font-bold text-xs transition-all ${!skipped ? 'bg-green-600 text-white shadow' : 'bg-gray-100 text-gray-500'}`}
                >
                  🔩 Repair
                </button>
                <button
                  type="button"
                  onClick={() => updateRepair(item.code, 'skip', true)}
                  className={`py-2.5 rounded-xl font-bold text-xs transition-all ${skipped ? 'bg-gray-700 text-white shadow' : 'bg-gray-100 text-gray-500'}`}
                >
                  ⏭ Skip (not repaired)
                </button>
              </div>

              {skipped ? (
                <div className="px-4 pb-4 pt-2">
                  <div className="bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 font-semibold">
                    This item will remain {isCrit ? 'flagged as critical' : 'flagged for monitoring'}. Dispatch hold will persist if any critical item is skipped.
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500">
                        Part Replaced *
                      </label>
                      {r._fromQuote && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
                          From quote {typeof r._fromQuote === 'string' ? r._fromQuote : ''}
                        </span>
                      )}
                    </div>
                    <input
                      id={`fix-${item.code}-part`}
                      value={r.partReplaced || ''}
                      onChange={(e) => updateRepair(item.code, 'partReplaced', e.target.value)}
                      placeholder="e.g. Brake Pad Set (Front)"
                      className="input"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                        Quantity
                      </label>
                      <div className="flex items-center bg-gray-50 border rounded-xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateRepair(item.code, 'qty', Math.max(1, (r.qty || 1) - 1))}
                          className="w-10 h-11 text-xl font-black text-gray-600 hover:bg-gray-100"
                        >
                          −
                        </button>
                        <div className="flex-1 text-center font-bold text-base min-w-0">{r.qty || 1}</div>
                        <button
                          type="button"
                          onClick={() => updateRepair(item.code, 'qty', (r.qty || 1) + 1)}
                          className="w-10 h-11 text-xl font-black text-gray-600 hover:bg-gray-100"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    {item.type === 'measurable' && (
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                          After ({item.unit}) *
                        </label>
                        <input
                          id={`fix-${item.code}-measure`}
                          type="number"
                          step="0.01"
                          value={r.afterMeasure || ''}
                          onChange={(e) => updateRepair(item.code, 'afterMeasure', e.target.value)}
                          placeholder={`Min ${item.threshold}`}
                          className="input"
                        />
                        {r.afterMeasure && parseFloat(r.afterMeasure) >= item.threshold && (
                          <div className="text-[11px] font-bold text-green-600 mt-1">✓ OK</div>
                        )}
                        {r.afterMeasure && parseFloat(r.afterMeasure) < item.threshold && (
                          <div className="text-[11px] font-bold text-red-600 mt-1">Still low</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Photos
                    </label>
                    <PhotoCapture photos={r.photos || []} onChange={(next) => setPhotos(item.code, next)} />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Note (optional)
                    </label>
                    <textarea
                      rows={2}
                      value={r.note || ''}
                      onChange={(e) => updateRepair(item.code, 'note', e.target.value)}
                      placeholder="Optional repair notes…"
                      className="input resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Labor section — multi-select job order types */}
        {flagged.length > 0 && (
          <div className="rounded-2xl border-2 border-gray-700 overflow-hidden">
            <div className="px-4 py-3 bg-gray-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl shrink-0">👷</div>
              <div className="flex-1">
                <div className="font-black text-white text-base">Job Order / Labor</div>
                <div className="text-gray-300 text-xs mt-0.5">Select labor types performed</div>
              </div>
              {laborCount > 0 && (
                <span className="text-xs font-black bg-white text-gray-800 px-2.5 py-1 rounded-full">
                  {laborCount}
                </span>
              )}
            </div>
            <div className="bg-white">
              {LABOR_TYPES.map((lt) => {
                const checked = !!laborTypes[lt.code]
                return (
                  <div key={lt.code}>
                    <button
                      type="button"
                      onClick={() => setLaborTypes((prev) => ({ ...prev, [lt.code]: !prev[lt.code] }))}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-100 last:border-0 ${checked ? 'bg-gray-50' : ''}`}
                    >
                      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-gray-800 border-gray-800' : 'border-gray-300'}`}>
                        {checked && <span className="text-white text-xs font-black">✓</span>}
                      </div>
                      <span className="text-base shrink-0">{lt.icon}</span>
                      <span className={`text-sm ${checked ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
                        {lt.label}
                      </span>
                    </button>
                    {lt.code === 'LBR_OTHER' && checked && (
                      <div className="px-4 pb-3 pt-1 bg-gray-50">
                        <textarea
                          rows={2}
                          placeholder="Describe labor performed…"
                          value={otherLabor}
                          onChange={(e) => setOtherLabor(e.target.value)}
                          className="input resize-none"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0))' }}
      >
        <div className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3">
          {error && <div className="text-[11px] text-red-700 flex-1 truncate" title={error}>{error}</div>}
          <div className={`text-[11px] flex-1 min-w-0 ${error ? 'hidden' : ''}`}>
            {canSubmit
              ? <span className="text-gray-700"><span className="font-bold">{repairedCount}</span> repair{repairedCount === 1 ? '' : 's'}{skippedCount > 0 ? ` · ${skippedCount} skip` : ''}</span>
              : <span className="text-gray-500">Tap Submit — we'll jump you to anything missing.</span>}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className={`text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow active:scale-95 transition-transform shrink-0 ${
              canSubmit ? 'bg-brand hover:bg-brand-dark' : 'bg-amber-600 hover:bg-amber-700'
            } ${saving ? 'opacity-50' : ''}`}
            title={canSubmit ? '' : 'Some items still need a part replaced or a measurement — click to jump there.'}
          >
            {saving ? 'Submitting…' : 'Submit Quick Fix'}
          </button>
        </div>
      </div>
    </div>
  )
}
