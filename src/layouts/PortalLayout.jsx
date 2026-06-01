import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import BottomNav from '../components/BottomNav'

// Mobile uses a bottom-tab nav (BottomNav) instead of a hamburger drawer —
// mg-fms style. On md+ the persistent Sidebar takes over and the bottom
// nav is hidden by its own `md:hidden`. pb-safe on the main container
// leaves clearance for the bottom-tab bar on mobile.
export default function PortalLayout() {
  return (
    <div className="min-h-screen md:h-full md:flex print:block">
      <div className="print:hidden">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-screen md:min-h-0">
        <div className="print:hidden">
          <Topbar />
        </div>
        <main className="flex-1 overflow-auto bg-gray-50 pb-16 md:pb-0 print:overflow-visible print:bg-white print:pb-0">
          <Outlet />
        </main>
        <footer className="hidden md:block text-center text-[11px] text-gray-500 py-2 border-t bg-white print:hidden">
          © GM Solutions Inc {new Date().getFullYear()} · v1.0.0
        </footer>
      </div>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
