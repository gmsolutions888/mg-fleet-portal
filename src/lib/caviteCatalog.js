// Cavite price catalog — Services / Parts / Consumables. Shared shape
// (validate → preview → idempotent batch upsert) per cowork spec dated
// 2026-04-28. Round 34.
//
// Three top-level collections:
//   caviteServices    — labor lines, make+model FK
//   caviteParts       — physical parts, make+model FK
//   caviteConsumables — universal supplies, no FK
//
// Each row is keyed in Firestore by its source primary id (ServiceID /
// PartsID / ConsumableID) as a string. That makes re-import idempotent
// (same id → updates the same doc). Make/model names are denormalized
// onto each doc at write time so display + autocomplete don't need a
// second hop.

import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, where, writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { getAllBrands, getAllModels } from './refVehicles'

// ── Collection names ──────────────────────────────────────────────────────

const SERVICES = 'caviteServices'
const PARTS    = 'caviteParts'
const CONSUMABLES = 'caviteConsumables'

// ── Watchers (used by the autocomplete in Phase 2) ────────────────────────

export function watchCaviteServices(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured' }); return () => {} }
  const filters = []
  if (options?.makeId != null) filters.push(where('serviceMakeId', '==', Number(options.makeId)))
  if (options?.modelId != null) filters.push(where('serviceModelId', '==', Number(options.modelId)))
  const q = filters.length > 0
    ? query(collection(db, SERVICES), ...filters)
    : query(collection(db, SERVICES), orderBy('serviceDesc'))
  return onSnapshot(
    q,
    (snap) => cb({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), source: 'firestore' }),
    (err) => { console.warn('[caviteServices] err:', err); cb({ rows: [], source: 'error', error: err }) },
  )
}

export function watchCaviteParts(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured' }); return () => {} }
  const filters = []
  if (options?.makeId != null) filters.push(where('partsMakeId', '==', Number(options.makeId)))
  if (options?.modelId != null) filters.push(where('partsModelId', '==', Number(options.modelId)))
  const q = filters.length > 0
    ? query(collection(db, PARTS), ...filters)
    : query(collection(db, PARTS), orderBy('partsDesc'))
  return onSnapshot(
    q,
    (snap) => cb({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), source: 'firestore' }),
    (err) => { console.warn('[caviteParts] err:', err); cb({ rows: [], source: 'error', error: err }) },
  )
}

export function watchCaviteConsumables(cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured' }); return () => {} }
  const q = query(collection(db, CONSUMABLES), orderBy('consumableDesc'))
  return onSnapshot(
    q,
    (snap) => cb({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), source: 'firestore' }),
    (err) => { console.warn('[caviteConsumables] err:', err); cb({ rows: [], source: 'error', error: err }) },
  )
}

// ── Counts (for the ingest page header) ───────────────────────────────────

export async function countDocs(coll) {
  if (!db) return 0
  try {
    const snap = await getDocs(query(collection(db, coll), limit(10000)))
    return snap.size
  } catch {
    return 0
  }
}

export async function countAll() {
  const [s, p, c] = await Promise.all([countDocs(SERVICES), countDocs(PARTS), countDocs(CONSUMABLES)])
  return { services: s, parts: p, consumables: c }
}

// ── Normalizers ───────────────────────────────────────────────────────────

