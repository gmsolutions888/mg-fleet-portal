// Reports — live analytics dashboard. Reads from the shared vehicles stream
// (watchVehicles → latest assessment + pms_records per plate) and buckets the
// rows into the three operational alerts the garage triages on each morning:
// critical defects, PMS urgency, and reassessment-due follow-ups. Company
// breakdown rollup at the bottom lets fleet managers see which client is
// struggling.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { watchVehicles, formatDate } from '../lib/vehicles'
import PageHero, { HeroStat } from '../components/ui/PageHero'
import Icon from '../components/ui/Icon'
import RoadworthyBadge from '../components/ui/RoadworthyBadge'

const TOP_N = 8

export default function Reports() {
  const [vehicles, setVehicles] = useState([])
  const [source, setSource] = useState('loading')

  useEffect(() => {
    const unsub = watchVehicles({}, ({ vehicles, source }) => {
      setVehicles(vehicles); setSource(source)
    })
    return unsub
  }, [])

  const stats = useMemo(() => computeStats(vehicles), [vehicles])
  const byCompany = useMemo(() => computeByCompany(vehicles), [vehicles])

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="REPORTS"
        title="Fleet Analytics"
        subtitle={vehicles.length === 0
          ? 'Waiting for data from assessments…'
          : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · ${stats.unfit} unfit · ${stats.overduePms} overdue PMS · ${stats.criticalDefects} with critical defects`}
        right={<HeroStat value={vehicles.length} label="TOTAL" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked by Firestore rules.
        </div>
      )}
      {source !== 'loading' && source !== 'error' && vehicles.length === 0 && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-gray-600 bg-gray-50 border rounded px-3 py-2">
          No assessments yet — analytics will populate as mechanics submit inspections.
        </div>
      )}

      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <AlertTile label="Critical defects" value={stats.criticalDefects} tone="red" />
          <AlertTile label="PMS overdue"      value={stats.overduePms}      tone="amber" />
          <AlertTile label="Dispatch blocked" value={stats.dispatchBlocked} tone="gray" />
          <AlertTile label="Reassessment due" value={stats.reassessmentDue} tone="blue" />
        </div>
      </div>

      <div className="px-3 sm:px-6 pt-5 space-y-4">
        <AlertSection
          title="Critical defects"
          subtitle="Latest assessments with fail-critical items."
          empty="No plates with critical defects right now."
          rows={stats.criticalList}
          render={(v) => (
            <VehicleAlertRow
              v={v}
              right={
                <div className="text-right shrink-0">
                  <div className="text-lg font-black text-red-600 leading-none">{v.classification?.failCriticalCount ?? 0}</div>
                  <div className="text-[9px] font-bold tracking-widest text-red-700/70 mt-0.5">CRIT</div>
                </div>
              }
            />
          )}
        />

        <AlertSection
          title="PMS urgency"
          subtitle="Overdue first, then due in the next 30 days."
          empty="All plates are current on their PMS intervals."
          rows={stats.pmsList}
          render={(v) => (
            <VehicleAlertRow
              v={v}
              right={
                <div className="text-right shrink-0">
                  {v.overdueDays ? (
                    <>
                      <div className="text-lg font-black text-red-600 leading-none">{v.overdueDays}d</div>
                      <div className="text-[9px] font-bold tracking-widest text-red-700/70 mt-0.5">OVERDUE</div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-black text-amber-600 leading-none">{formatDate(v.nextPms)}</div>
                      <div className="text-[9px] font-bold tracking-widest text-amber-700/70 mt-0.5">DUE SOON</div>
                    </>
                  )}
                </div>
              }
            />
          )}
        />

        <AlertSection
          title="Reassessment due"
          subtitle="Conditional and deferred units tracked for follow-up."
          empty="No reassessments pending."
          rows={stats.reassessList}
          render={(v) => (
            <VehicleAlertRow
              v={v}
              right={
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-gray-800 leading-none">
                    {v.classification?.reassessmentDue ? formatDate(v.classification.reassessmentDue) : '—'}
                  </div>
                  <div className="text-[9px] font-bold tracking-widest text-gray-500 mt-0.5">TARGET DATE</div>
                </div>
              }
            />
          )}
        />

        {byCompany.length > 0 && (
          <section className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-4 py-3 border-b">
              <div className="text-[10px] font-bold tracking-widest text-gray-500">FLEET BREAKDOWN</div>
              <div className="font-bold text-gray-900 text-sm mt-0.5">By company</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs sm:text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600">
                  <tr>
                    <th className="px-3 sm:px-4 py-2 text-left font-medium">Company</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium">Vehicles</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium text-green-700">Active</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium text-amber-700">Minor</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium text-red-700">Unfit</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium text-red-700">Critical</th>
                    <th className="px-3 sm:px-4 py-2 text-right font-medium text-amber-700">PMS overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byCompany.map((row) => (
                    <tr key={row.company} className="hover:bg-gray-50">
                      <td className="px-3 sm:px-4 py-2 font-semibold text-gray-900 truncate max-w-[160px] sm:max-w-none">{row.company}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono">{row.total}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono text-green-700">{row.active || ''}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono text-amber-700">{row.minor || ''}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono text-red-700">{row.unfit || ''}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono text-red-700">{row.critical || ''}</td>
                      <td className="px-3 sm:px-4 py-2 text-right font-mono text-amber-700">{row.overdue || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function AlertTile({ label, value, tone }) {
  const map = {
    red:   'bg-red-600',
    amber: 'bg-amber-500',
    gray:  'bg-gray-800',
    blue:  'bg-brand',
  }
  return (
    <div className={`${map[tone]} text-white rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90 leading-tight">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function AlertSection({ title, subtitle, empty, rows, render }) {
  return (
    <section className="bg-white rounded-2xl border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-gray-900 text-sm">{title}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>
        </div>
        <div className="text-[10px] font-bold tracking-widest text-gray-500 shrink-0 pt-0.5">
          {rows.length} SHOWN
        </div>
      </div>
      <div className="divide-y">
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">{empty}</div>
        )}
        {rows.map((v) => (
          <Link
            key={v.plateNo + (v._raw?._docId || '')}
            to={`/vehicles/${v.plateNo}`}
            className="block px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            {render(v)}
          </Link>
        ))}
      </div>
    </section>
  )
}

