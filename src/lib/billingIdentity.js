// Billing identity — issuer info shown on the printed external invoice.
// Two issuer types:
//   - MG Fleet itself (issues client invoices)
//   - Per-branch identity (issues branch invoices to MG Fleet)
//
// PLACEHOLDER VALUES below — replace with real legal name, address,
// TIN, BIR ATP / OR series, and bank info before mailing actual
// invoices to clients. Do NOT print to a paying customer until the
// TODO markers are filled in.
//
// Tax model is configurable here too. Default is VAT-inclusive at 12%
// (standard PH); change `taxMode` to 'EXCLUSIVE' if your quoted prices
// are net-of-VAT, or 'EXEMPT' / 'ZERO_RATED' if applicable.

// ─── Tax configuration ────────────────────────────────────────────────────

export const TAX_CONFIG = {
  // 'INCLUSIVE' — quoted unit prices already contain 12% VAT (back out
  //   the VAT on the printed invoice).
  // 'EXCLUSIVE' — quoted prices are net; add 12% VAT on top.
  // 'EXEMPT'    — no VAT line.
  // 'ZERO_RATED' — VAT line at 0%.
  taxMode: 'INCLUSIVE',
  vatRate: 0.12,
  // PH creditable withholding tax on services. Set to 0.02 if your fleet
  // clients withhold 2% CWT, else 0. Shown as a deduction on the client
  // invoice's payable line.
  cwtRate: 0,
}

// ─── MG Fleet (client-facing issuer) ──────────────────────────────────────

export const MG_FLEET_IDENTITY = {
  legalName:   'MG Fleet Management Services, Inc.',  // TODO: confirm legal name
  tradeName:   'MG Fleet',                             // shown big on invoices
  address1:    'TODO — street, barangay',
  address2:    'TODO — city, province, ZIP',
  tin:         'TODO-NNN-NNN-NNN-NNNN',                // 12-digit TIN
  birAtp:      null,                                   // 'OCN: ...' if you have an ATP
  orSeries:    null,                                   // 'CINV-00001 to CINV-99999' if registered
  email:       'TODO@mgfleet.com',
  phone:       'TODO',
  // Remit-to block on client invoices.
  bank: {
    bankName:      'TODO — bank',
    accountName:   'TODO — account name',
    accountNumber: 'TODO — account number',
    branch:        'TODO — bank branch',
  },
  // Logo path (place a file at `public/branding/mgfleet-logo.png` later).
  logoUrl: '/branding/mgfleet-logo.png',
}

// ─── Per-branch (issues branch invoices to MG Fleet) ──────────────────────
//
// Keyed by the branch_code stored on appointments / invoices
// (MGCAVITE / MGQUEZON CITY / MGPAMPANGA / MGDAVAO / MGPALAWAN).

const BRANCH_DEFAULTS = {
  legalName:   'TODO — branch legal name',
  tradeName:   'Master Garage',
  address1:    'TODO',
  address2:    'TODO',
  tin:         null,
  birAtp:      null,
  orSeries:    null,
  email:       null,
  phone:       null,
  bank: null,    // branches may not need a remit-to block (paid by MG Fleet, not by clients)
  logoUrl:     '/branding/mg-logo.jpg',
}

const BRANCHES = {
  'MGCAVITE': {
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Cavite',
    address1:  'TODO — Cavite address',
  },
  'MGQUEZON CITY': {
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Quezon City',
    address1:  'TODO — QC address',
  },
  'MGQUEZONCITY': {  // alt spelling without space
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Quezon City',
    address1:  'TODO — QC address',
  },
  'MGPAMPANGA': {
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Pampanga',
    address1:  'TODO — Pampanga address',
  },
  'MGDAVAO': {
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Davao',
    address1:  'TODO — Davao address',
  },
  'MGPALAWAN': {
    ...BRANCH_DEFAULTS,
    tradeName: 'MG Palawan',
    address1:  'TODO — Palawan address',
  },
  'ALL BRANCH': {
    ...BRANCH_DEFAULTS,
    tradeName: 'Master Garage — All Branch',
    address1:  'TODO — head office address',
  },
}

export function branchIdentity(branchCode) {
  if (!branchCode) return BRANCH_DEFAULTS
  const key = String(branchCode).toUpperCase()
  return BRANCHES[key] || { ...BRANCH_DEFAULTS, tradeName: branchCode }
}

// ─── Tax math helpers ─────────────────────────────────────────────────────

// Compute the VAT breakdown for a list-price subtotal under the current
// taxMode. Returns:
//   { net, vat, gross, taxLabel }
// where:
//   net = the amount before VAT
//   vat = the VAT amount
//   gross = total payable (= net + vat for EXCLUSIVE; = subtotal for INCLUSIVE)
//   taxLabel = human-readable line label for the printed invoice
export function computeVat(subtotal) {
  const s = Number(subtotal) || 0
  const r = TAX_CONFIG.vatRate
  switch (TAX_CONFIG.taxMode) {
    case 'EXCLUSIVE': {
      const vat = s * r
      return { net: s, vat, gross: s + vat, taxLabel: `VAT (${(r * 100).toFixed(0)}%)` }
    }
    case 'EXEMPT':
      return { net: s, vat: 0, gross: s, taxLabel: 'VAT-Exempt' }
    case 'ZERO_RATED':
      return { net: s, vat: 0, gross: s, taxLabel: 'Zero-Rated VAT (0%)' }
    case 'INCLUSIVE':
    default: {
      // Back out VAT from a VAT-inclusive subtotal: net = s / (1 + r)
      const net = s / (1 + r)
      const vat = s - net
      return { net, vat, gross: s, taxLabel: `VAT (${(r * 100).toFixed(0)}%) — included` }
    }
  }
}

// Optional withholding tax line on the CLIENT invoice (PH CWT).
// Returns { rate, amount, label, payable }.
//   payable = gross - amount (what the client actually remits)
export function computeWithholding(gross) {
  const g = Number(gross) || 0
  const r = TAX_CONFIG.cwtRate
  if (!r) return { rate: 0, amount: 0, label: null, payable: g }
  const amount = g * r
  return {
    rate: r,
    amount,
    label: `Less: ${(r * 100).toFixed(0)}% Creditable Withholding Tax`,
    payable: g - amount,
  }
}
