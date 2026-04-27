// Client Invoice detail. Like the branch invoice, line items are immutable —
// snapshot taken at issue time so later quote edits don't retroactively
// change what the client was billed. Mutations allowed: VOID (only while
// no payments recorded — any payment forces the credit-note path in
// Round 15) and Record Payment (one or many; auto-flips to PAID at zero
// balance).

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatMoney, formatDate, formatDateTime } from '../lib/dummyData'
import { isCustomer } from '../lib/roles'
import { profileCompany } from '../lib/vehicles'
import { CREDIT_NOTE_KIND } from '../lib/creditNotes'
import CreditNotesSection from '../components/CreditNotesSection'
import PrintInvoice from '../components/PrintInvoice'
import {
  CLIENT_INVOICE_STATUS,
  PAYMENT_METHODS,
  PAYMENT_TERMS_LABEL,
  agingFor,
  balanceDue as balanceDueOf,
  effectiveStatus,
  paymentsTotal as paymentsTotalOf,
  recordPayment,
  voidClientInvoice,
  watchClientInvoiceByCode,
} from '../lib/clientInvoices'
import Icon from '../components/ui/Icon'
import PageHero from '../components/ui/PageHero'
import StatusPill from '../components/ui/StatusPill'

export default function ClientInvoiceDetails() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('loading')
  const [voidModalOpen, setVoidModalOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const unsub = watchClientInvoiceByCode(code, ({ invoice, source }) => {
      setInvoice(invoice); setSource(source); setLoading(false)
    })
    return unsub
  }, [code])

  if (loading) return <div className="p-4 sm:p-6 text-gray-500">Loading invoice…</div>
  if (!invoice) return (
    <div className="p-4 sm:p-6 space-y-3">
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
        <div className="font-semibold mb-1">Invoice not found</div>
        <div className="text-xs">
          No client invoice with code <span className="font-mono">{code}</span>.
          {source === 'error' && ' (Firestore read failed.)'}
        </div>
      </div>
    </div>
  )

  const customerView = isCustomer(profile?.role) && !profile?.is_admin

  // Defense in depth: clients can only open their own company's invoices.
  // (Firestore rules should also enforce this server-side.)
  if (customerView) {
    const myCompany = (profileCompany(profile) || '').toString().trim().toLowerCase()
    const billed = (invoice.company || '').toString().trim().toLowerCase()
    if (myCompany && billed && myCompany !== billed) {
      return (
        <div className="p-4 sm:p-6 space-y-3">
          <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
            <div className="font-semibold mb-1">Not your invoice</div>
            <div className="text-xs">This invoice belongs to a different company.</div>
          </div>
        </div>
      )
    }
  }

  const eff = effectiveStatus(invoice, now)
  const aging = agingFor(invoice, now)
  const balance = balanceDueOf(invoice)
  const paid = paymentsTotalOf(invoice)

  // Permission gates: clients are read-only. Internal finance/admin can act.
  const canAct = !customerView
  const canVoid = canAct && invoice.status === CLIENT_INVOICE_STATUS.OPEN && paid === 0 && (
    profile?.is_admin || profile?.role === 'finance' || profile?.role === 'branch_manager'
  )
  const canPay = canAct && invoice.status === CLIENT_INVOICE_STATUS.OPEN && balance > 0 && (
    profile?.is_admin || profile?.role === 'finance'
  )

  return (
    <div className="pb-32">
      {/* Print-only: clean external invoice document. Hidden on screen. */}
      <PrintInvoice kind="client" invoice={invoice} />

      {/* Screen-only: full audit detail. */}
      <div className="print:hidden">
      <PageHero
        eyebrow={customerView ? 'YOUR INVOICE' : 'CLIENT INVOICE'}
        title={invoice.code}
        subtitle={`${invoice.plateNo || ''} · ${invoice.company || '—'}`}
        right={<TotalChip total={invoice.total} balance={balance} status={invoice.status} />}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={eff} />
          {invoice.paymentTerms && (
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
              {PAYMENT_TERMS_LABEL[invoice.paymentTerms] || invoice.paymentTerms}
            </span>
          )}
          {invoice.issuedAtIso && (
            <span className="text-[11px] text-gray-500">
              Issued {formatDate(invoice.issuedAtIso)}
              {invoice.issuedByName && ` by ${invoice.issuedByName}`}
            </span>
          )}
          {invoice.dueAtIso && (
            <span className={`text-[11px] font-bold ${eff === 'OVERDUE' ? 'text-red-700' : 'text-gray-600'}`}>
              Due {formatDate(invoice.dueAtIso)}
              {eff === 'OVERDUE' && ` · ${aging.daysPastDue}d overdue`}
            </span>
          )}
        </div>

        {invoice.status === CLIENT_INVOICE_STATUS.VOID && invoice.voidReason && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
            <div className="font-black text-red-800 text-sm">Voided</div>
            <div className="text-xs text-red-700 mt-1">
              {invoice.voidedByName || 'Staff'}{invoice.voidedAt ? ` · ${formatDate(invoice.voidedAt)}` : ''}
            </div>
            <div className="text-xs text-red-800 mt-2 italic">"{invoice.voidReason}"</div>
          </div>
        )}

        {!customerView && <LinkedDocsCard invoice={invoice} />}

        <CustomerCard invoice={invoice} />

        <ItemsCard invoice={invoice} />

        <PaymentsCard invoice={invoice} customerView={customerView} />

        <CreditNotesSection
          invoice={invoice}
          kind={CREDIT_NOTE_KIND.CLIENT}
          profile={profile}
          customerView={customerView}
        />

        <TotalsCard invoice={invoice} balance={balance} paid={paid} />
      </div>

      {/* Sticky action bar — clients see Print only; staff see full set. */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <div className={`px-3 sm:px-6 py-3 grid gap-2 ${customerView ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icon name="print" className="w-4 h-4" />
            Print
          </button>
          {!customerView && (
            <>
              <button
                type="button"
                onClick={() => canPay && setPayModalOpen(true)}
                disabled={!canPay}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-3 rounded-xl active:scale-95 transition-transform"
                title={canPay ? 'Record a payment' : 'Only finance or admin can record payments'}
              >
                {invoice.status === CLIENT_INVOICE_STATUS.PAID ? 'Paid in full' : 'Record payment'}
              </button>
              <button
                type="button"
                onClick={() => canVoid && setVoidModalOpen(true)}
                disabled={!canVoid}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-3 rounded-xl active:scale-95 transition-transform"
                title={
                  paid > 0
                    ? 'Cannot void — payments already recorded. Use a credit note (Round 15).'
                    : (canVoid ? 'Void this invoice' : 'Only finance, branch manager, or admin can void')
                }
              >
                {invoice.status !== CLIENT_INVOICE_STATUS.OPEN
                  ? `Invoice ${invoice.status.toLowerCase()}`
                  : 'Void'}
              </button>
            </>
          )}
        </div>
      </div>

      {voidModalOpen && (
        <VoidModal
          invoice={invoice}
          profile={profile}
          onClose={() => setVoidModalOpen(false)}
          onVoided={() => setVoidModalOpen(false)}
        />
      )}
      {payModalOpen && (
        <PaymentModal
          invoice={invoice}
          balance={balance}
          profile={profile}
          onClose={() => setPayModalOpen(false)}
          onRecorded={() => setPayModalOpen(false)}
        />
      )}
      </div>
    </div>
  )
}

function LinkedDocsCard({ invoice }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        Sources
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Branch Invoice</div>
          {invoice.branchInvoiceCode ? (
            <Link to={`/branch-invoices/${invoice.branchInvoiceCode}`} className="text-brand font-mono font-semibold hover:underline">
              {invoice.branchInvoiceCode}
            </Link>
          ) : <span className="text-gray-400">—</span>}
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Source Quotation</div>
          {invoice.quotationCode ? (
            <Link to={`/service-receipts/${invoice.quotationCode}`} className="text-brand font-mono font-semibold hover:underline">
              {invoice.quotationCode}
            </Link>
          ) : <span className="text-gray-400">—</span>}
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Post-repair RWA</div>
          {invoice.reassessmentRwa ? (
            <Link to={`/assessments/${invoice.reassessmentRwa}`} className="text-brand font-mono font-semibold hover:underline">
              {invoice.reassessmentRwa}
            </Link>
          ) : <span className="text-gray-400">—</span>}
        </div>
      </div>
    </div>
  )
}

function CustomerCard({ invoice }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        Bill To
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <Info label="Plate No.">
          <span className="bg-brand text-white font-mono font-bold tracking-wide px-3 py-1 rounded-lg inline-block">{invoice.plateNo || '—'}</span>
        </Info>
        <Info label="Brand / Model">{invoice.brandModel || '—'}</Info>
        <Info label="Driver / Custodian">{invoice.customer || '—'}</Info>
        <Info label="Fleet Company" className="sm:col-span-3">{invoice.company || '—'}</Info>
      </div>
    </div>
  )
}

function ItemsCard({ invoice }) {
  const items = invoice.items || []
  const groups = new Map()
  for (const i of items) {
    const r = Number(i.revisionRound) || 1
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  }
  const rounds = [...groups.keys()].sort((a, b) => a - b)

  return (
    <div className="space-y-2">
      {rounds.map((round) => {
        const roundItems = groups.get(round)
        const subtotal = roundItems.reduce((s, i) => s + (i.subTotal || i.qty * i.unitCost), 0)
        const isOriginal = round === 1
        return (
          <div key={round} className="bg-white rounded-2xl border overflow-hidden">
            <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isOriginal ? 'bg-gray-50' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full ${isOriginal ? 'bg-gray-700 text-white' : 'bg-amber-600 text-white'}`}>
                  Rev {round}
                </span>
                <span className={`text-[11px] font-semibold ${isOriginal ? 'text-gray-600' : 'text-amber-800'}`}>
                  {roundItems.length} item{roundItems.length === 1 ? '' : 's'}
                </span>
              </div>
              <span className="text-sm font-black text-gray-800">{formatMoney(subtotal)}</span>
            </div>

            <div className="lg:hidden divide-y">
              {roundItems.map((item, i) => (
                <div key={i} className="p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${item.type === 'Labor' ? 'bg-sky-600 text-white' : 'bg-gray-700 text-white'}`}>
                      {item.type}
                    </span>
                    <span className="text-xs text-gray-500 font-bold">× {item.qty}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 uppercase break-words">{item.description}</div>
                  <div className="mt-1.5 flex items-baseline justify-between">
                    <span className="text-[11px] text-gray-500">{formatMoney(item.unitCost)} × {item.qty}</span>
                    <span className="text-base font-black text-gray-900">{formatMoney(item.subTotal || item.qty * item.unitCost)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Type</th>
                    <th className="px-4 py-2 text-left font-medium">Qty</th>
                    <th className="px-4 py-2 text-left font-medium">Description</th>
                    <th className="px-4 py-2 text-right font-medium">Unit Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Sub Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {roundItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">{item.type}</td>
                      <td className="px-4 py-2">{item.qty}</td>
                      <td className="px-4 py-2 uppercase">{item.description}</td>
                      <td className="px-4 py-2 text-right">{formatMoney(item.unitCost)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatMoney(item.subTotal || item.qty * item.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PaymentsCard({ invoice, customerView }) {
  const payments = Array.isArray(invoice.payments) ? invoice.payments : []
  if (payments.length === 0 && customerView) return null
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        Payments
      </div>
      {payments.length === 0 ? (
        <div className="p-4 text-sm text-gray-400 italic">No payments recorded yet.</div>
      ) : (
        <ul className="divide-y">
          {payments.map((p, i) => (
            <li key={i} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-900">{p.method}</div>
                {p.reference && <div className="text-[11px] text-gray-500 font-mono">Ref: {p.reference}</div>}
                {p.note && <div className="text-[11px] text-gray-500 italic mt-0.5">{p.note}</div>}
                <div className="text-[10px] text-gray-400 mt-1">
                  {p.paidAt ? formatDateTime(p.paidAt) : '—'}
                  {p.recordedByName && ` · ${p.recordedByName}`}
                </div>
              </div>
              <div className="text-base font-black text-green-700 shrink-0">{formatMoney(p.amount)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TotalsCard({ invoice, balance, paid }) {
  return (
    <div className="bg-white rounded-2xl border overflow-hidden">
      <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        Amount due
      </div>
      <div className="p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Labor</span>
          <span className="font-bold text-gray-900">{formatMoney(invoice.laborTotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Parts & Materials</span>
          <span className="font-bold text-gray-900">{formatMoney(invoice.materialsTotal)}</span>
        </div>
        <div className="border-t pt-3 mt-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-600">Total</span>
          <span className="text-xl font-black text-gray-900">{formatMoney(invoice.total)}</span>
        </div>
        {paid > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Paid</span>
            <span className="font-bold text-green-700">−{formatMoney(paid)}</span>
          </div>
        )}
        <div className="border-t pt-3 mt-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-600">Balance Due</span>
          <span className={`text-2xl font-black ${balance > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {formatMoney(balance)}
          </span>
        </div>
      </div>
    </div>
  )
}

function TotalChip({ total, balance, status }) {
  const showBalance = status === CLIENT_INVOICE_STATUS.OPEN && balance !== total
  return (
    <div className="bg-white/15 rounded-xl px-3 py-2 text-right min-w-[120px]">
      <div className="text-[9px] font-bold tracking-widest text-white/60">
        {showBalance ? 'BALANCE' : 'TOTAL'}
      </div>
      <div className="text-xl font-black text-white leading-none mt-0.5">{formatMoney(showBalance ? balance : total)}</div>
    </div>
  )
}

function Info({ label, children, className = '' }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</div>
      <div className="text-gray-900 text-sm break-words">{children}</div>
    </div>
  )
}

function VoidModal({ invoice, profile, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (saving) return
    const trimmed = reason.trim()
    if (!trimmed) { setError('A reason is required.'); return }
    setSaving(true); setError(null)
    try {
      await voidClientInvoice(invoice.id, { reason: trimmed, byProfile: profile })
      onVoided?.()
    } catch (err) {
      console.error('[clientInvoice] void failed:', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:w-[480px] sm:max-w-full rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-bold text-gray-900">Void invoice</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none w-8 h-8 flex items-center justify-center" aria-label="Close">×</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-3 py-2">
            Voiding <span className="font-mono font-bold">{invoice.code}</span> ({formatMoney(invoice.total)})
            cancels the receivable entirely. Use only for mistakes or pre-payment cancellations.
          </div>
          <textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for voiding (required). e.g. Duplicate invoice — corrected on CINV-00042."
            className="input"
            autoFocus
            disabled={saving}
          />
          {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">Failed: {error}</div>}
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-50 px-3 py-2">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !reason.trim()}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-bold px-4 py-2 rounded-full shadow"
          >
            {saving ? 'Voiding…' : 'Confirm void'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PaymentModal({ invoice, balance, profile, onClose, onRecorded }) {
  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount] = useState(String(balance.toFixed(2)))
  const [method, setMethod] = useState('Bank Transfer')
  const [reference, setReference] = useState('')
  const [paidDate, setPaidDate] = useState(today)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (saving) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return }
    if (amt > balance + 0.01) { setError(`Exceeds outstanding balance (${formatMoney(balance)}).`); return }
    setSaving(true); setError(null)
    try {
      await recordPayment(invoice.id, {
        amount: amt,
        method,
        reference,
        // YYYY-MM-DD → midnight ISO; the field is for human reporting only.
        paidAtIso: new Date(`${paidDate}T00:00:00`).toISOString(),
        note,
        byProfile: profile,
      })
      onRecorded?.()
    } catch (err) {
      console.error('[clientInvoice] payment failed:', err)
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:w-[520px] sm:max-w-full rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-bold text-gray-900">Record payment</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none w-8 h-8 flex items-center justify-center" aria-label="Close">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded-lg px-3 py-2">
            Outstanding on <span className="font-mono font-bold">{invoice.code}</span>: <strong>{formatMoney(balance)}</strong>.
            Partial payments are fine — invoice flips to PAID when balance hits zero.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                disabled={saving}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Method *</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="input" disabled={saving}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Reference no.</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="input"
                placeholder="OR / cheque / txn ref"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Date received</label>
              <input
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className="input"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Note</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder="Optional"
              disabled={saving}
            />
          </div>

          {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">Failed: {error}</div>}
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-50 px-3 py-2">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !amount}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-bold px-4 py-2 rounded-full shadow"
          >
            {saving ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
