// Mobile-only "More" screen — full-screen menu of every route that didn't
// fit on the bottom nav. Role-aware (matches Sidebar's logic) and also
// surfaces the plate search + branch/role info + logout that live in the
// desktop Topbar. On md+ users shouldn't reach this page because the
// sidebar exposes everything directly — if they do, we render normally.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isCustomer, canBookServices, roleLabel } from '../lib/roles'
import Icon from '../components/ui/Icon'

function SectionHeader({ children }) {
  return (
    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-5 pb-2">
      {children}
    </div>
  )
}

function Row({ to, label, icon, onClick }) {
  const body = (
    <div className="flex items-center gap-3 px-4 py-3.5 bg-white hover:bg-gray-50 active:bg-gray-100">
      <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center shrink-0">
        <Icon name={icon} className="w-5 h-5" />
      </div>
      <span className="flex-1 text-[15px] text-gray-800 font-medium">{label}</span>
      <span className="text-gray-300 text-xl leading-none">›</span>
    </div>
  )
  if (onClick) return <button type="button" onClick={onClick} className="w-full text-left">{body}</button>
  return <Link to={to}>{body}</Link>
}

export default function More() {
  const { profile, user, logout } = useAuth()
  const navigate = useNavigate()
  const [plate, setPlate] = useState('')

  const customerView = isCustomer(profile?.role) && !profile?.is_admin

  const handleSearch = (e) => {
    e.preventDefault()
    const p = plate.trim().toUpperCase().replace(/\s+/g, '')
    if (p) navigate(`/vehicles/${encodeURIComponent(p)}`)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="pb-24 min-h-screen bg-gray-50">
      {/* Brand strip — match mg-fms TopBar feel */}
      <div className="bg-brand text-white px-4 pt-5 pb-4">
        <div className="text-[10px] font-bold tracking-widest text-white/60 mb-0.5">LOGGED IN AS</div>
        <div className="font-black text-lg leading-tight truncate">{profile?.name || user?.email || 'User'}</div>
        <div className="text-white/70 text-xs mt-0.5">
          {roleLabel(profile?.role) || 'No role'}
          {profile?.branch ? ` · ${profile.branch}` : ''}
          {profile?.is_admin ? ' · admin' : ''}
        </div>
      </div>

      {/* Plate search — staff-only; fleet customers don't look up arbitrary plates */}
      {!customerView && (
        <form onSubmit={handleSearch} className="px-4 pt-4">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="Search plate…"
              className="input pl-9 uppercase"
            />
          </div>
        </form>
      )}

      {customerView ? <CustomerMenu profile={profile} /> : <StaffMenu profile={profile} />}

      <SectionHeader>Account</SectionHeader>
      <div className="bg-white divide-y">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100"
        >
          <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
            <Icon name="user" className="w-5 h-5" />
          </div>
          <span className="flex-1 text-[15px] text-red-700 font-semibold">Log out</span>
        </button>
      </div>
    </div>
  )
}

function CustomerMenu({ profile }) {
  return (
    <>
      <SectionHeader>Fleet</SectionHeader>
      <div className="bg-white divide-y">
        <Row to="/portal/service-log" icon="doc" label="Service Log" />
        <Row to="/portal/quotations" icon="doc" label="Service Quotations" />
        <Row to="/portal/invoices" icon="doc" label="My Invoices" />
        <Row to="/portal/statement" icon="doc" label="Statement of Account" />
        {canBookServices(profile?.role) && (
          <Row to="/appointments" icon="calendar" label="Book a Service" />
        )}
      </div>

      {profile?.is_admin && (
        <>
          <SectionHeader>Admin</SectionHeader>
          <div className="bg-white divide-y">
            <Row to="/admin/fleet-companies" icon="tool" label="Fleet Companies" />
            <Row to="/admin/users" icon="user" label="Users" />
          </div>
        </>
      )}
    </>
  )
}

function StaffMenu({ profile }) {
  return (
    <>
      <SectionHeader>Quick Links</SectionHeader>
      <div className="bg-white divide-y">
        <Row to="/home/my-mechanics" icon="user" label="My Mechanics" />
        <Row to="/appointments?quicklink=yes" icon="plus" label="+ Booking" />
        <Row to="/service-receipts/create" icon="plus" label="+ Service Receipt" />
      </div>

      <SectionHeader>Core Operations</SectionHeader>
      <div className="bg-white divide-y">
        <Row to="/quotations" icon="doc" label="Service Quotations" />
        <Row to="/quotations/unbilled" icon="doc" label="Services for Quotation" />
        <Row to="/branch-invoices" icon="doc" label="Branch Invoices" />
        <Row to="/client-invoices" icon="doc" label="Client Invoices" />
        <Row to="/credit-notes" icon="doc" label="Credit Notes" />
        <Row to="/reports/receivables" icon="backlog" label="Receivables Aging" />
        <Row to="/reports" icon="backlog" label="Reports" />
      </div>

      <SectionHeader>Data Management</SectionHeader>
      <div className="bg-white divide-y">
        <Row to="/customers" icon="user" label="Customers" />
        <Row to="/vehicles" icon="car" label="Fleet" />
        <Row to="/mechanics" icon="tool" label="Mechanics" />
        <Row to="/services" icon="tool" label="Services Offered" />
      </div>

      {profile?.is_admin && (
        <>
          <SectionHeader>Admin</SectionHeader>
          <div className="bg-white divide-y">
            <Row to="/admin/fleet-companies" icon="tool" label="Fleet Companies" />
            <Row to="/admin/users" icon="user" label="Users" />
          </div>
        </>
      )}
    </>
  )
}
