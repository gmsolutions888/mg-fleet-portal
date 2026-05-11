// Password gate for preview deployments only.
// Set VITE_PREVIEW_PASSWORD in .env to enable.
// On production (mg-fleet-portal-new.vercel.app or custom domain), this is skipped.

import { useState } from 'react'

const PREVIEW_PASSWORD = import.meta.env.VITE_PREVIEW_PASSWORD || ''
const STORAGE_KEY = 'mgfp:preview-auth'

function isProduction() {
  const host = window.location.hostname
  return host === 'localhost'
    || host === 'mg-fleet-portal-new.vercel.app'
    || host === 'mg-fleet-portal.vercel.app'
    || !host.includes('vercel.app') // custom domain
}

export default function PreviewGate({ children }) {
  const [authed, setAuthed] = useState(() => {
    if (!PREVIEW_PASSWORD || isProduction()) return true
    try { return sessionStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)

  if (authed) return children

  const submit = (e) => {
    e.preventDefault()
    if (input === PREVIEW_PASSWORD) {
      try { sessionStorage.setItem(STORAGE_KEY, 'true') } catch {}
      setAuthed(true)
    } else {
      setError(true)
      setTimeout(() => setError(false), 2000)
    }
  }

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <img
              src="/assets/mg-logo.jpg"
              alt="Master Garage"
              className="w-20 h-20 object-cover rounded-full border-2 border-gray-700"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </div>
          <div className="text-white font-black text-xl tracking-wide">MG FLEET PORTAL</div>
          <div className="text-gray-400 text-xs mt-1 uppercase tracking-widest">Preview</div>
        </div>
        <form onSubmit={submit} className="bg-white rounded-lg shadow-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Enter preview password</label>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Password"
              className="input w-full"
              autoFocus
            />
          </div>
          {error && (
            <div className="text-xs text-red-600 font-semibold">Incorrect password</div>
          )}
          <button
            type="submit"
            className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-lg text-sm"
          >
            Enter Preview
          </button>
        </form>
      </div>
    </div>
  )
}
