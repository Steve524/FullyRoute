// Pure geometry in map.json's pixel space.

export interface RoutePoint {
  x: number
  y: number
}

export type Poly = RoutePoint[]

function polyArea(poly: Poly): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  }
  return a / 2
}

// Offset a polygon outward by `pad` px along per-vertex edge normals. Unlike a
// radial-from-centroid inflate, this stays correct for non-convex footprints:
// each vertex moves along the miter of its two adjacent outward edge normals.
export function offsetPolygon(poly: Poly, pad: number): Poly {
  const n = poly.length
  const sign = polyArea(poly) > 0 ? 1 : -1 // outward direction depends on winding
  const out: Poly = []
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]
    const cur = poly[i]
    const next = poly[(i + 1) % n]
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1
    const n1x = (sign * (cur.y - prev.y)) / l1
    const n1y = (sign * -(cur.x - prev.x)) / l1
    const n2x = (sign * (next.y - cur.y)) / l2
    const n2y = (sign * -(next.x - cur.x)) / l2
    let mx = n1x + n2x
    let my = n1y + n2y
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const cos = Math.max(0.25, mx * n1x + my * n1y) // clamp miter at sharp corners
    const scale = pad / cos
    out.push({ x: cur.x + mx * scale, y: cur.y + my * scale })
  }
  return out
}

// Distance from a point to the closest edge of a polygon (0 if inside).
export function distanceToPoly(p: RoutePoint, poly: RoutePoint[]): number {
  if (pointInPoly(p, poly)) return 0
  let min = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy || 1
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    if (d < min) min = d
  }
  return min
}

export function segmentsCross(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): boolean {
  const o = (p: RoutePoint, q: RoutePoint, r: RoutePoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

export function pointInPoly(p: RoutePoint, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Map scale from the affine georeference (~4.85 px per metre → ~0.206 m/px).
export const METERS_PER_PIXEL = 0.206

export function polylineMeters(pts: RoutePoint[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) {
    m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return m * METERS_PER_PIXEL
}

export function dedupe(pts: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out
}
