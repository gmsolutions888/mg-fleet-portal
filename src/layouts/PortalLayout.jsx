import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'

// On mobile the sidebar lives as an off-canvas drawer: hidden by default,
// slides in from the left when the Topbar hamburger toggles it. On md+ it
// goes back to being a permanent side column. Auto-closes on route change so
// a nav tap doesn't leave the drawer covering the page.
export default function PortalLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close on any navigation. location.key changes on every navigate — even
  // same-path navigations with a different query string or hash — so this
  // catches cases pathname alone would miss.
  useEffect(() => { setDrawerOpen(false) }, [location.key])

  // Lock body scroll while drawer is open on mobile so the background doesn't
  // scroll under the overlay.
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  return (
    <div className="min-h-screen md:h-full md:flex">
      {/* Backdrop — mobile only, shown when drawer is open */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen md:min-h-0">
        <Topbar onMenuClick={() => setDrawerOpen((v) => !v)} />
        <main className="flex-1 overflow-auto bg-gray-50">
          <Outlet />
        </main>
        <footer className="text-center text-[11px] text-gray-500 py-2 border-t bg-white">
          © GM Solutions Inc {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  )
}
