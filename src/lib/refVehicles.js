// Reference vehicle makes + models. Sourced from the MG Cavite catalog
// (xlsx files at "MG Cavite Database/", gitignored) and ingested via the
// admin page at /admin/vehicle-catalog. Each doc carries a `caviteId`
// that preserves the join key for the parts/services catalogs we'll
// ingest in a later round.
//
// Collections:
//   refVehicleBrands/{auto-id}: { caviteId, name, normalizedName,
//                                  createdAt, updatedAt }
//   refVehicleModels/{auto-id}: { caviteId, caviteMakeId, brandId,
//                                  brandName, name, normalizedName,
//                                  createdAt, updatedAt }
//
// caviteId is the integer from VMAKES.VMakeID / VMODELS.VModelID. We use
// it as the lookup key for re-ingest (idempotent) and for joining to the
// parts/services tables once those ingest. brandId is the Firestore doc
// id of the parent brand, denormalized so model queries don't need a
// second hop.

import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, where, writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'

const BRANDS_COLLECTION = 'refVehicleBrands'
const MODELS_COLLECTION = 'refVehicleModels'

// ── Watchers ──────────────────────────────────────────────────────────────

export function watchBrands(cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured' }); return () => {} }
  const q = query(collection(db, BRANDS_COLLECTION), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => cb({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), source: 'firestore' }),
    (err) => {
      console.warn('[refVehicles] brands listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

export function watchModels(options, cb) {
  if (!db) { cb({ rows: [], source: 'unconfigured' }); return () => {} }
  const filters = []
  if (options?.brandId) filters.push(where('brandId', '==', options.brandId))
  if (options?.caviteMakeId != null) filters.push(where('caviteMakeId', '==', Number(options.caviteMakeId)))
  const q = filters.length > 0
    ? query(collection(db, MODELS_COLLECTION), ...filters, orderBy('name'))
    : query(collection(db, MODELS_COLLECTION), orderBy('name'))
  return onSnapshot(
    q,
    (snap) => cb({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), source: 'firestore' }),
    (err) => {
      console.warn('[refVehicles] models listener error:', err)
      cb({ rows: [], source: 'error', error: err })
    },
  )
}

// ── One-shot fetchers (used by the ingest preview to detect existing rows) ─

export async function getBrandByCaviteId(caviteId) {
  if (!db || caviteId == null) return null
  const snap = await getDocs(query(
    collection(db, BRANDS_COLLECTION),
    where('caviteId', '==', Number(caviteId)),
    limit(1),
  ))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export async function getModelByCaviteId(caviteId) {
  if (!db || caviteId == null) return null
  const snap = await getDocs(query(
    collection(db, MODELS_COLLECTION),
    where('caviteId', '==', Number(caviteId)),
    limit(1),
  ))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

export async function getAllBrands() {
  if (!db) return []
  const snap = await getDocs(query(collection(db, BRANDS_COLLECTION), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function getAllModels() {
  if (!db) return []
  const snap = await getDocs(query(collection(db, MODELS_COLLECTION), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── Normalizers ───────────────────────────────────────────────────────────

// Normalize a make/model display name. Trim whitespace, collapse internal
// runs of spaces, uppercase. We keep the uppercase name as canonical so
// joins on text are case-insensitive without further work.
export function normalizeName(s) {
  if (s == null) return ''
  return String(s).replace(/\s+/g, ' ').trim().toUpperCase()
}

// Validate + clean a parsed VMAKES row. Returns { ok: true, row } or
// { ok: false, reason }.
export function cleanBrandRow(raw) {
  const caviteId = Number(raw?.VMakeID ?? raw?.caviteId)
  const name = normalizeName(raw?.VMakeDesc ?? raw?.name)
  if (!Number.isFinite(caviteId)) return { ok: false, reason: 'Missing or invalid VMakeID' }
  if (!name) return { ok: false, reason: 'Missing VMakeDesc' }
  return { ok: true, row: { caviteId, name, normalizedName: name } }
}

// Validate + clean a parsed VMODELS row. The brand lookup happens at
// upsert time — this just validates the raw row's own integrity.
export function cleanModelRow(raw) {
  const caviteId = Number(raw?.VModelID ?? raw?.caviteId)
  const caviteMakeId = Number(raw?.VMakeID ?? raw?.caviteMakeId)
  const name = normalizeName(raw?.VModelDesc ?? raw?.name)
  if (!Number.isFinite(caviteId)) return { ok: false, reason: 'Missing or invalid VModelID' }
  if (!Number.isFinite(caviteMakeId)) return { ok: false, reason: 'Missing or invalid VMakeID' }
  if (!name) return { ok: false, reason: 'Missing VModelDesc' }
  return { ok: true, row: { caviteId, caviteMakeId, name, normalizedName: name } }
}

// ── Upsert ────────────────────────────────────────────────────────────────

// Idempotent batch upsert of brands. Looks up each row by caviteId; if
// found, updates; if not, creates. Returns { created, updated, skipped }.
// Skips rows that fail cleanBrandRow validation; the caller is expected
// to have surfaced those in the preview already, but defensive here too.
//
// Firestore batch limit is 500 writes; we chunk accordingly.
export async function upsertBrands(rawRows) {
  if (!db) throw new Error('Firestore not configured.')
  const uid = auth?.currentUser?.uid || null
  let created = 0, updated = 0, skipped = 0

  // Pre-fetch existing by caviteId (avoids N reads inside the batch loop).
  const existing = await getAllBrands()
  const byCaviteId = new Map(existing.map((b) => [Number(b.caviteId), b]))

  const cleaned = []
  for (const raw of rawRows) {
    const v = cleanBrandRow(raw)
    if (!v.ok) { skipped++; continue }
    cleaned.push(v.row)
  }

  // Chunk into batches of 400 for safety (Firestore ceiling 500).
  const chunks = chunkArray(cleaned, 400)
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    for (const row of chunk) {
      const found = byCaviteId.get(row.caviteId)
      if (found) {
        // Skip the write entirely if the only change would be the
        // updatedAt stamp — reduces noise + cost on re-ingest.
        if (found.name === row.name && found.normalizedName === row.normalizedName) {
          continue
        }
        batch.update(doc(db, BRANDS_COLLECTION, found.id), {
          name: row.name,
          normalizedName: row.normalizedName,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
        updated++
      } else {
        const ref = doc(collection(db, BRANDS_COLLECTION))
        batch.set(ref, {
          caviteId: row.caviteId,
          name: row.name,
          normalizedName: row.normalizedName,
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
        // Track the new doc so the model upsert can resolve brandId.
        byCaviteId.set(row.caviteId, { id: ref.id, ...row })
        created++
      }
    }
    await batch.commit()
  }

  return { created, updated, skipped, brandsByCaviteId: byCaviteId }
}

// Models depend on brands. The caller passes in `brandsByCaviteId` (the
// Map returned from upsertBrands), so we don't refetch. If a model
// references a missing make, it's skipped with a reason.
export async function upsertModels(rawRows, brandsByCaviteId) {
  if (!db) throw new Error('Firestore not configured.')
  if (!(brandsByCaviteId instanceof Map)) {
    // Fallback: build the map from a fresh read.
    const list = await getAllBrands()
    brandsByCaviteId = new Map(list.map((b) => [Number(b.caviteId), b]))
  }
  const uid = auth?.currentUser?.uid || null
  let created = 0, updated = 0, skipped = 0
  const skippedNoBrand = []

  const existing = await getAllModels()
  const byCaviteId = new Map(existing.map((m) => [Number(m.caviteId), m]))

  const cleaned = []
  for (const raw of rawRows) {
    const v = cleanModelRow(raw)
    if (!v.ok) { skipped++; continue }
    cleaned.push(v.row)
  }

  const chunks = chunkArray(cleaned, 400)
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    for (const row of chunk) {
      const brand = brandsByCaviteId.get(row.caviteMakeId)
      if (!brand) {
        skipped++
        if (skippedNoBrand.length < 20) skippedNoBrand.push(`${row.name} (caviteMakeId=${row.caviteMakeId})`)
        continue
      }
      const payload = {
        name: row.name,
        normalizedName: row.normalizedName,
        caviteMakeId: row.caviteMakeId,
        brandId: brand.id,
        brandName: brand.name,
      }
      const found = byCaviteId.get(row.caviteId)
      if (found) {
        if (
          found.name === payload.name &&
          found.normalizedName === payload.normalizedName &&
          found.caviteMakeId === payload.caviteMakeId &&
          found.brandId === payload.brandId &&
          found.brandName === payload.brandName
        ) {
          continue
        }
        batch.update(doc(db, MODELS_COLLECTION, found.id), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
        updated++
      } else {
        const ref = doc(collection(db, MODELS_COLLECTION))
        batch.set(ref, {
          caviteId: row.caviteId,
          ...payload,
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

  return { created, updated, skipped, skippedNoBrand }
}

function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
