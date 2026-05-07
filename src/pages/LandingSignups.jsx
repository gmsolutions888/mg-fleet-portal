// Landing Sign-ups — view fleet client sign-up submissions from the landing page.
// Reads the `landing_signups` collection in Firestore.

import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ref as storageRef, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// Extract document entries from the signup data — they're stored as named
// fields (afs, bankStatements, etc.) rather than a subcollection.
function extractDocuments(data) {
  const known = ['companyName', 'companyAddress', 'contactPerson', 'contactNumber', 'email', 'createdAt', 'status', 'id', '_docId']
  const docs = []
  for (const [key, val] of Object.entries(data)) {
    if (known.includes(key)) continue
    if (val && typeof val === 'object' && (val.fileName || val.storagePath || val.label)) {
      docs.push({ key, ...val })
    }
    // Handle nested `documents` map
    if (key === 'documents' && val && typeof val === 'object') {
      for (const [dk, dv] of Object.entries(val)) {
        if (dv && typeof dv === 'object' && (dv.fileName || dv.storagePath || dv.label)) {
          docs.push({ key: dk, ...dv })
        }
      }
    }
  }
  return docs
}

export default function LandingSignups() {
  const [signups, setSignups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
  const [downloadingKey, setDownloadingKey] = useState(null)

  async function handleDownload(signupId, d) {
    if (!storage || !d?.storagePath) return
    const key = `${signupId}::${d.key}`
    setDownloadingKey(key)
    try {
      const url = await getDownloadURL(storageRef(storage, d.storagePath))
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = d.fileName || d.label || d.key || 'document'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      console.error('[landing-signups] blob download failed:', err, { storagePath: d.storagePath, code: err?.code })
      // Fallback: open the storage URL in a new tab so the user can save it.
      try {
        const url = await getDownloadURL(storageRef(storage, d.storagePath))
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch (urlErr) {
        console.error('[landing-signups] getDownloadURL failed:', urlErr, { storagePath: d.storagePath, code: urlErr?.code })
        alert(`Could not download file.\n\nPath: ${d.storagePath}\nError: ${urlErr?.code || urlErr?.message || urlErr}`)
      }
    } finally {
      setDownloadingKey(null)
    }
  }

  useEffect(() => {
    if (!db) { setLoading(false); return }
    const unsub = onSnapshot(
      query(collection(db, 'landing_signups')),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Sort by createdAt desc if available, otherwise by companyName
        rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
          return tb - ta
        })
        setSignups(rows)
        setLoading(false)
        setError(null)
      },
      (err) => {
        console.error('[landing-signups] listener error:', err)
        setError(err)
        setLoading(false)
      },
    )
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return signups
    return signups.filter((s) => {
      return [s.companyName, s.contactPerson, s.contactNumber, s.email, s.companyAddress]
        .join(' ').toLowerCase().includes(term)
    })
  }, [signups, search])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Fleet Sign-ups"
        subtitle={`${signups.length} submission${signups.length === 1 ? '' : 's'} from the landing page`}
        right={<HeroStat value={signups.length} label="TOTAL" tone="solid" />}
      />

      {error && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules for the `landing_signups` collection.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact person…"
            className="input pl-9"
          />
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">Loading…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            {signups.length === 0 ? 'No sign-ups yet.' : 'No matches.'}
          </div>
        )}

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-3">
          {filtered.map((s) => {
            const docs = extractDocuments(s)
            const isOpen = expanded === s.id
            return (
              <div key={s.id} className="bg-white rounded-2xl border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  className="w-full text-left p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-black text-sm text-gray-900">{s.companyName || '—'}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.contactPerson || '—'}</div>
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">{formatDate(s.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                    {s.contactNumber && <span>{s.contactNumber}</span>}
                    {s.email && <span>{s.email}</span>}
                  </div>
                  {s.companyAddress && (
                    <div className="text-[11px] text-gray-400 mt-1">{s.companyAddress}</div>
                  )}
                  {docs.length > 0 && (
                    <div className="text-[11px] text-brand font-bold mt-2">
                      {docs.length} document{docs.length === 1 ? '' : 's'} attached {isOpen ? '▲' : '▼'}
                    </div>
                  )}
                </button>

                {isOpen && docs.length > 0 && (
                  <div className="border-t px-4 py-3 bg-gray-50 space-y-2">
                    {docs.map((d) => {
                      const dlKey = `${s.id}::${d.key}`
                      const isDownloading = downloadingKey === dlKey
                      const canDownload = Boolean(d.storagePath && storage)
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => canDownload && handleDownload(s.id, d)}
                          disabled={!canDownload || isDownloading}
                          className="w-full flex items-center gap-2 text-xs text-left rounded p-1 -m-1 hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <div className="w-7 h-7 rounded bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                            <Icon name="doc" className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-gray-800 truncate">{d.label || d.key}</div>
                            <div className="text-gray-400 truncate">{d.fileName || '—'} {d.size ? `· ${formatSize(d.size)}` : ''}</div>
                          </div>
                          <span className="text-brand text-[11px] font-bold shrink-0">
                            {isDownloading ? '…' : (canDownload ? 'Download' : '—')}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Company Name</th>
                  <th className="px-4 py-3 text-left font-medium">Contact Person</th>
                  <th className="px-4 py-3 text-left font-medium">Contact Number</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Address</th>
                  <th className="px-4 py-3 text-left font-medium">Documents</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    {signups.length === 0 ? 'No sign-ups yet.' : 'No matches.'}
                  </td></tr>
                )}
                {filtered.map((s) => {
                  const docs = extractDocuments(s)
                  const isOpen = expanded === s.id
                  return (
                    <tr key={s.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 font-semibold text-gray-900">{s.companyName || '—'}</td>
                      <td className="px-4 py-3">{s.contactPerson || '—'}</td>
                      <td className="px-4 py-3">{s.contactNumber || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{s.email || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{s.companyAddress || '—'}</td>
                      <td className="px-4 py-3">
                        {docs.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                            className="text-brand text-xs font-bold hover:underline"
                          >
                            {docs.length} file{docs.length === 1 ? '' : 's'} {isOpen ? '▲' : '▼'}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">None</span>
                        )}
                        {isOpen && (
                          <div className="mt-2 space-y-1.5">
                            {docs.map((d) => {
                              const dlKey = `${s.id}::${d.key}`
                              const isDownloading = downloadingKey === dlKey
                              const canDownload = Boolean(d.storagePath && storage)
                              return (
                                <button
                                  key={d.key}
                                  type="button"
                                  onClick={() => canDownload && handleDownload(s.id, d)}
                                  disabled={!canDownload || isDownloading}
                                  className="w-full flex items-center gap-2 text-xs text-left bg-gray-50 hover:bg-gray-100 rounded px-2 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  <Icon name="doc" className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-gray-700 truncate">{d.label || d.key}</div>
                                    <div className="text-gray-400 truncate">{d.fileName} {d.size ? `· ${formatSize(d.size)}` : ''}</div>
                                  </div>
                                  <span className="text-brand text-[11px] font-bold shrink-0">
                                    {isDownloading ? '…' : (canDownload ? 'Download' : '—')}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(s.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
