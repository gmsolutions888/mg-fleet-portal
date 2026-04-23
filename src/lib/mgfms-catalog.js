// MG-FMS catalog — ported from mg-fms-app/src/App.jsx (lines 41–194).
// Single source of truth for assessment item codes, defect codes, PMS items,
// status configs, and the health-score / action helpers. Keep in sync with the
// mg-fms app: when mg-fms adds/renames an item, mirror it here.

// ── PMS items (scheduled/brake/major/troubleshooting service types) ──────
export const PMS_ITEMS = [
  { code: 'PMS_OIL',          label: 'Engine Oil',                                 icon: '🛢️',  kmInterval: 10000, monthInterval: 6,  category: 'scheduled' },
  { code: 'PMS_OIL_FILTER',   label: 'Oil Filter',                                 icon: '🔧',  kmInterval: 10000, monthInterval: 6,  category: 'scheduled' },
  { code: 'PMS_AIR',          label: 'Air Filter',                                 icon: '💨',  kmInterval: 10000, monthInterval: 6,  category: 'scheduled' },
  { code: 'PMS_CABIN',        label: 'Cabin Filter',                               icon: '🌬️',  kmInterval: 15000, monthInterval: 12, category: 'scheduled' },
  { code: 'PMS_FUEL',         label: 'Fuel Filter',                                icon: '⛽',  kmInterval: 10000, monthInterval: 6,  category: 'scheduled' },
  { code: 'PMS_BRAKE_CLEAN',  label: 'Brake Cleaning',                             icon: '🧹',  kmInterval: 10000, monthInterval: 6,  category: 'scheduled' },
  { code: 'PMS_BRAKE_PAD_F',  label: 'Brake Pads Front',                           icon: '🛑',  kmInterval: 40000, monthInterval: 24, category: 'brake' },
  { code: 'PMS_BRAKE_PAD_R',  label: 'Brake Pads Rear',                            icon: '🛑',  kmInterval: 40000, monthInterval: 24, category: 'brake' },
  { code: 'PMS_BRAKE_SHOE',   label: 'Brake Shoes',                                icon: '🛑',  kmInterval: 40000, monthInterval: 24, category: 'brake' },
  { code: 'PMS_BRAKE_ROTOR_F',label: 'Brake Rotor Front',                          icon: '🔘',  kmInterval: 60000, monthInterval: 36, category: 'brake' },
  { code: 'PMS_BRAKE_ROTOR_R',label: 'Brake Rotor Rear',                           icon: '🔘',  kmInterval: 60000, monthInterval: 36, category: 'brake' },
  { code: 'PMS_BRAKE_DRUM',   label: 'Brake Drum',                                 icon: '🔘',  kmInterval: 60000, monthInterval: 36, category: 'brake' },
  { code: 'PMS_BRAKE_FLUID',  label: 'Brake Fluid',                                icon: '🛑',  kmInterval: 40000, monthInterval: 12, category: 'brake' },
  { code: 'PMS_BRAKE_CAL',    label: 'Brake Caliper',                              icon: '🔧',  kmInterval: null,  monthInterval: 60, category: 'brake' },
  { code: 'PMS_BRAKE_HOSE',   label: 'Brake Hose',                                 icon: '🔧',  kmInterval: null,  monthInterval: 36, category: 'brake' },
  { code: 'PMS_BRAKE_REFACE', label: 'Reface Rotor Disc',                          icon: '🔘',  kmInterval: null,  monthInterval: null, category: 'brake' },
  { code: 'PMS_SPARK',        label: 'Spark Plugs',                                icon: '⚡',  kmInterval: 50000, monthInterval: 48, category: 'scheduled' },
  { code: 'PMS_COOL',         label: 'Coolant / Radiator Flush',                   icon: '🌡️',  kmInterval: 50000, monthInterval: 48, category: 'scheduled' },
  { code: 'PMS_TRANS',        label: 'Transmission Fluid',                         icon: '⚙️',  kmInterval: 70000, monthInterval: 48, category: 'scheduled' },
  { code: 'PMS_DRIVEBELT',    label: 'Drivebelt',                                  icon: '🔗',  kmInterval: 80000, monthInterval: 60, category: 'scheduled' },
  { code: 'PMS_DIFF',         label: 'Differential Oil',                           icon: '⚙️',  kmInterval: 40000, monthInterval: 12, category: 'scheduled' },
  { code: 'PMS_BATT',         label: 'Battery & Terminals',                        icon: '🔋',  kmInterval: null,  monthInterval: 24, category: 'scheduled' },
  { code: 'PMS_TIMING',       label: 'Timing Belt / Chain',                        icon: '⛓️',  kmInterval: 100000, monthInterval: 60, category: 'major' },
  { code: 'PMS_EGR',          label: 'EGR / Intake Manifold & Throttle Body',      icon: '🔧',  kmInterval: 50000, monthInterval: 36, category: 'major' },
  { code: 'PMS_INTAKE',       label: 'Intake Manifold & Throttle Body Cleaning',   icon: '🌬️',  kmInterval: 50000, monthInterval: 36, category: 'major' },
  { code: 'PMS_TURBO',        label: 'Turbo Cleaning',                             icon: '🌀',  kmInterval: 100000, monthInterval: 60, category: 'major' },
  { code: 'PMS_ATF',          label: 'ATF Dialysis',                               icon: '🔄',  kmInterval: 70000, monthInterval: 48, category: 'major' },
  { code: 'PMS_ECU',          label: 'ECU Scanning',                               icon: '💻',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
  { code: 'PMS_SENSOR',       label: 'Sensor Cleaning',                            icon: '📡',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
  { code: 'PMS_PARTS',        label: 'Replace Parts',                              icon: '🔩',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
  { code: 'PMS_REWIRE',       label: 'Rewire',                                     icon: '🔌',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
  { code: 'PMS_REPROG',       label: 'Reprogram',                                  icon: '🖥️',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
  { code: 'PMS_OTHER_T',      label: 'Other (Troubleshooting)',                    icon: '🔎',  kmInterval: null,  monthInterval: null, category: 'troubleshooting' },
]

export const PMS_MAP = Object.fromEntries(PMS_ITEMS.map((p) => [p.code, p]))

// Inspection code → PMS code map. Port of mg-fms-app/src/App.jsx:98. When an
// inspection item is marked `replaced` in the diagnostic, the matching PMS
// item auto-checks with the brand/qty/photos carried over. Keep in sync with
// mg-fms: both apps rely on this for the cross-flow prefill.
export const INSP_TO_PMS = {
  ENG_OIL:        'PMS_OIL',
  ENG_OIL_FILTER: 'PMS_OIL_FILTER',
  ENG_AIR:        'PMS_AIR',
  ENG_CABIN:      'PMS_CABIN',
  ENG_SPARK:      'PMS_SPARK',
  ENG_FUEL:       'PMS_FUEL',
  ENG_BELT:       'PMS_DRIVEBELT',
  ENG_COOL:       'PMS_COOL',
  ENG_TRANS:      'PMS_TRANS',
  BRK_PAD_F:      'PMS_BRAKE_PAD_F',
  BRK_PAD_R:      'PMS_BRAKE_PAD_R',
  BRK_DRUM:       'PMS_BRAKE_DRUM',
  BRK_SHOE:       'PMS_BRAKE_SHOE',
  BRK_FLUID:      'PMS_BRAKE_FLUID',
  BRK_HAND:       'PMS_BRAKE_SHOE',
  ELC_BATT:       'PMS_BATT',
  ELC_BATT_V:     'PMS_BATT',
}

// ── Defect codes dictionary ──────────────────────────────────────────────
export const DEFECT_CODES = {
  LOW_THICKNESS: 'Low thickness',
  UNEVEN_WEAR: 'Uneven wear',
  CONTAMINATED: 'Contaminated',
  CRACKED: 'Cracked',
  BULGE_PRESENT: 'Bulge present',
  SIDEWALL_CRACK: 'Sidewall crack',
  UNDERINFLATED: 'Underinflated',
  LOW_TREAD: 'Low tread depth',
  LOW_VOLTAGE: 'Low voltage',
  CORROSION: 'Corrosion / terminal buildup',
  LEAKING: 'Leaking',
  WORN: 'Worn beyond limit',
  DAMAGED: 'Physically damaged',
  MISSING: 'Missing / not found',
  EXPIRED: 'Expired',
  NOT_FUNCTIONING: 'Not functioning',
  NOISY: 'Noise / vibration',
  LOOSE: 'Loose / needs tightening',
  CLOGGED: 'Clogged fuel filter',
  LOW_LEVEL: 'Coolant level low',
  SCORED: 'Scored / grooved',
  WARPED: 'Warped',
  WORN_VALVE_GASKET: 'Worn valve gasket',
  OTHER: 'Other (see note)',
}

// ── Inspection item catalog — 7 categories, 35+ items ────────────────────
export const CATEGORIES = [
  { code: 'ENG', label: 'Engine & Drivetrain', icon: '⚙️', items: [
    { code: 'ENG_OIL',        label: 'Engine oil — condition & level',        type: 'condition', isCritical: false },
    { code: 'ENG_OIL_FILTER', label: 'Oil filter — condition & replace',      type: 'condition', isCritical: false },
    { code: 'ENG_COOL',       label: 'Coolant level & condition',             type: 'condition', isCritical: false },
    { code: 'ENG_MOUNT',      label: 'Engine mounts — no excessive vibration',type: 'condition', isCritical: false },
    { code: 'ENG_TRANS',      label: 'Transmission fluid level',              type: 'condition', isCritical: false },
    { code: 'ENG_BELT',       label: 'Drive belts condition',                 type: 'condition', isCritical: false },
    { code: 'ENG_AIR',        label: 'Air filter condition',                  type: 'condition', isCritical: false },
    { code: 'ENG_CABIN',      label: 'Cabin filter condition',                type: 'condition', isCritical: false },
    { code: 'ENG_SPARK',      label: 'Spark plugs condition',                 type: 'condition', isCritical: false },
    { code: 'ENG_FUEL',       label: 'Fuel system — no visible leaks',        type: 'condition', isCritical: true, holdUnit: true },
    { code: 'ENG_VALVE_GSKT', label: 'Valve gasket condition',                type: 'condition', isCritical: false },
  ]},
  { code: 'BRK', label: 'Braking System', icon: '🛑', items: [
    { code: 'BRK_PAD_F', label: 'Brake pad thickness — front', type: 'measurable', isCritical: true, holdUnit: true, unit: 'mm', threshold: 3.0, thresholdLabel: 'Min 3.0mm' },
    { code: 'BRK_PAD_R', label: 'Brake pad thickness — rear',  type: 'measurable', isCritical: true, holdUnit: true, unit: 'mm', threshold: 3.0, thresholdLabel: 'Min 3.0mm' },
    { code: 'BRK_ROTOR', label: 'Brake rotors / drums',        type: 'condition',  isCritical: false },
    { code: 'BRK_DRUM',  label: 'Brake drum condition',        type: 'condition',  isCritical: false },
    { code: 'BRK_SHOE',  label: 'Brake shoe condition',        type: 'condition',  isCritical: true, holdUnit: true },
    { code: 'BRK_FLUID', label: 'Brake fluid level',           type: 'condition',  isCritical: false },
    { code: 'BRK_HAND',  label: 'Handbrake effectiveness',     type: 'condition',  isCritical: true, holdUnit: true },
    { code: 'BRK_ABS',   label: 'ABS warning light',           type: 'condition',  isCritical: false },
  ]},
  { code: 'SUS', label: 'Suspension & Steering', icon: '🔧', items: [
    { code: 'SUS_SHOCK', label: 'Shock absorbers — no leaks',      type: 'condition', isCritical: false },
    { code: 'SUS_TIE',   label: 'Tie rods and ball joints',        type: 'condition', isCritical: true, holdUnit: true },
    { code: 'SUS_PS',    label: 'Power steering fluid',            type: 'condition', isCritical: false },
    { code: 'SUS_ALIGN', label: 'Steering wheel play & alignment', type: 'condition', isCritical: false },
  ]},
  { code: 'ELC', label: 'Electrical System', icon: '⚡', items: [
    { code: 'ELC_BATT_V', label: 'Battery voltage',                 type: 'measurable', isCritical: false, unit: 'V', threshold: 12.0, thresholdLabel: 'Min 12.0V' },
    { code: 'ELC_BATT',   label: 'Battery condition & terminals',   type: 'condition',  isCritical: false },
    { code: 'ELC_LIGHTS', label: 'All exterior lights functioning', type: 'condition',  isCritical: true },
    { code: 'ELC_WIPER',  label: 'Wipers and washer system',        type: 'condition',  isCritical: false },
    { code: 'ELC_HORN',   label: 'Horn functioning',                type: 'condition',  isCritical: false },
    { code: 'ELC_DASH',   label: 'Dashboard — no active warnings',  type: 'condition',  isCritical: false },
  ]},
  { code: 'TIR', label: 'Tires & Wheels', icon: '🔘', items: [
    { code: 'TIR_TREAD_F', label: 'Front tire tread depth',           type: 'measurable', isCritical: true, holdUnit: true, unit: 'mm', threshold: 1.6, thresholdLabel: 'Min 1.6mm' },
    { code: 'TIR_TREAD_R', label: 'Rear tire tread depth',            type: 'measurable', isCritical: true, holdUnit: true, unit: 'mm', threshold: 1.6, thresholdLabel: 'Min 1.6mm' },
    { code: 'TIR_PSI',     label: 'Tire inflation — all tires',       type: 'condition',  isCritical: false },
    { code: 'TIR_SIDE',    label: 'Sidewall condition',               type: 'condition',  isCritical: true, holdUnit: true },
    { code: 'TIR_SPARE',   label: 'Spare tire condition & pressure',  type: 'condition',  isCritical: false },
    { code: 'TIR_NUTS',    label: 'Wheel nuts — properly torqued',    type: 'condition',  isCritical: true, holdUnit: true },
  ]},
  { code: 'BOD', label: 'Body & Chassis', icon: '🚗', items: [
    { code: 'BOD_STRUCT', label: 'Structural integrity',               type: 'condition', isCritical: true, holdUnit: true },
    { code: 'BOD_UNDER',  label: 'Undercarriage — no major corrosion', type: 'condition', isCritical: false },
    { code: 'BOD_DOOR',   label: 'Door, window, lock operation',       type: 'condition', isCritical: false },
    { code: 'BOD_BELT',   label: 'Seat belts — all functioning',       type: 'condition', isCritical: true, holdUnit: true },
    { code: 'BOD_WIND',   label: 'Windshield — no obstructing cracks', type: 'condition', isCritical: true },
  ]},
  { code: 'LTO', label: 'LTO Compliance', icon: '📋', isCompliance: true, items: [
    { code: 'LTO_REG',  label: 'Registration — current & valid',  type: 'condition', isCompliance: true },
    { code: 'LTO_ORCR', label: 'OR/CR on board',                  type: 'condition', isCompliance: true },
    { code: 'LTO_EMIS', label: 'Emission sticker — current',      type: 'condition', isCompliance: true },
    { code: 'LTO_MVIS', label: 'MVIS certificate — current',      type: 'condition', isCompliance: true },
    { code: 'LTO_INS',  label: 'Third-party insurance — current', type: 'condition', isCompliance: true },
  ]},
]

export const ALL_ITEMS = CATEGORIES.flatMap((c) => c.items)
export const ITEM_MAP  = Object.fromEntries(ALL_ITEMS.map((i) => [i.code, i]))

// ── Assessment types (ported from mg-fms-app/src/App.jsx:11) ───────────────
// Same 4 values mg-fms writes to `header.type`. Keep labels identical so
// both apps render the same badge text on the same records.
export const ASSESS_TYPES = ['Initial', 'Periodic', 'Re-Assessment', 'Pre-Dispatch']

// Pre-Dispatch inspections only cover safety-critical items — anything
// flagged `holdUnit`, `isCritical`, or `isCompliance`. Everything else gets
// auto-filled as N/A so the inspector isn't slowed down during a pre-trip
// check. Port of mg-fms-app/src/App.jsx:179.
export const PRE_DISPATCH_ITEMS = new Set(
  ALL_ITEMS.filter((i) => i.holdUnit || i.isCritical || i.isCompliance).map((i) => i.code)
)

// Given an assessment type + (for Re-Assessment) the previous assessment,
// return the set of item codes that need to be answered this pass. `null`
// means "all items". Port of mg-fms-app/src/App.jsx:180.
//
//   Initial / Periodic → null  (all ALL_ITEMS)
//   Pre-Dispatch       → PRE_DISPATCH_ITEMS
//   Re-Assessment      → Set of items that were fail_critical or monitor in
//                        the previous assessment
export function getActiveItems(type, prevAssessment) {
  if (type === 'Re-Assessment' && prevAssessment) {
    const flagged = new Set()
    for (const i of ALL_ITEMS) {
      const r = prevAssessment.itemResults?.[i.code]
      if (r?.resultCode === 'fail_critical' || r?.resultCode === 'monitor') flagged.add(i.code)
    }
    return flagged
  }
  if (type === 'Pre-Dispatch') return PRE_DISPATCH_ITEMS
  return null
}

// For a history of assessments on one plate, tally how many times each item
// came back fail_critical or monitor. Used by VehicleProfile / reports to
// surface recurring defects. Port of mg-fms-app/src/App.jsx:185.
export function getRepeatDefects(vehicleAssessments) {
  const counts = {}
  for (const a of vehicleAssessments || []) {
    for (const item of ALL_ITEMS) {
      const r = a.itemResults?.[item.code]
      if (r?.resultCode === 'fail_critical' || r?.resultCode === 'monitor') {
        counts[item.code] = (counts[item.code] || 0) + 1
      }
    }
  }
  return counts
}

// ── Status / result / action configs ─────────────────────────────────────
export const SC = {
  active:      { label: 'ACTIVE / Roadworthy',        bg: 'bg-green-600',  badge: 'bg-green-100 text-green-800',  grad: 'from-green-700 to-green-600' },
  conditional: { label: 'CONDITIONAL',                bg: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-800',  grad: 'from-amber-600 to-amber-500' },
  deferred:    { label: 'DEFERRED — Not Roadworthy',  bg: 'bg-red-700',    badge: 'bg-red-100 text-red-800',      grad: 'from-red-800 to-red-700' },
}

export const RC = {
  pass:          { label: 'Pass',          bg: 'bg-green-600', light: 'bg-green-50 text-green-700', icon: '✓' },
  monitor:       { label: 'Monitor',       bg: 'bg-amber-500', light: 'bg-amber-50 text-amber-700', icon: '⚠' },
  fail_critical: { label: 'Fail Critical', bg: 'bg-red-600',   light: 'bg-red-50 text-red-700',     icon: '✕' },
  replaced:      { label: 'Replaced',      bg: 'bg-blue-600',  light: 'bg-blue-50 text-blue-700',   icon: '🔩' },
  na:            { label: 'N/A',           bg: 'bg-gray-400',  light: 'bg-gray-50 text-gray-500',   icon: '—' },
}

export const ACTION_CFG = {
  NONE:             { label: 'No Action',           color: 'text-green-700',  bg: 'bg-green-50' },
  MONITOR_ONLY:     { label: 'Monitor',             color: 'text-amber-700',  bg: 'bg-amber-50' },
  REPAIR_REQUIRED:  { label: 'Repair Required',     color: 'text-orange-700', bg: 'bg-orange-50' },
  REPAIR_IMMEDIATE: { label: 'Repair Immediately',  color: 'text-red-700',    bg: 'bg-red-50' },
  HOLD_UNIT:        { label: '⛔ Hold Unit',         color: 'text-red-900',    bg: 'bg-red-100' },
}

// ── Derived helpers ──────────────────────────────────────────────────────
export function getAction(item, resultCode) {
  if (!resultCode || resultCode === 'pass' || resultCode === 'na') return 'NONE'
  if (resultCode === 'replaced') return 'NONE'
  if (resultCode === 'monitor') return 'MONITOR_ONLY'
  if (resultCode === 'fail_critical') {
    if (item.isCompliance) return 'REPAIR_REQUIRED'
    if (item.holdUnit) return 'HOLD_UNIT'
    if (item.isCritical) return 'REPAIR_IMMEDIATE'
    return 'REPAIR_REQUIRED'
  }
  return 'NONE'
}

export function calcHealthScore(classification, itemResults) {
  if (!classification || !itemResults) return 100
  const answered = ALL_ITEMS.filter((i) => itemResults[i.code]?.resultCode && itemResults[i.code].resultCode !== 'na').length
  if (answered === 0) return 100
  let deductions = 0
  ALL_ITEMS.forEach((item) => {
    const r = itemResults[item.code]
    if (!r?.resultCode) return
    if (r.resultCode === 'fail_critical') {
      deductions += item.holdUnit ? 20 : item.isCritical ? 15 : item.isCompliance ? 10 : 8
    }
    if (r.resultCode === 'monitor') deductions += item.isCritical ? 5 : 3
  })
  return Math.max(0, Math.min(100, 100 - deductions))
}

export function healthColor(score) {
  if (score >= 80) return { text: 'text-green-700', bg: 'bg-green-100', bar: 'bg-green-500' }
  if (score >= 50) return { text: 'text-amber-700', bg: 'bg-amber-100', bar: 'bg-amber-500' }
  return { text: 'text-red-700', bg: 'bg-red-100', bar: 'bg-red-500' }
}
