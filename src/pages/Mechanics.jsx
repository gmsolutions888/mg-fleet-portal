// Staff Mechanics directory. Shows assessors/warriors from the Firestore
// users collection, filtered by the logged-in user's branch.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { watchUsers, createUserDoc } from '../lib/users'
import { watchAppointments } from '../lib/appointments'
import { ROLE_REGISTRY } from '../lib/roles'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const ASSESSOR_ROLES = new Set(['field_assessor', 'warrior', 'dispatcher', 'technician'])

export default function Mechanics() {
  const { profile } = useAuth()
  const [allUsers, setAllUsers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'field_assessor', branch: '' })
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  useEffect(() => {
    const u1 = watchUsers((list) => setAllUsers(list))
    const u2 = watchAppointments({}, ({ rows }) => setAppointments(rows))
    return () => { u1?.(); u2?.() }
  }, [])

  const userBranch = (profile?.branch || '').toUpperCase().trim()
  const isFleetMgr = String(profile?.role || '').toLowerCase() === 'general_manager'

  // Assessors/warriors filtered by branch
  const mechanics = useMemo(() => {
    return allUsers
      .filter((u) => {
        if (!ASSESSOR_ROLES.has(String(u.role || '').toLowerCase())) return false
        if (u.is_active === 0) return false
        if (!isFleetMgr && userBranch) {
          return (u.branch || '').toUpperCase().trim() === userBranch
        }
        return true
      })
      .map((u) => ({ id: u.id, name: u.name || u.email || '—', branch: u.branch || null, role: u.role }))
  }, [allUsers, userBranch, isFleetMgr])

  // Count active assignments per mechanic
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const activeStatuses = new Set(['BOOKED', 'CONFIRMED', 'TENTATIVE', 'ARRIVED', 'ONGOING', 'DIAGNOSED', 'PENDING'])
    const load = new Map()
    for (const a of appointments) {
      if (!a.mechanic || a.mechanic === 'Not yet assigned') continue
      if (!activeStatuses.has(a.status)) continue
      load.set(a.mechanic, (load.get(a.mechanic) || 0) + 1)
    }
    return mechanics
      .map((m) => ({ ...m, assignedCount: load.get(m.name) || 0 }))
      .filter((m) => !term || m.name.toLowerCase().includes(term))
  }, [mechanics, appointments, search])

  const busyCount = rows.filter((m) => m.assignedCount > 0).length

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="DIRECTORY"
        title={userBranch ? `Mechanics — ${userBranch}` : 'Mechanics'}
        subtitle={`${mechanics.length} total · ${busyCount} currently assigned`}
        right={<HeroStat value={mechanics.length} label="TOTAL" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name…"
            className="input pl-9"
          />
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden space-y-2">
          {rows.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">No mechanics found.</div>
          )}
          {rows.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl border p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center text-sm font-black shrink-0">
                {m.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-gray-900 truncate">{m.name}</div>
                {m.branch && <div className="text-[10px] text-gray-400">{m.branch}</div>}
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {m.assignedCount > 0 ? (
                    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                      {m.assignedCount} vehicle{m.assignedCount === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="italic text-gray-400">Idle — no assignments</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Branch</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-center font-medium">Currently Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No mechanics found.</td></tr>
                )}
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                          {m.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <span className="font-medium">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{m.branch || '—'}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m.role}</span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {m.assignedCount > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                          {m.assignedCount} vehicle{m.assignedCount === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Mechanic button */}
      <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
        <button
          onClick={() => { setShowForm(true); setForm({ name: '', role: 'field_assessor', branch: userBranch || '' }); setSaveErr(null) }}
          className="bg-brand hover:bg-brand-dark text-white px-4 sm:px-5 py-3 rounded-full font-bold text-sm flex items-center gap-2 shadow-xl"
        >
          <Icon name="plus" className="w-4 h-4" />
          Add Mechanic
        </button>
      </div>

      {/* Add Mechanic modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-brand text-white px-5 py-4">
              <div className="text-[10px] font-bold tracking-widest opacity-70">NEW MECHANIC</div>
              <div className="font-black text-lg mt-0.5">Add Assessor / Warrior</div>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!form.name.trim()) return
                setSaving(true); setSaveErr(null)
                try {
                  await createUserDoc(form)
                  setShowForm(false)
                } catch (err) {
                  setSaveErr(err.message || String(err))
                } finally {
                  setSaving(false)
                }
              }}
              className="px-5 py-4 space-y-3"
            >
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Full Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="input"
                  placeholder="e.g. Juan Dela Cruz"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Role *</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="input"
                >
                  {[...ASSESSOR_ROLES].map((r) => (
                    <option key={r} value={r}>{ROLE_REGISTRY[r]?.label || r}</option>
                  ))}
                </select>
              </div>
              {/* Branch is auto-set from the logged-in user */}
              {saveErr && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{saveErr}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-3 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 text-sm font-bold text-white bg-brand hover:bg-brand-dark disabled:opacity-40 px-4 py-3 rounded-xl shadow"
                >
                  {saving ? 'Saving…' : 'Add Mechanic'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
