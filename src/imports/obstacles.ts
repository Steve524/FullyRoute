import footprintsData from './footprints.json'
import { offsetPolygon, pointInPoly, segmentsCross, type Poly, type RoutePoint } from './geometry'

// --- Obstacle avoidance ------------------------------------------------------
// Building footprints traced from the drawn campus map artwork, in map.json's
// pixel space. The drawn polyline is bent around any footprint a segment would
// cross, so the route follows building walls instead of cutting through them.
// Distances/steps still come from the graph's weightM.

export const CLEARANCE = 30 // px the drawn path is nudged outside a wall

interface Footprint {
  poly: Poly // raw wall, used for all blocking/visibility tests
  offset: Poly // walls pushed out by CLEARANCE, used only to source waypoints
  cx: number
  cy: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const footprints: Footprint[] = (footprintsData as { poly: number[][] }[])
  .map((f) => f.poly.map(([x, y]) => ({ x, y })))
  .filter((poly) => poly.length >= 4)
  .map((raw) => {
    const xs = raw.map((p) => p.x)
    const ys = raw.map((p) => p.y)
    return {
      poly: raw,
      offset: offsetPolygon(raw, CLEARANCE),
      cx: raw.reduce((s, p) => s + p.x, 0) / raw.length,
      cy: raw.reduce((s, p) => s + p.y, 0) / raw.length,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  })

// Does segment a-b hit this footprint (cross an edge or lie inside)?
function segmentHitsPoly(a: RoutePoint, b: RoutePoint, fp: Footprint): boolean {
  const poly = fp.poly
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsCross(a, b, poly[j], poly[i])) return true
  }
  return pointInPoly({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly)
}

// Is the straight segment a-b clear of every building? Footprints that contain
// an endpoint (the start/destination building) are ignored so a route can still
// leave and reach its doors.
function segmentClear(a: RoutePoint, b: RoutePoint): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  for (const fp of footprints) {
    if (fp.maxX < minX || fp.minX > maxX || fp.maxY < minY || fp.minY > maxY) continue
    if (pointInPoly(a, fp.poly) || pointInPoly(b, fp.poly)) continue
    if (segmentHitsPoly(a, b, fp)) return false
  }
  return true
}

// Shortest obstacle-free path from a to b through building corners, via a
// visibility graph over the (inflated) footprint vertices near the corridor.
// Returns the waypoints after `a` (including `b`). This routes *around* walls by
// construction rather than bending a straight line after the fact.
const CORRIDOR = 260 // px margin around the a-b box for candidate corners

export function routeSegment(a: RoutePoint, b: RoutePoint): RoutePoint[] {
  if (segmentClear(a, b)) return [b]

  const minX = Math.min(a.x, b.x) - CORRIDOR
  const maxX = Math.max(a.x, b.x) + CORRIDOR
  const minY = Math.min(a.y, b.y) - CORRIDOR
  const maxY = Math.max(a.y, b.y) + CORRIDOR

  // Nodes: a (0), b (1), then footprint corners (offset outward) in the corridor.
  const nodes: RoutePoint[] = [a, b]
  for (const fp of footprints) {
    if (fp.maxX < minX || fp.minX > maxX || fp.maxY < minY || fp.minY > maxY) continue
    for (const v of fp.offset) nodes.push(v)
  }

  const n = nodes.length
  const dist = new Array<number>(n).fill(Infinity)
  const prev = new Array<number>(n).fill(-1)
  const done = new Array<boolean>(n).fill(false)
  dist[0] = 0

  while (true) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i]
        u = i
      }
    }
    if (u === -1 || u === 1) break
    done[u] = true
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue
      if (!segmentClear(nodes[u], nodes[v])) continue
      const nd = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y)
      if (nd < dist[v]) {
        dist[v] = nd
        prev[v] = u
      }
    }
  }

  if (dist[1] === Infinity) return [b] // no way through — fall back to straight

  const path: RoutePoint[] = []
  let cur = 1
  while (cur !== -1) {
    path.unshift(nodes[cur])
    cur = prev[cur]
  }
  return path.slice(1) // drop `a`, already in the polyline
}
