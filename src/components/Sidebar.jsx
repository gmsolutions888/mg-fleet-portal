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
          `flex items-center justify-between px-4 py-2.5 md:py-1.5 text-sm transition-colors ` +
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
    </Section>
  )
}

function Brand() {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-gray-800">
      <div className="text-white font-bold text-lg leading-tight">
        garage <span className="text-brand-light">.\</span> connect
      </div>
      <div className="text-[10px] uppercase tracking-wider text-sidebar-heading mt-1">
        MG Fleet Portal
      </div>
      <div className="flex justify-center mt-3">
        <img
          src="/assets/mg-logo.jpg"
          alt="Master Garage"
          className="w-20 h-20 md:w-28 md:h-28 object-cover rounded-full border-2 border-gray-700"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
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

// On mobile the sidebar is a fixed-position drawer (translated off-screen
// by default, slid in when `drawerOpen` flips). On md+ it's a static column.
// A close button is rendered inside the drawer for mobile so users who opened
// it but changed their mind have an obvious exit besides the backdrop.
export default function Sidebar({ drawerOpen = false, onClose }) {
  const { profile } = useAuth()
  const role = profile?.role
  // Admins always get the full internal sidebar regardless of their role.
  const customerView = isCustomer(role) && !profile?.is_admin

  const shellClasses =
    'fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-text ' +
    'overflow-y-auto flex flex-col transform transition-transform duration-200 ease-out ' +
    'md:static md:translate-x-0 md:w-60 md:h-full md:z-auto ' +
    (drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0')

  // Close the drawer when any link inside it is tapped. Relying on
  // pathname-change alone wasn't enough — tapping a Quick Link that points
  // at the current route (e.g. "+ Booking" from /appointments) left the
  // drawer overlaid on top of the content. Harmless on md+ since onClose
  // still just flips a state that CSS ignores at that breakpoint.
  const handleNavClick = (e) => {
    if (!onClose) return
    if (e.target.closest && e.target.closest('a')) onClose()
  }

  const MobileCloseButton = () => (
    <button
      onClick={onClose}
      className="md:hidden absolute top-2 right-2 w-8 h-8 rounded-md hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white"
      aria-label="Close menu"
    >
      ✕
    </button>
  )

  if (customerView) {
    return (
      <aside className={shellClasses} onClick={handleNavClick}>
        <MobileCloseButton />
        <Brand />
        <Section title="Fleet">
          <Item to="/portal" label="Fleet Dashboard" />
          <Item to="/portal/my-fleet" label="My Fleet" />
          <Item to="/portal/service-log" label="Service Log" />
          <Item to="/portal/notifications" label="Notifications" />
          <Item to="/portal/quotations" label="Service Quotations" />
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
    <aside className={shellClasses} onClick={handleNavClick}>
      <MobileCloseButton />
      <Brand />
      <Section title="Quick Links">
        <Item to="/home" label="My Garage" />
        <Item to="/home/my-mechanics" label="My Mechanics" />
        <Item to="/appointments?quicklink=yes" label="+ Booking" />
        <Item to="/service-receipts/create" label="+ Service Receipt" />
        <Item to="/home/notifications" label="Notifications" />
      </Section>
      <Section title="Core Operations">
        <Item to="/appointments" label="Service Bookings" />
        <Item to="/service-receipts" label="Service Receipts" />
        <Item to="/quotations" label="Service Quotations" />
        <Item to="/quotations/unbilled" label="Services for Quotation" />
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
