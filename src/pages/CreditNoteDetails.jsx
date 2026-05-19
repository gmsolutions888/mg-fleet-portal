// Credit Note detail. Designed to be printable as a standalone document
// (BIR-style). Read-only here — issuing and voiding both happen on the
// source invoice page (CreditNotesSection). The page exists so individual
// credit notes can be linked from notifications, the CN list, the SOA
// report, and so users can print them.
//
// Visibility:
//   - Internal staff: full view always.
//   - Fleet customers: only their own company's CLIENT-kind credit notes.
//     BRANCH credits (MG Fleet ↔ branch) are internal-only.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatMoney, formatDate, formatDateTime } from '../lib/dummyData'
import { isCustomer } from '../lib/roles'
import { profileCompany } from '../lib/vehicles'
import {
  CREDIT_NOTE_KIND, CREDIT_NOTE_STATUS, watchCreditNoteByCode,
} from '../lib/creditNotes'
import Icon from '../components/ui/Icon'
import PageHero from '../components/ui/PageHero'

export default function CreditNoteDetails() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [cn, setCn] = useState(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('loading')

  useEffect(() => {
    const unsub = watchCreditNoteByCode(code, ({ creditNote, source }) => {
      setCn(creditNote); setSource(source); setLoading(false)
    })
    return unsub
  }, [code])

  if (loading) return <div className="p-4 sm:p-6 text-gray-500">Loading credit note…</div>
  if (!cn) return (
    <div className="p-4 sm:p-6 space-y-3">
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
        <div className="font-semibold mb-1">Credit note not found</div>
        <div className="text-xs">No credit note with code <span className="font-mono">{code}</span>.
          {source === 'error' && ' (Firestore read failed.)'}
        </div>
      </div>
    </div>
  )

  const customerView = isCustomer(profile?.role) && !profile?.is_admin

  // Customers can only see CLIENT-kind credits, scoped to their own company.
  if (customerView) {
    if (cn.kind !== CREDIT_NOTE_KIND.CLIENT) {
      return (
        <NotYours navigate={navigate} message="Branch-side credit notes are internal." />
      )
    }
    const myCompany = (profileCompany(profile) || '').toString().trim().toLowerCase()
    const cnCompany = (cn.company || '').toString().trim().toLowerCase()
    if (myCompany && cnCompany && myCompany !== cnCompany) {
      return (
        <NotYours navigate={navigate} message="This credit note belongs to a different company." />
      )
    }
  }

  const sourceUrl = cn.kind === CREDIT_NOTE_KIND.BRANCH
    ? `/branch-invoices/${cn.sourceInvoiceCode}`
    : `/client-invoices/${cn.sourceInvoiceCode}`
  const isVoid = cn.status === CREDIT_NOTE_STATUS.VOID

  return (
    <div className="pb-32">
      <PageHero
        eyebrow="CREDIT NOTE"
        title={cn.code}
        subtitle={`${cn.plateNo || ''} · ${cn.company || cn.branch || '—'}`}
        right={
          <div className="bg-white/15 rounded-xl px-3 py-2 text-right min-w-[120px]">
            <div className="text-[9px] font-bold tracking-widest text-white/60">AMOUNT</div>
            <div className={`text-xl font-black leading-none mt-0.5 ${isVoid ? 'text-white/50 line-through' : 'text-white'}`}>
              −{formatMoney(cn.amount)}
            </div>
          </div>
        }
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${isVoid ? 'bg-slate-500 text-white' : 'bg-amber-600 text-white'}`}>
            {cn.status}
          </span>
          <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cn.kind === CREDIT_NOTE_KIND.BRANCH ? 'bg-sky-100 text-sky-800' : 'bg-purple-100 text-purple-800'}`}>
            {cn.kind === CREDIT_NOTE_KIND.BRANCH ? 'Branch (MG Fleet → branch)' : 'Client (MG Fleet ← client)'}
          </span>
          {cn.issuedAtIso && (
            <span className="text-[11px] text-gray-500">
              Issued {formatDate(cn.issuedAtIso)}
              {cn.issuedByName && ` by ${cn.issuedByName}`}
            </span>
          )}
        </div>

        {isVoid && cn.voidReason && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
            <div className="font-black text-red-800 text-sm">Voided</div>
            <div className="text-xs text-red-700 mt-1">
              {cn.voidedByName || 'Staff'}{cn.voidedAt ? ` · ${formatDateTime(cn.voidedAt)}` : ''}
            </div>
            <div className="text-xs text-red-800 mt-2 italic">"{cn.voidReason}"</div>
          </div>
        )}

        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Source Invoice
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Info label="Invoice code">
              {cn.sourceInvoiceCode ? (
                <Link to={sourceUrl} className="text-brand font-mono font-semibold hover:underline">
                  {cn.sourceInvoiceCode}
                </Link>
              ) : '—'}
            </Info>
            <Info label="Plate">{cn.plateNo || '—'}</Info>
            <Info label={cn.kind === CREDIT_NOTE_KIND.BRANCH ? 'Branch' : 'Company'}>
              {cn.kind === CREDIT_NOTE_KIND.BRANCH ? (cn.branch || '—') : (cn.company || '—')}
            </Info>
            {cn.brandModel && <Info label="Brand / Model" className="sm:col-span-2">{cn.brandModel}</Info>}
            {cn.customer && <Info label="Driver / Custodian">{cn.customer}</Info>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Reason
          </div>
          <div className="p-4 text-sm text-gray-800 italic">"{cn.reason}"</div>
          {cn.note && (
            <div className="px-4 pb-4 text-xs text-gray-500">
              <div className="font-bold uppercase tracking-wider text-[10px] text-gray-400 mb-1">Internal note</div>
              {cn.note}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2.5 text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Amount
          </div>
          <div className="p-4 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              Credited from <Link to={sourceUrl} className="text-brand font-mono hover:underline">{cn.sourceInvoiceCode}</Link>
            </span>
            <span className={`text-3xl font-black ${isVoid ? 'text-gray-400 line-through' : 'text-amber-700'}`}>
              −{formatMoney(cn.amount)}
            </span>
          </div>
        </div>
      </div>

      {/* Sticky bar — Print only; mutations live on the source invoice. */}
      <div
        className="fixed bottom-[3.5rem] md:bottom-0 left-0 right-0 z-40 bg-white border-t shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <div className="px-3 sm:px-6 py-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icon name="print" className="w-4 h-4" />
            Print
          </button>
          <Link
            to={sourceUrl}
            className="bg-brand hover:bg-brand-dark text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
          >
            View source invoice →
          </Link>
        </div>
      </div>
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

function NotYours({ navigate, message }) {
  return (
    <div className="p-4 sm:p-6 space-y-3">
      <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:underline mb-4">← Back</button>
      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-4">
        <div className="font-semibold mb-1">Not available</div>
        <div className="text-xs">{message}</div>
      </div>
    </div>
  )
}
