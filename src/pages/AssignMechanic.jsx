// Assign / reassign a mechanic to a booked appointment. Full-page picker so
// supervisors can see who's idle vs. loaded before tapping. Writes via
// assignMechanic() which also emits an internal notification (no fleet-client
// spam on mechanic changes).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { watchAppointments, assignMechanic } from '../lib/appointments'
import { MECHANICS } from '../lib/dummyData'
import PageHero from '../components/ui/PageHero'
import Icon from '../components/ui/Icon'
import StatusPill from '../components/ui/StatusPill'

export default function AssignMechanic() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Round 16 — when entered via the My Garage Assess flow, this param is set
  // and we forward to the assessment form on save instead of bouncing back.
  const thenTarget = params.get('then')
  const goAfterSave = () => {
    if (thenTarget === 'assess' && id) navigate(`/appointments/${id}/assess`)
    else navigate(-1)
  }

  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(null) // mechanic name currently being written
  const [error, setError] = useState(null)

  useEffect(() => {
    const unsub = watchAppointments({}, ({ rows }) => setRows(rows))
    return unsub
  }, [])

  const appt = useMemo(() => rows.find((a) => a.id === id) || null, [rows, id])

  // Workload per mechanic — counts all non-completed appointments assigned to
  // that mechanic across the fleet. Helps the picker surface idle techs.
  const mechanics = useMemo(() => {
    const term = search.trim().toLowerCase()
    const activeStatuses = new Set(['BOOKED', 'CONFIRMED', 'ARRIVED', 'ONGOING', 'DIAGNOSED', 'PENDING'])
    const load = new Map()
    for (const a of rows) {
      if (!a.mechanic || a.mechanic === 'Not yet assigned') continue
      if (!activeStatuses.has(a.status)) continue
      load.set(a.mechanic, (load.get(a.mechanic) || 0) + 1)
    }
    const out = MECHANICS.map((m) => ({
      ...m,
      workload: load.get(m.name) || 0,
    }))
    return term
      ? out.filter((m) => m.name.toLowerCase().includes(term))
      : out
  }, [rows, search])

  const currentName = appt?.mechanic && appt.mechanic !== 'Not yet assigned' ? appt.mechanic : null

  const assign = async (name) => {
    if (!appt || saving) return
    setSaving(name); setError(null)
    try {
      await assignMechanic(appt.id, name)
      goAfterSave()
    } catch (err) {
      console.error('[assign] failed:', err)
      setError(err.message || String(err))
      setSaving(null)
    }
  }

  const unassign = async () => {
    if (!appt || saving) return
    setSaving('__unassign'); setError(null)
    try {
      await assignMechanic(appt.id, 'Not yet assigned')
      goAfterSave()
    } catch (err) {
      console.error('[assign] unassign failed:', err)
      setError(err.message || String(err))
      setSaving(null)
    }
  }

  if (!appt) {
    return (
      <div className="pb-24">
        <PageHero eyebrow="ASSIGN MECHANIC" title="Loading…" />
        <div className="px-4 pt-6 text-sm text-gray-500">Looking up the appointment…</div>
      </div>
    )
  }

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="ASSIGN MECHANIC"
        title={appt.plateNo}
        subtitle={[appt.customer, appt.scheduledTime].filter(Boolean).join(' · ') || 'Pick a mechanic below'}
        right={<div className="text-right shrink-0"><StatusPill status={appt.status} /></div>}
      />

      <div className="px-3 sm:px-6 pt-4 space-y-4">
        {/* Current assignment card */}
        <div className="bg-white rounded-2xl border p-4 flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
            currentName ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400'
          }`}>
            {currentName
              ? currentName.split(' ').map((n) => n[0]).join('').slice(0, 2)
              : <Icon name="user" className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold tracking-widest text-gray-500">CURRENTLY ASSIGNED</div>
            <div className="font-bold text-sm text-gray-900 truncate mt-0.5">
              {currentName || <span className="italic text-gray-400 font-normal">Not yet assigned</span>}
            </div>
          </div>
          {currentName && (
            <button
              onClick={unassign}
              disabled={Boolean(saving)}
              className="text-xs font-bold text-gray-500 hover:text-red-600 disabled:opacity-40 shrink-0 px-3 py-2"
            >
              {saving === '__unassign' ? 'Clearing…' : 'Unassign'}
            </button>
          )}
        </div>

        {error && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            Save failed: {error}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mechanics…"
            className="input pl-9"
          />
        </div>

        <div className="text-[10px] font-bold tracking-widest text-gray-500">
          PICK A MECHANIC ({mechanics.length})
        </div>

        {/* Mechanic list — one card per row on mobile, 2/3 cols on wider */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {mechanics.length === 0 && (
            <div className="col-span-full bg-white rounded-2xl border border-dashed p-6 text-center text-gray-400 text-sm">
              No mechanics match.
            </div>
          )}
          {mechanics.map((m) => {
            const isCurrent = m.name === currentName
            const isSaving = saving === m.name
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => !isCurrent && assign(m.name)}
                disabled={isCurrent || Boolean(saving)}
                className={`text-left rounded-2xl border p-3 flex items-center gap-3 transition-shadow ${
                  isCurrent
                    ? 'bg-brand/5 border-brand/40 cursor-default'
                    : 'bg-white hover:shadow-md hover:border-brand/40 disabled:opacity-60'
                }`}
              >
                <div className="w-11 h-11 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-black shrink-0">
                  {m.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-gray-900 truncate">{m.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {m.workload > 0 ? (
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                        {m.workload} active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                        Idle
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-xs font-bold">
                  {isCurrent ? (
                    <span className="text-brand">CURRENT</span>
                  ) : isSaving ? (
                    <span className="text-gray-500">Saving…</span>
                  ) : (
                    <span className="text-brand">Assign →</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
