// Animated placeholder block. Use as a perceived-speed boost instead of
// a bare spinner. Sizes via inline style or className.
export default function Skeleton({ w = '100%', h = 14, r = 8, style }) {
  return (
    <span
      className="skeleton"
      style={{ display: 'inline-block', width: w, height: h, borderRadius: r, ...style }}
      aria-hidden
    />
  )
}
