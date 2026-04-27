// Cavite price catalog ingest — Services / Parts / Consumables.
// Round 34 (per cowork's spec dated 2026-04-28).
//
// One page, three tabs. Same shape as /admin/vehicle-catalog:
//   pick file → preview (validate, dedupe, FK check) → click Ingest →
//   per-tab summary. xlsx is lazy-loaded so the main bundle stays lean
//   for users who never open this page.
//
// FK validation reads refVehicleBrands + refVehicleModels (already
// ingested via /admin/vehicle-catalog). If those aren't populated yet,
// every Service / Part row will fail FK validation — flagged in the
// preview as "orphan", which doubles as a hint to ingest VMAKES +
// VMODELS first.

import { useEffect, useMemo, useState } from 'react'
import {
  analyzeServices, analyzeParts, analyzeConsumables,
  loadFkPools, countAll,
  upsertServices, upsertParts, upsertConsumables,
} from '../../lib/caviteCatalog'
import { getAllBrands, getAllModels } from '../../lib/refVehicles'
import PageHero, { HeroStat } from '../../components/ui/PageHero'

const TABS = [
  { key: 'services',    label: 'Services (Labor)',  file: 'SERVICES_MG.xlsx',  expected: 'ServiceID, ServiceCode, ServiceMakeID, ServiceModelID, ServiceDesc, ServiceSRP' },
  { key: 'parts',       label: 'Parts',             file: 'PARTS_MG.xlsx',     expected: 'PartsID, SupplierID, PartsMakeID, PartsModelID, ProductCode, PartsDesc, PartsSRP' },
  { key: 'consumables', label: 'Consumables',       file: 'CONSUMABLES.xlsx',  expected: 'ConsumableID, SupplierID, ConsumableCode, ConsumableDesc, ConsumableSRP' },
]

export default function CaviteCatalogIngest() {
  const [tab, setTab] = useState('services')
  const [counts, setCounts] = useState({ services: 0, parts: 0, consumables: 0 })
  const [refCounts, setRefCounts] = useState({ makes: 0, models: 0 })
  const [tick, setTick] = useState(0)

  // Heartbeat — proves the page didn't freeze (see reference_cavite_catalog
  // memory note re: prior /admin/vehicle-catalog freeze). If this stops
  // ticking, page is stalled.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Initial counts: how many docs already exist + how many makes/models.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [c, makes, models] = await Promise.all([
          countAll(), getAllBrands(), getAllModels(),
        ])
        if (!cancelled) { setCounts(c); setRefCounts({ makes: makes.length, models: models.length }) }
      } catch (err) { console.warn('[catalog ingest] counts failed:', err) }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Cavite Price Catalog Ingest"
        subtitle={`Page alive · uptime ${tick}s · ${counts.services} services · ${counts.parts} parts · ${counts.consumables} consumables in Firestore`}
        right={<HeroStat value={counts.services + counts.parts + counts.consumables} label="ROWS" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* FK status — services / parts both depend on VMAKES + VMODELS being already ingested. */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-sky-900">
          <div className="font-bold mb-0.5">Foreign-key check status</div>
          <div>
            {refCounts.makes} make{refCounts.makes === 1 ? '' : 's'} · {refCounts.models} model{refCounts.models === 1 ? '' : 's'} loaded from /admin/vehicle-catalog.
            {(refCounts.makes === 0 || refCounts.models === 0) && (
              <span className="font-bold text-red-700"> Run the Vehicle Catalog ingest first — Services and Parts will all be flagged as orphan otherwise.</span>
            )}
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-brand text-white' : 'bg-white border text-gray-700'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        {tab === 'services'    && <CatalogTab kind="services"    onCountsChanged={setCounts} />}
        {tab === 'parts'       && <CatalogTab kind="parts"       onCountsChanged={setCounts} />}
        {tab === 'consumables' && <CatalogTab kind="consumables" onCountsChanged={setCounts} />}
      </div>
    </div>
  )
}

// ── Per-tab UI ────────────────────────────────────────────────────────────

