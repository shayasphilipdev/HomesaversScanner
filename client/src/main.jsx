import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './lib/theme.js'   // applies stored theme before first paint
import './App.css'
import { isTestEnv } from './lib/env.js'

// Stamp the test build before first paint so the darker test palette in
// App.css applies without a flash of the live colours. Paired with the red
// TESTING MODE banner in App.jsx — the tint is the at-a-glance signal for
// staff who are looking at the shelf, not the top of the screen.
if (isTestEnv()) document.documentElement.setAttribute('data-testenv', '1')

// Register the service worker so the app installs as a PWA and the shell
// is available offline. Skipped on localhost dev since Vite serves /sw.js
// from the public dir at the prod URL only.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
