import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleReset = () => {
    // Clear query caches but KEEP auth session (don't log user out)
    try {
      localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')
      // Don't remove 'tripsplit-auth' — that would log them out!
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(key => caches.delete(key)))
      }
    } catch (e) {
      // ignore
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
          <div className="max-w-sm w-full text-center space-y-4">
            <p className="text-4xl">😵</p>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-200">
              Something went wrong
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              The app encountered an error. This is usually fixed by clearing the cache.
            </p>
            {this.state.error && (
              <p className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 rounded p-2 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleReset}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
            >
              Clear Cache & Reload
            </button>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 text-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
