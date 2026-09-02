// Shared date-range presets and helpers.
//
// THE CONVENTION (read before adding anything here)
// -------------------------------------------------
// Calendar arithmetic runs on the LOCAL clock, so "Today" / "This week" /
// "This month" mean what the person looking at the screen means.
//
// The boundaries we emit are UTC DAY EDGES — `YYYY-MM-DDT00:00:00.000Z` to
// `YYYY-MM-DDT23:59:59.999Z` — because every day bucket in this system is a UTC
// day: task_stats_daily.day, dashboard_stats' created_at::date (the DB runs in
// UTC), manager_overview, and the store-task period keys.
//
// Ireland is UTC+0/+1, so the only divergence is a record scanned between 00:00
// and 01:00 IST in summer, which the database already counts against the
// previous day. Do not "fix" that here — fix it in both places or neither.
//
// Emitting midnight boundaries also matters for correctness, not just tidiness:
// dashboard_stats_v2 reads a day-grained rollup, so a range starting mid-day
// rounds out to the whole day. Every preset below lands on a day edge.
//
// This module replaces seven copy-pasted "today / N-days-ago" helpers. The
// Dashboard uses it now; the report pages (Reports, Expiry, Pricing,
// AdminReports, StoreTasks) still have their own and are a separate change —
// note three of those compute "today" in UTC and three locally, so converting
// them will shift some default ranges by a day.

import { useCallback, useMemo, useState } from 'react'

// ── Local calendar helpers ──────────────────────────────────────────────────
// Deliberately NOT toISOString().slice(0,10) — that converts to UTC first and
// silently reports "yesterday" for anyone east of Greenwich late in the day.
export function isoDay(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const todayDay = () => isoDay(new Date())

const parseDay = (day) => {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(day, n) {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

export function addMonths(day, n) {
  const d = parseDay(day)
  d.setMonth(d.getMonth() + n)
  return isoDay(d)
}

// Monday-based, mirroring Postgres date_trunc('week') and the backend's
// isoWeek() period keys.
export function startOfIsoWeek(day) {
  const d = parseDay(day)
  const dow = (d.getDay() + 6) % 7          // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow)
  return isoDay(d)
}

export function startOfMonth(day) {
  const d = parseDay(day)
  d.setDate(1)
  return isoDay(d)
}

export function endOfMonth(day) {
  const d = parseDay(day)
  d.setMonth(d.getMonth() + 1, 0)
  return isoDay(d)
}

// ── Presets ─────────────────────────────────────────────────────────────────
export const PRESETS = [
  'today', 'yesterday',
  'this_week', 'last_week', 'last_7',
  'this_month', 'last_month', 'last_30',
  'last_90', 'last_6_months',
  'custom'
]

export const PRESET_LABELS = {
  today:         'Today',
  yesterday:     'Yesterday',
  this_week:     'This week',
  last_week:     'Last week',
  last_7:        'Last 7 days',
  this_month:    'This month',
  last_month:    'Last month',
  last_30:       'Last 30 days',
  last_90:       'Last 90 days',
  last_6_months: 'Last 6 months',
  custom:        'Custom range'
}

// Calendar presets ("This week" = Mon-to-today) and rolling presets
// ("Last 7 days") are both offered on purpose: the Dashboard's old buttons were
// rolling, so keeping rolling versions means no existing view is lost.
export function resolvePreset(key) {
  const today = todayDay()
  switch (key) {
    case 'today':         return { fromDay: today, toDay: today }
    case 'yesterday':     return { fromDay: addDays(today, -1), toDay: addDays(today, -1) }
    case 'this_week':     return { fromDay: startOfIsoWeek(today), toDay: today }
    case 'last_week': {
      const lastWeekStart = addDays(startOfIsoWeek(today), -7)
      return { fromDay: lastWeekStart, toDay: addDays(lastWeekStart, 6) }
    }
    case 'last_7':        return { fromDay: addDays(today, -6),  toDay: today }
    case 'this_month':    return { fromDay: startOfMonth(today), toDay: today }
    case 'last_month': {
      const prev = addMonths(startOfMonth(today), -1)
      return { fromDay: prev, toDay: endOfMonth(prev) }
    }
    case 'last_30':       return { fromDay: addDays(today, -29), toDay: today }
    case 'last_90':       return { fromDay: addDays(today, -89), toDay: today }
    case 'last_6_months': return { fromDay: addDays(addMonths(today, -6), 1), toDay: today }
    default:              return { fromDay: addDays(today, -29), toDay: today }
  }
}

// ── Output ──────────────────────────────────────────────────────────────────
// UTC day edges. `to` is 23:59:59.999 so the last day is inclusive, matching
// every existing report in the app.
export function toRangeParams({ fromDay, toDay }) {
  return {
    from: `${fromDay}T00:00:00.000Z`,
    to:   `${toDay}T23:59:59.999Z`
  }
}

// Value for an <input type="datetime-local">, for the report pages that use one.
export const toInputValue = (day, endOfDay = false) =>
  `${day}T${endOfDay ? '23:59' : '00:00'}`

// Mirrors the thresholds in dashboard_stats_v2 so the client can label the axis
// before the response arrives. The server is authoritative and echoes back the
// bucket it actually used.
export function suggestBucket(fromDay, toDay) {
  const days = Math.round(
    (parseDay(toDay).getTime() - parseDay(fromDay).getTime()) / 86400000
  )
  if (days <= 31)  return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

const fmtDay = (day) =>
  parseDay(day).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })

export function rangeLabel({ preset, fromDay, toDay }) {
  if (preset && preset !== 'custom' && PRESET_LABELS[preset]) return PRESET_LABELS[preset]
  if (!fromDay || !toDay) return ''
  return fromDay === toDay ? fmtDay(fromDay) : `${fmtDay(fromDay)} – ${fmtDay(toDay)}`
}

// ── Hook ────────────────────────────────────────────────────────────────────
// Presets re-resolve on every read rather than being frozen at mount, so a tab
// left open overnight does not keep showing yesterday as "Today".
export function useDateRange(defaultPreset = 'last_30') {
  const [state, setState] = useState(() => ({
    preset: defaultPreset,
    ...resolvePreset(defaultPreset)
  }))

  const setRange = useCallback((next) => {
    setState(prev => {
      const merged = { ...prev, ...next }
      if (next.preset && next.preset !== 'custom') {
        return { preset: next.preset, ...resolvePreset(next.preset) }
      }
      // A hand-picked date always means "custom"; swap reversed bounds rather
      // than erroring at the user.
      let { fromDay, toDay } = merged
      if (fromDay && toDay && fromDay > toDay) [fromDay, toDay] = [toDay, fromDay]
      return { preset: 'custom', fromDay, toDay }
    })
  }, [])

  const params = useMemo(
    () => toRangeParams({ fromDay: state.fromDay, toDay: state.toDay }),
    [state.fromDay, state.toDay]
  )
  const bucket = useMemo(
    () => suggestBucket(state.fromDay, state.toDay),
    [state.fromDay, state.toDay]
  )

  return { range: state, setRange, params, bucket }
}
