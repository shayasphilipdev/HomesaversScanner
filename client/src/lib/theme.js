// Light / dark theme. Stored in localStorage; falls back to the OS preference.
const KEY = 'hs_theme'

export function getStoredTheme() {
  return localStorage.getItem(KEY)  // 'light' | 'dark' | null
}

export function resolvedTheme() {
  const stored = getStoredTheme()
  if (stored === 'light' || stored === 'dark') return stored
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  // Keep the iOS / Android status-bar tinted to match the surface.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F1419' : '#15265C')
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

// Apply once on script load, before React paints — no FOUC.
applyTheme(resolvedTheme())
