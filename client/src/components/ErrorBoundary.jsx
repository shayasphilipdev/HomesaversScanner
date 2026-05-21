import { Component } from 'react'

// Top-level safety net. If any component throws during render, show a
// recoverable message instead of a blank white screen, and let the user
// reload. Logs the error to the console for diagnosis.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
        }}>
          <div style={{
            maxWidth: 420, textAlign: 'center', background: '#fff',
            border: '1px solid #E8E1D2', borderRadius: 12, padding: '28px 24px',
            boxShadow: '0 6px 20px rgba(0,0,0,.08)'
          }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Something went wrong</h2>
            <p style={{ color: '#6E6A60', fontSize: 14, margin: '0 0 16px' }}>
              The screen hit an unexpected error. Your saved records are safe.
              Reload to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#C96442', color: '#fff', border: 0,
                borderRadius: 8, padding: '10px 18px', fontSize: 14,
                fontWeight: 600, cursor: 'pointer'
              }}
            >
              ↻ Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
