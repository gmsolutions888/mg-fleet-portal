// Landing Contact-us — view contact form submissions from the landing page.
// Reads the `landing_contacts` collection in Firestore. Field shape comes
// from C:\Override\Project\LandingPage\contact\index.html: name, company,
// email, phone, fleetSize, message, status ('new'), submittedAt, userAgent, uid.

import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LandingContacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!db) { setLoading(false); return }
    const unsub = onSnapshot(
      query(collection(db, 'landing_contacts')),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => {
          const ta = (a.submittedAt || a.createdAt)?.toMillis?.() ?? 0
          const tb = (b.submittedAt || b.createdAt)?.toMillis?.() ?? 0
          return tb - ta
        })
        setContacts(rows)
        setLoading(false)
        setError(null)
      },
      (err) => {
        console.error('[landing-contacts] listener error:', err)
        setError(err)
        setLoading(false)
      },
    )
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return contacts
    return contacts.filter((c) => {
      return [c.name, c.email, c.phone, c.company, c.fleetSize, c.message, c.status]
        .join(' ').toLowerCase().includes(term)
    })
  }, [contacts, search])

  function StatusBadge({ status }) {
    const s = (status || 'new').toLowerCase()
    const tone =
      s === 'new' ? 'bg-blue-100 text-blue-700' :
      s === 'contacted' ? 'bg-amber-100 text-amber-700' :
      s === 'closed' ? 'bg-gray-200 text-gray-600' :
      'bg-gray-100 text-gray-700'
    return (
      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${tone}`}>
        {s}
      </span>
    )
  }

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Fleet Contact-us"
        subtitle={`${contacts.length} message${contacts.length === 1 ? '' : 's'} from the landing page`}
        right={<HeroStat value={contacts.length} label="TOTAL" tone="solid" />}
      />

      {error && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules for the `landing_contacts` collection.
        </div>
      )}

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, company, message…"
            className="input pl-9"
          />
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">Loading…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed p-8 text-center text-gray-400 text-sm">
            {contacts.length === 0 ? 'No messages yet.' : 'No matches.'}
          </div>
        )}

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-3">
          {filtered.map((c) => {
            const isOpen = expanded === c.id
            return (
              <div key={c.id} className="bg-white rounded-2xl border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  className="w-full text-left p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-black text-sm text-gray-900">{c.name || '—'}</div>
                        <StatusBadge status={c.status} />
                      </div>
                      {c.company && <div className="text-xs text-gray-500 mt-0.5">{c.company}</div>}
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">{formatDate(c.submittedAt || c.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                    {c.phone && <span>{c.phone}</span>}
                    {c.email && <span>{c.email}</span>}
                    {c.fleetSize && <span className="text-gray-600 font-semibold">{c.fleetSize}</span>}
                  </div>
                  {c.message && (
                    <div className={`text-xs text-gray-600 mt-2 ${isOpen ? '' : 'line-clamp-2'}`}>
                      {c.message}
                    </div>
                  )}
                  {c.message && c.message.length > 120 && (
                    <div className="text-[11px] text-brand font-bold mt-2">
                      {isOpen ? 'Show less ▲' : 'Show more ▼'}
                    </div>
                  )}
                </button>
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
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Company</th>
                  <th className="px-4 py-3 text-left font-medium">Fleet Size</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Message</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    {contacts.length === 0 ? 'No messages yet.' : 'No matches.'}
                  </td></tr>
                )}
                {filtered.map((c) => {
                  const isOpen = expanded === c.id
                  const longMsg = (c.message || '').length > 120
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{c.name || '—'}</td>
                      <td className="px-4 py-3">{c.company || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.fleetSize || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{c.email || '—'}</td>
                      <td className="px-4 py-3">{c.phone || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[360px] whitespace-normal">
                        {c.message ? (
                          <>
                            <div className={isOpen ? '' : 'line-clamp-2'}>{c.message}</div>
                            {longMsg && (
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : c.id)}
                                className="text-brand text-[11px] font-bold hover:underline mt-1"
                              >
                                {isOpen ? 'Show less ▲' : 'Show more ▼'}
                              </button>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(c.submittedAt || c.createdAt)}</td>
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
