import walkwaysData from './walkways.json'
import walkwayAccessData from './walkway-access.json'
import type { RoutePoint } from './geometry'
import { routeSegment } from './obstacles'

// --- Walkway network ---------------------------------------------------------
// Real pedestrian ways (footway/path/pedestrian/steps/service) from OpenStreetMap,
// georeferenced into the map's pixel space. Routes are drawn along this network
// so the line follows actual sidewalks and paths instead of cutting across grass.
// Building endpoints snap onto the nearest walkway node; only the short link from
// a door to the path is a straight connector.

const QUANT = 8 // px grid for merging coincident walkway vertices
const DENSIFY = 40 // px max spacing between walkway nodes (subdivided for snapping)
const CELL = 120 // px spatial-hash cell for nearest-node lookup

export const wNodes: RoutePoint[] = []
export const wAdj: { to: number; w: number; line: number }[][] = []
const nodeIndex = new Map<string, number>()
const grid = new Map<string, number[]>()

function wNode(x: number, y: number): number {
  const key = `${Math.round(x / QUANT)},${Math.round(y / QUANT)}`
  let idx = nodeIndex.get(key)
  if (idx === undefined) {
    idx = wNodes.length
    wNodes.push({ x, y })
    wAdj.push([])
    nodeIndex.set(key, idx)
    const gk = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
    if (!grid.has(gk)) grid.set(gk, [])
    grid.get(gk)!.push(idx)
  }
  return idx
}

function wEdge(a: number, b: number, line: number) {
  if (a === b) return
  const w = Math.hypot(wNodes[a].x - wNodes[b].x, wNodes[a].y - wNodes[b].y)
  wAdj[a].push({ to: b, w, line })
  wAdj[b].push({ to: a, w, line })
}

// Walkway polylines that aren't step-free (stairs, steep ramps, closures).
// Listed in walkway-access.json by polyline index; everything else is assumed
// passable until surveyed.
export interface WalkwayBarrier {
  line: number
  type: 'steps' | 'steep' | 'closed' | 'narrow'
  note?: string
}
const barriers = (walkwayAccessData as { barriers: WalkwayBarrier[] }).barriers
const blockedLines = new Set(barriers.map((b) => b.line))
// Until someone surveys the paths, a step-free route can't be called confirmed.
export const barriersSurveyed = barriers.length > 0

for (const [lineIdx, line] of (walkwaysData as number[][][]).entries()) {
  let prev = -1
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i]
    if (prev === -1) {
      prev = wNode(x, y)
      continue
    }
    // Subdivide long segments so snapping always lands close to the real path.
    const p = wNodes[prev]
    const dist = Math.hypot(x - p.x, y - p.y)
    const steps = Math.max(1, Math.ceil(dist / DENSIFY))
    let from = prev
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const nx = p.x + (x - p.x) * t
      const ny = p.y + (y - p.y) * t
      const to = wNode(nx, ny)
      wEdge(from, to, lineIdx)
      from = to
    }
    prev = wNode(x, y)
  }
}

// Nearest walkway node to an arbitrary point, searching outward through the grid.
export function snapToWalkway(p: RoutePoint): number {
  const gx = Math.floor(p.x / CELL)
  const gy = Math.floor(p.y / CELL)
  let best = -1
  let bestD = Infinity
  for (let ring = 0; ring <= 12; ring++) {
    for (let cx = gx - ring; cx <= gx + ring; cx++) {
      for (let cy = gy - ring; cy <= gy + ring; cy++) {
        if (ring > 0 && Math.abs(cx - gx) !== ring && Math.abs(cy - gy) !== ring) continue
        for (const idx of grid.get(`${cx},${cy}`) ?? []) {
          const d = Math.hypot(wNodes[idx].x - p.x, wNodes[idx].y - p.y)
          if (d < bestD) {
            bestD = d
            best = idx
          }
        }
      }
    }
    // Once we have a hit, one extra ring guarantees the true nearest is found.
    if (best !== -1 && ring >= 1) break
  }
  return best
}

