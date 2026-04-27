// Service Booking page. Reads live `appointments` + writes new bookings via
// createAppointment.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canReviewAtBranch } from '../lib/roles'
import { BRANCHES, FLEET_COMPANIES } from '../lib/dummyData'
import { watchVehicles } from '../lib/vehicles'
import {
  APPT_STATUS,
  watchAppointments, createAppointment, updateAppointmentStatus,
  approveBookingAtBranch, rejectBookingAtBranch,
} from '../lib/appointments'
import { PMS_ITEMS } from '../lib/mgfms-catalog'
import SlidePanel from '../components/ui/SlidePanel'
import Icon from '../components/ui/Icon'
import PageHero, { HeroStat } from '../components/ui/PageHero'

const TIME_SLOTS = [
  '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM',
]

// Service options for the booking form, sourced from mg-fms PMS catalog so
// selections line up with the taxonomy mechanics use during diagnosis/PMS.
// Grouped by catalog category: scheduled / brake / major / troubleshooting.
const SERVICE_GROUPS = (() => {
  const order = ['scheduled', 'brake', 'major', 'troubleshooting']
  const titles = {
    scheduled: 'Scheduled Maintenance',
    brake: 'Braking',
    major: 'Major Service',
    troubleshooting: 'Troubleshooting',
  }
  return order.map((cat) => ({
    cat,
    title: titles[cat],
    options: PMS_ITEMS.filter((p) => p.category === cat).map((p) => p.label),
  }))
})()

// Compose an ISO timestamp from a yyyy-mm-dd date and a "H:MM AM/PM" slot.
function composeScheduledAt(dateStr, timeSlot) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeSlot || '').trim())
  let hh = 8, mm = 0
  if (m) {
    hh = Number(m[1]) % 12
    if (/PM/i.test(m[3])) hh += 12
    mm = Number(m[2])
  }
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return new Date().toISOString()
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

