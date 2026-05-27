import { useEffect, useState } from 'react'
import {
  createFleetCompany,
  setFleetCompanyActive,
  updateFleetCompany,
  watchFleetCompanies,
} from '../../lib/fleetCompanies'
import { MGFMS_CLIENTS } from '../../lib/dummyData'
import Icon from '../../components/ui/Icon'
import PageHero, { HeroStat } from '../../components/ui/PageHero'

const EMPTY = { name: '', code: '', contactEmail: '', contactPhone: '', paymentTerms: 'NET_30', isActive: true, hasBrokerMarkup: false, brokerMarkupPercent: 0 }

const PAYMENT_TERM_OPTIONS = [
  { value: 'CASH',   label: 'Cash on receipt' },
  { value: 'NET_30', label: 'Net 30 days' },
  { value: 'NET_60', label: 'Net 60 days' },
  { value: 'NET_90', label: 'Net 90 days' },
]

function termsLabel(value) {
  return PAYMENT_TERM_OPTIONS.find((o) => o.value === value)?.label || 'Net 30 days'
}

export default function FleetCompanies() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [seeding, setSeeding] = useState(false)

  const seedFromMgFms = async () => {
    setSeeding(true)
    setSaveError(null)
    try {
      const existingNames = new Set(rows.map((r) => (r.name || '').trim()))
      for (const c of MGFMS_CLIENTS) {
        if (existingNames.has(c.name)) continue
        await createFleetCompany({
          name: c.name,
          code: c.code,
          contactEmail: '',
          contactPhone: '',
          paymentTerms: 'NET_30',
          isActive: true,
        })
      }
    } catch (err) {
      setSaveError(err.message || String(err))
    } finally {
      setSeeding(false)
    }
  }

  useEffect(() => {
    const unsub = watchFleetCompanies(
      (list) => {
        setRows(list)
        setLoading(false)
        setLoadError(null)
      },
      (err) => {
        setLoadError(err)
        setLoading(false)
      },
    )
    return unsub
  }, [])

  const openAdd = () => {
    setForm(EMPTY)
    setEditingId('new')
    setSaveError(null)
  }

  const openEdit = (row) => {
    setForm({
      name: row.name || '',
      code: row.code || '',
      contactEmail: row.contactEmail || '',
      contactPhone: row.contactPhone || '',
      paymentTerms: row.paymentTerms || 'NET_30',
      isActive: row.isActive !== false,
      hasBrokerMarkup: Boolean(row.hasBrokerMarkup),
      brokerMarkupPercent: Number(row.brokerMarkupPercent) || 0,
    })
    setEditingId(row.id)
    setSaveError(null)
  }

  const closeForm = () => {
    setEditingId(null)
    setForm(EMPTY)
    setSaveError(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      if (editingId === 'new') {
        await createFleetCompany(form)
      } else {
        await updateFleetCompany(editingId, form)
      }
      closeForm()
    } catch (err) {
      setSaveError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row) => {
    try {
      await setFleetCompanyActive(row.id, !row.isActive)
    } catch (err) {
      alert('Failed to update status: ' + (err.message || err))
    }
  }

  const activeCount = rows.filter((r) => r.isActive !== false).length

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ADMIN"
        title="Fleet Companies"
        subtitle={`${rows.length} total · ${activeCount} active`}
        right={<HeroStat value={rows.length} label="TOTAL" tone="solid" />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {editingId === null && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-gray-600 text-xs sm:text-sm">
              Manage the companies whose fleets are serviced through the portal.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={seedFromMgFms}
                disabled={seeding}
                title="Creates the 3 real fleet clients that mg-fms uses (Purefoods, National Museum, ChinaBank)."
                className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-2.5 rounded-xl text-xs font-bold border border-gray-300"
              >
                {seeding ? 'Seeding…' : 'Seed from mg-fms'}
              </button>
              <button
                onClick={openAdd}
                className="bg-brand hover:bg-brand-dark text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1.5"
              >
                <Icon name="plus" className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        )}

        {editingId !== null && (
          <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-5 space-y-4">
            <div className="text-sm font-bold uppercase tracking-widest text-gray-500">
              {editingId === 'new' ? 'Add Fleet Company' : 'Edit Fleet Company'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company name *">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Purefoods Corporation"
                  required
                  className="input"
                />
              </Field>
              <Field label="Company code *" hint="Short uppercase ID used internally.">
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. PUREFOODS"
                  required
                  className="input font-mono uppercase"
                />
              </Field>
              <Field label="Contact email">
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  placeholder="contact@company.com"
                  className="input"
                />
              </Field>
              <Field label="Contact phone">
                <input
                  type="text"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  placeholder="+63 ..."
                  className="input"
                />
              </Field>
              <Field label="Payment terms" hint="Drives the due date on client invoices. Snapshot per-invoice — changing this won't shift already-issued bills.">
                <select
                  value={form.paymentTerms}
                  onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                  className="input"
                >
                  {PAYMENT_TERM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.hasBrokerMarkup}
                  onChange={(e) => setForm({ ...form, hasBrokerMarkup: e.target.checked, brokerMarkupPercent: e.target.checked ? form.brokerMarkupPercent : 0 })}
                />
                With broker / middleman
              </label>
              {form.hasBrokerMarkup && (
                <Field label="Broker markup %" hint="Percentage added on top of MG base prices for client billing.">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={form.brokerMarkupPercent}
                    onChange={(e) => setForm({ ...form, brokerMarkupPercent: e.target.value })}
                    placeholder="e.g. 15"
                    className="input w-32"
                  />
                </Field>
              )}
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>

            {saveError && (
              <div className="text-sm text-red-600">Save failed: {saveError}</div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-bold"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Mobile: card list */}
        <div className="lg:hidden space-y-2">
          {loading && <div className="bg-white rounded-2xl border p-6 text-center text-gray-400 text-sm">Loading…</div>}
          {!loading && loadError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">
              Failed to load: {loadError.message || String(loadError)}
            </div>
          )}
          {!loading && !loadError && rows.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">
              No fleet companies yet.
            </div>
          )}
          {rows.map((row) => (
            <CompanyCard
              key={row.id}
              row={row}
              onEdit={() => openEdit(row)}
              onToggleActive={() => toggleActive(row)}
            />
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden lg:block bg-white rounded-2xl shadow-sm border overflow-x-auto">
          <table className="min-w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Contact</th>
                <th className="px-4 py-3 text-left font-medium">Terms</th>
                <th className="px-4 py-3 text-left font-medium">Broker Markup</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && <EmptyRow>Loading…</EmptyRow>}
              {!loading && loadError && (
                <EmptyRow className="text-red-500">
                  Failed to load: {loadError.message || String(loadError)}
                </EmptyRow>
              )}
              {!loading && !loadError && rows.length === 0 && (
                <EmptyRow>No fleet companies yet.</EmptyRow>
              )}
              {rows.map((row) => (
                <tr key={row.id} className={row.isActive === false ? 'opacity-60' : ''}>
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{row.code || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{row.contactEmail || '—'}</div>
                    {row.contactPhone && (
                      <div className="text-xs text-gray-400">{row.contactPhone}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 font-mono">{termsLabel(row.paymentTerms)}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.hasBrokerMarkup ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
                        +{Number(row.brokerMarkupPercent) || 0}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.isActive === false ? (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">
                        Inactive
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(row)} className="text-brand hover:underline text-xs font-medium mr-3">Edit</button>
                    <button onClick={() => toggleActive(row)} className="text-gray-500 hover:text-gray-800 text-xs font-medium">
                      {row.isActive === false ? 'Reactivate' : 'Deactivate'}
                    </button>
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

function CompanyCard({ row, onEdit, onToggleActive }) {
  const isActive = row.isActive !== false
  return (
    <div className={`bg-white rounded-2xl border p-4 ${isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-900 text-sm break-words">{row.name || '—'}</div>
          <div className="text-[11px] text-gray-500 font-mono mt-0.5">{row.code || '—'}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="text-xs text-gray-600 space-y-0.5 pb-3 border-b mb-3">
        {row.contactEmail && <div className="break-all">{row.contactEmail}</div>}
        {row.contactPhone && <div className="font-mono">{row.contactPhone}</div>}
        <div className="text-[11px] text-gray-500">
          Terms: <span className="font-bold text-gray-700">{termsLabel(row.paymentTerms)}</span>
        </div>
        {row.hasBrokerMarkup && (
          <div className="text-[11px]">
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">
              Broker +{Number(row.brokerMarkupPercent) || 0}%
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onEdit}
          className="text-xs bg-gray-900 hover:bg-black text-white font-bold px-3 py-2 rounded-lg"
        >
          Edit
        </button>
        <button
          onClick={onToggleActive}
          className={`text-xs font-bold px-3 py-2 rounded-lg border-2 ${isActive ? 'bg-white border-gray-200 text-gray-600' : 'bg-green-600 border-green-600 text-white'}`}
        >
          {isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

function EmptyRow({ children, className = 'text-gray-400' }) {
  return (
    <tr>
      <td colSpan={7} className={`px-4 py-8 text-center ${className}`}>
        {children}
      </td>
    </tr>
  )
}