// Binary-heap Dijkstra over the walkway graph; returns node coords start..end.
function walkPath(a: RoutePoint, b: RoutePoint): RoutePoint[] | null {
  return walkPathMulti([a], [b])?.path ?? null
}

// One Dijkstra from every start door at once to the nearest end door. Each
// door's straight link to its snapped walkway node counts toward the total, so
// the winner is the shortest door-to-door walk overall.
export function walkPathMulti(
  froms: RoutePoint[],
  tos: RoutePoint[],
  stepFree = false,
): { path: RoutePoint[]; from: number; to: number } | null {
  const link = (p: RoutePoint, n: number) => Math.hypot(wNodes[n].x - p.x, wNodes[n].y - p.y)
  const starts = froms.map(snapToWalkway)
  const ends = tos.map(snapToWalkway)
  // Cheapest end door reachable through each walkway node.
  const endCost = new Map<number, { door: number; c: number }>()
  ends.forEach((n, i) => {
    if (n === -1) return
    const c = link(tos[i], n)
    const cur = endCost.get(n)
    if (!cur || c < cur.c) endCost.set(n, { door: i, c })
  })
  if (!endCost.size || starts.every((n) => n === -1)) return null

  const dist = new Float64Array(wNodes.length).fill(Infinity)
  const prev = new Int32Array(wNodes.length).fill(-1)
  const origin = new Int32Array(wNodes.length).fill(-1) // start door per node
  const heap: { n: number; d: number }[] = []
  const push = (n: number, d: number) => {
    heap.push({ n, d })
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p].d <= heap[i].d) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        let sm = i
        const l = 2 * i + 1
        const r = 2 * i + 2
        if (l < heap.length && heap[l].d < heap[sm].d) sm = l
        if (r < heap.length && heap[r].d < heap[sm].d) sm = r
        if (sm === i) break
        ;[heap[sm], heap[i]] = [heap[i], heap[sm]]
        i = sm
      }
    }
    return top
  }

  starts.forEach((n, i) => {
    if (n === -1) return
    const c = link(froms[i], n)
    if (c < dist[n]) {
      dist[n] = c
      origin[n] = i
      push(n, c)
    }
  })

  let best = { total: Infinity, node: -1, door: -1 }
  while (heap.length) {
    const { n, d } = pop()
    if (d > dist[n]) continue
    if (d >= best.total) break // nothing left can beat the best arrival
    const end = endCost.get(n)
    if (end && d + end.c < best.total) best = { total: d + end.c, node: n, door: end.door }
    for (const e of wAdj[n]) {
      if (stepFree && blockedLines.has(e.line)) continue
      const nd = d + e.w
      if (nd < dist[e.to]) {
        dist[e.to] = nd
        prev[e.to] = n
        origin[e.to] = origin[n]
        push(e.to, nd)
      }
    }
  }

  if (best.node === -1) return null
  const out: RoutePoint[] = []
  for (let cur = best.node; cur !== -1; cur = prev[cur]) out.unshift(wNodes[cur])
  return { path: out, from: origin[best.node], to: best.door }
}

// Route one leg (graph node A -> B) along the walkway network. The short links
// from each endpoint to its nearest path node are kept clear of building walls.
function legPoints(a: RoutePoint, b: RoutePoint): RoutePoint[] {
  const path = walkPath(a, b)
  if (!path || path.length === 0) return routeSegment(a, b) // no walkway — fall back
  const head = routeSegment(a, path[0])
  const tail = routeSegment(path[path.length - 1], b)
  return [...head, ...path.slice(1), ...tail]
}

// Build the drawn polyline: follow real walkways between each pair of graph nodes.
export function avoidObstacles(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    for (const wp of legPoints(points[i], points[i + 1])) out.push(wp)
  }
  return out
}
