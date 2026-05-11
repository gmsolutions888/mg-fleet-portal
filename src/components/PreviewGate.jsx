// Password gate for preview deployments only.
// Set VITE_PREVIEW_PASSWORD in .env to enable.
// On production (mg-fleet-portal-new.vercel.app or custom domain), this is skipped.

import { useState } from 'react'

const PREVIEW_PASSWORD = import.meta.env.VITE_PREVIEW_PASSWORD || 'MGPreview2026!'
const STORAGE_KEY = 'mgfp:preview-auth'

function isProduction() {
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (host === 'mgfleet.gmsolutions.ph' || host === 'mgfleetsystem.com' || host === 'www.mgfleetsystem.com') return true
  // test.mgfleetsystem.com is preview — NOT production
  if (host === 'test.mgfleetsystem.com') return false
  // Other custom domains are production
  if (!host.includes('vercel.app')) return true
  // Vercel production aliases
  if (host === 'mg-fleet-portal-new.vercel.app' || host === 'mg-fleet-portal.vercel.app' || host === 'mg-fleet-portal-new-pi.vercel.app') return true
  return false
}

export default function PreviewGate({ children }) {
  const [authed, setAuthed] = useState(() => {
    if (!PREVIEW_PASSWORD || isProduction()) return true
    try { return sessionStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })

  if (authed) return children

  const tryPassword = () => {
    const input = window.prompt('Enter preview password:')
    if (input === null) return // cancelled
    if (input === PREVIEW_PASSWORD) {
      try { sessionStorage.setItem(STORAGE_KEY, 'true') } catch {}
      setAuthed(true)
    } else {
      window.alert('Incorrect password')
      tryPassword()
    }
  }

  // Trigger prompt on mount
  if (!authed) {
    setTimeout(tryPassword, 100)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 2 }}>MG FLEET PORTAL</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: 3 }}>Preview</div>
        <button
          onClick={tryPassword}
          style={{ marginTop: 24, background: '#b91c1c', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          Enter Password
        </button>
      </div>
    </div>
  )
}