function CatalogTab({ kind, onCountsChanged }) {
  const meta = TABS.find((t) => t.key === kind)
  const [file, setFile] = useState(null)
  const [raw, setRaw] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseStep, setParseStep] = useState('')
  const [parseError, setParseError] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestResult, setIngestResult] = useState(null)
  const [ingestError, setIngestError] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  // Preview: cleanse + analyze raw rows. Loads FK pools + existing
  // Firestore docs once each time the user picks a file.
  useEffect(() => {
    if (!raw) { setAnalysis(null); return }
    let cancelled = false
    setAnalyzing(true)
    ;(async () => {
      try {
        const fk = (kind === 'consumables') ? null : await loadFkPools()
        // Pull existing docs to compute create vs update.
        const existing = await fetchExisting(kind)
        if (cancelled) return
        const a = kind === 'services'
          ? analyzeServices(raw, fk, existing)
          : kind === 'parts'
            ? analyzeParts(raw, fk, existing)
            : analyzeConsumables(raw, existing)
        setAnalysis(a)
      } catch (err) {
        console.error('[catalog ingest] analyze failed:', err)
      } finally {
        if (!cancelled) setAnalyzing(false)
      }
    })()
    return () => { cancelled = true }
  }, [raw, kind])

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    setIngestResult(null); setIngestError(null)
    parseFile(f, setRaw, setParsing, setParseStep, setParseError)
  }

  const ingest = async () => {
    if (!raw || ingesting) return
    setIngesting(true); setIngestError(null); setIngestResult(null)
    try {
      const result = kind === 'services' ? await upsertServices(raw)
                   : kind === 'parts'    ? await upsertParts(raw)
                   :                       await upsertConsumables(raw)
      setIngestResult(result)
      // Refresh counts in the parent.
      const c = await countAll()
      onCountsChanged?.(c)
    } catch (err) {
      console.error('[catalog ingest] failed:', err)
      setIngestError(err.message || String(err))
    } finally {
      setIngesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border p-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{meta.label}</div>
        <div className="text-xs text-gray-600">
          Pick <span className="font-mono text-gray-800">{meta.file}</span>. Expected columns: <span className="font-mono">{meta.expected}</span>.
        </div>
        <label className={`block bg-white rounded-2xl border-2 border-dashed p-3 cursor-pointer hover:border-brand hover:bg-gray-50 transition-colors ${parsing || ingesting ? 'opacity-60 pointer-events-none' : ''}`}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand file:text-white file:hover:bg-brand-dark file:cursor-pointer"
          />
          {file && (
            <div className="mt-2 text-[11px] text-gray-700 font-mono truncate">📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>
          )}
        </label>
      </div>

      {parsing && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-sm text-sky-900 flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-sky-700 border-t-transparent rounded-full animate-spin" />
          <span>{parseStep}</span>
        </div>
      )}

      {parseError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm">
          Parse failed: {parseError}
        </div>
      )}

      {analyzing && (
        <div className="bg-gray-50 border rounded-xl px-3 py-2 text-sm text-gray-600 italic">Analyzing rows…</div>
      )}

      {analysis && <AnalysisCard analysis={analysis} />}

      {analysis && analysis.cleanCount > 0 && (
        <div className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
          <div className="text-xs sm:text-sm text-gray-700">
            Will write up to <strong>{(analysis.createCount || 0) + (analysis.updateCount || 0)}</strong> doc{((analysis.createCount + analysis.updateCount) === 1) ? '' : 's'}
            ({analysis.createCount} new · {analysis.updateCount} updates · {analysis.cleanCount - analysis.createCount - analysis.updateCount} unchanged).
          </div>
          <button
            type="button"
            onClick={ingest}
            disabled={ingesting}
            className="bg-brand hover:bg-brand-dark disabled:opacity-40 text-white font-bold text-sm px-5 py-2.5 rounded-xl shrink-0"
          >
            {ingesting ? 'Ingesting…' : 'Ingest →'}
          </button>
        </div>
      )}

      {ingestError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm">
          Ingest failed: {ingestError}
        </div>
      )}

      {ingestResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm space-y-1">
          <div className="font-black text-emerald-900">✓ {meta.label} ingest complete.</div>
          <div className="text-emerald-800">
            Created {ingestResult.created} · Updated {ingestResult.updated} · Skipped {ingestResult.skipped}.
          </div>
        </div>
      )}
    </div>
  )
}

