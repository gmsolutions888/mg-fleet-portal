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
  upsertBrands, upsertModels,
} from '../../lib/refVehicles'
import PageHero, { HeroStat } from '../../components/ui/PageHero'

export default function VehicleCatalogIngest() {
  const [brandsRaw, setBrandsRaw] = useState(null) // parsed VMAKES rows
  const [modelsRaw, setModelsRaw] = useState(null) // parsed VMODELS rows
  const [brandsFile, setBrandsFile] = useState(null)
  const [modelsFile, setModelsFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseStep, setParseStep] = useState('') // human-readable progress
  const [parseError, setParseError] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestResult, setIngestResult] = useState(null)
  const [ingestError, setIngestError] = useState(null)

  // Existing-data view is opt-in (Round 20.3). The auto-mount watcher
  // turned out to be a freeze suspect, so we now wait for an explicit
  // click. Empty arrays mean "haven't loaded" — analysis treats them
  // the same as "nothing in Firestore" which is fine for the diff.
  const [existingBrands, setExistingBrands] = useState([])
  const [existingModels, setExistingModels] = useState([])
  const [readError, setReadError] = useState(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [existingLoaded, setExistingLoaded] = useState(false)

  const loadExisting = async () => {
    setLoadingExisting(true); setReadError(null)
    console.log('[ingest] loadExisting → starting')
    try {
      const [brands, models] = await Promise.all([getAllBrands(), getAllModels()])
      console.log('[ingest] loadExisting → got', brands.length, 'brands +', models.length, 'models')
      setExistingBrands(brands)
      setExistingModels(models)
      setExistingLoaded(true)
    } catch (err) {
      console.error('[ingest] loadExisting failed:', err)
      setReadError(err.message || String(err))
    } finally {
      setLoadingExisting(false)
    }
  }

  // Heartbeat — proves the page's render loop is alive.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Log every state transition so we can see in DevTools where things
  // get stuck. Only logs when a value actually changes.
  useEffect(() => { console.log('[ingest] brandsRaw set', brandsRaw?.length ?? null, 'rows') }, [brandsRaw])
  useEffect(() => { console.log('[ingest] modelsRaw set', modelsRaw?.length ?? null, 'rows') }, [modelsRaw])
  useEffect(() => { console.log('[ingest] parsing =', parsing) }, [parsing])
  useEffect(() => { console.log('[ingest] ingesting =', ingesting) }, [ingesting])

  // Yield to the browser between steps so React paints the progress
  // indicator instead of locking the screen during the synchronous parts
  // of the parse.
  const yieldToUI = () => new Promise((r) => setTimeout(r, 0))

  const parse = async (file, setter) => {
    const t0 = performance.now()
    setParsing(true); setParseError(null); setParseStep('Loading xlsx parser…')
    console.log('[ingest] parse started:', file.name, file.size, 'bytes')
    try {
      await yieldToUI()
      // Static literal import so Vite code-splits xlsx into its own chunk.
      // Race it against a 30s timeout so a network stall surfaces as a
      // visible error instead of an apparent page freeze.
      const xlsx = await Promise.race([
        import('xlsx'),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('xlsx parser failed to load in 30s — check DevTools → Network for the xlsx-*.js asset, or use the CSV / JSON-paste fallback.')),
          30000,
        )),
      ])
      console.log('[ingest] xlsx module loaded in', (performance.now() - t0).toFixed(0), 'ms')

      setParseStep('Reading file…')
      await yieldToUI()
      const buf = await file.arrayBuffer()
      console.log('[ingest] arrayBuffer obtained, byteLength =', buf.byteLength)

      setParseStep('Decoding workbook…')
      await yieldToUI()
      const wb = xlsx.read(buf, { type: 'array' })
      const sheetName = wb.SheetNames[0]
      console.log('[ingest] sheets:', wb.SheetNames, '| using:', sheetName)
      const ws = wb.Sheets[sheetName]

      setParseStep('Extracting rows…')
      await yieldToUI()
      const rows = xlsx.utils.sheet_to_json(ws, { defval: null })
      console.log('[ingest] parsed', rows.length, 'rows in', (performance.now() - t0).toFixed(0), 'ms total')
      console.log('[ingest] first row keys:', rows[0] ? Object.keys(rows[0]) : '(empty)')

      setParseStep('Done.')
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
    console.log('[ingest] file selected (brands):', file.name, file.size, 'bytes', file.type)
    setBrandsFile(file)
    parse(file, setBrandsRaw)
  }
  const handleModelsFile = (file) => {
    if (!file) return
    console.log('[ingest] file selected (models):', file.name, file.size, 'bytes', file.type)
    setModelsFile(file)
    parse(file, setModelsRaw)
  }

  // CSV fallback — no xlsx dependency. The user exports each xlsx tab to
  // CSV from Excel ("Save As → CSV UTF-8"). Trivial parser, no library
  // needed.
  const handleCsvForBrands = (file) => parseCsvFile(file, setBrandsRaw, 'brands', setBrandsFile, setParsing, setParseStep, setParseError)
  const handleCsvForModels = (file) => parseCsvFile(file, setModelsRaw, 'models', setModelsFile, setParsing, setParseStep, setParseError)

  // JSON paste fallback — last-resort path. User pastes a JSON array of
  // objects with the same column names as the xlsx (VMakeID, VMakeDesc,
  // VModelID, VMakeID, VModelDesc).
  const [jsonPaste, setJsonPaste] = useState('')
  const [pasteTarget, setPasteTarget] = useState('brands')
  const applyJsonPaste = () => {
    setParseError(null)
    try {
      const parsed = JSON.parse(jsonPaste)
      if (!Array.isArray(parsed)) throw new Error('Paste must be a JSON array.')
      console.log('[ingest] applied JSON paste:', parsed.length, 'rows →', pasteTarget)
      if (pasteTarget === 'brands') setBrandsRaw(parsed)
      else setModelsRaw(parsed)
      setJsonPaste('')
    } catch (err) {
      setParseError(`JSON paste failed: ${err.message}`)
    }
  }

  // Validate parsed brands + models before ingest. Computes delta vs
  // current Firestore state.
  const brandsAnalysis = useMemo(() => analyzeBrands(brandsRaw, existingBrands), [brandsRaw, existingBrands])
  const modelsAnalysis = useMemo(() => analyzeModels(modelsRaw, existingModels, brandsRaw, existingBrands), [modelsRaw, existingModels, brandsRaw, existingBrands])

  const canIngest = !ingesting && (
    (brandsRaw && (brandsAnalysis?.cleanCount || 0) > 0) ||
    (modelsRaw && (modelsAnalysis?.cleanCount || 0) > 0)
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
        subtitle={existingLoaded
          ? `${existingBrands.length} make${existingBrands.length === 1 ? '' : 's'} · ${existingModels.length} model${existingModels.length === 1 ? '' : 's'} currently in Firestore`
          : `Page alive · uptime ${tick}s · click "Load existing" to read what's already in Firestore`}
        right={<HeroStat value={existingLoaded ? existingBrands.length : '—'} label="MAKES" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="bg-sky-50 border border-sky-200 text-sky-900 text-xs sm:text-sm rounded-xl px-3 py-2.5">
          <div className="font-bold mb-1">How this works</div>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Pick the two xlsx files from <span className="font-mono">MG Cavite Database/</span> — or use a CSV / paste JSON.</li>
            <li>Review the preview. Anything flagged (duplicates, missing fields, orphan models) is skipped, not silently included.</li>
            <li>Click Ingest. Re-running is safe — rows already in Firestore are updated, not duplicated.</li>
          </ol>
        </div>

        <div className="bg-white rounded-2xl border p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-700">
            {existingLoaded
              ? <>Existing in Firestore — <strong>{existingBrands.length}</strong> brands, <strong>{existingModels.length}</strong> models.</>
              : 'Click to read what is already in Firestore (so the preview can show diffs).'}
          </div>
          <button
            type="button"
            onClick={loadExisting}
            disabled={loadingExisting || ingesting}
            className="bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-lg shrink-0"
          >
            {loadingExisting ? 'Loading…' : (existingLoaded ? 'Reload existing' : 'Load existing')}
          </button>
        </div>

        {readError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 text-sm">
            <div className="font-bold">Firestore read blocked</div>
            <div className="text-xs mt-0.5">{readError}</div>
            <div className="text-xs mt-1 italic">
              Likely the firestore.rules in mg-fms-app/firestore.rules haven't been deployed for the new collections.
              The ingest will fail at the read step. Deploy rules before retrying.
            </div>
          </div>
        )}

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
            onCsvFile={handleCsvForBrands}
            disabled={parsing || ingesting}
          />
          <FilePicker
            title="VMODELS.xlsx"
            description="Vehicle model list, joined to make by VMakeID (~352 rows)."
            file={modelsFile}
            onFile={handleModelsFile}
            onCsvFile={handleCsvForModels}
            disabled={parsing || ingesting}
          />
        </div>

        {/* JSON paste fallback — for when both file paths fail. */}
        <details className="bg-white rounded-2xl border overflow-hidden">
          <summary className="cursor-pointer bg-gray-50 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-gray-500 hover:bg-gray-100">
            Last-resort: paste JSON
          </summary>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600">
              Hit a wall with the file pickers? Convert the xlsx tab to JSON (e.g.
              <a href="https://tableconvert.com/xlsx-to-json" target="_blank" rel="noreferrer" className="text-brand hover:underline mx-1">tableconvert.com/xlsx-to-json</a>
              or any tool of your choice) and paste the array here. Keep the original column names: VMakeID/VMakeDesc for makes, VModelID/VMakeID/VModelDesc for models.
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-gray-700">Target:</label>
              <select value={pasteTarget} onChange={(e) => setPasteTarget(e.target.value)} className="input">
                <option value="brands">Brands (VMAKES)</option>
                <option value="models">Models (VMODELS)</option>
              </select>
            </div>
            <textarea
              rows={8}
              value={jsonPaste}
              onChange={(e) => setJsonPaste(e.target.value)}
              placeholder='[{"VMakeID": 1, "VMakeDesc": "AUDI"}, {"VMakeID": 3, "VMakeDesc": "BMW"}]'
              className="input font-mono text-xs"
            />
            <button
              type="button"
              onClick={applyJsonPaste}
              disabled={!jsonPaste.trim() || ingesting}
              className="bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-lg"
            >
              Apply paste
            </button>
          </div>
        </details>

        {parsing && (
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-sm text-sky-900 flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-sky-700 border-t-transparent rounded-full animate-spin" />
            <span>{parseStep || 'Parsing…'}</span>
          </div>
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
              Will write up to {(brandsAnalysis?.cleanCount || 0)} make change{brandsAnalysis?.cleanCount === 1 ? '' : 's'} and {(modelsAnalysis?.cleanCount || 0)} model change{modelsAnalysis?.cleanCount === 1 ? '' : 's'}.
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

// ── CSV fallback ──────────────────────────────────────────────────────────
//
// Tiny CSV parser. Handles quoted fields with commas + escaped quotes.
// Inputs in the format Excel "Save As → CSV UTF-8" produces. We coerce
// numeric-looking values to numbers so the downstream cleaners don't
// have to special-case strings.

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
    if (row.length === 1 && row[0] === '') continue // skip blank lines
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

async function parseCsvFile(file, setter, kind, setFile, setParsing, setParseStep, setParseError) {
  if (!file) return
  setFile(file)
  setParsing(true); setParseError(null); setParseStep(`Reading ${kind} CSV…`)
  console.log('[ingest] CSV file selected:', file.name, file.size, 'bytes')
  try {
    const text = await file.text()
    setParseStep('Parsing CSV…')
    await new Promise((r) => setTimeout(r, 0))
    const rows = parseCsvText(text)
    console.log('[ingest] CSV parsed:', rows.length, 'rows; first row keys:', rows[0] ? Object.keys(rows[0]) : '(empty)')
    setter(rows)
    setParseStep('Done.')
  } catch (err) {
    console.error('[ingest] CSV parse failed:', err)
    setParseError(err.message || String(err))
  } finally {
    setParsing(false)
  }
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function FilePicker({ title, description, file, onFile, onCsvFile, disabled }) {
  // Route based on extension. CSV path uses the inline parser (no
  // SheetJS dependency); xlsx/xls path goes through the lazy xlsx
  // import. Mixed accept list so the user can pick whichever they have.
  const handleChange = (e) => {
    const f = e.target.files?.[0] || null
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop()
    if (ext === 'csv' && onCsvFile) onCsvFile(f)
    else onFile(f)
  }
  return (
    <label className={`block bg-white rounded-2xl border-2 border-dashed p-4 cursor-pointer hover:border-brand hover:bg-gray-50 transition-colors ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="font-bold text-gray-900 text-sm">{title}</div>
      <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      <div className="text-[11px] text-gray-500 mt-1.5 italic">
        .xlsx (lazy SheetJS) or .csv (inline parser, faster + no dependency).
      </div>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleChange}
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
