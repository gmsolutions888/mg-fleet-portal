// Cavite vehicle catalog ingest — admin-only. Drag/drop or browse for
// VMAKES.xlsx and VMODELS.xlsx, see a parsed preview with validation
// flags (duplicates / blanks / orphan models referencing unknown
// makes), then click Ingest to write to refVehicleBrands +
// refVehicleModels in Firestore.
//
// xlsx is lazy-imported on first parse so the main bundle stays lean —
// this page is admin-only and rarely opened.

import { useEffect, useMemo, useState } from 'react'
import {
  cleanBrandRow, cleanModelRow, getAllBrands, getAllModels,
  upsertBrands, upsertModels, watchBrands, watchModels,
} from '../../lib/refVehicles'
import PageHero, { HeroStat } from '../../components/ui/PageHero'

export default function VehicleCatalogIngest() {
  const [brandsRaw, setBrandsRaw] = useState(null) // parsed VMAKES rows
  const [modelsRaw, setModelsRaw] = useState(null) // parsed VMODELS rows
  const [brandsFile, setBrandsFile] = useState(null)
  const [modelsFile, setModelsFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestResult, setIngestResult] = useState(null)
  const [ingestError, setIngestError] = useState(null)

  // Live counts of what's already in Firestore so the admin can see the
  // delta before clicking Ingest.
  const [existingBrands, setExistingBrands] = useState([])
  const [existingModels, setExistingModels] = useState([])
  useEffect(() => {
    const u1 = watchBrands(({ rows }) => setExistingBrands(rows))
    const u2 = watchModels({}, ({ rows }) => setExistingModels(rows))
    return () => { u1?.(); u2?.() }
  }, [])

  const parse = async (file, setter) => {
    setParsing(true); setParseError(null)
    try {
      const xlsx = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = xlsx.read(buf, { type: 'array' })
      const sheetName = wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const rows = xlsx.utils.sheet_to_json(ws, { defval: null })
      setter(rows)
    } catch (err) {
      console.error('[ingest] parse failed:', err)
      setParseError(err.message || String(err))
    } finally {
      setParsing(false)
    }
  }

  const handleBrandsFile = (file) => {
    if (!file) return
    setBrandsFile(file)
    parse(file, setBrandsRaw)
  }
  const handleModelsFile = (file) => {
    if (!file) return
    setModelsFile(file)
    parse(file, setModelsRaw)
  }

  // Validate parsed brands + models before ingest. Computes delta vs
  // current Firestore state.
  const brandsAnalysis = useMemo(() => analyzeBrands(brandsRaw, existingBrands), [brandsRaw, existingBrands])
  const modelsAnalysis = useMemo(() => analyzeModels(modelsRaw, existingModels, brandsRaw, existingBrands), [modelsRaw, existingModels, brandsRaw, existingBrands])

  const canIngest = !ingesting && (
    (brandsRaw && brandsAnalysis.cleanCount > 0) ||
    (modelsRaw && modelsAnalysis.cleanCount > 0)
  )

  const ingest = async () => {
    if (!canIngest) return
    setIngesting(true); setIngestError(null); setIngestResult(null)
    try {
      const result = { brands: null, models: null }
      let brandsByCaviteId = new Map(existingBrands.map((b) => [Number(b.caviteId), b]))

      if (brandsRaw && brandsRaw.length > 0) {
        const r = await upsertBrands(brandsRaw)
        result.brands = r
        brandsByCaviteId = r.brandsByCaviteId
      }

      if (modelsRaw && modelsRaw.length > 0) {
        // Refetch brands if we didn't just ingest them — handles the
        // case where models ingest runs alone.
        if (!result.brands) {
          const list = await getAllBrands()
          brandsByCaviteId = new Map(list.map((b) => [Number(b.caviteId), b]))
        }
        result.models = await upsertModels(modelsRaw, brandsByCaviteId)
      }

      setIngestResult(result)
    } catch (err) {
      console.error('[ingest] failed:', err)
      setIngestError(err.message || String(err))
    } finally {
      setIngesting(false)
    }
  }

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Cavite Vehicle Catalog Ingest"
        subtitle={`${existingBrands.length} make${existingBrands.length === 1 ? '' : 's'} · ${existingModels.length} model${existingModels.length === 1 ? '' : 's'} currently in Firestore`}
        right={<HeroStat value={existingBrands.length} label="MAKES" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="bg-sky-50 border border-sky-200 text-sky-900 text-xs sm:text-sm rounded-xl px-3 py-2.5">
          <div className="font-bold mb-1">How this works</div>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Pick the two xlsx files from <span className="font-mono">MG Cavite Database/</span> — VMAKES first, then VMODELS.</li>
            <li>Review the preview. Anything flagged (duplicates, missing fields, models pointing at unknown makes) gets skipped, not silently included.</li>
            <li>Click Ingest. Re-running is safe — rows already in Firestore are updated, not duplicated.</li>
          </ol>
        </div>

        {parseError && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm">
            Parse failed: {parseError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <FilePicker
            title="VMAKES.xlsx"
            description="Vehicle make / brand list (54 rows in the source file)."
            file={brandsFile}
            onFile={handleBrandsFile}
            disabled={parsing || ingesting}
          />
          <FilePicker
            title="VMODELS.xlsx"
            description="Vehicle model list, joined to make by VMakeID (~352 rows)."
            file={modelsFile}
            onFile={handleModelsFile}
            disabled={parsing || ingesting}
          />
        </div>

        {parsing && (
          <div className="text-sm text-gray-500 italic">Parsing…</div>
        )}

        {brandsRaw && (
          <AnalysisCard title="Makes preview" analysis={brandsAnalysis} sample={brandsRaw.slice(0, 5)} kind="brands" />
        )}

        {modelsRaw && (
          <AnalysisCard title="Models preview" analysis={modelsAnalysis} sample={modelsRaw.slice(0, 5)} kind="models" />
        )}

        {(brandsRaw || modelsRaw) && (
          <div className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-gray-700">
              Will write up to {(brandsAnalysis.cleanCount || 0)} make change{brandsAnalysis.cleanCount === 1 ? '' : 's'} and {(modelsAnalysis.cleanCount || 0)} model change{modelsAnalysis.cleanCount === 1 ? '' : 's'}.
              Existing rows with no field differences are no-ops.
            </div>
            <button
              type="button"
              onClick={ingest}
              disabled={!canIngest}
              className="bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-2.5 rounded-xl shrink-0"
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
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 text-sm space-y-1">
            <div className="font-black">✓ Ingest complete.</div>
            {ingestResult.brands && (
              <div>
                Makes — created {ingestResult.brands.created}, updated {ingestResult.brands.updated}, skipped {ingestResult.brands.skipped}.
              </div>
            )}
            {ingestResult.models && (
              <div>
                Models — created {ingestResult.models.created}, updated {ingestResult.models.updated}, skipped {ingestResult.models.skipped}
                {ingestResult.models.skippedNoBrand?.length ? ` (${ingestResult.models.skippedNoBrand.length} pointed at unknown makes)` : ''}.
              </div>
            )}
            <div className="text-xs text-emerald-700 italic">
              Sidebar reads will catch up automatically — refresh other tabs if open.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function FilePicker({ title, description, file, onFile, disabled }) {
  return (
    <label className={`block bg-white rounded-2xl border-2 border-dashed p-4 cursor-pointer hover:border-brand hover:bg-gray-50 transition-colors ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="font-bold text-gray-900 text-sm">{title}</div>
      <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        className="block w-full mt-3 text-xs text-gray-600
          file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
          file:text-xs file:font-bold file:bg-brand file:text-white
          file:hover:bg-brand-dark file:cursor-pointer"
      />
      {file && (
        <div className="mt-2 text-[11px] text-gray-700 font-mono truncate">
          📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)
        </div>
      )}
    </label>
  )
}

function AnalysisCard({ title, analysis, sample, kind }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        {title}
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label="Total rows"   value={analysis.total} />
          <Tile label="Clean"        value={analysis.cleanCount} tone="green" />
          <Tile label="Will create"  value={analysis.createCount} tone="blue" />
          <Tile label="Will update"  value={analysis.updateCount} tone="amber" />
        </div>
        {(analysis.duplicates?.length > 0 || analysis.skipped?.length > 0 || analysis.orphans?.length > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
            {analysis.duplicates?.length > 0 && (
              <div>
                <div className="font-bold text-amber-900">Duplicates by caviteId ({analysis.duplicates.length})</div>
                <div className="text-amber-800 mt-0.5">Only the first occurrence is kept; the rest are dropped.</div>
                <ul className="list-disc pl-5 mt-1 text-[11px] text-amber-800">
                  {analysis.duplicates.slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}
                  {analysis.duplicates.length > 6 && <li>…and {analysis.duplicates.length - 6} more</li>}
                </ul>
              </div>
            )}
            {analysis.skipped?.length > 0 && (
              <div>
                <div className="font-bold text-amber-900">Skipped ({analysis.skipped.length})</div>
                <ul className="list-disc pl-5 mt-1 text-[11px] text-amber-800">
                  {analysis.skipped.slice(0, 6).map((s, i) => <li key={i}>{s}</li>)}
                  {analysis.skipped.length > 6 && <li>…and {analysis.skipped.length - 6} more</li>}
                </ul>
              </div>
            )}
            {analysis.orphans?.length > 0 && (
              <div>
                <div className="font-bold text-amber-900">Orphan models ({analysis.orphans.length})</div>
                <div className="text-amber-800 mt-0.5">These reference a VMakeID that isn't in the makes file or in Firestore. They'll be skipped.</div>
                <ul className="list-disc pl-5 mt-1 text-[11px] text-amber-800">
                  {analysis.orphans.slice(0, 6).map((o, i) => <li key={i}>{o}</li>)}
                  {analysis.orphans.length > 6 && <li>…and {analysis.orphans.length - 6} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">First 5 cleaned rows</div>
          <div className="text-[11px] font-mono bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre">
            {sample.length === 0
              ? '(empty)'
              : sample.map((r, i) => kind === 'brands'
                  ? `${i + 1}. id=${r.VMakeID ?? '—'} name="${r.VMakeDesc ?? ''}"`
                  : `${i + 1}. id=${r.VModelID ?? '—'} makeId=${r.VMakeID ?? '—'} name="${r.VModelDesc ?? ''}"`,
                ).join('\n')}
          </div>
        </div>
      </div>
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

// ── Analysis (pure) ───────────────────────────────────────────────────────

function analyzeBrands(raw, existing) {
  if (!raw) return null
  const total = raw.length
  const seen = new Map() // caviteId → first row
  const duplicates = []
  const skipped = []
  for (const r of raw) {
    const v = cleanBrandRow(r)
    if (!v.ok) {
      skipped.push(`Row "${r?.VMakeDesc || ''}" (id=${r?.VMakeID ?? '—'}) — ${v.reason}`)
      continue
    }
    if (seen.has(v.row.caviteId)) {
      duplicates.push(`caviteId ${v.row.caviteId} — kept "${seen.get(v.row.caviteId).name}", dropped "${v.row.name}"`)
      continue
    }
    seen.set(v.row.caviteId, v.row)
  }
  const cleanCount = seen.size
  const existingByCaviteId = new Map(existing.map((b) => [Number(b.caviteId), b]))
  let createCount = 0, updateCount = 0
  for (const row of seen.values()) {
    const e = existingByCaviteId.get(row.caviteId)
    if (!e) createCount++
    else if (e.name !== row.name || e.normalizedName !== row.normalizedName) updateCount++
  }
  return { total, cleanCount, createCount, updateCount, duplicates, skipped }
}

function analyzeModels(raw, existingModels, brandsRaw, existingBrands) {
  if (!raw) return null
  const total = raw.length

  // Build the union of brand caviteIds we're aware of: existing in
  // Firestore + about to ingest from the file. A model whose make isn't
  // in either won't have a parent.
  const knownMakeIds = new Set([
    ...existingBrands.map((b) => Number(b.caviteId)),
    ...(brandsRaw || [])
      .map((b) => Number(b?.VMakeID))
      .filter((n) => Number.isFinite(n)),
  ])

  const seen = new Map()
  const duplicates = []
  const skipped = []
  const orphans = []
  for (const r of raw) {
    const v = cleanModelRow(r)
    if (!v.ok) {
      skipped.push(`Row "${r?.VModelDesc || ''}" (id=${r?.VModelID ?? '—'}) — ${v.reason}`)
      continue
    }
    if (seen.has(v.row.caviteId)) {
      duplicates.push(`caviteId ${v.row.caviteId} — kept "${seen.get(v.row.caviteId).name}", dropped "${v.row.name}"`)
      continue
    }
    if (knownMakeIds.size > 0 && !knownMakeIds.has(v.row.caviteMakeId)) {
      orphans.push(`${v.row.name} (caviteMakeId=${v.row.caviteMakeId})`)
      // Keep in seen so the count is correct, but the upsert will skip.
    }
    seen.set(v.row.caviteId, v.row)
  }
  const cleanCount = seen.size - orphans.length
  const existingByCaviteId = new Map(existingModels.map((m) => [Number(m.caviteId), m]))
  let createCount = 0, updateCount = 0
  for (const row of seen.values()) {
    if (knownMakeIds.size > 0 && !knownMakeIds.has(row.caviteMakeId)) continue
    const e = existingByCaviteId.get(row.caviteId)
    if (!e) createCount++
    else if (
      e.name !== row.name ||
      e.normalizedName !== row.normalizedName ||
      e.caviteMakeId !== row.caviteMakeId
    ) updateCount++
  }
  return { total, cleanCount, createCount, updateCount, duplicates, skipped, orphans }
}