function VehicleAlertRow({ v, right }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-black text-sm text-gray-900 tracking-wide">{v.plateNo}</span>
          <RoadworthyBadge status={v.roadworthy} size="sm" />
        </div>
        <div className="text-[11px] text-gray-600 truncate mt-0.5 flex items-center gap-1.5">
          {v.company && <span className="font-mono text-gray-500 truncate">{v.company}</span>}
          {v.branch && <><span className="text-gray-300">·</span><span className="text-gray-500">{v.branch}</span></>}
          {v.assignedTo && (
            <>
              <span className="text-gray-300">·</span>
              <span className="inline-flex items-center gap-1 text-gray-500 uppercase truncate">
                <Icon name="user" className="w-3 h-3" />{v.assignedTo}
              </span>
            </>
          )}
        </div>
      </div>
      {right}
    </div>
  )
}

// ── compute ──────────────────────────────────────────────────────────────

function computeStats(vehicles) {
  const critical = []
  const pmsOverdue = []
  const pmsDueSoon = []
  const dispatchBlocked = []
  const reassess = []
  let active = 0, minor = 0, unfit = 0

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()

  for (const v of vehicles) {
    if (v.roadworthy === 'active') active++
    else if (v.roadworthy === 'minor') minor++
    else if (v.roadworthy === 'unfit') unfit++

    const crit = v.classification?.failCriticalCount || 0
    if (crit > 0) critical.push(v)

    if (v.overdueDays && v.overdueDays > 0) {
      pmsOverdue.push(v)
    } else if (v.nextPms) {
      const t = Date.parse(v.nextPms)
      if (!isNaN(t) && t - now <= THIRTY_DAYS && t >= now) pmsDueSoon.push(v)
    }

    // Supervisor-cleared units are intentionally excluded — the override is
    // the resolution; analytics should show outstanding blockers only.
    if (v.classification?.dispatchAllowed === false && !v.supervisorCleared) dispatchBlocked.push(v)
    if (v.classification?.reassessmentRequired) reassess.push(v)
  }

  // Rank lists for display.
  critical.sort((a, b) => (b.classification?.failCriticalCount || 0) - (a.classification?.failCriticalCount || 0))
  pmsOverdue.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0))
  pmsDueSoon.sort((a, b) => Date.parse(a.nextPms || 0) - Date.parse(b.nextPms || 0))
  reassess.sort((a, b) => Date.parse(a.classification?.reassessmentDue || 0) - Date.parse(b.classification?.reassessmentDue || 0))

  const pmsCombined = [...pmsOverdue, ...pmsDueSoon]

  return {
    active, minor, unfit,
    criticalDefects: critical.length,
    overduePms: pmsOverdue.length,
    dispatchBlocked: dispatchBlocked.length,
    reassessmentDue: reassess.length,
    criticalList: critical.slice(0, TOP_N),
    pmsList:      pmsCombined.slice(0, TOP_N),
    reassessList: reassess.slice(0, TOP_N),
  }
}

function computeByCompany(vehicles) {
  const map = new Map()
  for (const v of vehicles) {
    const key = v.company || 'WALK-IN'
    const row = map.get(key) || { company: key, total: 0, active: 0, minor: 0, unfit: 0, critical: 0, overdue: 0 }
    row.total++
    if (v.roadworthy === 'active') row.active++
    else if (v.roadworthy === 'minor') row.minor++
    else if (v.roadworthy === 'unfit') row.unfit++
    if ((v.classification?.failCriticalCount || 0) > 0) row.critical++
    if (v.overdueDays && v.overdueDays > 0) row.overdue++
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => (b.unfit + b.critical + b.overdue) - (a.unfit + a.critical + a.overdue))
}
