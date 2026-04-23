// Color-coded pill for appointment/service_status values.
// Matches the status pipeline cards on the staff dashboard.

const STATUS_STYLES = {
  PENDING_BRANCH_APPROVAL: 'bg-amber-500 text-white',
  BOOKED:     'bg-gray-500 text-white',
  ARRIVED:    'bg-sky-500 text-white',
  DIAGNOSED:  'bg-indigo-500 text-white',
  ONGOING:    'bg-blue-600 text-white',
  PENDING:    'bg-yellow-500 text-white',
  COMPLETED:  'bg-green-600 text-white',
  CANCELLED:  'bg-red-500 text-white',
  OPEN:       'bg-gray-600 text-white',
  APPROVED:   'bg-green-600 text-white',
  DISAPPROVED:'bg-red-500 text-white',
  PAID:       'bg-blue-600 text-white',
  POST:       'bg-slate-600 text-white',
  TENTATIVE:  'bg-amber-500 text-white',
  CONFIRMED:  'bg-green-600 text-white',
  'NO SHOW':  'bg-red-400 text-white',
  NOSHOW:     'bg-red-400 text-white',
}

export default function StatusPill({ status, size = 'md' }) {
  const s = String(status || '').toUpperCase()
  const cls = STATUS_STYLES[s] || 'bg-gray-400 text-white'
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
  return (
    <span className={`${cls} ${padding} rounded-full font-semibold uppercase tracking-wider whitespace-nowrap inline-block`}>
      {s || '—'}
    </span>
  )
}

// Dashboard status pipeline card (with count in colored corner).
export function PipelineCard({ label, count, tone = 'gray' }) {
  const toneMap = {
    gray:    'bg-gray-500',
    sky:     'bg-sky-500',
    indigo:  'bg-indigo-500',
    blue:    'bg-blue-600',
    yellow:  'bg-yellow-500',
    green:   'bg-green-600',
    amber:   'bg-amber-500',
  }
  const bg = toneMap[tone] || toneMap.gray
  return (
    <div className={`${bg} text-white rounded-md px-4 py-2 flex items-center justify-between`}>
      <span className="text-xs font-bold tracking-wider">{label}</span>
      <span className="bg-white/90 text-gray-800 rounded px-2 py-0.5 text-sm font-bold min-w-[2rem] text-center">
        {count ?? '—'}
      </span>
    </div>
  )
}
