// /admin/users — list users, invite new ones, edit role / company / admin flag.
// Invite flow defaults to email link; falls back to a temp password if the admin
// toggles that option (useful while Firebase email-link sign-in isn't yet
// enabled in the project's console).

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { watchUsers, updateUser } from '../../lib/users'
import {
  createPendingInvite, sendInviteEmail, createUserWithTempPassword,
} from '../../lib/invites'
import { watchFleetCompanies } from '../../lib/fleetCompanies'
import { ROLE_REGISTRY } from '../../lib/roles'
import Icon from '../../components/ui/Icon'
import PageHero, { HeroStat } from '../../components/ui/PageHero'

const ROLE_OPTIONS = Object.entries(ROLE_REGISTRY).map(([key, info]) => ({
  value: key,
  label: info.label,
  category: info.category,
}))

export default function Users() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [companies, setCompanies] = useState([])

  const [mode, setMode] = useState(null) // null | 'invite' | {id} (edit)
  const [form, setForm] = useState(emptyForm())
  const [useTempPassword, setUseTempPassword] = useState(false)
  const [tempPwd, setTempPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [saveOk, setSaveOk] = useState(null)

  useEffect(() => {
    const uu = watchUsers(
      (list) => { setUsers(list); setLoading(false); setLoadErr(null) },
      (err) => { setLoadErr(err); setLoading(false) },
    )
    const uc = watchFleetCompanies((list) => setCompanies(list.filter((c) => c.isActive !== false)))
    return () => { uu?.(); uc?.() }
  }, [])

  const [userFilter, setUserFilter] = useState('ALL')
  const [companyFilter, setCompanyFilter] = useState('')

  const filteredUsers = useMemo(() => {
    const sorted = [...users].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    if (userFilter === 'ALL') return sorted
    if (userFilter === 'INTERNAL') {
      return sorted.filter((u) => {
        const info = ROLE_REGISTRY[u.role]
        return info?.category === 'internal' && !u.branch
      })
    }
    if (userFilter === 'FLEET_COMPANY') {
      const customerUsers = sorted.filter((u) => ROLE_REGISTRY[u.role]?.category === 'customer')
      if (!companyFilter) return customerUsers
      return customerUsers.filter((u) => {
        const uc = (u.company_id || u.company || '').toLowerCase().trim()
        const cf = companyFilter.toLowerCase().trim()
        return uc === cf || uc.includes(cf) || cf.includes(uc)
      })
    }
    // Filter by specific branch
    return sorted.filter((u) => (u.branch || '').toUpperCase() === userFilter)
  }, [users, userFilter, companyFilter])

  // Get unique branches for the filter
  const branches = useMemo(() => {
    const set = new Set()
    for (const u of users) {
      if (u.branch) set.add(u.branch.toUpperCase())
    }
    return [...set].sort()
  }, [users])

  const filterCounts = useMemo(() => ({
    ALL: users.length,
    INTERNAL: users.filter((u) => ROLE_REGISTRY[u.role]?.category === 'internal' && !u.branch).length,
    FLEET_COMPANY: users.filter((u) => ROLE_REGISTRY[u.role]?.category === 'customer').length,
  }), [users])

  const openInvite = () => {
    setForm(emptyForm())
    setUseTempPassword(false)
    setTempPwd('')
    setMode('invite')
    setSaveErr(null); setSaveOk(null)
  }

  const openEdit = (u) => {
    // Back-compat: if an existing doc stores `company` as a short code (e.g.
    // "PUREFOODS"), try to resolve it to the full client name so the dropdown
    // has a matching option. New saves always store the full name.
    const rawCompany = u.company_id || u.company || ''
    const matched = companies.find((c) => c.code === rawCompany || c.name === rawCompany)
    setForm({
      name: u.name || '',
      email: u.email || '',
      role: u.role || 'customer',
      company: matched ? matched.name : rawCompany,
      branch: u.branch || '',
      is_admin: Boolean(u.is_admin),
      quotation_approver: Boolean(u.quotation_approver),
    })
    setMode(u.id)
    setSaveErr(null); setSaveOk(null)
  }

  const closeForm = () => { setMode(null); setSaveErr(null); setSaveOk(null) }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveErr(null); setSaveOk(null)
    try {
      if (mode === 'invite') {
        await createPendingInvite(form.email, {
          name: form.name,
          role: form.role,
          company: form.company || null,
          branch: form.branch || null,
          is_admin: form.is_admin,
          quotation_approver: form.quotation_approver,
        })
        if (useTempPassword) {
          const pwd = tempPwd.trim() || defaultTempPwd()
          const uid = await createUserWithTempPassword(readConfigFromEnv(), form.email, pwd)
          setSaveOk(`User created. Share these credentials: ${form.email} / ${pwd}. (UID: ${uid})`)
        } else {
          await sendInviteEmail(form.email)
          setSaveOk(`Invite sent to ${form.email}. They'll click the link in their inbox to finish signing up.`)
        }
      } else {
        // edit existing
        await updateUser(mode, {
          name: form.name,
          role: form.role,
          company_id: form.company || null,
          branch: form.branch || null,
          is_admin: form.is_admin,
          quotation_approver: form.quotation_approver,
        })
        setSaveOk('User updated.')
      }
      setMode(null)
    } catch (err) {
      console.error('[users] save failed', err)
      setSaveErr(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleAdmin = async (u) => {
    try { await updateUser(u.id, { is_admin: !u.is_admin }) }
    catch (err) { alert('Failed: ' + (err.message || err)) }
  }

  const isCustomerRole = ['fleet_manager', 'fleet_user', 'customer'].includes(form.role)

  const adminCount = filteredUsers.filter((u) => u.is_admin).length

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Users"
        subtitle={`${filteredUsers.length} user${filteredUsers.length === 1 ? '' : 's'} · ${adminCount} admin${adminCount === 1 ? '' : 's'}`}
        right={<HeroStat value={filteredUsers.length} label="TOTAL" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'ALL', label: 'All' },
            { key: 'FLEET_COMPANY', label: 'Fleet Company' },
            { key: 'INTERNAL', label: 'Fleet Internal Users' },
            ...branches.map((b) => ({ key: b, label: b })),
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setUserFilter(t.key); if (t.key !== 'FLEET_COMPANY') setCompanyFilter('') }}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full whitespace-nowrap transition-colors ${
                userFilter === t.key
                  ? 'bg-brand text-white'
                  : 'bg-white border text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t.label}
              {filterCounts[t.key] != null && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  userFilter === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                }`}>
                  {filterCounts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {userFilter === 'FLEET_COMPANY' && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="input text-sm max-w-xs"
          >
            <option value="">All Fleet Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.name}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
            ))}
          </select>
        )}

        {mode === null && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-gray-600 text-xs sm:text-sm">
              Grant portal access and assign roles + fleet companies. Fleet customers only see vehicles from the company you pick here.
            </p>
            <button
              onClick={openInvite}
              className="bg-brand hover:bg-brand-dark text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 shrink-0"
            >
              <Icon name="plus" className="w-4 h-4" />
              Invite User
            </button>
          </div>
        )}

        {saveOk && <Banner kind="ok">{saveOk}</Banner>}
        {saveErr && <Banner kind="err">{saveErr}</Banner>}

      {mode !== null && (
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-5 space-y-4">
          <div className="text-sm font-bold uppercase tracking-widest text-gray-500">
            {mode === 'invite' ? 'Invite New User' : 'Edit User'}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Field label="Full name *">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="input" />
            </Field>
            <Field label="Email *">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={mode !== 'invite'} className="input" />
            </Field>
            <Field label="Role *">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
                <optgroup label="Fleet customer">
                  {ROLE_OPTIONS.filter((r) => r.category === 'customer').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </optgroup>
                <optgroup label="Internal (garage staff)">
                  {ROLE_OPTIONS.filter((r) => r.category === 'internal').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </optgroup>
              </select>
            </Field>
            {isCustomerRole ? (
              <Field label="Fleet Company *" hint="Must exactly match mg-fms's `header.client` value (e.g. 'Purefoods — San Miguel Corporation').">
                <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="input">
                  <option value="">— select —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Branch" hint="Which garage branch (e.g. MGCAVITE)?">
                <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value.toUpperCase() })} className="input uppercase" />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
              Grant admin access (can manage users + companies)
            </label>
            {isCustomerRole && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.quotation_approver} onChange={(e) => setForm({ ...form, quotation_approver: e.target.checked })} />
                Can approve/reject fleet quotations
              </label>
            )}
          </div>

          {mode === 'invite' && (
            <div className="border rounded-md p-3 bg-gray-50 space-y-2 text-xs">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useTempPassword} onChange={(e) => setUseTempPassword(e.target.checked)} />
                Send a temporary password instead of an email link
              </label>
              {useTempPassword ? (
                <div className="pl-6 space-y-1">
                  <div className="text-gray-600">The portal will create the Firebase account immediately. Share these credentials with the user.</div>
                  <input placeholder="Temp password (leave blank to auto-generate)" value={tempPwd} onChange={(e) => setTempPwd(e.target.value)} className="input" />
                </div>
              ) : (
                <div className="pl-6 text-gray-500">
                  Firebase will email a one-time sign-in link to <strong>{form.email || 'the user'}</strong>. They click it, set a password, and they're in. Requires "Email link (passwordless sign-in)" enabled in Firebase → Authentication → Sign-in method.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button type="submit" disabled={saving} className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium">
              {saving ? 'Saving…' : (mode === 'invite' ? 'Send invite' : 'Save changes')}
            </button>
            <button type="button" onClick={closeForm} disabled={saving} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-md text-sm font-medium">
              Cancel
            </button>
          </div>
        </form>
      )}

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-2">
          {loading && <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">Loading…</div>}
          {!loading && loadErr && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">
              Failed to load: {loadErr.message || String(loadErr)}
            </div>
          )}
          {!loading && !loadErr && filteredUsers.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">No users yet.</div>
          )}
          {filteredUsers.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              isYou={u.id === profile?.id}
              onEdit={() => openEdit(u)}
              onToggleAdmin={() => toggleAdmin(u)}
            />
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl shadow-sm border overflow-x-auto">
          <table className="min-w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Company / Branch</th>
                <th className="px-4 py-3 text-center font-medium">Admin</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && <Empty cols={6}>Loading…</Empty>}
              {!loading && loadErr && <Empty cols={6} error>Failed to load: {loadErr.message || String(loadErr)}</Empty>}
              {!loading && !loadErr && filteredUsers.length === 0 && <Empty cols={6}>No users yet.</Empty>}
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 font-medium text-gray-800">{u.name || '—'}</td>
                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                      {ROLE_REGISTRY[u.role]?.label || u.role || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {u.company_id || u.company
                      ? <span className="font-mono">{u.company_id || u.company}</span>
                      : u.branch
                        ? <span className="font-mono">{u.branch}</span>
                        : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleAdmin(u)}
                      className={`text-xs px-2 py-0.5 rounded-full ${u.is_admin ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {u.is_admin ? 'Admin' : '—'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openEdit(u)} className="text-brand hover:underline text-xs mr-3">Edit</button>
                    {u.id === profile?.id && <span className="text-[10px] text-gray-400">(you)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function UserCard({ user, isYou, onEdit, onToggleAdmin }) {
  const roleLabel = ROLE_REGISTRY[user.role]?.label || user.role || '—'
  const isCustomer = ROLE_REGISTRY[user.role]?.category === 'customer'
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center text-sm font-black shrink-0">
          {(user.name || user.email || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-gray-900 text-sm truncate">{user.name || '—'}</div>
            {isYou && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">YOU</span>}
          </div>
          <div className="text-[11px] text-gray-500 font-mono break-all">{user.email}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isCustomer ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-700'}`}>
              {roleLabel}
            </span>
            {(user.company_id || user.company) && (
              <span className="text-[10px] font-mono text-gray-600 bg-gray-50 border px-2 py-0.5 rounded-full">
                {user.company_id || user.company}
              </span>
            )}
            {!user.company_id && !user.company && user.branch && (
              <span className="text-[10px] font-mono text-gray-600 bg-gray-50 border px-2 py-0.5 rounded-full">
                {user.branch}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2">
        <button
          onClick={onToggleAdmin}
          className={`text-xs font-bold px-3 py-2 rounded-lg border-2 ${
            user.is_admin
              ? 'bg-amber-100 border-amber-300 text-amber-800'
              : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          {user.is_admin ? '★ Admin' : 'Make Admin'}
        </button>
        <button
          onClick={onEdit}
          className="text-xs bg-gray-900 hover:bg-black text-white font-bold px-3 py-2 rounded-lg"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

function Empty({ cols, children, error }) {
  return (
    <tr><td colSpan={cols} className={`px-4 py-8 text-center ${error ? 'text-red-500' : 'text-gray-400'}`}>{children}</td></tr>
  )
}

function Banner({ kind, children }) {
  const cls = kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
  return <div className={`mb-4 border rounded-md px-3 py-2 text-sm ${cls}`}>{children}</div>
}

function emptyForm() {
  return { name: '', email: '', role: 'fleet_user', company: '', branch: '', is_admin: false, quotation_approver: false }
}

function defaultTempPwd() {
  // Short, readable, safe-enough for first-time login.
  const base = Math.random().toString(36).slice(2, 8)
  return `MG${base.toUpperCase()}!`
}

function readConfigFromEnv() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
}
