import graphData from './graph.json'
import buildingsData from './buildings.json'
import footprintsData from './footprints.json'
import walkwaysData from './walkways.json'
import { geoToPixel } from './geo'
import entrancesData from './entrances.json'
import walkwayAccessData from './walkway-access.json'
import type { Building, Entrance, Graph, PathEdge, PathNode } from './types'

const graph = graphData as Graph
const buildings = buildingsData as Building[]

const nodeById = new Map<string, PathNode>(graph.nodes.map((n) => [n.id, n]))
const buildingById = new Map<string, Building>(buildings.map((b) => [b.id, b]))

// First graph node that belongs to a given building/landmark id.
const nodeForBuilding = (buildingId: string): PathNode | undefined =>
  graph.nodes.find((n) => n.buildingId === buildingId)

// Readable label for a node — prefer the real building name, otherwise
// prettify the graph's landmark id (e.g. "lm-ecs-lawn" -> "ECS Lawn").
const LANDMARK_LABELS: Record<string, string> = {
  'lm-commons': 'the Commons',
  'lm-quad': 'the Quad',
  'lm-ecs-lawn': 'ECS Lawn',
}

export function nodeLabel(nodeId: string): string {
  const node = nodeById.get(nodeId)
  if (!node?.buildingId) return 'the next point'
  const building = buildingById.get(node.buildingId)
  if (building) return building.name
  return LANDMARK_LABELS[node.buildingId] ?? node.buildingId
}

export interface RouteStep {
  instruction: string
  distanceM: number
  fromNodeId: string
  toNodeId: string
}

export interface RoutePoint {
  x: number
  y: number
}

export interface RouteResult {
  path: string[] // ordered node ids
  points: RoutePoint[] // pixel-space polyline, bent around building obstacles
  steps: RouteStep[]
  totalMeters: number
  unverified: boolean
  startDoor?: string | null // entrance used at each end, when known
  endDoor?: string | null
  startDoorPoint?: RoutePoint
  endDoorPoint?: RoutePoint
  stepFree?: boolean // routed with step-free constraints
  stepFreeConfirmed?: boolean // both doors surveyed accessible and paths surveyed
}

// --- Obstacle avoidance ------------------------------------------------------
// Building footprints traced from the drawn campus map artwork, in map.json's
// pixel space. The drawn polyline is bent around any footprint a segment would
// cross, so the route follows building walls instead of cutting through them.
// Distances/steps still come from the graph's weightM.

const CLEARANCE = 30 // px the drawn path is nudged outside a wall

