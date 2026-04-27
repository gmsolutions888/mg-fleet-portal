// Vehicle Service Update — side panel. Writes new update entries to Firestore
// via postUpdate and optionally updates the appointment's status + note.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { watchAppointments, updateAppointmentStatus } from '../lib/appointments'
import { watchVehicles } from '../lib/vehicles'
import { postUpdate, watchUpdatesForPlate } from '../lib/serviceUpdates'
import { hasApprovedQuotationForPlate } from '../lib/serviceReceipts'
import StatusPill from '../components/ui/StatusPill'
import Icon from '../components/ui/Icon'

const TAG_OPTIONS = ['POST', 'BOOKED', 'ARRIVED', 'DIAGNOSED', 'ONGOING', 'PENDING', 'COMPLETED']

export default function VehicleServiceUpdate() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [appt, setAppt] = useState(null)
  const [vehicle, setVehicle] = useState(null)
  const [updates, setUpdates] = useState([])
  const [note, setNote] = useState('')
  const [tag, setTag] = useState('POST')
  const [nextStatus, setNextStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Round 11 gate: only show ONGOING as a valid next-status when the plate
  // has an APPROVED_FINAL quotation (fleet bookings only; walk-ins skip).
  // `null` during the initial check; `true` once we know one way or the other.
  const [quoteApproved, setQuoteApproved] = useState(null)

  useEffect(() => {
    const u1 = watchAppointments({}, ({ rows }) => {
      setAppt(rows.find((a) => a.id === id) || rows[0] || null)
    })
    return u1
  }, [id])

  useEffect(() => {
    if (!appt?.plateNo) return
    const u2 = watchVehicles({}, ({ vehicles }) => {
      setVehicle(vehicles.find((v) => v.plateNo === appt.plateNo) || null)
    })
    const u3 = watchUpdatesForPlate(appt.plateNo, ({ rows }) => setUpdates(rows))
    return () => { u2?.(); u3?.() }
  }, [appt?.plateNo])

  // ONGOING gate check — fleet bookings only. Walk-ins auto-pass.
  useEffect(() => {
    let cancelled = false
    if (!appt?.plateNo) { setQuoteApproved(null); return }
    if (!appt.company) { setQuoteApproved(true); return } // walk-in bypass
    hasApprovedQuotationForPlate(appt.plateNo).then((ok) => {
      if (!cancelled) setQuoteApproved(ok)
    })
    return () => { cancelled = true }
  }, [appt?.plateNo, appt?.company])

  const submit = async (e) => {
    e.preventDefault()
    if (!appt) return
    setSaving(true); setError(null)
    try {
      await postUpdate({
        plateNo: appt.plateNo,
        appointmentId: appt.id,
        tag,
        label: note || tag,
      })
      if (nextStatus && nextStatus !== appt.status && appt.id && !String(appt.id).startsWith('a')) {
        await updateAppointmentStatus(appt.id, nextStatus, note || undefined)
      }
      navigate(-1)
    } catch (err) {
      console.error('[update] save failed:', err)
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const timeline = useMemo(() => {
    return (updates || []).map((u) => ({
      date: u.date || u.createdAt?.toDate?.()?.toLocaleDateString() || '',
      tag: u.tag,
      label: u.label,
    }))
  }, [updates])

  if (!appt) return <div className="p-4 sm:p-6 text-gray-500">Loading…</div>

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex justify-end">
      <aside className="w-[460px] max-w-full bg-white h-full flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b">
          <div className="font-semibold text-gray-800 truncate pr-2">Post message for {appt.plateNo}</div>
          <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800 text-xl leading-none shrink-0 w-8 h-8 flex items-center justify-center" aria-label="Close">×</button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-auto p-4 sm:p-5 space-y-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 mb-1">Current Status</div>
            <StatusPill status={appt.status} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">TAG</label>
            <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
              {TAG_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">ADD NOTES...</label>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Type your update here..."
              className="input"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Also change appointment status to…</label>
            <select className="input" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
              <option value="">— keep current ({appt.status}) —</option>
              {TAG_OPTIONS.filter((t) => t !== 'POST').map((t) => {
                const isBlocked = t === 'ONGOING' && quoteApproved === false
                return (
                  <option key={t} value={t} disabled={isBlocked}>
                    {t}{isBlocked ? ' — blocked (quotation not approved)' : ''}
                  </option>
                )
              })}
            </select>
            {nextStatus !== 'ONGOING' && quoteApproved === false && (
              <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Repair can't start yet — this plate has no approved quotation. Have the admin supervisor
                forward the quotation through MG Fleet to the client for approval first.
              </div>
            )}
            {nextStatus === 'ONGOING' && quoteApproved === false && (
              <div className="mt-2 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                Quotation must be APPROVED before moving to ONGOING.
              </div>
            )}
          </div>

          {error && <div className="text-red-600 text-xs">Save failed: {error}</div>}

          <div>
            <div className="text-xs text-gray-500 mb-2">Update History</div>
            <ul className="space-y-3">
              {timeline.length === 0 && <li className="text-xs text-gray-400 italic">No updates yet.</li>}
              {timeline.map((u, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <div className="w-12 shrink-0 text-xs text-gray-500">{u.date || ''}</div>
                  <div className="flex-1">
                    <div className="text-xs"><StatusPill status={u.tag} size="sm" /></div>
                    <div className="text-sm text-gray-800 mt-1">{u.label}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {vehicle && (
            <div className="mt-4 pt-4 border-t">
              <Link to={`/vehicles/${vehicle.plateNo}`} className="text-xs text-brand hover:underline flex items-center gap-1">
                <Icon name="car" className="w-3 h-3" />
                View full vehicle details
              </Link>
            </div>
          )}
        </form>

        <div className="border-t px-4 sm:px-5 py-3 bg-gray-900">
          <button type="button" onClick={submit} disabled={saving} className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2 rounded text-sm font-semibold">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </aside>
    </div>
  )
}
