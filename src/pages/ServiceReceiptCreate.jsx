// Create Service Receipt — writes to Firestore via createReceipt.
//
// Mobile: line items become a vertical stack of cards with proper-sized
// inputs and per-card remove/duplicate controls. Grand total lives in a
// sticky footer above the submit bar. Desktop keeps the table.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MECHANICS, formatMoney } from '../lib/dummyData'
import { watchVehicles } from '../lib/vehicles'
import { createReceipt } from '../lib/serviceReceipts'
import Icon from '../components/ui/Icon'
import PageHero from '../components/ui/PageHero'

const PARTS_CATALOG = [
  { code: 'P001', name: 'ENGINE FILTER',        compat: 'Toyota Vios, Honda City',   supplier: 'AutoPlus',         unitCost: 500,  srp: 700,  stock: 15, reserved: 2 },
  { code: 'P002', name: 'OIL FILTER',           compat: 'Toyota Innova, Honda Civic',supplier: 'Autoplus Trading', unitCost: 200,  srp: 400,  stock: 20, reserved: 3 },
  { code: 'P003', name: 'US LUBE GASOLINE',     compat: 'All',                        supplier: 'US Lube Inc.',     unitCost: 250,  srp: 350,  stock: 40, reserved: 0 },
  { code: 'P004', name: 'CABIN FILTER',         compat: 'Toyota Vios, Innova',        supplier: 'Autoplus Trading', unitCost: 350,  srp: 550,  stock: 8,  reserved: 1 },
  { code: 'P005', name: 'ENGINE SUPPORT FOR VIOS', compat: 'Toyota Vios 2003',       supplier: 'Autoplus Trading', unitCost: 1200, srp: 1800, stock: 2,  reserved: 0 },
  { code: 'P006', name: 'DRY RAG',              compat: 'All',                        supplier: 'General Supply',   unitCost: 10,   srp: 15,   stock: 500, reserved: 0 },
  { code: 'L001', name: 'PREVENTIVE MAINTENANCE SERVICE', compat: '', supplier: '', unitCost: 2500, srp: 2500, stock: null, reserved: null },
  { code: 'L002', name: 'REPLACE ENGINE SUPPORT',         compat: '', supplier: '', unitCost: 800,  srp: 800,  stock: null, reserved: null },
]