type Poly = RoutePoint[]

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
function offsetPolygon(poly: Poly, pad: number): Poly {
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

// Named footprints for landmark references in turn-by-turn steps. Prefer the
// short building code (as printed on the map) and fall back to the full name.
const nameToCode = new Map<string, string>()
for (const b of buildings) if (b.code) nameToCode.set(b.name, b.code)

interface NamedFootprint {
  label: string
  poly: RoutePoint[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const namedFootprints: NamedFootprint[] = (footprintsData as { name: string | null; poly: number[][] }[])
  .filter((f) => f.name && f.poly.length >= 4)
  .map((f) => {
    const poly = f.poly.map(([x, y]) => ({ x, y }))
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    return {
      label: nameToCode.get(f.name!) ?? f.name!,
      poly,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  })

// Distance from a point to the closest edge of a polygon (0 if inside).
function distanceToPoly(p: RoutePoint, poly: RoutePoint[]): number {
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

// Closest building label to a point, if one is within `maxPx`. Used to phrase
// steps like "Turn right at EC" instead of bare compass directions.
const LANDMARK_REACH = 85 // px (~17m) — only mention a building you're beside
function nearestLandmark(p: RoutePoint): string | null {
  let best: string | null = null
  let bestDist = LANDMARK_REACH
  for (const fp of namedFootprints) {
    if (p.x < fp.minX - bestDist || p.x > fp.maxX + bestDist) continue
    if (p.y < fp.minY - bestDist || p.y > fp.maxY + bestDist) continue
    const d = distanceToPoly(p, fp.poly)
    if (d < bestDist) {
      bestDist = d
      best = fp.label
    }
  }
  return best
}

function segmentsCross(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): boolean {
  const o = (p: RoutePoint, q: RoutePoint, r: RoutePoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

function pointInPoly(p: RoutePoint, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

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

function routeSegment(a: RoutePoint, b: RoutePoint): RoutePoint[] {
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

// --- Walkway network ---------------------------------------------------------
// Real pedestrian ways (footway/path/pedestrian/steps/service) from OpenStreetMap,
// georeferenced into the map's pixel space. Routes are drawn along this network
// so the line follows actual sidewalks and paths instead of cutting across grass.
// Building endpoints snap onto the nearest walkway node; only the short link from
// a door to the path is a straight connector.

const QUANT = 8 // px grid for merging coincident walkway vertices
const DENSIFY = 40 // px max spacing between walkway nodes (subdivided for snapping)
const CELL = 120 // px spatial-hash cell for nearest-node lookup

const wNodes: RoutePoint[] = []
const wAdj: { to: number; w: number; line: number }[][] = []
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
const barriersSurveyed = barriers.length > 0

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
function snapToWalkway(p: RoutePoint): number {
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
function walkPathMulti(
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
function avoidObstacles(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    for (const wp of legPoints(points[i], points[i + 1])) out.push(wp)
  }
  return out
}

// Map scale from the affine georeference (~4.85 px per metre → ~0.206 m/px).
const METERS_PER_PIXEL = 0.206

function polylineMeters(pts: RoutePoint[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) {
    m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return m * METERS_PER_PIXEL
}

function dedupe(pts: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out
}

// North is up on the map; pixel y increases downward.
function compass(dx: number, dy: number): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

// Collapse the dense walkway polyline into human turn-by-turn steps by keeping
// only meaningful corners, then classifying each turn left/right.
function synthSteps(pts: RoutePoint[]): RouteStep[] {
  if (pts.length < 2) return []
  const corners: RoutePoint[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = corners[corners.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const h1 = Math.atan2(b.y - a.y, b.x - a.x)
    const h2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = ((h2 - h1) * 180) / Math.PI
    while (d > 180) d -= 360
    while (d < -180) d += 360
    if (Math.abs(d) > 22) corners.push(b)
  }
  corners.push(pts[pts.length - 1])

  const steps: RouteStep[] = []
  let lastLandmark: string | null = null
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]
    const b = corners[i + 1]
    const distanceM = Math.round((Math.hypot(b.x - a.x, b.y - a.y) * METERS_PER_PIXEL) / 5) * 5
    if (i !== 0 && distanceM < 5) continue
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    let instruction: string
    if (i === 0) {
      instruction = `Head ${compass(b.x - a.x, b.y - a.y)}`
      const lm = nearestLandmark(mid) ?? nearestLandmark(b)
      if (lm) {
        instruction += ` toward ${lm}`
        lastLandmark = lm
      }
    } else {
      const prev = corners[i - 1]
      const h1 = Math.atan2(a.y - prev.y, a.x - prev.x)
      const h2 = Math.atan2(b.y - a.y, b.x - a.x)
      let d = ((h2 - h1) * 180) / Math.PI
      while (d > 180) d -= 360
      while (d < -180) d += 360
      let turn: string
      if (d > 55) turn = 'Turn right'
      else if (d > 20) turn = 'Bear right'
      else if (d < -55) turn = 'Turn left'
      else if (d < -20) turn = 'Bear left'
      else turn = 'Continue straight'

      // Prefer the landmark at the corner where the turn happens; for a
      // straightaway, mention a building you pass along the way instead.
      const turning = turn !== 'Continue straight'
      const lm = turning ? nearestLandmark(a) : nearestLandmark(mid)
      if (lm && lm !== lastLandmark) {
        instruction = turning ? `${turn} at ${lm}` : `Continue straight past ${lm}`
        lastLandmark = lm
      } else {
        instruction = turn
        if (turning) lastLandmark = null
      }
    }
    steps.push({ instruction, distanceM, fromNodeId: `s${i}`, toNodeId: `s${i + 1}` })
  }
  return steps
}

export type RouteOutcome =
  | { ok: true; route: RouteResult }
  | { ok: false; reason: 'no-node' | 'no-path' | 'no-accessible-door' }

// Adjacency from undirected edges. Route on weightM only, never pixels.
function buildAdjacency(edges: PathEdge[]) {
  const adj = new Map<string, { to: string; weight: number; edge: PathEdge }[]>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.has(e.to)) adj.set(e.to, [])
    adj.get(e.from)!.push({ to: e.to, weight: e.weightM, edge: e })
    adj.get(e.to)!.push({ to: e.from, weight: e.weightM, edge: e })
  }
  return adj
}

// --- Route anchors -----------------------------------------------------------
// Where a route starts/ends for any place — building, parking lot or landmark —
// independent of the illustrative graph. Most precise source wins:
//   1. hand-placed entrances, 2. footprint corners nearest walkways (up to
//   three, one per side), 3. the place's own map pin. Each is then joined to the walkway network.

const MAX_SNAP = 700 // px; farther than this from any walkway = not routable

interface Anchor {
  point: RoutePoint
  verified: boolean
  label: string | null // entrance name, e.g. "North entrance"; null for a bare pin
  accessible: boolean | null // step-free door? null = not surveyed
}

const MAX_DOORS = 3 // derived doors per place
const DOOR_SPACING = 220 // px; derived doors closer than this are redundant

// All entrances per place — big buildings and parking structures have several.
const entrancesByBuilding = new Map<string, Entrance[]>()
for (const e of entrancesData as Entrance[]) {
  if (!e.position.pixel) continue
  const list = entrancesByBuilding.get(e.buildingId) ?? []
  list.push(e)
  entrancesByBuilding.set(e.buildingId, list)
}

// Footprint outlines by building name (a building may have several pieces).
const outlinesByName = new Map<string, RoutePoint[][]>()
for (const f of footprintsData as { name: string | null; poly: number[][] }[]) {
  if (!f.name || f.poly.length < 4) continue
  const raw = f.poly.map(([x, y]) => ({ x, y }))
  const list = outlinesByName.get(f.name) ?? []
  list.push(offsetPolygon(raw, CLEARANCE))
  outlinesByName.set(f.name, list)
}

// Largest connected piece of the walkway network. A few traced paths are
// islands; an anchor that would snap onto one is moved to the main network.
const mainNet = (() => {
  const comp = new Int32Array(wNodes.length).fill(-1)
  const sizes: number[] = []
  for (let s = 0; s < wNodes.length; s++) {
    if (comp[s] !== -1) continue
    const id = sizes.length
    let size = 0
    const stack = [s]
    comp[s] = id
    while (stack.length) {
      const n = stack.pop()!
      size++
      for (const { to } of wAdj[n]) if (comp[to] === -1) (comp[to] = id), stack.push(to)
    }
    sizes.push(size)
  }
  const main = sizes.indexOf(Math.max(...sizes))
  return (i: number) => comp[i] === main
})()

const nearestMainNode = (p: RoutePoint): number => {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < wNodes.length; i++) {
    if (!mainNet(i)) continue
    const d = Math.hypot(wNodes[i].x - p.x, wNodes[i].y - p.y)
    if (d < bestD) (bestD = d), (best = i)
  }
  return best
}

const snapDist = (p: RoutePoint): number => {
  const i = snapToWalkway(p)
  return i === -1 ? Infinity : Math.hypot(wNodes[i].x - p.x, wNodes[i].y - p.y)
}

// Pull an anchor on an island walkway onto the main network's nearest node.
function onMainNet(a: Anchor): Anchor {
  const i = snapToWalkway(a.point)
  if (i !== -1 && mainNet(i)) return a
  const j = nearestMainNode(a.point)
  return j === -1 ? a : { ...a, point: wNodes[j], verified: false }
}

const COMPASS = ['East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest', 'North', 'Northeast']
const compassFrom = (c: RoutePoint, p: RoutePoint) =>
  COMPASS[((Math.round(Math.atan2(p.y - c.y, p.x - c.x) / (Math.PI / 4)) % 8) + 8) % 8]

// Likely doors from a footprint: the outline corners nearest to walkways,
// spread apart so each covers a different side of the building.
function outlineDoors(name: string): Anchor[] {
  const outlines = outlinesByName.get(name)
  if (!outlines) return []
  const pts = outlines.flat()
  const c = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  }
  const candidates = pts
    .map((p) => ({ p, d: snapDist(p) }))
    .filter((v) => v.d <= MAX_SNAP)
    .sort((a, b) => a.d - b.d)
  const picked: RoutePoint[] = []
  for (const { p } of candidates) {
    if (picked.length >= MAX_DOORS) break
    if (picked.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < DOOR_SPACING)) continue
    picked.push(p)
  }
  return picked.map((p) => ({ point: p, verified: false, label: `${compassFrom(c, p)} side`, accessible: null }))
}

// Access points for places without a footprint (fields, lawns, untraced
// buildings): the nearest main-network walkway node on each side of the pin,
// searched out to a bit past the closest path so big fields reach their edges.
function pinAccess(pin: RoutePoint): Anchor[] {
  const near: { p: RoutePoint; d: number }[] = []
  let closest = Infinity
  for (let i = 0; i < wNodes.length; i++) {
    if (!mainNet(i)) continue
    const d = Math.hypot(wNodes[i].x - pin.x, wNodes[i].y - pin.y)
    closest = Math.min(closest, d)
    if (d <= 900) near.push({ p: wNodes[i], d })
  }
  if (closest > MAX_SNAP) return []
  const reach = closest * 1.6 + 150
  const bestBySide = new Map<string, { p: RoutePoint; d: number }>()
  for (const v of near) {
    if (v.d > reach) continue
    const side = compassFrom(pin, v.p)
    const cur = bestBySide.get(side)
    if (!cur || v.d < cur.d) bestBySide.set(side, v)
  }
  const picked: { p: RoutePoint; side: string }[] = []
  for (const [side, { p }] of [...bestBySide].sort((a, b) => a[1].d - b[1].d)) {
    if (picked.length >= MAX_DOORS) break
    if (picked.some((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < DOOR_SPACING)) continue
    picked.push({ p, side })
  }
  return picked.map(({ p, side }) => ({ point: p, verified: false, label: `${side} access`, accessible: null }))
}

// Map pin for any place: its pixel, else its GPS position, else its host's pin.
export function placePin(id: string): RoutePoint | undefined {
  const b = buildingById.get(id)
  if (!b) return undefined
  if (b.position.pixel) return b.position.pixel
  if (b.position.geo) return geoToPixel(b.position.geo)
  if (b.hostId && b.hostId !== id) return placePin(b.hostId)
  return nodeForBuilding(id)?.position.pixel
}

function computeAnchors(b: Building): Anchor[] {
  const doors = (entrancesByBuilding.get(b.id) ?? [])
    .filter((e) => snapDist(e.position.pixel!) <= MAX_SNAP)
    .map((e) => ({ point: e.position.pixel!, verified: e.provenance.verified, label: e.name, accessible: e.accessible }))
  if (doors.length) return doors

  const derived = outlineDoors(b.name)
  if (derived.length) return derived

  const pin = placePin(b.id)
  if (!pin) return []
  const access = pinAccess(pin)
  if (access.length) return access
  if (snapDist(pin) <= MAX_SNAP) return [{ point: pin, verified: false, label: null, accessible: null }]
  return []
}

const anchors = new Map<string, Anchor[]>()
for (const b of buildings) {
  if (b.hostId) continue
  const list = computeAnchors(b).map(onMainNet)
  if (list.length) anchors.set(b.id, list)
}
// POIs inside a building reuse its doors ("via Titan Student Union · …").
for (const b of buildings) {
  if (!b.hostId) continue
  const host = buildingById.get(b.hostId)
  const list = anchors.get(b.hostId)
  if (host && list) anchors.set(b.id, list.map((a) => ({ ...a, label: `via ${host.name}${a.label ? ` · ${a.label}` : ''}` })))
}

// Doors for a place, for drawing on the map.
export function placeDoors(id: string): { point: RoutePoint; label: string | null }[] {
  return (anchors.get(id) ?? []).map(({ point, label }) => ({ point, label }))
}

// Every place that can start or end a route.
export const routableBuildingIds: ReadonlySet<string> = new Set([
  ...anchors.keys(),
  ...graph.nodes.map((n) => n.buildingId).filter((id): id is string => Boolean(id)),
])

/**
 * Dijkstra shortest path between two building ids, minimizing total meters.
 * `accessibleOnly` restricts traversal to accessible edges.
 */
export function findRoute(
  fromBuildingId: string,
  toBuildingId: string,
  accessibleOnly = false,
): RouteOutcome {
  const startNode = nodeForBuilding(fromBuildingId)
  const endNode = nodeForBuilding(toBuildingId)
  const startDoors = anchors.get(fromBuildingId)
  const endDoors = anchors.get(toBuildingId)

  // Primary path: true shortest walk along the real pedestrian network. Every
  // start door is searched at once and the nearest end door wins, so
  // you leave from the side facing your destination.
  // Step-free routes skip known barriers and doors marked not accessible
  // (unsurveyed doors are still allowed, and flagged in the result).
  if (startDoors && endDoors) {
    const ok = (a: Anchor) => !accessibleOnly || a.accessible !== false
    const froms = startDoors.filter(ok)
    const tos = endDoors.filter(ok)
    if (!froms.length || !tos.length) return { ok: false, reason: 'no-accessible-door' }
    const hit = walkPathMulti(
      froms.map((a) => a.point),
      tos.map((a) => a.point),
      accessibleOnly,
    )
    const best = hit && { points: hit.path, from: froms[hit.from], to: tos[hit.to] }
    if (best) {
      const { from, to, points: wp } = best
      const head = routeSegment(from.point, wp[0])
      const tail = routeSegment(wp[wp.length - 1], to.point)
      const points = dedupe([from.point, ...head, ...wp.slice(1), ...tail])
      const totalMeters = Math.round(polylineMeters(points) / 5) * 5
      return {
        ok: true,
        route: {
          path: [fromBuildingId, toBuildingId],
          points,
          steps: synthSteps(points),
          totalMeters,
          unverified: !from.verified || !to.verified,
          startDoor: from.label,
          endDoor: to.label,
          startDoorPoint: from.point,
          endDoorPoint: to.point,
          stepFree: accessibleOnly,
          stepFreeConfirmed:
            accessibleOnly && from.accessible === true && to.accessible === true && barriersSurveyed,
        },
      }
    }
  }

  if (startDoors && endDoors) return { ok: false, reason: 'no-path' }
  if (!startNode || !endNode) return { ok: false, reason: 'no-node' }

  const adj = buildAdjacency(graph.edges)
  const dist = new Map<string, number>()
  const prev = new Map<string, { node: string; edge: PathEdge }>()
  const visited = new Set<string>()

  dist.set(startNode.id, 0)
  // Small graph — a linear-scan frontier is plenty.
  while (true) {
    let current: string | null = null
    let best = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d
        current = id
      }
    }
    if (current === null) break
    if (current === endNode.id) break
    visited.add(current)

    for (const { to, weight, edge } of adj.get(current) ?? []) {
      if (visited.has(to)) continue
      if (accessibleOnly && !edge.accessible) continue
      const nd = best + weight
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        prev.set(to, { node: current, edge })
      }
    }
  }

  if (!dist.has(endNode.id)) return { ok: false, reason: 'no-path' }

  // Reconstruct path.
  const path: string[] = []
  const usedEdges: PathEdge[] = []
  let cursor: string | undefined = endNode.id
  while (cursor) {
    path.unshift(cursor)
    const step = prev.get(cursor)
    if (!step) break
    usedEdges.unshift(step.edge)
    cursor = step.node
  }

  const steps: RouteStep[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const edge = usedEdges[i]
    steps.push({
      instruction: `${i === 0 ? 'Head toward' : 'Continue to'} ${nodeLabel(path[i + 1])}`,
      distanceM: edge.weightM,
      fromNodeId: path[i],
      toNodeId: path[i + 1],
    })
  }

  const rawPoints: RoutePoint[] = path
    .map((id) => nodeById.get(id)?.position.pixel)
    .filter((p): p is RoutePoint => Boolean(p))

  const points = rawPoints.length > 1 ? avoidObstacles(rawPoints) : rawPoints

  const totalMeters = usedEdges.reduce((sum, e) => sum + e.weightM, 0)
  const unverified =
    path.some((id) => !nodeById.get(id)?.provenance.verified) ||
    usedEdges.some((e) => !e.provenance.verified)

  return { ok: true, route: { path, points, steps, totalMeters, unverified } }
}

// Rough walking time: ~1.35 m/s average campus pace.
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 1.35 / 60))
}

// Build an SVG path string with rounded corners from a list of points.
export function buildRoundedPath(pts: RoutePoint[], radius: number): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const d1 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1
    const d2 = Math.hypot(next.x - p.x, next.y - p.y) || 1
    const r = Math.min(radius, d1 / 2, d2 / 2)
    const a = { x: p.x - ((p.x - prev.x) / d1) * r, y: p.y - ((p.y - prev.y) / d1) * r }
    const b = { x: p.x + ((next.x - p.x) / d2) * r, y: p.y + ((next.y - p.y) / d2) * r }
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

