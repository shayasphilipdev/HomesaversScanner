// Photo/file URLs are stored as whatever the device sent, so only plain web
// links may become clickable: a javascript: href would run inside the app, and
// a file:// or \\server link in an Excel export leaks the user's Windows login.
export function safeHref(u) {
  if (typeof u !== 'string') return null
  const s = u.trim()
  return /^https?:\/\//i.test(s) ? s : null
}