// `kind` is "receipt" (default) or "quotation" — chosen by the route the user
// arrived from. A quotation enters the Round 10 approval chain at DRAFT; a
// receipt goes straight into the OPEN → PAID/CANCELLED flow.
export default function ServiceReceiptCreate({ kind = 'receipt' }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const initialPlate = (search.get('plate') || '').toUpperCase()
  const isQuotation = kind === 'quotation'

  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    const unsub = watchVehicles({ dummyFallback: true }, ({ vehicles }) => setVehicles(vehicles))
    return unsub
  }, [])

  const [plate, setPlate] = useState(initialPlate)
  const vehicle = useMemo(
    () => vehicles.find((v) => v.plateNo === plate) || vehicles[0] || {},
    [plate, vehicles],
  )

  const [odo, setOdo] = useState(vehicle.latestOdo || 0)
  const [customerName, setCustomerName] = useState(vehicle.assignedTo || 'CUSTOMER 100')
  const [mobile, setMobile] = useState('')
  const [notes, setNotes] = useState('')
  const [mechanic, setMechanic] = useState('Amelia Castillo')
  const [items, setItems] = useState([
    { type: 'Labor', qty: 1, description: 'PREVENTIVE MAINTENANCE SERVICE', unitCost: 2500 },
    { type: 'Parts', qty: 1, description: '', unitCost: 0 },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Sync to selected vehicle when list arrives / plate changes
  useEffect(() => {
    if (!vehicle) return
    setOdo(vehicle.latestOdo || 0)
    setCustomerName(vehicle.assignedTo || customerName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.plateNo])

  const laborTotal = items.filter((i) => i.type === 'Labor').reduce((s, i) => s + i.qty * i.unitCost, 0)
  const matTotal   = items.filter((i) => i.type !== 'Labor').reduce((s, i) => s + i.qty * i.unitCost, 0)
  const grandTotal = laborTotal + matTotal

  const addRow = () => setItems([...items, { type: 'Parts/Materials', qty: 1, description: '', unitCost: 0 }])
  const removeRow = (i) => setItems(items.filter((_, idx) => idx !== i))
  const updateRow = (i, patch) => setItems(items.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const { code } = await createReceipt(kind, {
        plateNo: plate,
        brandModel: vehicle.brandModel || '',
        latestOdo: odo,
        customer: customerName,
        mobile,
        company: vehicle.company || null,
        branch: (profile?.branch || 'MGCAVITE').toUpperCase(),
        mechanic,
        personInCharge: profile?.name || 'Admin',
        scheduleType: 'SCHEDULED',
        items,
        notes,
        byProfile: profile,
      })
      navigate(`/service-receipts/${code}`)
    } catch (err) {
      console.error('[receipt] create failed', err)
      setError(err.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="pb-32">
      <PageHero
        eyebrow={isQuotation ? 'NEW QUOTATION' : 'NEW RECEIPT'}
        title={isQuotation ? 'Create Service Quotation' : 'Create Service Receipt'}
        subtitle={plate ? `${plate}${vehicle.brandModel ? ` · ${vehicle.brandModel}` : ''}` : 'Enter customer + vehicle details below'}
        right={<GrandTotalChip value={grandTotal} />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-sm">Save failed: {error}</div>}

        <Section title="Customer & Vehicle">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Plate No. *">
              <input className="input uppercase font-mono" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required />
            </Field>
            <Field label="Name *">
              <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value.toUpperCase())} required />
            </Field>
            <Field label="Brand / Model">
              <div className="py-2 text-gray-800 text-sm">{vehicle.brandModel || '—'}</div>
            </Field>
            <Field label="Mobile No">
              <input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Field>
            <Field label="Latest Odometer *">
              <input type="number" className="input" value={odo} onChange={(e) => setOdo(Number(e.target.value))} required />
            </Field>
            <Field label="Schedule Type">
              <div className="py-2 text-gray-800 text-sm">SCHEDULED</div>
            </Field>
          </div>
        </Section>

        {/* Line items — mobile card stack, desktop table */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Labor · Parts · Materials</div>
            <span className="text-xs text-gray-400">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>

          {/* Mobile: vertical card stack */}
          <div className="lg:hidden space-y-3">
            {items.map((row, i) => (
              <LineCard
                key={i}
                index={i}
                row={row}
                onChange={(patch) => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
                canRemove={items.length > 1}
              />
            ))}
            <button
              type="button"
              onClick={addRow}
              className="w-full bg-white border-2 border-dashed border-gray-300 text-gray-600 hover:border-brand hover:text-brand rounded-2xl py-3 font-bold text-sm flex items-center justify-center gap-1.5"
            >
              <Icon name="plus" className="w-4 h-4" />
              Add Another Item
            </button>
          </div>

          {/* Desktop: table */}
          <div className="hidden lg:block bg-white rounded-2xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Qty</th>
                    <th className="px-3 py-2 text-left font-medium">Service / Parts / Materials</th>
                    <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Sub Total</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((row, i) => (
                    <LineRow
                      key={i}
                      row={row}
                      onChange={(patch) => updateRow(i, patch)}
                      onAdd={addRow}
                      onRemove={() => removeRow(i)}
                      isLast={i === items.length - 1}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <Section title="Assignment & Notes">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Assigned Mechanic">
              <select className="input" value={mechanic} onChange={(e) => setMechanic(e.target.value)}>
                {MECHANICS.map((m) => <option key={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Total Labor">
              <div className="text-right py-2 font-bold text-gray-800">{formatMoney(laborTotal)}</div>
            </Field>
            <Field label="Total Materials">
              <div className="text-right py-2 font-bold text-gray-800">{formatMoney(matTotal)}</div>
            </Field>
            <Field label="Notes" className="sm:col-span-3">
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Section>
      </div>

      {/* Sticky bottom submit bar with grand total */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <div className="px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Grand Total</div>
            <div className="text-xl sm:text-2xl font-black text-green-700 leading-tight">{formatMoney(grandTotal)}</div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-bold text-sm px-6 py-3 rounded-xl shadow active:scale-95 transition-transform shrink-0"
          >
            {submitting ? 'Saving…' : (isQuotation ? 'Save as Draft' : 'Submit Receipt')}
          </button>
        </div>
      </div>
    </form>
  )
}

function GrandTotalChip({ value }) {
  return (
    <div className="bg-white/15 rounded-xl px-3 py-2 text-right min-w-[110px]">
      <div className="text-[9px] font-bold tracking-widest text-white/60">GRAND TOTAL</div>
      <div className="text-xl font-black text-white leading-none mt-0.5">{formatMoney(value)}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// Mobile-first card for a single line item. Full-size inputs, an integer
// stepper for qty, and a clear remove button. The parts autocomplete opens
// as a full-width dropdown below the search field.
function LineCard({ index, row, onChange, onRemove, canRemove }) {
  const [showAuto, setShowAuto] = useState(false)
  const subTotal = row.qty * row.unitCost
  const filtered = row.description
    ? PARTS_CATALOG.filter((p) => p.name.toLowerCase().includes(row.description.toLowerCase())).slice(0, 6)
    : []
  const pick = (p) => { onChange({ description: p.name, unitCost: p.srp || p.unitCost }); setShowAuto(false) }

  const isLabor = row.type === 'Labor'
  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${isLabor ? 'border-sky-200' : 'border-gray-200'}`}>
      <div className={`px-4 py-2 border-b flex items-center justify-between ${isLabor ? 'bg-sky-50' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${isLabor ? 'bg-sky-600 text-white' : 'bg-gray-700 text-white'}`}>
            #{index + 1} · {isLabor ? 'Labor' : 'Parts'}
          </span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1"
          >
            <Icon name="warn" className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {['Labor', 'Parts/Materials'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ type: t })}
                className={`text-sm font-bold py-2.5 rounded-xl border-2 transition-colors ${
                  row.type === t
                    ? (t === 'Labor' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-gray-800 border-gray-800 text-white')
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
            Service / Parts / Materials
          </label>
          <input
            className="input"
            value={row.description}
            onChange={(e) => { onChange({ description: e.target.value }); setShowAuto(true) }}
            onFocus={() => setShowAuto(true)}
            onBlur={() => setTimeout(() => setShowAuto(false), 150)}
            placeholder="Search catalog or enter custom…"
          />
          {showAuto && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border rounded-xl shadow-xl text-xs max-h-64 overflow-y-auto">
              {filtered.map((p) => (
                <button type="button" key={p.code} onClick={() => pick(p)} className="block w-full text-left px-3 py-2 hover:bg-sky-50 border-b last:border-b-0">
                  <div className="font-semibold text-gray-800">{p.name} <span className="font-mono text-gray-400">({p.code})</span></div>
                  {p.compat && <div className="text-[11px] text-gray-500">{p.compat}</div>}
                  <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                    <span className="font-bold text-green-700">{formatMoney(p.srp || p.unitCost)}</span>
                    {p.supplier && <span>· {p.supplier}</span>}
                    {p.stock != null && <span>· stock {p.stock}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Qty</label>
            <div className="flex items-center bg-gray-50 border rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => onChange({ qty: Math.max(1, (row.qty || 1) - 1) })}
                className="w-10 h-11 text-xl font-black text-gray-600 hover:bg-gray-100"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                value={row.qty}
                onChange={(e) => onChange({ qty: Math.max(1, Number(e.target.value) || 1) })}
                className="flex-1 bg-transparent text-center font-bold text-base focus:outline-none min-w-0"
              />
              <button
                type="button"
                onClick={() => onChange({ qty: (row.qty || 1) + 1 })}
                className="w-10 h-11 text-xl font-black text-gray-600 hover:bg-gray-100"
              >
                +
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Unit Cost</label>
            <input
              type="number"
              min="0"
              value={row.unitCost}
              onChange={(e) => onChange({ unitCost: Number(e.target.value) || 0 })}
              className="input text-right font-mono"
            />
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Sub Total</span>
          <span className="text-lg font-black text-gray-900">{formatMoney(subTotal)}</span>
        </div>
      </div>
    </div>
  )
}

function LineRow({ row, onChange, onAdd, onRemove, isLast }) {
  const subTotal = row.qty * row.unitCost
  const [showAuto, setShowAuto] = useState(false)
  const filtered = row.description
    ? PARTS_CATALOG.filter((p) => p.name.toLowerCase().includes(row.description.toLowerCase())).slice(0, 6)
    : []
  const pick = (p) => { onChange({ description: p.name, unitCost: p.srp || p.unitCost }); setShowAuto(false) }

  return (
    <tr>
      <td className="px-3 py-2">
        <select value={row.type} onChange={(e) => onChange({ type: e.target.value })} className="input py-1 text-sm sm:text-xs min-w-[110px]">
          <option>Labor</option>
          <option>Parts/Materials</option>
        </select>
      </td>
      <td className="px-3 py-2 w-20">
        <input type="number" min="1" className="input py-1 text-sm sm:text-xs text-right" value={row.qty} onChange={(e) => onChange({ qty: Number(e.target.value) })} />
      </td>
      <td className="px-3 py-2 relative">
        <input
          className="input py-1 text-sm sm:text-xs"
          value={row.description}
          onChange={(e) => { onChange({ description: e.target.value }); setShowAuto(true) }}
          onFocus={() => setShowAuto(true)}
          placeholder="Search parts / service..."
        />
        {showAuto && filtered.length > 0 && (
          <div className="absolute top-full left-0 z-20 mt-1 w-[90vw] max-w-sm sm:w-80 bg-white border rounded-md shadow-xl text-xs">
            {filtered.map((p) => (
              <button type="button" key={p.code} onClick={() => pick(p)} className="block w-full text-left px-3 py-2 hover:bg-sky-50 border-b last:border-b-0">
                <div className="font-semibold text-gray-800">{p.name} ({p.code})</div>
                {p.compat && <div className="text-[11px] text-gray-500">Compatible to: {p.compat}</div>}
                {p.supplier && (
                  <div className="text-[11px] text-gray-500">
                    Supplier: {p.supplier} | Stock: {p.stock} | Reserved: {p.reserved} | SRP: {formatMoney(p.srp)}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 w-32">
        <input type="number" className="input py-1 text-sm sm:text-xs text-right" value={row.unitCost} onChange={(e) => onChange({ unitCost: Number(e.target.value) })} />
      </td>
      <td className="px-3 py-2 w-28 text-right font-semibold">{formatMoney(subTotal)}</td>
      <td className="px-3 py-2 w-20 text-center">
        {isLast ? (
          <button type="button" onClick={onAdd} className="bg-green-600 hover:bg-green-700 text-white rounded w-7 h-7 inline-flex items-center justify-center"><Icon name="plus" className="w-4 h-4" /></button>
        ) : (
          <button type="button" onClick={onRemove} className="bg-red-500 hover:bg-red-600 text-white rounded w-7 h-7 inline-flex items-center justify-center">−</button>
        )}
      </td>
    </tr>
  )
}
