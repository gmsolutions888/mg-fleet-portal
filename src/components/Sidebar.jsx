// Desktop-only persistent sidebar. On mobile (< md) the BottomNav and the
// /more screen replace this. We render it `hidden md:flex` so it's never
// in the DOM on phones — no drawer mechanism, no off-canvas transform, no
// overlap risk with the mobile header.

import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isCustomer, canBookServices, roleLabel } from '../lib/roles'

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <div className="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-sidebar-heading font-semibold">
        {title}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

function Item({ to, label, badge }) {
  return (
    <li>
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          `flex items-center justify-between px-4 py-1.5 text-sm transition-colors ` +
          (isActive
            ? 'bg-brand text-white'
            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white')
        }
      >
        <span>{label}</span>
        {badge != null && badge > 0 && (
          <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-semibold">
            {badge}
          </span>
        )}
      </NavLink>
    </li>
  )
}

function AdminSection({ profile }) {
  if (!profile?.is_admin) return null
  return (
    <Section title="Admin">
      <Item to="/admin/fleet-companies" label="Fleet Companies" />
      <Item to="/admin/users" label="Users" />
      <Item to="/admin/vehicle-catalog" label="Vehicle Catalog" />
      <Item to="/admin/cavite-catalog" label="Price Catalog" />
    </Section>
  )
}

function Brand() {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-gray-800">
      <div className="flex justify-center mb-3">
        <img
          src="/assets/mg-logo.jpg"
          alt="Master Garage"
          className="w-28 h-28 object-cover rounded-full border-2 border-gray-700"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>
      <div className="text-white font-black text-base tracking-wide text-center">
        MG FLEET PORTAL
      </div>
    </div>
  )
}

function Footer({ profile }) {
  const name = profile?.name || profile?.email || 'guest'
  return (
    <div className="mt-auto px-4 py-3 border-t border-gray-800 text-[11px] text-sidebar-heading">
      <div>Logged in as:</div>
      <div className="text-sidebar-text truncate" title={name}>
        {name.toString().toLowerCase().replace(/\s+/g, '_')}
        {profile?.is_admin ? ' · admin' : ''}
      </div>
      {profile?.role && (
        <div className="text-[10px] text-gray-600 mt-0.5">{roleLabel(profile.role)}</div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { profile } = useAuth()
  const role = profile?.role
  // Admins always get the full internal sidebar regardless of their role.
  const customerView = isCustomer(role) && !profile?.is_admin

  const shellClasses = 'hidden md:flex w-60 h-full bg-sidebar text-sidebar-text overflow-y-auto flex-col shrink-0'

  if (customerView) {
    return (
      <aside className={shellClasses}>
        <Brand />
        <Section title="Fleet">
          <Item to="/portal" label="Fleet Dashboard" />
          <Item to="/portal/my-fleet" label="My Fleet" />
          <Item to="/portal/service-log" label="Service Log" />
          <Item to="/portal/notifications" label="Notifications" />
          <Item to="/portal/quotations" label="Service Quotations" />
          <Item to="/portal/invoices" label="Service Receipts" />
          <Item to="/portal/statement" label="Statement of Account" />
          {canBookServices(role) && (
            <Item to="/appointments" label="+ Book a Service" />
          )}
        </Section>
        <AdminSection profile={profile} />
        <Footer profile={profile} />
      </aside>
    )
  }

  return (
    <aside className={shellClasses}>
      <Brand />
      <Section title="Quick Links">
        <Item to="/home" label="My Garage" />
        <Item to="/home/my-mechanics" label="My Mechanics" />
        <Item to="/appointments?quicklink=yes" label="+ Booking" />
        <Item to="/home/notifications" label="Notifications" />
      </Section>
      <Section title="Core Operations">
        <Item to="/appointments" label="Service Bookings" />
        <Item to="/quotations" label="Service Quotations" />
        <Item to="/branch-invoices" label="Branch Invoices" />
        <Item to="/client-invoices" label="Client Invoices" />
        <Item to="/credit-notes" label="Credit Notes" />
        <Item to="/reports" label="Reports" />
      </Section>
      <Section title="Data Management">
        <Item to="/customers" label="Customers" />
        <Item to="/vehicles" label="Fleet" />
        <Item to="/mechanics" label="Mechanics" />
        <Item to="/services" label="Services Offered" />
      </Section>
      <AdminSection profile={profile} />
      <Footer profile={profile} />
    </aside>
  )
}
