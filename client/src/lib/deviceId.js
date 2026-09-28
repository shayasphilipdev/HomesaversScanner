// A stable per-browser identifier, so a report from one physical device (one
// gun, one till) can be told apart from another sharing the same store login.
// Purely a random tag — carries no personal or hardware identity — but it's
// what turns "gun 2 keeps doing this" from a guess into something queryable
// in device_log_events, for a store with no one on site who can check the
// device itself.
const KEY = 'hs_device_id'

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private window / storage disabled — a fresh id every call still lets
    // this event upload, it just can't be tied to earlier ones from the
    // same device.
    return `no-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}
