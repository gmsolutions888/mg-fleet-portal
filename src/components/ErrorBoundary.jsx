// Top-level error boundary. React error boundaries catch render-time
// exceptions in their subtree and render a fallback UI instead of
// unmounting silently (which is what produces "blank white page" /
// "screen freezes" reports).
//
// Wrapping the whole router in this means any uncaught render error
// — including the kind that's bitten us several times this session
// (Round 22.1, Round 32.1, Round 34.1) — surfaces visibly with the
// stack trace, plus a "Reload" button.
//
// One class component because that's the only API React gives for
// componentDidCatch. The rest of the app stays functional.

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info)
  }

  reset = () => {
    this.setState({ error: null, info: null })
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)
    const stack = this.state.error?.stack || ''
    const componentStack = this.state.info?.componentStack || ''

    return (
      <div className="min-h-screen bg-gray-50 flex items-start sm:items-center justify-center p-4 sm:p-8">
        <div className="bg-white border-2 border-red-300 rounded-2xl shadow-xl max-w-3xl w-full p-5 sm:p-7 space-y-4">
          <div className="flex items-start gap-3">
            <div className="text-3xl leading-none">⚠️</div>
            <div className="min-w-0 flex-1">
              <div className="font-black text-gray-900 text-lg">Something went wrong</div>
              <div className="text-sm text-gray-600 mt-1">
                The page hit an unexpected error and stopped rendering. Your data is safe — nothing was written.
                Reload to recover; if the same screen errors again, share the details below.
              </div>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs">
            <div className="font-bold text-red-800">Error</div>
            <div className="text-red-900 mt-0.5 break-words">{msg}</div>
          </div>

          {stack && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-bold">
                Stack trace
              </summary>
              <pre className="mt-2 bg-gray-900 text-gray-100 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words max-h-64">
                {stack}
              </pre>
            </details>
          )}

          {componentStack && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-bold">
                React component tree
              </summary>
              <pre className="mt-2 bg-gray-100 text-gray-800 rounded-lg p-3 overflow-auto whitespace-pre-wrap max-h-48">
                {componentStack}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={this.reset}
              className="bg-brand hover:bg-brand-dark text-white font-bold text-sm px-5 py-2.5 rounded-xl"
            >
              Reload page
            </button>
            <a
              href="/home"
              className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold text-sm px-5 py-2.5 rounded-xl"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    )
  }
}