export default function ServiceBooking() {
  const { profile } = useAuth()
  const branch = (profile?.branch || 'MGCAVITE').toUpperCase()
  const canReview = canReviewAtBranch(profile?.role) || profile?.is_admin
  const [showPanel, setShowPanel] = useState(false)
  const [editId, setEditId] = useState(null)
  const [queueActing, setQueueActing] = useState(null)
  const [queueError, setQueueError] = useState(null)
  const today = new Date()

  const [appointments, setAppointments] = useState([])
  const [source, setSource] = useState('loading')
  const [vehicles, setVehicles] = useState([])

  useEffect(() => {
    const u1 = watchAppointments({}, ({ rows, source }) => {
      setAppointments(rows); setSource(source)
    })
    const u2 = watchVehicles({}, ({ vehicles }) => setVehicles(vehicles))
    return () => { u1?.(); u2?.() }
  }, [])

  const stats = useMemo(() => {
    const backlogs = appointments.filter((a) => ['ARRIVED', 'ONGOING', 'PENDING'].includes(a.status)).length
    const confirmed = appointments.filter((a) => a.status === 'BOOKED' || a.status === 'CONFIRMED').length
    const pendingApproval = appointments.filter((a) => a.status === APPT_STATUS.PENDING_BRANCH_APPROVAL).length
    return { backlogs, confirmed, pendingApproval }
  }, [appointments])

  // Group today's bookings by scheduled time slot for the day view. Only shows
  // bookings that have cleared branch approval (i.e. not PENDING_BRANCH_APPROVAL).
  const slotMap = useMemo(() => {
    const map = {}
    for (const a of appointments) {
      if (!['BOOKED', 'ARRIVED', 'ONGOING', 'CONFIRMED', 'TENTATIVE'].includes(a.status)) continue
      const slot = a.scheduledTime || '8:00 AM'
      if (!map[slot]) map[slot] = []
      const v = vehicles.find((x) => x.plateNo === a.plateNo)
      map[slot].push({ ...a, model: v?.model, yearModel: v?.yearModel })
    }
    return map
  }, [appointments, vehicles])

  // Fleet bookings awaiting branch approval. Rendered below the time-slot grid
  // so the branch reviewer can act on them inline.
  const pendingApproval = useMemo(() => {
    return appointments
      .filter((a) => a.status === APPT_STATUS.PENDING_BRANCH_APPROVAL && a.company)
      .map((a) => {
        const v = vehicles.find((x) => x.plateNo === a.plateNo)
        return { ...a, model: v?.model, yearModel: v?.yearModel }
      })
  }, [appointments, vehicles])

  const onApproveQueue = async (id) => {
    setQueueActing(id); setQueueError(null)
    try { await approveBookingAtBranch(id) }
    catch (err) { setQueueError(err.message || String(err)) }
    finally { setQueueActing(null) }
  }
  const onRejectQueue = async (id) => {
    const reason = window.prompt('Reason for rejecting this booking? (optional)') ?? ''
    if (reason === null) return
    setQueueActing(id); setQueueError(null)
    try { await rejectBookingAtBranch(id, reason.trim() || null) }
    catch (err) { setQueueError(err.message || String(err)) }
    finally { setQueueActing(null) }
  }

  const todayLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="pb-24">
      <PageHero
        eyebrow="SERVICE BOOKINGS"
        title={branch}
        subtitle={todayLabel}
        right={<HeroStat value={stats.confirmed} label="TODAY" tone="solid" />}
      />

      {source === 'error' && (
        <div className="mx-3 sm:mx-6 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Read blocked — check Firestore rules.
        </div>
      )}

      {/* Floating status tiles overlap the hero for the mg-fms look */}
      <div className="px-3 sm:px-6 -mt-3 relative z-10">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryTile label="Backlogs"         value={stats.backlogs}        tone="sky" />
          <SummaryTile label="Confirmed"        value={stats.confirmed}       tone="green" />
          <SummaryTile label="Pending approval" value={stats.pendingApproval} tone="amber" />
        </div>
      </div>

      <div className="px-3 sm:px-6 pt-5 space-y-5">
        {/* Service Center Bookings — time slot day view */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Today's Bookings</div>
            <span className="text-xs text-gray-400">{stats.confirmed} confirmed</span>
          </div>
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="overflow-x-auto">
              <div className="flex">
                {TIME_SLOTS.map((slot) => (
                  <div key={slot} className="border-r last:border-r-0 w-36 flex-shrink-0">
                    <div className="text-xs font-bold text-gray-500 text-center py-2 border-b bg-gray-50">{slot}</div>
                    <div className="p-2 space-y-2 min-h-[220px]">
                      {(slotMap[slot] || []).map((a) => (
                        <BookingCard key={a.id} appt={a} onClick={() => { setEditId(a.id); setShowPanel(true) }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pending Approval queue */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
              <Icon name="clock" className="w-3.5 h-3.5" />
              Pending Branch Approval
            </div>
            <span className="text-xs text-gray-400">{pendingApproval.length}</span>
          </div>
          {queueError && (
            <div className="mb-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 text-xs">
              Action failed: {queueError}
            </div>
          )}
          {pendingApproval.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed p-5 text-center text-gray-400 text-sm">
              No fleet bookings waiting for branch approval.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingApproval.map((a) => {
                const acting = queueActing === a.id
                return (
                  <div key={a.id} className="bg-white rounded-2xl border-2 border-amber-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => { setEditId(a.id); setShowPanel(true) }}
                      className="w-full text-left px-4 py-3 hover:bg-amber-50"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="bg-amber-500 text-white rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">Pending</div>
                        <div className="font-black text-sm text-gray-900">{a.plateNo}</div>
                        <div className="text-xs text-gray-500 uppercase">· {a.customer || '—'}</div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1.5 break-words">
                        {a.company}{a.scheduledTime ? ` · ${a.scheduledTime}` : ''}{a.model ? ` · ${a.model}` : ''}{a.yearModel ? ` (${a.yearModel})` : ''}
                      </div>
                    </button>
                    {canReview ? (
                      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => onApproveQueue(a.id)}
                          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2.5 rounded-lg font-bold"
                        >
                          ✓ Approve
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => onRejectQueue(a.id)}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-2.5 rounded-lg font-bold"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    ) : (
                      <div className="px-4 pb-3 text-[11px] text-gray-400 italic">Awaiting branch reviewer</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Floating + New Booking */}
      <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-20">
        <button
          onClick={() => { setEditId(null); setShowPanel(true) }}
          className="bg-brand hover:bg-brand-dark text-white rounded-full pl-4 pr-5 py-3 shadow-xl font-bold text-sm flex items-center gap-2"
        >
          <Icon name="plus" className="w-4 h-4" />
          New Booking
        </button>
      </div>

      <SlidePanel open={showPanel} onClose={() => setShowPanel(false)} title="Service Booking">
        <BookingForm
          editId={editId}
          branch={branch}
          appointments={appointments}
          vehicles={vehicles}
          onClose={() => setShowPanel(false)}
        />
      </SlidePanel>
    </div>
  )
}

function SummaryTile({ label, value, tone }) {
  const map = {
    sky:   'bg-sky-500',
    green: 'bg-green-600',
    amber: 'bg-amber-500',
  }
  return (
    <div className={`${map[tone]} text-white rounded-2xl px-3 py-2.5 flex items-center justify-between shadow-sm`}>
      <div className="text-[10px] font-bold tracking-widest opacity-90 leading-tight">{label}</div>
      <div className="text-2xl font-black leading-none">{value ?? '—'}</div>
    </div>
  )
}

function BookingCard({ appt, onClick }) {
  return (
    <button
      onClick={onClick}
      className="block w-full bg-blue-600 text-white rounded-md p-2 text-left shadow-sm hover:bg-blue-700"
    >
      <div className="font-bold text-xs tracking-wide">{appt.plateNo}</div>
      <div className="uppercase text-[10px] opacity-90 truncate">{appt.customer}</div>
      <div className="text-[10px] opacity-80">{(appt.model || '').toString()} ({appt.yearModel || ''})</div>
      <div className="flex items-center gap-1 mt-1 text-[10px] opacity-80">
        <Icon name="user" className="w-3 h-3" />
        {appt.mechanic === 'Not yet assigned' ? 'Unassigned' : appt.mechanic}
      </div>
    </button>
  )
}

function BookingForm({ editId, branch, appointments, vehicles, onClose }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const canReview = canReviewAtBranch(profile?.role) || profile?.is_admin
  const existing = editId ? appointments.find((a) => a.id === editId) : null
  const [walkin, setWalkin] = useState(false)
  const [tentative, setTentative] = useState(false)
  const [custType, setCustType] = useState(existing ? 'old' : 'new')
  const [plate, setPlate] = useState(existing?.plateNo || '')
  const [customer, setCustomer] = useState(existing?.customer || '')
  const [mobile, setMobile] = useState(existing?.mobile || '')
  const [company, setCompany] = useState(existing?.company || '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('8:00 AM')
  const [services, setServices] = useState([])
  const [issues, setIssues] = useState([])
  const [saving, setSaving] = useState(false)
  const [statusActing, setStatusActing] = useState(false)
  const [error, setError] = useState(null)

  // When the plate matches an existing vehicle, surface its metadata so the
  // staff member can confirm they picked the right unit, and prefill fleet
  // company + custType when the vehicle belongs to a fleet client.
  const matchedVehicle = useMemo(() => {
    if (!plate) return null
    const up = plate.toUpperCase().replace(/\s+/g, '')
    return vehicles.find((v) => v.plateNo === up) || null
  }, [plate, vehicles])

  const onPickPlate = (v) => {
    setPlate(v.plateNo)
    if (v.company) {
      setCustType('fleet')
      setCompany(v.company)
    }
  }

  const onStatusAction = async (nextStatus, note) => {
    if (!editId) return
    setStatusActing(true); setError(null)
    try {
      await updateAppointmentStatus(editId, nextStatus, note)
      onClose()
    } catch (err) {
      console.error('[booking] updateAppointmentStatus failed', err)
      setError(err.message || String(err))
    } finally {
      setStatusActing(false)
    }
  }

  const onApprove = async () => {
    if (!editId) return
    setStatusActing(true); setError(null)
    try {
      await approveBookingAtBranch(editId)
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setStatusActing(false)
    }
  }

  const onReject = async () => {
    if (!editId) return
    const reason = window.prompt('Reason for rejecting this booking? (optional)') ?? ''
    if (reason === null) return
    setStatusActing(true); setError(null)
    try {
      await rejectBookingAtBranch(editId, reason.trim() || null)
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setStatusActing(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      // Status policy:
      //   fleet → PENDING_BRANCH_APPROVAL (approval gate, regardless of the
      //           Tentative checkbox — the gate is the dominant signal)
      //   non-fleet + tentative checkbox → TENTATIVE (legacy "might not show")
      //   non-fleet → BOOKED
      const isFleet = custType === 'fleet'
      const submitStatus = isFleet
        ? APPT_STATUS.PENDING_BRANCH_APPROVAL
        : (tentative ? APPT_STATUS.TENTATIVE : APPT_STATUS.BOOKED)
      await createAppointment({
        plateNo: plate,
        customer,
        customerType: custType,
        mobile,
        company: isFleet ? company : null,
        branch,
        scheduledAt: composeScheduledAt(date, time),
        scheduledTime: time,
        servicesInterested: services,
        customerIssues: issues,
        tentative,
        walkin,
        status: submitStatus,
        note: 'SERVICE BOOKED',
      })
      onClose()
    } catch (err) {
      console.error('[booking] createAppointment failed', err)
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded px-3 py-2 text-xs">Save failed: {error}</div>}

      {existing && (
        <div className="bg-gray-50 border rounded-md p-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-gray-500 mr-1">STATUS: {existing.status}</span>
          {existing.status === APPT_STATUS.PENDING_BRANCH_APPROVAL && canReview ? (
            <>
              <button type="button" disabled={statusActing}
                onClick={onApprove}
                className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2 py-1 rounded">
                Approve Booking
              </button>
              <button type="button" disabled={statusActing}
                onClick={onReject}
                className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 rounded">
                Reject
              </button>
            </>
          ) : null}
          {existing.status === APPT_STATUS.PENDING_BRANCH_APPROVAL && !canReview ? (
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              Waiting on branch reviewer
            </span>
          ) : null}
          {existing.status === 'BOOKED' || existing.status === 'CONFIRMED' || existing.status === 'TENTATIVE' ? (
            <button type="button" disabled={statusActing}
              onClick={() => onStatusAction('ARRIVED', 'Vehicle checked in')}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2 py-1 rounded">
              Mark Arrived
            </button>
          ) : null}
          {existing.status === 'ARRIVED' || existing.status === 'ONGOING' ? (
            <button type="button"
              onClick={() => navigate(`/appointments/${editId}/assess`)}
              className="text-xs bg-red-700 hover:bg-red-800 text-white px-2 py-1 rounded">
              Assess →
            </button>
          ) : null}
          {['ARRIVED', 'ONGOING', 'DIAGNOSED'].includes(existing.status) ? (
            <button type="button"
              onClick={() => navigate(`/appointments/${editId}/pms`)}
              className="text-xs bg-green-700 hover:bg-green-800 text-white px-2 py-1 rounded">
              Record PMS →
            </button>
          ) : null}
          {existing.status !== 'CANCELLED' && existing.status !== 'COMPLETED' ? (
            <button type="button" disabled={statusActing}
              onClick={() => {
                if (!confirm('Cancel this booking?')) return
                onStatusAction('CANCELLED', 'Booking cancelled')
              }}
              className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 rounded">
              Cancel Booking
            </button>
          ) : null}
        </div>
      )}

      <Row label="Service Center">
        <select value={branch} disabled className="input">
          {BRANCHES.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="flex items-center gap-1.5 mt-2 text-xs">
          <input type="checkbox" checked={walkin} onChange={(e) => setWalkin(e.target.checked)} />
          Walk-in
        </label>
      </Row>

      <Row label="Preferred Schedule*">
        <div className="flex gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input flex-1" required />
          <select value={time} onChange={(e) => setTime(e.target.value)} className="input w-32">
            {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 mt-2 text-xs">
          <input type="checkbox" checked={tentative} onChange={(e) => setTentative(e.target.checked)} />
          Tentative
        </label>
      </Row>

      <div className="flex items-center gap-4 text-xs">
        {['new', 'old', 'fleet'].map((t) => (
          <label key={t} className="flex items-center gap-1">
            <input type="radio" name="custType" value={t} checked={custType === t} onChange={(e) => setCustType(e.target.value)} />
            <span className="uppercase">{t === 'old' ? 'Old Customer' : t === 'new' ? 'New Customer' : 'FLEET'}</span>
          </label>
        ))}
      </div>

      <Row label="Plate No.*">
        <PlatePicker
          value={plate}
          vehicles={vehicles}
          onChange={setPlate}
          onPick={onPickPlate}
        />
        {matchedVehicle && (
          <div className="mt-2 bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded px-2 py-1.5">
            {matchedVehicle.brandModel || matchedVehicle.model}
            {matchedVehicle.yearModel ? ` (${matchedVehicle.yearModel})` : ''}
            {matchedVehicle.company ? ` · ${matchedVehicle.company}` : ''}
          </div>
        )}
      </Row>

      <Row label="Customer*">
        <div className="flex gap-1">
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="SEARCH CUSTOMER..." className="input flex-1" required />
          <button type="button" className="bg-gray-800 text-white px-2 rounded">+</button>
        </div>
        <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="MOBILE NUMBER" className="input w-full mt-2" />
        <div className="mt-2 bg-sky-50 border border-sky-200 text-sky-900 text-xs rounded px-2 py-1.5">
          <Icon name="phone" className="w-3 h-3 inline mr-1" />
          Ensure to input the updated mobile number.
        </div>
      </Row>

      {custType === 'fleet' && (
        <Row label="Fleet Company">
          <select value={company} onChange={(e) => setCompany(e.target.value)} className="input w-full" required>
            <option value="">— select —</option>
            {FLEET_COMPANIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Row>
      )}

      <Row label="Services Interested*">
        <GroupedMultiSelect
          placeholder="SELECT ALL THAT APPLIES"
          groups={SERVICE_GROUPS}
          value={services}
          onChange={setServices}
        />
      </Row>

      <Row label="Customer Issues">
        <MultiSelect
          placeholder="SELECT ALL THAT APPLIES"
          options={['Engine Noise', 'Brake Issues', 'Overheating', 'AC Not Working', 'Transmission Slipping', 'Electrical Problems']}
          value={issues}
          onChange={setIssues}
        />
      </Row>

      <div className="pt-2 flex justify-end">
        <button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded font-semibold text-sm">
          {saving ? 'Saving…' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

function PlatePicker({ value, vehicles, onChange, onPick }) {
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const q = String(value || '').toUpperCase().replace(/\s+/g, '')
    if (!q) return []
    return vehicles
      .filter((v) => v.plateNo?.startsWith(q) && v.plateNo !== q)
      .slice(0, 8)
  }, [value, vehicles])

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="SEARCH VEHICLE..."
          className="input flex-1 uppercase"
          required
        />
        <button type="button" className="bg-gray-800 text-white px-2 rounded" title="New vehicle (not yet wired)">+</button>
      </div>
      {open && matches.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10 max-h-56 overflow-auto">
          {matches.map((v) => (
            <button
              key={v.plateNo}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(v); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-xs flex items-center justify-between"
            >
              <span className="font-semibold">{v.plateNo}</span>
              <span className="text-gray-500 truncate ml-2">
                {v.brandModel || v.model || ''}{v.company ? ` · ${v.company}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupedMultiSelect({ placeholder, groups, value, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (opt) => {
    onChange(value.includes(opt) ? value.filter((o) => o !== opt) : [...value, opt])
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="input w-full text-left flex items-center justify-between text-xs">
        <span className={value.length === 0 ? 'text-gray-400' : 'text-gray-900'}>
          {value.length === 0 ? placeholder : `${value.length} selected`}
        </span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10 max-h-72 overflow-auto">
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="px-3 py-1 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500 sticky top-0">
                {g.title}
              </div>
              {g.options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-xs cursor-pointer">
                  <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function MultiSelect({ placeholder, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (opt) => {
    onChange(value.includes(opt) ? value.filter((o) => o !== opt) : [...value, opt])
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="input w-full text-left flex items-center justify-between text-xs">
        <span className={value.length === 0 ? 'text-gray-400' : 'text-gray-900'}>
          {value.length === 0 ? placeholder : value.join(', ')}
        </span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10 max-h-48 overflow-auto">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-xs cursor-pointer">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