function normName(s) {
  if (s == null) return ''
  return String(s).replace(/\s+/g, ' ').trim().toUpperCase()
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Row validators per kind ──────────────────────────────────────────────

export function cleanServiceRow(raw) {
  const id = num(raw?.ServiceID)
  const makeId = num(raw?.ServiceMakeID)
  const modelId = num(raw?.ServiceModelID)
  const desc = normName(raw?.ServiceDesc)
  const code = (raw?.ServiceCode || '').toString().trim()
  const srp = num(raw?.ServiceSRP)
  if (!Number.isFinite(id)) return { ok: false, reason: 'Missing ServiceID' }
  if (!desc) return { ok: false, reason: 'Missing ServiceDesc' }
  if (!Number.isFinite(makeId)) return { ok: false, reason: 'Missing ServiceMakeID' }
  if (!Number.isFinite(modelId)) return { ok: false, reason: 'Missing ServiceModelID' }
  return {
    ok: true,
    row: { serviceId: id, serviceCode: code || null, serviceMakeId: makeId, serviceModelId: modelId, serviceDesc: desc, serviceSrp: srp ?? 0 },
  }
}

export function cleanPartRow(raw) {
  const id = num(raw?.PartsID)
  const supplierId = num(raw?.SupplierID)
  const makeId = num(raw?.PartsMakeID)
  const modelId = num(raw?.PartsModelID)
  const code = (raw?.ProductCode || '').toString().trim()
  const desc = normName(raw?.PartsDesc)
  const cost = num(raw?.PartsCost) // may be missing per spec
  const srp = num(raw?.PartsSRP)
  if (!Number.isFinite(id)) return { ok: false, reason: 'Missing PartsID' }
  if (!desc) return { ok: false, reason: 'Missing PartsDesc' }
  if (!Number.isFinite(makeId)) return { ok: false, reason: 'Missing PartsMakeID' }
  if (!Number.isFinite(modelId)) return { ok: false, reason: 'Missing PartsModelID' }
  return {
    ok: true,
    row: {
      partsId: id, supplierId: Number.isFinite(supplierId) ? supplierId : null,
      partsMakeId: makeId, partsModelId: modelId,
      productCode: code || null, partsDesc: desc,
      partsCost: cost, partsSrp: srp ?? 0,
    },
  }
}

export function cleanConsumableRow(raw) {
  const id = num(raw?.ConsumableID)
  const supplierId = num(raw?.SupplierID) // some rows null per spec
  const code = (raw?.ConsumableCode || '').toString().trim()
  const desc = normName(raw?.ConsumableDesc)
  const cost = num(raw?.ConsumableCost) // optional
  const srp = num(raw?.ConsumableSRP)
  if (!Number.isFinite(id)) return { ok: false, reason: 'Missing ConsumableID' }
  if (!desc) return { ok: false, reason: 'Missing ConsumableDesc' }
  return {
    ok: true,
    row: {
      consumableId: id, supplierId: Number.isFinite(supplierId) ? supplierId : null,
      consumableCode: code || null, consumableDesc: desc,
      consumableCost: cost, consumableSrp: srp ?? 0,
    },
  }
}

// ── Pre-flight FK pools (load makes + models from Firestore once) ────────

export async function loadFkPools() {
  const [brands, models] = await Promise.all([getAllBrands(), getAllModels()])
  return {
    makesById: new Map(brands.map((b) => [Number(b.caviteId), b])),
    modelsById: new Map(models.map((m) => [Number(m.caviteId), m])),
  }
}

// ── Analyze (preview, no writes) ─────────────────────────────────────────

// Each analyzer returns:
//   { total, cleanCount, createCount, updateCount,
//     skipped: [...reasons], duplicates: [...], orphans: [...] }
// `existing` is a Map of id → existing doc (loaded from Firestore once),
// used to compute create vs update.

function fkOk(row, fk) {
  return fk.makesById.has(row.serviceMakeId ?? row.partsMakeId)
      && fk.modelsById.has(row.serviceModelId ?? row.partsModelId)
}

export function analyzeServices(raw, fk, existing) {
  if (!raw) return null
  const seen = new Map(), skipped = [], duplicates = [], orphans = []
  for (const r of raw) {
    const v = cleanServiceRow(r)
    if (!v.ok) { skipped.push(`Row id=${r?.ServiceID ?? '—'}: ${v.reason}`); continue }
    if (seen.has(v.row.serviceId)) { duplicates.push(`ID ${v.row.serviceId} — kept first, dropped "${v.row.serviceDesc}"`); continue }
    if (!fk.makesById.has(v.row.serviceMakeId) || !fk.modelsById.has(v.row.serviceModelId)) {
      orphans.push(`${v.row.serviceDesc} — make=${v.row.serviceMakeId} model=${v.row.serviceModelId}`)
      continue
    }
    seen.set(v.row.serviceId, v.row)
  }
  let createCount = 0, updateCount = 0
  for (const row of seen.values()) {
    const e = existing.get(row.serviceId)
    if (!e) createCount++
    else if (
      e.serviceDesc !== row.serviceDesc ||
      e.serviceCode !== row.serviceCode ||
      e.serviceMakeId !== row.serviceMakeId ||
      e.serviceModelId !== row.serviceModelId ||
      Number(e.serviceSrp) !== Number(row.serviceSrp)
    ) updateCount++
  }
  return { total: raw.length, cleanCount: seen.size, createCount, updateCount, skipped, duplicates, orphans }
}

export function analyzeParts(raw, fk, existing) {
  if (!raw) return null
  const seen = new Map(), skipped = [], duplicates = [], orphans = []
  for (const r of raw) {
    const v = cleanPartRow(r)
    if (!v.ok) { skipped.push(`Row id=${r?.PartsID ?? '—'}: ${v.reason}`); continue }
    if (seen.has(v.row.partsId)) { duplicates.push(`ID ${v.row.partsId} — kept first`); continue }
    if (!fk.makesById.has(v.row.partsMakeId) || !fk.modelsById.has(v.row.partsModelId)) {
      orphans.push(`${v.row.partsDesc} — make=${v.row.partsMakeId} model=${v.row.partsModelId}`)
      continue
    }
    seen.set(v.row.partsId, v.row)
  }
  let createCount = 0, updateCount = 0
  for (const row of seen.values()) {
    const e = existing.get(row.partsId)
    if (!e) createCount++
    else if (
      e.partsDesc !== row.partsDesc ||
      e.productCode !== row.productCode ||
      e.partsMakeId !== row.partsMakeId ||
      e.partsModelId !== row.partsModelId ||
      Number(e.partsSrp) !== Number(row.partsSrp) ||
      Number(e.partsCost) !== Number(row.partsCost) ||
      e.supplierId !== row.supplierId
    ) updateCount++
  }
  return { total: raw.length, cleanCount: seen.size, createCount, updateCount, skipped, duplicates, orphans }
}

export function analyzeConsumables(raw, existing) {
  if (!raw) return null
  const seen = new Map(), skipped = [], duplicates = []
  for (const r of raw) {
    const v = cleanConsumableRow(r)
    if (!v.ok) { skipped.push(`Row id=${r?.ConsumableID ?? '—'}: ${v.reason}`); continue }
    if (seen.has(v.row.consumableId)) { duplicates.push(`ID ${v.row.consumableId} — kept first`); continue }
    seen.set(v.row.consumableId, v.row)
  }
  let createCount = 0, updateCount = 0
  for (const row of seen.values()) {
    const e = existing.get(row.consumableId)
    if (!e) createCount++
    else if (
      e.consumableDesc !== row.consumableDesc ||
      e.consumableCode !== row.consumableCode ||
      Number(e.consumableSrp) !== Number(row.consumableSrp) ||
      e.supplierId !== row.supplierId
    ) updateCount++
  }
  return { total: raw.length, cleanCount: seen.size, createCount, updateCount, skipped, duplicates, orphans: [] }
}

// ── Upsert in chunks ──────────────────────────────────────────────────────

// Firestore writeBatch supports up to 500 ops; chunk to 400 for headroom.
// Each row is keyed by its source primary id (as string) for idempotency.
async function batchUpsert(coll, rows, key, fk, denorm) {
  const uid = auth?.currentUser?.uid || null
  let created = 0, updated = 0, skipped = 0
  // Pre-fetch existing once.
  // Firestore caps limit() at 10000. Largest table (PARTS_MG) has
  // ~8k rows so this is enough for first ingest + re-ingest.
  const existingSnap = await getDocs(query(collection(db, coll), limit(10000)))
  const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data()]))

  const chunkSize = 400
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = writeBatch(db)
    for (const row of rows.slice(i, i + chunkSize)) {
      const id = String(row[key])
      const denormed = denorm ? denorm(row, fk) : row
      const found = existing.get(id)
      if (found) {
        batch.update(doc(db, coll, id), {
          ...denormed,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
        updated++
      } else {
        batch.set(doc(db, coll, id), {
          ...denormed,
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
        created++
      }
    }
    await batch.commit()
  }
  return { created, updated, skipped }
}

export async function upsertServices(rawRows) {
  if (!db) throw new Error('Firestore not configured.')
  const fk = await loadFkPools()
  const cleaned = []
  let skipped = 0
  for (const r of rawRows) {
    const v = cleanServiceRow(r)
    if (!v.ok) { skipped++; continue }
    if (!fk.makesById.has(v.row.serviceMakeId) || !fk.modelsById.has(v.row.serviceModelId)) { skipped++; continue }
    cleaned.push(v.row)
  }
  // Dedupe by id (keep first).
  const byId = new Map()
  for (const r of cleaned) if (!byId.has(r.serviceId)) byId.set(r.serviceId, r)
  const result = await batchUpsert(SERVICES, [...byId.values()], 'serviceId', fk, denormService)
  return { ...result, skipped: skipped + (cleaned.length - byId.size) }
}

export async function upsertParts(rawRows) {
  if (!db) throw new Error('Firestore not configured.')
  const fk = await loadFkPools()
  const cleaned = []
  let skipped = 0
  for (const r of rawRows) {
    const v = cleanPartRow(r)
    if (!v.ok) { skipped++; continue }
    if (!fk.makesById.has(v.row.partsMakeId) || !fk.modelsById.has(v.row.partsModelId)) { skipped++; continue }
    cleaned.push(v.row)
  }
  const byId = new Map()
  for (const r of cleaned) if (!byId.has(r.partsId)) byId.set(r.partsId, r)
  const result = await batchUpsert(PARTS, [...byId.values()], 'partsId', fk, denormPart)
  return { ...result, skipped: skipped + (cleaned.length - byId.size) }
}

export async function upsertConsumables(rawRows) {
  if (!db) throw new Error('Firestore not configured.')
  const cleaned = []
  let skipped = 0
  for (const r of rawRows) {
    const v = cleanConsumableRow(r)
    if (!v.ok) { skipped++; continue }
    cleaned.push(v.row)
  }
  const byId = new Map()
  for (const r of cleaned) if (!byId.has(r.consumableId)) byId.set(r.consumableId, r)
  const result = await batchUpsert(CONSUMABLES, [...byId.values()], 'consumableId', null, null)
  return { ...result, skipped: skipped + (cleaned.length - byId.size) }
}

// Denormalize make + model names onto the row at write time so display
// queries don't need a second hop. fk has the makes+models maps.
function denormService(row, fk) {
  return {
    ...row,
    makeName: fk.makesById.get(row.serviceMakeId)?.name || null,
    modelName: fk.modelsById.get(row.serviceModelId)?.name || null,
  }
}
function denormPart(row, fk) {
  return {
    ...row,
    makeName: fk.makesById.get(row.partsMakeId)?.name || null,
    modelName: fk.modelsById.get(row.partsModelId)?.name || null,
  }
}
