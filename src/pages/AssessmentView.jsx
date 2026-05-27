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
import Icon from '../components/ui/Icon'
import {
  ALL_ITEMS, CATEGORIES, DEFECT_CODES, PMS_ITEMS, SC, ACTION_CFG,
  calcHealthScore, healthColor, getAction,
  daysUntilDue, kmUntilDue, pmsUrgency,
} from '../lib/mgfms-catalog'
import { loadPmsRecord, resolveCanonicalPlate } from '../lib/pms'

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
  const [clientCanView, setClientCanView] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [vehiclePMS, setVehiclePMS] = useState({})

  useEffect(() => {
    let cancelled = false
    fetchAssessmentByRwa(rwa)
      .then((a) => { if (!cancelled) setState({ loading: false, assessment: a, error: null }) })
      .catch((err) => { if (!cancelled) setState({ loading: false, assessment: null, error: err }) })
    return () => { cancelled = true }
  }, [rwa])

  // Fetch vehicle PMS records once assessment loads
  useEffect(() => {
    const plate = state.assessment?.header?.plate
    if (!plate) return
    let cancelled = false
    resolveCanonicalPlate(plate)
      .then((canonical) => loadPmsRecord(canonical))
      .then((rec) => { if (!cancelled) setVehiclePMS(rec) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [state.assessment?.header?.plate])

  // Check if fleet client can view this assessment
  useEffect(() => {
    if (!clientView) { setClientCanView(true); return }
    const a = state.assessment
    if (!a) return
    if (isVisibleToClient(a.review_status)) { setClientCanView(true); return }
    // Check if a quotation for this plate has been forwarded to client
    const plate = a.header?.plate
    if (!plate) return
    const CLIENT_VISIBLE_STATUSES = new Set(['FOR_CLIENT_REVIEW', 'CLIENT_CLARIFICATION', 'CLIENT_REJECTED', 'APPROVED_FINAL'])
    getDocs(query(collection(db, 'serviceReceipts'), where('kind', '==', 'quotation'), where('plateNo', '==', plate.toUpperCase().replace(/\s+/g, ''))))
      .then((snap) => {
        for (const d of snap.docs) {
          if (CLIENT_VISIBLE_STATUSES.has(d.data()?.status)) {
            setClientCanView(true)
            return
          }
        }
      })
      .catch(() => {})
  }, [clientView, state.assessment])

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

  if (clientView && !clientCanView) {
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
  const isFleetMgr = String(profile?.role || '').toLowerCase() === 'general_manager'
  const showBlocked = cls.dispatchAllowed === false && !a.supervisorCleared
  const canOverride = isAdmin && !isFleetMgr && showBlocked

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

  const exportPdf = async () => {
    try {
    const jsPDFModule = await import('jspdf')
    const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF
    const autoTableModule = await import('jspdf-autotable')
    const autoTableFn = autoTableModule.default || autoTableModule
    const pdf = new jsPDF('p', 'mm', 'a4')
    const table = (opts) => { autoTableFn(pdf, opts); return pdf.lastAutoTable }
    const w = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    let y = 15

    // Helper: load image URL as base64 data URL for embedding in PDF.
    // Returns { dataUrl, width, height } or null on failure.
    const loadImage = (src) => new Promise((resolve) => {
      if (!src) { resolve(null); return }
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d').drawImage(img, 0, 0)
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.7), width: img.naturalWidth, height: img.naturalHeight })
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = src
    })

    // Helper: add a row of photos to the PDF. Mutates `y` in the outer scope.
    const addPhotos = async (photos, label) => {
      if (!photos || photos.length === 0) return
      const imgW = 40 // mm per photo
      const imgH = 30
      const gap = 4
      const cols = Math.floor((w - 28) / (imgW + gap))
      if (y > pageH - 50) { pdf.addPage(); y = 15 }
      pdf.setFontSize(8)
      pdf.setFont(undefined, 'bold')
      pdf.text(label, 14, y)
      y += 4
      let col = 0
      for (const src of photos) {
        const img = await loadImage(src)
        if (!img) continue
        if (col >= cols) { col = 0; y += imgH + gap }
        if (y + imgH > pageH - 15) { pdf.addPage(); y = 15 }
        const x = 14 + col * (imgW + gap)
        pdf.addImage(img.dataUrl, 'JPEG', x, y, imgW, imgH)
        col++
      }
      y += imgH + gap
    }

    // Title
    pdf.setFontSize(16)
    pdf.setFont(undefined, 'bold')
    pdf.text('Vehicle Roadworthiness Assessment', w / 2, y, { align: 'center' })
    y += 8
    pdf.setFontSize(10)
    pdf.setFont(undefined, 'normal')
    pdf.text(a.rwaNumber || '', w / 2, y, { align: 'center' })
    y += 10

    // Status
    pdf.setFontSize(12)
    pdf.setFont(undefined, 'bold')
    const statusText = (cls.overallStatus || '').toUpperCase()
    pdf.text(`Status: ${statusText}`, 14, y)
    pdf.text(`Health Score: ${score}/100`, w - 14, y, { align: 'right' })
    y += 6
    pdf.setFontSize(9)
    pdf.setFont(undefined, 'normal')
    pdf.text(cls.dispatchAllowed ? 'Dispatch Allowed' : 'Unit on Hold — Do NOT Dispatch', 14, y)
    y += 8

    // Vehicle info table
    table({
      startY: y,
      head: [['Field', 'Value']],
      body: [
        ['Plate', a.header?.plate || '—'],
        ['Vehicle', [a.header?.make, a.header?.model, a.header?.yearModel].filter(Boolean).join(' ') || '—'],
        ['Client', a.header?.client || '—'],
        ['Branch', a.header?.branch || '—'],
        ['Technician', a.header?.technician || '—'],
        ['Odometer', a.header?.odometer ? `${a.header.odometer} km` : '—'],
        ['Type', a.header?.type || '—'],
        ['Date', a.header?.date || '—'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 81], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35 } },
      margin: { left: 14, right: 14 },
    })
    y = (pdf.lastAutoTable?.finalY || y) + 8

    // Classification
    table({
      startY: y,
      head: [['Classification', 'Value']],
      body: [
        ['Technical Status', (cls.technicalStatus || cls.overallStatus || '').toUpperCase()],
        ['Compliance', cls.complianceStatus === 'compliant' ? 'COMPLIANT' : 'NON-COMPLIANT'],
        ['Dispatch Allowed', cls.dispatchAllowed ? 'YES' : 'NO'],
        ['Critical Items', String(cls.failCriticalCount || 0)],
        ['Monitors', String(cls.monitorCount || 0)],
        ['Dispatch Blockers', String(cls.totalBlockerCount || 0)],
        ['Reassessment Due', cls.reassessmentDue || 'None'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 81], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } },
      margin: { left: 14, right: 14 },
    })
    y = (pdf.lastAutoTable?.finalY || y) + 8

    // Findings
    if (findings.length > 0) {
      pdf.setFontSize(10)
      pdf.setFont(undefined, 'bold')
      pdf.text(`Assessment Findings (${findings.length})`, 14, y)
      y += 5

      const findingsData = findings.map((item) => {
        const r = a.itemResults?.[item.code] || {}
        const rc = r.resultCode || 'na'
        const status = rc === 'fail_critical' ? 'CRITICAL' : rc === 'monitor' ? 'MONITOR' : rc === 'replaced' ? 'FIXED' : rc.toUpperCase()
        const defect = r.defectCode ? (DEFECT_CODES[r.defectCode] || r.defectCode) : ''
        const measured = r.measuredValue !== undefined && r.measuredValue !== '' ? `${r.measuredValue}${item.unit || ''}` : ''
        const note = r.note || ''
        return [item.label, status, defect, measured, note]
      })

      table({
        startY: y,
        head: [['Item', 'Status', 'Defect', 'Measured', 'Note']],
        body: findingsData,
        theme: 'grid',
        headStyles: { fillColor: [185, 28, 28], fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 40 },
        },
        margin: { left: 14, right: 14 },
      })
      y = (pdf.lastAutoTable?.finalY || y) + 8

      // Photos for each finding
      for (const item of findings) {
        const r = a.itemResults?.[item.code] || {}
        const imgs = Array.isArray(r.photos) ? r.photos
          : r.photo ? (Array.isArray(r.photo) ? r.photo : [r.photo])
          : r.image ? (Array.isArray(r.image) ? r.image : [r.image])
          : []
        if (imgs.length > 0) {
          await addPhotos(imgs, `${item.label} ${r.resultCode === 'replaced' ? '(Before / After)' : ''}`)
        }
      }
    }

    // ECU Scanning
    if (a.ecuScan) {
      pdf.setFontSize(10)
      pdf.setFont(undefined, 'bold')
      if (y > 260) { pdf.addPage(); y = 15 }
      pdf.text('ECU Scanning', 14, y)
      y += 5
      if (a.ecuScan.noCodes) {
        table({
          startY: y,
          body: [['No trouble codes detected']],
          theme: 'grid',
          bodyStyles: { fontSize: 8, fontStyle: 'bold', textColor: [22, 101, 52] },
          margin: { left: 14, right: 14 },
        })
      } else if (a.ecuScan.codes?.length > 0) {
        table({
          startY: y,
          head: [['DTC Code', 'Description']],
          body: a.ecuScan.codes.map((c) => [c.code || '', c.description || '—']),
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
          margin: { left: 14, right: 14 },
        })
      }
      y = (pdf.lastAutoTable?.finalY || y) + 4
      if (a.ecuScan.notes) {
        pdf.setFontSize(8)
        pdf.setFont(undefined, 'italic')
        pdf.text(`Notes: ${a.ecuScan.notes}`, 14, y)
        y += 6
      }
      // ECU scan report photos
      if (Array.isArray(a.ecuScan.photos) && a.ecuScan.photos.length > 0) {
        await addPhotos(a.ecuScan.photos, 'ECU Scan Report Photos')
      }
      y += 4
    }

    // Full inspection breakdown
    const breakdownData = []
    for (const cat of CATEGORIES) {
      const items = ALL_ITEMS.filter((i) => i.category === cat.key)
      for (const item of items) {
        const r = a.itemResults?.[item.code] || {}
        const rc = r.resultCode
        if (!rc) continue
        const label = rc === 'pass' ? 'Pass' : rc === 'monitor' ? 'Monitor' : rc === 'fail_critical' ? 'Critical' : rc === 'replaced' ? 'Replaced' : 'N/A'
        breakdownData.push([cat.label, item.label, label])
      }
    }
    if (breakdownData.length > 0) {
      pdf.setFontSize(10)
      pdf.setFont(undefined, 'bold')
      if (y > 260) { pdf.addPage(); y = 15 }
      pdf.text('Full Inspection Breakdown', 14, y)
      y += 5
      table({
        startY: y,
        head: [['Category', 'Item', 'Result']],
        body: breakdownData,
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        columnStyles: { 0: { cellWidth: 30 }, 2: { cellWidth: 20, halign: 'center' } },
        margin: { left: 14, right: 14 },
      })
    }

    // Footer
    const pageCount = pdf.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i)
      pdf.setFontSize(7)
      pdf.setFont(undefined, 'normal')
      pdf.text(`MG Fleet Portal — ${a.rwaNumber} — Page ${i} of ${pageCount}`, w / 2, pdf.internal.pageSize.getHeight() - 8, { align: 'center' })
    }

    pdf.save(`${a.rwaNumber || 'assessment'}.pdf`)
    } catch (err) {
      console.error('[exportPdf] failed:', err)
      alert('PDF export failed: ' + (err.message || err))
    }
  }

  return (
    <div className="pb-20">
      {/* Back link */}
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
        {showBlocked && (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl leading-none">⛔</div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-red-800 text-sm">Dispatch blocked</div>
                <div className="text-xs text-red-700 mt-1">
                  This unit failed one or more critical items.{canOverride ? ' If you\'ve inspected it in person and are authorising its release, stamp an override with a written reason — the audit trail is preserved.' : ''}
                </div>
                {canOverride && (
                  <button
                    type="button"
                    onClick={() => setOverrideOpen(true)}
                    className="mt-3 bg-red-700 hover:bg-red-800 text-white text-xs font-bold px-4 py-2 rounded-full shadow"
                  >
                    Supervisor override →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Photo gallery — all photos from the assessment ───────── */}
        {(() => {
          const allPhotos = []
          const collectPhotos = (obj, label) => {
            if (!obj) return
            const srcs = Array.isArray(obj.photos) ? obj.photos
              : obj.photo ? (Array.isArray(obj.photo) ? obj.photo : [obj.photo])
              : obj.image ? (Array.isArray(obj.image) ? obj.image : [obj.image])
              : []
            srcs.forEach((src) => { if (src) allPhotos.push({ src, label }) })
          }

          // 1. itemResults
          for (const [code, r] of Object.entries(a.itemResults || {})) {
            const item = ALL_ITEMS.find((i) => i.code === code)
            collectPhotos(r, item?.label || code)
          }
          // 2. adjustedResults
          for (const [code, r] of Object.entries(a.adjustedResults || {})) {
            const item = ALL_ITEMS.find((i) => i.code === code)
            collectPhotos(r, `${item?.label || code} (adjusted)`)
          }
          // 3. pmsData.serviceDetails
          if (a.pmsData?.serviceDetails) {
            for (const [code, detail] of Object.entries(a.pmsData.serviceDetails)) {
              collectPhotos(detail, `PMS: ${code}`)
            }
          }
          // 4. pmsData.updates
          if (a.pmsData?.updates) {
            for (const [code, upd] of Object.entries(a.pmsData.updates)) {
              collectPhotos(upd, `PMS: ${code}`)
            }
          }
          // 5. ecuScan (new top-level field)
          if (Array.isArray(a.ecuScan?.photos)) {
            a.ecuScan.photos.forEach((src) => { if (src) allPhotos.push({ src, label: 'ECU Scan' }) })
          }
          // 6. pmsData.ecuData (legacy)
          if (a.pmsData?.ecuData) {
            collectPhotos(a.pmsData.ecuData, 'ECU Scan')
            // Trouble codes with individual photos
            if (Array.isArray(a.pmsData.ecuData.codes)) {
              a.pmsData.ecuData.codes.forEach((c) => {
                if (c.photo) allPhotos.push({ src: c.photo, label: `ECU: ${c.code || 'Code'}` })
              })
            }
          }

          if (allPhotos.length === 0) return null
          return (
            <Card>
              <CardTitle>Photos ({allPhotos.length})</CardTitle>
              <div className="flex gap-2 mt-3 flex-wrap">
                {allPhotos.map((p, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={p.src}
                      className="w-20 h-20 rounded-lg object-cover border border-gray-200 cursor-pointer hover:opacity-80"
                      alt={p.label}
                      onClick={() => setLightboxSrc(p.src)}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-bold px-1 py-0.5 rounded-b-lg truncate">
                      {p.label}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )
        })()}

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
                      {(() => {
                        const imgs = Array.isArray(r.photos) ? r.photos
                          : r.photo ? (Array.isArray(r.photo) ? r.photo : [r.photo])
                          : r.image ? (Array.isArray(r.image) ? r.image : [r.image])
                          : []
                        if (imgs.length === 0) return null
                        // Fixed items: show before/after side-by-side comparison
                        if (isResolved && imgs.length >= 2) {
                          return (
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <div>
                                <div className="text-[9px] font-bold text-red-600 uppercase tracking-wider mb-1">Before</div>
                                <img src={imgs[0]} className="w-full h-28 rounded-lg object-cover border-2 border-red-200 cursor-pointer hover:shadow-md transition-shadow" alt="Before" onClick={() => setLightboxSrc(imgs[0])} />
                              </div>
                              <div>
                                <div className="text-[9px] font-bold text-green-600 uppercase tracking-wider mb-1">After</div>
                                <img src={imgs[imgs.length - 1]} className="w-full h-28 rounded-lg object-cover border-2 border-green-200 cursor-pointer hover:shadow-md transition-shadow" alt="After" onClick={() => setLightboxSrc(imgs[imgs.length - 1])} />
                              </div>
                              {imgs.length > 2 && (
                                <div className="col-span-2 flex gap-1.5">
                                  {imgs.slice(1, -1).map((src, i) => (
                                    <div key={i}>
                                      <div className="text-[9px] font-bold text-blue-600 uppercase tracking-wider mb-1">New Part</div>
                                      <img src={src} className="w-20 h-20 rounded-lg object-cover border-2 border-blue-200 cursor-pointer hover:shadow-md transition-shadow" alt={`New part ${i + 1}`} onClick={() => setLightboxSrc(src)} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        }
                        return (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {imgs.map((src, i) => (
                              <img key={i} src={src} className="w-20 h-20 rounded-lg object-cover border border-gray-200 cursor-pointer hover:shadow-md transition-shadow" alt={`Photo ${i + 1}`} onClick={() => setLightboxSrc(src)} />
                            ))}
                          </div>
                        )
                      })()}
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

        {/* ── ECU Scanning results ─────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                  <path d="M9 3H4a1 1 0 00-1 1v5a1 1 0 001 1h1v4H4a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1v-1h4v1a1 1 0 001 1h5a1 1 0 001-1v-5a1 1 0 00-1-1h-1v-4h1a1 1 0 001-1V4a1 1 0 00-1-1h-5a1 1 0 00-1 1v1h-4V4a1 1 0 00-1-1zm1 3V5h4v1a1 1 0 001 1h1v4h-1a1 1 0 00-1 1v1h-4v-1a1 1 0 00-1-1H8V7h1a1 1 0 001-1z"/>
                </svg>
              </div>
              <CardTitle>ECU Scanning</CardTitle>
            </div>
            {a.ecuScan ? (
              a.ecuScan.noCodes ? (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-800">No Codes</span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-800">
                  {a.ecuScan.codes?.length || 0} DTC{(a.ecuScan.codes?.length || 0) !== 1 ? 's' : ''}
                </span>
              )
            ) : (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">Not scanned</span>
            )}
          </div>

          {!a.ecuScan && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-500 text-center">
              No ECU scan data — assessed before ECU scanning was required.
            </div>
          )}

          {a.ecuScan?.noCodes && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-800 font-semibold text-center">
              No trouble codes detected
            </div>
          )}

          {Array.isArray(a.ecuScan?.codes) && a.ecuScan.codes.length > 0 && (
            <div className="mt-3 space-y-2">
              {a.ecuScan.codes.map((c, i) => (
                <div key={i} className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-3">
                  <span className="font-mono font-black text-red-700 text-sm shrink-0">{c.code}</span>
                  <span className="text-sm text-gray-700 flex-1">{c.description || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(a.ecuScan?.photos) && a.ecuScan.photos.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Scan Report Photos</div>
              <div className="flex gap-2 flex-wrap">
                {a.ecuScan.photos.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    className="w-20 h-20 rounded-lg object-cover border border-gray-200 cursor-pointer hover:shadow-md transition-shadow"
                    alt={`ECU scan ${i + 1}`}
                    onClick={() => setLightboxSrc(src)}
                  />
                ))}
              </div>
            </div>
          )}

          {a.ecuScan?.notes && (
            <div className="mt-3">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Scan Notes</div>
              <div className="text-sm text-gray-700 italic">"{a.ecuScan.notes}"</div>
            </div>
          )}
        </Card>

        {/* ── PMS Schedule — vehicle-wide maintenance status ────────── */}
        {a.rwaNumber === 'RWA-SEED-LCV2906' && Object.keys(vehiclePMS).length > 0 && (
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>🗓 PMS Schedule</CardTitle>
              <span className="text-[10px] text-gray-400">
                Odometer: {Number(a.header?.odometer || 0).toLocaleString()} km
              </span>
            </div>
            <div className="space-y-2 mt-3">
              {PMS_ITEMS.map((item) => {
                const rec = vehiclePMS[item.code]
                if (!rec) return null
                const currentOdo = parseInt(a.header?.odometer, 10) || 0
                const days = daysUntilDue(rec.nextDate)
                const km = kmUntilDue(rec.nextOdo, currentOdo)
                const status = pmsUrgency(days, km)
                return (
                  <div key={item.code} className={`rounded-xl p-3 border ${status.bg}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-lg shrink-0">{item.icon}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-gray-800 text-sm">{item.label}</div>
                          <div className="text-[11px] text-gray-400">
                            Last: {rec.lastDate} @ {Number(rec.lastOdo).toLocaleString()} km
                          </div>
                          {rec.performedBy && (
                            <div className="text-[11px] text-gray-400">By: {rec.performedBy}</div>
                          )}
                          {rec.brand && (
                            <div className="text-[11px] text-green-700 font-semibold mt-0.5">
                              {rec.qty > 1 ? `${rec.qty}× ` : ''}{rec.brand}
                            </div>
                          )}
                          {rec.photos?.length > 0 && (
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                              {rec.photos.map((src, i) => (
                                <img
                                  key={i}
                                  src={src}
                                  className="w-12 h-12 rounded-lg object-cover border border-gray-200 cursor-pointer hover:shadow-md transition-shadow"
                                  alt={`${item.label} photo ${i + 1}`}
                                  onClick={() => setLightboxSrc(src)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                          {status.label}
                        </span>
                        <div className={`text-[11px] font-bold mt-1 ${status.color}`}>
                          {km < 0
                            ? `${Math.abs(km).toLocaleString()} km overdue`
                            : km === Infinity ? '' : `${km.toLocaleString()} km left`}
                        </div>
                        <div className={`text-[11px] ${status.color}`}>
                          {days < 0
                            ? `${Math.abs(days)}d overdue`
                            : days === Infinity ? '' : `by ${rec.nextDate}`}
                        </div>
                      </div>
                    </div>
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

      {/* Photo lightbox */}
      {/* Export PDF button */}
      <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
        <button
          onClick={exportPdf}
          className="bg-brand hover:bg-brand-dark text-white px-4 sm:px-5 py-3 rounded-full font-bold text-sm flex items-center gap-2 shadow-xl"
        >
          <Icon name="doc" className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 text-white rounded-full text-2xl font-bold flex items-center justify-center z-50"
          >
            ✕
          </button>
          <img
            src={lightboxSrc}
            className="max-w-full max-h-full object-contain rounded-lg"
            alt="Full view"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
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
                    <div key={item.code} className="py-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 flex-1 pr-2">{item.label}</span>
                        <span className={`font-semibold ${tone}`}>
                          {label}
                          {r.measuredValue !== undefined && r.measuredValue !== '' && ` · ${r.measuredValue}${item.unit || ''}`}
                          {r.defectCode && ` · ${DEFECT_CODES[r.defectCode] || r.defectCode}`}
                        </span>
                      </div>
                      {r.note && (
                        <div className="text-[11px] text-gray-500 italic mt-0.5 pl-1">"{r.note}"</div>
                      )}
                      {(() => {
                        const imgs = Array.isArray(r.photos) ? r.photos : r.photo ? (Array.isArray(r.photo) ? r.photo : [r.photo]) : r.image ? (Array.isArray(r.image) ? r.image : [r.image]) : []
                        if (imgs.length === 0) return null
                        return (
                          <div className="flex gap-1.5 mt-1.5 flex-wrap pl-1">
                            {imgs.map((src, i) => (
                              <img key={i} src={src} className="w-20 h-20 rounded-lg object-cover border border-gray-200 cursor-pointer hover:shadow-md transition-shadow" alt={`Photo ${i + 1}`} onClick={() => setLightboxSrc(src)} />
                            ))}
                          </div>
                        )
                      })()}
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
  const { profile } = useAuth()
  const role = String(profile?.role || '').toLowerCase()
  const isWarrior = ['field_assessor', 'warrior', 'dispatcher', 'technician'].includes(role)
  const isFleetMgr = role === 'general_manager'
  const cannotCreateQuote = isWarrior || isFleetMgr

  const plate = a?.header?.plate || ''
  const isReAssessment = a?.header?.type === 'Re-Assessment'
  const assessmentDate = a?.submittedAt ? new Date(a.submittedAt).getTime() : 0
  const [state, setState] = useState({ loading: true, approved: null })
  useEffect(() => {
    if (!plate) { setState({ loading: false, approved: null }); return }
    let cancelled = false
    getApprovedQuotationForPlate(plate).then((quot) => {
      if (!cancelled) {
        // Re-Assessments always show the approved quotation (they follow
        // the approval flow — the quotation is from the same booking).
        // Initial/Periodic assessments only show quotations created after
        // the assessment — older ones belong to a previous booking.
        if (quot && assessmentDate && !isReAssessment) {
          const quotDate = Date.parse(
            quot.updatedAt?.toDate?.()?.toISOString?.() || quot.updatedAt || quot.createdAt || ''
          ) || 0
          if (quotDate < assessmentDate) {
            setState({ loading: false, approved: null })
            return
          }
        }
        setState({ loading: false, approved: quot })
      }
    }).catch(() => {
      if (!cancelled) setState({ loading: false, approved: null })
    })
    return () => { cancelled = true }
  }, [plate, assessmentDate, isReAssessment])

  if (state.loading) {
    return (
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-4 text-sm text-gray-500">
        Checking for an existing approved quote…
      </div>
    )
  }

  // Existing approved quote → proceed to invoice path (branch users only).
  if (state.approved) {
    if (cannotCreateQuote) {
      return (
        <div className="bg-emerald-50 border rounded-2xl p-4 text-center text-xs text-gray-600">
          Approved quotation <span className="font-mono font-bold">{state.approved.code}</span> on file for {plate}.
        </div>
      )
    }
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

  // No approved quote yet → first-time quote creation (branch supervisor only).
  if (cannotCreateQuote) {
    return (
      <div className="bg-gray-50 border rounded-2xl p-4 text-center text-xs text-gray-500">
        Assessment submitted. Awaiting branch supervisor to create the quotation.
      </div>
    )
  }

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
            to={`/quotations/create?plate=${encodeURIComponent(plate)}&fromAssessment=${encodeURIComponent(a.rwaNumber || '')}${a.appointmentId ? `&appointmentId=${encodeURIComponent(a.appointmentId)}` : ''}`}
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
