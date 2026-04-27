// Full assessment report — mirrors the mg-fms "result" screen
// (mg-fms-app/src/App.jsx ~1028–1053). Route: /assessments/:rwa
//
// Layout: gradient banner (status) → vehicle & inspection card → classification
// → assessment findings (critical / monitor / replaced) → services completed →
// supervisor override card (if any). Read-only — no re-assess action.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { isClientView } from '../lib/roles'
import { isVisibleToClient, statusBadge } from '../lib/reviewStatus'
import { clearDispatchBySupervisor } from '../lib/assessments'
import { getApprovedQuotationForPlate } from '../lib/serviceReceipts'
import {
  ALL_ITEMS, CATEGORIES, DEFECT_CODES, PMS_ITEMS, SC, ACTION_CFG,
  calcHealthScore, healthColor, getAction,
} from '../lib/mgfms-catalog'

async function fetchAssessmentByRwa(rwa) {
  if (!db || !rwa) return null
  const snap = await getDocs(query(
    collection(db, 'assessments'),
    where('rwaNumber', '==', rwa),
    limit(1),
  ))
  if (snap.empty) return null
  const d = snap.docs[0]
  return { _docId: d.id, ...d.data() }
}

export default function AssessmentView() {
  const { rwa } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const clientView = isClientView(profile)
  const [state, setState] = useState({ loading: true, assessment: null, error: null })
  const [overrideOpen, setOverrideOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAssessmentByRwa(rwa)
      .then((a) => { if (!cancelled) setState({ loading: false, assessment: a, error: null }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, assessment: null, error: err }) })
    return () => { cancelled = true }
  }, [rwa])

  if (state.loading) return <div className="p-4 sm:p-6 text-gray-500">Loading assessment…</div>
  if (!state.assessment) {
    return (
      <div className="p-4 sm:p-6">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">Assessment not found</div>
          <div className="text-xs">
            No assessment in mg-fms with RWA number <span className="font-mono">{rwa}</span>.
            {state.error && <> ({String(state.error.code || state.error.message)})</>}
          </div>
        </div>
      </div>
    )
  }

  // Hide assessments that haven't been forwarded to the client yet — but only
  // for client-view profiles. Internal staff and admins always see everything.
  if (clientView && !isVisibleToClient(state.assessment.review_status)) {
    const badge = statusBadge(state.assessment.review_status)
    return (
      <div className="p-4 sm:p-6">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
          <div className="font-semibold mb-1">Assessment not yet shared</div>
          <div className="text-xs">
            This assessment is still being reviewed and hasn't been forwarded to you yet.
            Status: <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.tone}`}>{badge.label}</span>
          </div>
        </div>
      </div>
    )
  }

  const a = state.assessment
  const cls = a.classification || {}
  const cfg = SC[cls.overallStatus] || SC.active
  const score = calcHealthScore(cls, a.itemResults || {})
  const hc = healthColor(score)

  const isAdmin = Boolean(profile?.is_admin)
  const canOverride = isAdmin && cls.dispatchAllowed === false && !a.supervisorCleared

  const applyOverride = ({ name, ts, remarks }) => {
    // Merge locally so the page shows the green "Supervisor Override Applied"
    // card right away. A re-fetch would add a round-trip for no new data.
    setState((s) => ({
      ...s,
      assessment: {
        ...s.assessment,
        supervisorCleared: true,
        supervisorName: name,
        supervisorTs: ts,
        supervisorRemarks: remarks,
      },
    }))
    setOverrideOpen(false)
  }

  const findings = ALL_ITEMS.filter((i) => {
    const r = a.itemResults?.[i.code]
    return r?.resultCode === 'fail_critical' || r?.resultCode === 'monitor' || r?.resultCode === 'replaced'
  })

  return (
    <div className="pb-20">
      {/* Desktop-only back link — mobile Topbar already provides one */}
      <button
        onClick={() => navigate(-1)}
        className="hidden md:inline-block m-4 text-sm text-gray-500 hover:underline"
      >
        ← Back
      </button>

      {/* ── Gradient status banner ─────────────────────────────────── */}
      <div className={`bg-gradient-to-b ${cfg.grad} text-white px-4 py-6 text-center mx-3 sm:mx-4 rounded-2xl mt-3 md:mt-0`}>
        <div className="text-xs font-bold tracking-widest opacity-60 mb-2">ASSESSMENT RESULT</div>
        <div className="text-2xl font-black mb-1">{cfg.label}</div>
        <div className="text-sm opacity-60 mb-3">{a.rwaNumber}</div>
        <div
          className={`inline-flex items-center gap-2 px-5 py-2 rounded-full font-bold text-sm shadow ${
            cls.dispatchAllowed ? 'bg-green-500 text-white' : 'bg-black/30 text-red-100'
          }`}
        >
          {cls.dispatchAllowed ? '✓ Dispatch Allowed' : '⛔ Unit on Hold — Do NOT Dispatch'}
        </div>
        {cls.reassessmentDue && (
          <div className="mt-2 text-xs opacity-80">
            {cls.overallStatus === 'deferred'
              ? `⏰ Reassessment by ${cls.reassessmentDue}`
              : `📅 Next check by ${cls.reassessmentDue}`}
          </div>
        )}
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-xs">
          <span className="font-bold">Health Score:</span>
          <span className={`font-black ${hc.text} bg-white rounded px-2`}>{score}</span>
        </div>
      </div>

      <div className="px-3 sm:px-4 pt-4 space-y-4">
        {/* ── Post-assessment CTA — internal only. If an APPROVED_FINAL
            quote already exists for this plate (typical after a Re-
            Assessment), point at it with "Proceed to Invoice". Otherwise
            offer to create a fresh quote (typical after Initial /
            Periodic / Pre-Dispatch). */}
        {!clientView && <PostAssessCta a={a} />}

        {/* ── Supervisor override CTA (admins, still-blocked units only) ─ */}
        {canOverride && (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl leading-none">⛔</div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-red-800 text-sm">Dispatch blocked</div>
                <div className="text-xs text-red-700 mt-1">
                  This unit failed one or more critical items. If you've inspected it in person and are
                  authorising its release, stamp an override with a written reason — the audit trail is
                  preserved.
                </div>
                <button
                  type="button"
                  onClick={() => setOverrideOpen(true)}
                  className="mt-3 bg-red-700 hover:bg-red-800 text-white text-xs font-bold px-4 py-2 rounded-full shadow"
                >
                  Supervisor override →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Vehicle & inspection header ─────────────────────────── */}
        <Card>
          <CardTitle>Vehicle & Inspection</CardTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-3">
            {[
              ['Plate', a.header?.plate],
              ['Vehicle', [a.header?.make, a.header?.model, a.header?.yearModel && `(${a.header.yearModel})`].filter(Boolean).join(' ') || '—'],
              ['Client', a.header?.client],
              ['Branch', a.header?.branch],
              ['Technician', a.header?.technician],
              ['Odometer', a.header?.odometer ? `${a.header.odometer} km` : '—'],
              ['Type', a.header?.type],
              ['Date', a.header?.date],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-xs text-gray-400">{k}</div>
                <div className="text-sm font-bold text-gray-800">{v || '—'}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Classification summary ──────────────────────────────── */}
        <Card>
          <CardTitle>Classification</CardTitle>
          <div className="space-y-2 mt-3">
            {[
              { label: 'Technical Status',   value: (cls.technicalStatus || cls.overallStatus || '').toUpperCase(), color: SC[cls.technicalStatus || cls.overallStatus]?.badge },
              { label: 'Compliance',         value: cls.complianceStatus === 'compliant' ? 'COMPLIANT' : 'NON-COMPLIANT', color: cls.complianceStatus === 'compliant' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800' },
              { label: 'Dispatch Allowed',   value: cls.dispatchAllowed ? 'YES' : 'NO', color: cls.dispatchAllowed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800' },
              { label: 'Critical Items',     value: String(cls.failCriticalCount || 0), color: cls.failCriticalCount > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600' },
              { label: 'Monitors',           value: String(cls.monitorCount || 0), color: cls.monitorCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600' },
              { label: 'Dispatch Blockers',  value: String(cls.totalBlockerCount || 0), color: cls.totalBlockerCount > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600' },
              { label: 'Reassessment Due',   value: cls.reassessmentDue || 'None', color: cls.reassessmentDue ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600' },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{r.label}</span>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${r.color || 'bg-gray-100 text-gray-600'}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Assessment findings ────────────────────────────────── */}
        {findings.length === 0 ? (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-black text-green-700 text-lg">All Items Passed</div>
            <div className="text-green-600 text-sm mt-1">Vehicle is roadworthy and cleared for dispatch</div>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-gray-200 overflow-hidden bg-white">
            <div className="bg-gray-800 px-4 py-3">
              <div className="font-black text-white text-sm">Assessment Findings ({findings.length})</div>
            </div>
            {findings.map((item) => {
              const r = a.itemResults?.[item.code] || {}
              const isResolved = r.resultCode === 'replaced'
              const isCrit = r.resultCode === 'fail_critical'
              const isMon = r.resultCode === 'monitor'
              return (
                <div
                  key={item.code}
                  className={`border-b border-gray-100 last:border-0 ${isResolved ? 'bg-green-50' : isCrit ? 'bg-red-50' : 'bg-amber-50'}`}
                >
                  <div className="px-4 py-3 flex items-start gap-3">
                    <div className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg ${
                      isResolved ? 'bg-blue-600 text-white'
                      : isCrit ? 'bg-red-600 text-white'
                      : 'bg-amber-500 text-white'
                    }`}>
                      {isResolved ? 'FIXED' : isCrit ? 'CRIT' : 'MON'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold text-sm ${isResolved ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{item.label}</div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {r.defectCode && (
                          <span className={`text-xs font-semibold ${isResolved ? 'text-gray-400' : isCrit ? 'text-red-600' : 'text-amber-600'}`}>
                            {DEFECT_CODES[r.defectCode] || r.defectCode}
                          </span>
                        )}
                        {r.measuredValue !== undefined && r.measuredValue !== '' && (
                          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isResolved ? 'bg-gray-100 text-gray-400' : 'bg-red-100 text-red-700'}`}>
                            {r.measuredValue}{item.unit || ''}
                            {item.threshold ? ` / min ${item.threshold}${item.unit || ''}` : ''}
                          </span>
                        )}
                        {r.partReplaced && (
                          <span className="text-xs text-blue-700 font-semibold">🔩 {r.partQty > 1 ? `${r.partQty}× ` : ''}{r.partReplaced}</span>
                        )}
                      </div>
                      {r.note && <div className="text-xs text-gray-500 italic mt-1">"{r.note}"</div>}
                      {!isResolved && (
                        <div className={`text-[11px] font-semibold mt-1 ${isCrit ? 'text-red-700' : 'text-amber-700'}`}>
                          {ACTION_CFG[getAction(item, r.resultCode)]?.label || ''}
                        </div>
                      )}
                    </div>
                    {!isResolved && (
                      <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-full ${isCrit ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>⚠ OPEN</span>
                    )}
                    {isResolved && (
                      <span className="shrink-0 text-xs font-black px-2.5 py-1 rounded-full bg-green-100 text-green-700">✓ FIXED</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Full inspection item breakdown (collapsed by category) ─ */}
        <InspectionBreakdown itemResults={a.itemResults || {}} />

        {/* ── PMS services performed this visit ──────────────────── */}
        {a.pmsData?.updates && Object.keys(a.pmsData.updates).length > 0 && (
          <Card>
            <CardTitle>🔧 Services Completed This Visit</CardTitle>
            <div className="space-y-2 mt-3">
              {Object.entries(a.pmsData.updates).map(([code, upd]) => {
                const p = PMS_ITEMS.find((x) => x.code === code)
                const detail = a.pmsData.serviceDetails?.[code]
                return (
                  <div key={code} className="bg-white rounded-xl p-3 border border-green-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{p?.icon || '🔧'}</span>
                        <span className="text-sm font-semibold text-gray-800">{p?.label || code}</span>
                      </div>
                      {upd?.nextOdo && (
                        <div className="text-right">
                          <div className="text-xs font-bold text-green-700">Next: {Number(upd.nextOdo).toLocaleString()} km</div>
                          <div className="text-xs text-gray-400">{upd.nextDate}</div>
                        </div>
                      )}
                    </div>
                    {detail?.brand && (
                      <div className="text-xs text-blue-700 font-semibold mt-1">
                        🔩 {detail.qty > 1 ? `${detail.qty}× ` : ''}{detail.brand}
                      </div>
                    )}
                    {detail?.photos?.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {detail.photos.map((src, i) => (
                          <img key={i} src={src} className="w-14 h-14 rounded-lg object-cover border border-gray-200" alt={`Photo ${i + 1}`} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* ── Supervisor override ─────────────────────────────────── */}
        {a.supervisorCleared && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4">
            <div className="font-black text-blue-700 text-sm mb-1">👤 Supervisor Override Applied</div>
            <div className="text-xs text-blue-600">Cleared by: {a.supervisorName}</div>
            {a.supervisorTs && <div className="text-xs text-gray-400">{new Date(a.supervisorTs).toLocaleString('en-PH')}</div>}
            {a.supervisorRemarks && <div className="text-xs text-gray-600 mt-1 italic">"{a.supervisorRemarks}"</div>}
          </div>
        )}

        {a.resolvedByRwa && (
          <div className="bg-green-600 text-white rounded-2xl p-4 flex items-start gap-3">
            <div className="text-3xl">✅</div>
            <div className="flex-1">
              <div className="font-black text-base">This Assessment Has Been Resolved</div>
              <div className="text-green-100 text-xs mt-1">
                Superseded by <span className="font-mono font-bold">{a.resolvedByRwa}</span>
                {a.resolvedAt && ` on ${new Date(a.resolvedAt).toLocaleDateString('en-PH')}`}.
              </div>
              <button
                onClick={() => navigate(`/assessments/${a.resolvedByRwa}`)}
                className="mt-2 bg-white text-green-700 text-xs font-bold px-3 py-1 rounded-full"
              >
                View Resolving RWA →
              </button>
            </div>
          </div>
        )}
      </div>

      {overrideOpen && (
        <OverrideModal
          assessment={a}
          profile={profile}
          onClose={() => setOverrideOpen(false)}
          onSaved={applyOverride}
        />
      )}
    </div>
  )
}

// Supervisor override modal — required reason, confirm button, disables itself
// while the write is in flight so a double-tap can't create two audit rows.
function OverrideModal({ assessment, profile, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const displayName = profile?.user_fullname || profile?.user_name || profile?.name || 'Supervisor'

  const submit = async () => {
    if (saving) return
    const trimmed = reason.trim()
    if (!trimmed) { setError('Please state a reason before confirming.'); return }
    setSaving(true); setError(null)
    try {
      const { at } = await clearDispatchBySupervisor(assessment._docId, { name: displayName, remarks: trimmed })
      onSaved({ name: displayName, ts: at, remarks: trimmed })
    } catch (err) {
      console.error('[override] failed:', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:w-[480px] sm:max-w-full rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-bold text-gray-900">Supervisor override</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none w-8 h-8 flex items-center justify-center" aria-label="Close">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-auto">
          <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-3 py-2">
            Releasing <span className="font-mono font-bold">{assessment.rwaNumber}</span> — {assessment.header?.plate}.
            The classification stays "dispatch blocked" for audit; this override adds a clearance record on top.
          </div>
          <div>
            <label className="text-[11px] font-bold text-gray-600 tracking-widest uppercase">Reason for clearance</label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Re-inspected in person; brakes are within spec after on-site bleed. Releasing for client pickup."
              className="input mt-1"
              disabled={saving}
            />
          </div>
          <div className="text-[11px] text-gray-500">
            Signed as <span className="font-semibold text-gray-700">{displayName}</span>. Internal notification only —
            the fleet client is not pinged on manual clearances.
          </div>
          {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">Save failed: {error}</div>}
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-50 px-3 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !reason.trim()}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-full shadow"
          >
            {saving ? 'Clearing…' : 'Confirm override'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Card({ children }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">{children}</div>
}
function CardTitle({ children }) {
  return <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">{children}</div>
}

// Full breakdown of every inspection item, grouped by category — expandable.
function InspectionBreakdown({ itemResults }) {
  const [openCat, setOpenCat] = useState(null)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <CardTitle>Full Inspection Breakdown</CardTitle>
      </div>
      {CATEGORIES.map((cat) => {
        const count = cat.items.length
        const answered = cat.items.filter((i) => itemResults[i.code]?.resultCode).length
        const fails = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'fail_critical').length
        const mons = cat.items.filter((i) => itemResults[i.code]?.resultCode === 'monitor').length
        const isOpen = openCat === cat.code
        return (
          <div key={cat.code} className="border-b border-gray-100 last:border-0">
            <button
              onClick={() => setOpenCat(isOpen ? null : cat.code)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{cat.icon}</span>
                <span className="text-sm font-semibold text-gray-800">{cat.label}</span>
                <span className="text-xs text-gray-400">({answered}/{count})</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {fails > 0 && <span className="text-red-600 font-bold">🚨 {fails}</span>}
                {mons > 0 && <span className="text-amber-600 font-bold">⚠️ {mons}</span>}
                <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-3 pt-1 space-y-1">
                {cat.items.map((item) => {
                  const r = itemResults[item.code] || {}
                  const rc = r.resultCode || 'na'
                  const label = rc === 'pass' ? 'Pass' : rc === 'monitor' ? 'Monitor' : rc === 'fail_critical' ? 'Critical' : rc === 'replaced' ? 'Replaced' : 'N/A'
                  const tone =
                    rc === 'pass' ? 'text-green-700'
                    : rc === 'monitor' ? 'text-amber-700'
                    : rc === 'fail_critical' ? 'text-red-700'
                    : rc === 'replaced' ? 'text-blue-700'
                    : 'text-gray-400'
                  return (
                    <div key={item.code} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-gray-700 flex-1 pr-2">{item.label}</span>
                      <span className={`font-semibold ${tone}`}>
                        {label}
                        {r.measuredValue !== undefined && r.measuredValue !== '' && ` · ${r.measuredValue}${item.unit || ''}`}
                        {r.defectCode && ` · ${DEFECT_CODES[r.defectCode] || r.defectCode}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Post-assessment CTA — switches between "Create Quotation" and
// "Proceed to Invoice" based on whether the plate already has an
// APPROVED_FINAL quote. After a Re-Assessment that closes the loop,
// the user shouldn't be prompted to create a NEW quote; they should
// be sent back to the existing quote so they can issue the invoice.
function PostAssessCta({ a }) {
  const plate = a?.header?.plate || ''
  const [state, setState] = useState({ loading: true, approved: null })
  useEffect(() => {
    if (!plate) { setState({ loading: false, approved: null }); return }
    let cancelled = false
    getApprovedQuotationForPlate(plate).then((quot) => {
      if (!cancelled) setState({ loading: false, approved: quot })
    }).catch(() => {
      if (!cancelled) setState({ loading: false, approved: null })
    })
    return () => { cancelled = true }
  }, [plate])

  if (state.loading) {
    return (
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-4 text-sm text-gray-500">
        Checking for an existing approved quote…
      </div>
    )
  }

  // Existing approved quote → proceed to invoice path.
  if (state.approved) {
    return (
      <div className="bg-white border-2 border-emerald-300 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">🧾</div>
          <div className="flex-1 min-w-0">
            <div className="font-black text-gray-900 text-sm">Approved quote on file — proceed to invoice</div>
            <div className="text-xs text-gray-600 mt-1">
              <span className="font-mono font-bold">{state.approved.code}</span> is already approved for {plate}.
              The quote detail page is where the branch invoice is issued.
            </div>
            <Link
              to={`/service-receipts/${state.approved.code}`}
              className="inline-block mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-full shadow"
            >
              Proceed to Invoice →
            </Link>
            <div className="mt-2 text-[11px] text-gray-500">
              The reassessment gate now sees this RWA — the "Generate Branch Invoice" button on the quote should be unlocked.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // No approved quote yet → first-time quote creation.
  return (
    <div className="bg-white border-2 border-brand/30 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none">📝</div>
        <div className="flex-1 min-w-0">
          <div className="font-black text-gray-900 text-sm">Ready to quote</div>
          <div className="text-xs text-gray-600 mt-1">
            Assessment is in. Build the quotation from these findings to start the approval chain.
          </div>
          <Link
            to={`/quotations/create?plate=${encodeURIComponent(plate)}&fromAssessment=${encodeURIComponent(a.rwaNumber || '')}`}
            className="inline-block mt-3 bg-brand hover:bg-brand-dark text-white text-xs font-bold px-4 py-2 rounded-full shadow"
          >
            Create Quotation →
          </Link>
          <div className="mt-2 text-[11px] text-gray-500">
            Lines will be prefilled from this assessment's critical findings — review and set unit costs.
          </div>
        </div>
      </div>
    </div>
  )
}
