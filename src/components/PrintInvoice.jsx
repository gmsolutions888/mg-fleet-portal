// PrintInvoice — external-facing invoice document. Designed for
// browser print and PDF export. Hidden on screen by default
// (`hidden print:block`); the surrounding screen UI gets `print:hidden`
// so the printed page only shows this clean version.
//
// Two flavors via the `kind` prop:
//   - 'client'  → MG Fleet → Fleet Client (the bill the client receives)
//   - 'branch'  → Branch → MG Fleet (internal billing between branch + MG Fleet)
//
// Client invoices use MG_FLEET_IDENTITY as issuer + the fleet company as
// bill-to, with a remit-to block. Branch invoices use the branch identity
// as issuer + MG Fleet as bill-to, no remit-to (internal transfer).
//
// Tax math comes from billingIdentity.computeVat / computeWithholding.
// All monetary values flow through the existing line-item snapshot on
// the invoice doc, so there's no recalculation drift between screen and
// print.

import { formatMoney, formatDate } from '../lib/dummyData'
import {
  MG_FLEET_IDENTITY, TAX_CONFIG, branchIdentity, computeVat, computeWithholding,
} from '../lib/billingIdentity'

export default function PrintInvoice({ kind, invoice }) {
  if (!invoice) return null

  // Issuer + bill-to vary by kind.
  const issuer = kind === 'client'
    ? MG_FLEET_IDENTITY
    : branchIdentity(invoice.branch)
  const billTo = kind === 'client'
    ? clientBillTo(invoice)
    : mgFleetBillTo(invoice)

  // Line items + computed totals. Subtotal already lives on the invoice
  // doc as `total` (snapshotted at issue). We back into VAT splits from
  // that subtotal.
  const items = Array.isArray(invoice.items) ? invoice.items : []
  const subtotal = Number(invoice.total) || 0
  const tax = computeVat(subtotal)
  const cwt = kind === 'client' ? computeWithholding(tax.gross) : { rate: 0, amount: 0, label: null, payable: tax.gross }

  // Payments + credits already recorded reduce the amount due. Showing
  // "Amount Due" instead of "Total" when payments exist makes the
  // printed copy match what the client actually owes today.
  const paid = Number(invoice.paymentsTotal) || 0
  const credited = Number(invoice.creditNotesTotal) || 0
  const amountDue = Math.max(0, cwt.payable - paid - credited)

  const docLabel = kind === 'client' ? 'SERVICE INVOICE' : 'BRANCH INVOICE'
  const subDocLabel = TAX_CONFIG.taxMode === 'EXEMPT' ? 'Non-VAT Service Invoice' : null

  return (
    <div className="hidden print:block bg-white text-gray-900 text-[12px] leading-snug print:p-8">
      <style>{`
        @page { size: A4; margin: 12mm 14mm; }
        @media print {
          body { background: white !important; }
        }
      `}</style>

      {/* ─── Issuer header ─────────────────────────────────────── */}
      <header className="flex items-start justify-between border-b-2 border-gray-900 pb-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          {issuer.logoUrl && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img src={issuer.logoUrl} className="w-14 h-14 object-contain shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-2xl font-black tracking-tight">{issuer.tradeName || issuer.legalName}</div>
            {issuer.legalName && issuer.legalName !== issuer.tradeName && (
              <div className="text-[10px] text-gray-600 uppercase tracking-wider">{issuer.legalName}</div>
            )}
            <div className="text-[10px] text-gray-700 mt-1 whitespace-pre-line">
              {[issuer.address1, issuer.address2].filter(Boolean).join('\n')}
            </div>
            <div className="text-[10px] text-gray-700 mt-0.5">
              {[issuer.phone && `Tel: ${issuer.phone}`, issuer.email].filter(Boolean).join(' · ')}
            </div>
            {issuer.tin && <div className="text-[10px] text-gray-700">TIN: {issuer.tin}</div>}
            {issuer.birAtp && <div className="text-[10px] text-gray-700">BIR ATP: {issuer.birAtp}</div>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold tracking-widest text-gray-500">{docLabel}</div>
          <div className="text-2xl font-black font-mono">{invoice.code}</div>
          {subDocLabel && <div className="text-[9px] text-gray-500 mt-0.5">{subDocLabel}</div>}
          <div className="text-[10px] text-gray-700 mt-2">
            <div>Issued: <strong>{formatDate(invoice.issuedAtIso)}</strong></div>
            {invoice.dueAtIso && <div>Due: <strong>{formatDate(invoice.dueAtIso)}</strong></div>}
            {invoice.paymentTerms && <div>Terms: <strong>{prettyTerms(invoice.paymentTerms)}</strong></div>}
          </div>
        </div>
      </header>

      {/* ─── Bill-to + Vehicle ─────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-6 mb-4">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Bill To</div>
          <div className="font-bold text-[13px]">{billTo.name}</div>
          {billTo.contactPerson && <div className="text-[10px] text-gray-700">Attn: {billTo.contactPerson}</div>}
          {billTo.address && <div className="text-[10px] text-gray-700 whitespace-pre-line">{billTo.address}</div>}
          {billTo.email && <div className="text-[10px] text-gray-700">{billTo.email}</div>}
          {billTo.phone && <div className="text-[10px] text-gray-700">{billTo.phone}</div>}
          {billTo.tin && <div className="text-[10px] text-gray-700">TIN: {billTo.tin}</div>}
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Vehicle</div>
          <div className="font-mono font-black text-[13px]">{invoice.plateNo || '—'}</div>
          {invoice.brandModel && <div className="text-[10px] text-gray-700">{invoice.brandModel}</div>}
          {invoice.customer && <div className="text-[10px] text-gray-700">Driver / Contact: {invoice.customer}</div>}
          {invoice.quotationCode && (
            <div className="text-[10px] text-gray-500 mt-1">Quotation Ref: <span className="font-mono">{invoice.quotationCode}</span></div>
          )}
          {kind === 'branch' && invoice.reassessmentRwa && (
            <div className="text-[10px] text-gray-500">Roadworthy Cleared: <span className="font-mono">{invoice.reassessmentRwa}</span></div>
          )}
        </div>
      </section>

      {/* ─── Line items table ──────────────────────────────────── */}
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="border-y-2 border-gray-900">
            <th className="text-left py-1.5 px-1 text-[10px] font-bold uppercase tracking-wider w-12">Qty</th>
            <th className="text-left py-1.5 px-1 text-[10px] font-bold uppercase tracking-wider">Description</th>
            <th className="text-left py-1.5 px-1 text-[10px] font-bold uppercase tracking-wider w-24">Type</th>
            <th className="text-right py-1.5 px-1 text-[10px] font-bold uppercase tracking-wider w-24">Unit</th>
            <th className="text-right py-1.5 px-1 text-[10px] font-bold uppercase tracking-wider w-28">Sub Total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-[10px] text-gray-400 italic">No line items.</td></tr>
          )}
          {items.map((it, i) => {
            const lineTotal = Number(it.subTotal) || (Number(it.qty) || 1) * (Number(it.unitCost) || 0)
            return (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-1.5 px-1 align-top">{it.qty || 1}</td>
                <td className="py-1.5 px-1 align-top">
                  <div className="font-medium">{it.description || '—'}</div>
                  {it.revisionRound > 1 && (
                    <div className="text-[9px] text-gray-500 italic">Revision {it.revisionRound}</div>
                  )}
                </td>
                <td className="py-1.5 px-1 align-top text-[10px] text-gray-700">{it.type || '—'}</td>
                <td className="py-1.5 px-1 align-top text-right">{formatMoney(it.unitCost)}</td>
                <td className="py-1.5 px-1 align-top text-right font-semibold">{formatMoney(lineTotal)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ─── Totals ─────────────────────────────────────────────── */}
      <section className="flex justify-end mb-4">
        <table className="text-[11px]">
          <tbody>
            {TAX_CONFIG.taxMode !== 'EXEMPT' && TAX_CONFIG.taxMode !== 'ZERO_RATED' && (
              <>
                <tr>
                  <td className="px-3 py-1 text-right text-gray-600">Net of VAT</td>
                  <td className="px-3 py-1 text-right font-mono w-32">{formatMoney(tax.net)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-1 text-right text-gray-600">{tax.taxLabel}</td>
                  <td className="px-3 py-1 text-right font-mono">{formatMoney(tax.vat)}</td>
                </tr>
              </>
            )}
            <tr className="border-t border-gray-300">
              <td className="px-3 py-1 text-right text-gray-600 font-semibold">Total</td>
              <td className="px-3 py-1 text-right font-mono font-bold">{formatMoney(tax.gross)}</td>
            </tr>
            {cwt.label && (
              <tr>
                <td className="px-3 py-1 text-right text-gray-600">{cwt.label}</td>
                <td className="px-3 py-1 text-right font-mono">−{formatMoney(cwt.amount)}</td>
              </tr>
            )}
            {paid > 0 && (
              <tr>
                <td className="px-3 py-1 text-right text-gray-600">Less: Payments Received</td>
                <td className="px-3 py-1 text-right font-mono text-green-700">−{formatMoney(paid)}</td>
              </tr>
            )}
            {credited > 0 && (
              <tr>
                <td className="px-3 py-1 text-right text-gray-600">Less: Credit Notes</td>
                <td className="px-3 py-1 text-right font-mono text-amber-700">−{formatMoney(credited)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-gray-900 bg-gray-50">
              <td className="px-3 py-2 text-right text-[12px] font-bold uppercase tracking-wider">
                {amountDue === tax.gross && !cwt.amount && !paid && !credited ? 'Amount Payable' : 'Amount Due'}
              </td>
              <td className="px-3 py-2 text-right font-mono font-black text-[14px]">{formatMoney(amountDue)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ─── Remit-to (client invoice only) ─────────────────────── */}
      {kind === 'client' && issuer.bank && (
        <section className="border border-gray-300 rounded p-3 mb-4 bg-gray-50">
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Remit Payment To</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px]">
            <div><span className="text-gray-500">Bank:</span> {issuer.bank.bankName}</div>
            <div><span className="text-gray-500">Account Name:</span> {issuer.bank.accountName}</div>
            <div><span className="text-gray-500">Account No.:</span> <span className="font-mono">{issuer.bank.accountNumber}</span></div>
            <div><span className="text-gray-500">Branch:</span> {issuer.bank.branch}</div>
          </div>
          {issuer.email && (
            <div className="text-[10px] text-gray-600 mt-2">
              Send remittance proof to <strong>{issuer.email}</strong>.
            </div>
          )}
        </section>
      )}

      {/* ─── Notes / signatures ─────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-6 mt-8">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">Notes</div>
          <div className="text-[10px] text-gray-700 italic">
            {kind === 'client'
              ? 'This is a service invoice for repairs and parts rendered. Payment terms apply from the issue date above.'
              : 'Internal billing — branch to MG Fleet. Settlement per branch contract.'}
          </div>
          {invoice.issuedByName && (
            <div className="text-[10px] text-gray-500 mt-2">Prepared by: {invoice.issuedByName}</div>
          )}
        </div>
        <div className="flex flex-col items-center justify-end">
          <div className="border-t border-gray-400 w-48 mt-12 pt-1 text-center text-[10px] text-gray-600">
            Authorized Signature
          </div>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────── */}
      <footer className="mt-6 pt-2 border-t border-gray-200 text-[9px] text-gray-500 text-center">
        Generated by MG Fleet Portal · {invoice.code} · {formatDate(invoice.issuedAtIso)}
      </footer>
    </div>
  )
}

// ── Bill-to assembly ──────────────────────────────────────────────────────

// Client invoice goes to the fleet company. Today the invoice doc only
// stores `company` as a string — no contact / address breakdown. When the
// `fleetCompanies` doc grows those fields, the print mode will pull them
// here automatically.
function clientBillTo(invoice) {
  return {
    name:          invoice.company || invoice.customer || 'Walk-in Customer',
    contactPerson: invoice.customer || null,
    address:       null, // TODO: pull from fleetCompanies when address fields land
    email:         null,
    phone:         null,
    tin:           null,
  }
}

// Branch invoice is paid by MG Fleet. Issuer is the branch (above);
// bill-to is the MG Fleet identity itself.
function mgFleetBillTo() {
  return {
    name:          MG_FLEET_IDENTITY.tradeName || MG_FLEET_IDENTITY.legalName,
    contactPerson: null,
    address:       [MG_FLEET_IDENTITY.address1, MG_FLEET_IDENTITY.address2].filter(Boolean).join('\n') || null,
    email:         MG_FLEET_IDENTITY.email,
    phone:         MG_FLEET_IDENTITY.phone,
    tin:           MG_FLEET_IDENTITY.tin,
  }
}

function prettyTerms(code) {
  switch (String(code || '').toUpperCase()) {
    case 'CASH':   return 'Cash on receipt'
    case 'NET_30': return 'Net 30 days'
    case 'NET_60': return 'Net 60 days'
    case 'NET_90': return 'Net 90 days'
    default:       return code
  }
}