function AnalysisCard({ analysis }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        Preview
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label="Total"       value={analysis.total} />
          <Tile label="Clean"       value={analysis.cleanCount} tone="green" />
          <Tile label="Will create" value={analysis.createCount} tone="blue" />
          <Tile label="Will update" value={analysis.updateCount} tone="amber" />
        </div>
        {(analysis.duplicates?.length > 0 || analysis.skipped?.length > 0 || analysis.orphans?.length > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
            {analysis.duplicates?.length > 0 && (
              <Group title={`Duplicate IDs (${analysis.duplicates.length})`} note="First occurrence kept; rest dropped." rows={analysis.duplicates} />
            )}
            {analysis.orphans?.length > 0 && (
              <Group title={`Orphan FK rows (${analysis.orphans.length})`} note="Make / model not in refVehicleBrands or refVehicleModels — skipped." rows={analysis.orphans} />
            )}
            {analysis.skipped?.length > 0 && (
              <Group title={`Skipped — missing required field (${analysis.skipped.length})`} note="" rows={analysis.skipped} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Group({ title, note, rows }) {
  return (
    <div>
      <div className="font-bold text-amber-900">{title}</div>
      {note && <div className="text-amber-800 mt-0.5">{note}</div>}
      <ul className="list-disc pl-5 mt-1 text-[11px] text-amber-800">
        {rows.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
        {rows.length > 6 && <li>…and {rows.length - 6} more</li>}
      </ul>
    </div>
  )
}

function Tile({ label, value, tone = 'gray' }) {
  const map = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
  }
  return (
    <div className={`rounded-lg px-3 py-2 ${map[tone] || map.gray}`}>
      <div className="text-[9px] font-bold uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-lg font-black leading-tight">{value ?? '—'}</div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function parseFile(file, setRaw, setParsing, setParseStep, setParseError) {
  const t0 = performance.now()
  setParsing(true); setParseError(null); setParseStep('Loading parser…')
  try {
    await new Promise((r) => setTimeout(r, 0))
    const ext = file.name.toLowerCase().split('.').pop()
    let rows
    if (ext === 'csv') {
      setParseStep('Reading CSV…')
      const text = await file.text()
      rows = parseCsvText(text)
    } else {
      const xlsx = await Promise.race([
        import('xlsx'),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('xlsx parser failed to load in 30s — switch to CSV (Save As → CSV UTF-8) and retry.')),
          30000,
        )),
      ])
      setParseStep('Reading file…')
      const buf = await file.arrayBuffer()
      setParseStep('Decoding workbook…')
      const wb = xlsx.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      setParseStep('Extracting rows…')
      rows = xlsx.utils.sheet_to_json(ws, { defval: null })
    }
    console.log('[catalog ingest] parsed', rows.length, 'rows in', (performance.now() - t0).toFixed(0), 'ms')
    setParseStep('Done.')
    setRaw(rows)
  } catch (err) {
    console.error('[catalog ingest] parse failed:', err)
    setParseError(err.message || String(err))
  } finally {
    setParsing(false)
  }
}

// Tiny CSV parser, copy-of from the vehicle catalog page (handles
// quoted fields with commas + escaped quotes).
function parseCsvText(text) {
  const lines = []
  let cur = []
  let field = ''
  let inQuotes = false
  let i = 0
  const flush = () => { cur.push(field); field = '' }
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { flush(); i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { flush(); lines.push(cur); cur = []; i++; continue }
    field += c; i++
  }
  if (field !== '' || cur.length > 0) { flush(); lines.push(cur) }

  if (lines.length === 0) return []
  const header = lines[0].map((h) => String(h).trim())
  const out = []
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r]
    if (row.length === 1 && row[0] === '') continue
    const obj = {}
    for (let c = 0; c < header.length; c++) {
      const key = header[c]
      let val = row[c] != null ? row[c] : null
      if (val === '') val = null
      if (val != null && /^-?\d+(\.\d+)?$/.test(val.trim())) val = Number(val)
      obj[key] = val
    }
    out.push(obj)
  }
  return out
}

// Existing-doc fetch per kind. Used by the analyzer to compute
// create vs update counts.
async function fetchExisting(kind) {
  const { collection, getDocs, query, limit } = await import('firebase/firestore')
  const { db } = await import('../../lib/firebase')
  if (!db) return new Map()
  const collName = kind === 'services' ? 'caviteServices'
                : kind === 'parts'    ? 'caviteParts'
                :                       'caviteConsumables'
  const snap = await getDocs(query(collection(db, collName), limit(10000)))
  const idKey = kind === 'services' ? 'serviceId'
              : kind === 'parts'    ? 'partsId'
              :                       'consumableId'
  return new Map(snap.docs.map((d) => [Number(d.id), { ...d.data() }]))
    // Keys are stored doc-ids (strings) and id-fields (numbers); index by both.
}
