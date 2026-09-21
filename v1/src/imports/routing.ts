import graphData from './graph.json'
import buildingsData from './buildings.json'
import footprintsData from './footprints.json'
import walkwaysData from './walkways.json'
import type { Building, Graph, PathEdge, PathNode } from './types'

const graph = graphData as Graph
const buildings = buildingsData as Building[]

const nodeById = new Map<string, PathNode>(graph.nodes.map((n) => [n.id, n]))
const buildingById = new Map<string, Building>(buildings.map((b) => [b.id, b]))

// First graph node that belongs to a given building/landmark id.
const nodeForBuilding = (buildingId: string): PathNode | undefined =>
  graph.nodes.find((n) => n.buildingId === buildingId)

// Building/landmark ids that have a node on the walking graph and can therefore
// be used as a route endpoint. Everything else resolves to a "no-node" outcome.
export const routableBuildingIds: ReadonlySet<string> = new Set(
  graph.nodes.map((n) => n.buildingId).filter((id): id is string => Boolean(id)),
)

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
const wAdj: { to: number; w: number }[][] = []
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

function wEdge(a: number, b: number) {
  if (a === b) return
  const w = Math.hypot(wNodes[a].x - wNodes[b].x, wNodes[a].y - wNodes[b].y)
  wAdj[a].push({ to: b, w })
  wAdj[b].push({ to: a, w })
}

for (const line of walkwaysData as number[][][]) {
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
      wEdge(from, to)
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
  const s = snapToWalkway(a)
  const t = snapToWalkway(b)
  if (s === -1 || t === -1) return null

  const dist = new Float64Array(wNodes.length).fill(Infinity)
  const prev = new Int32Array(wNodes.length).fill(-1)
  dist[s] = 0
  const heap: { n: number; d: number }[] = [{ n: s, d: 0 }]
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

  while (heap.length) {
    const { n, d } = pop()
    if (d > dist[n]) continue
    if (n === t) break
    for (const e of wAdj[n]) {
      const nd = d + e.w
      if (nd < dist[e.to]) {
        dist[e.to] = nd
        prev[e.to] = n
        push(e.to, nd)
      }
    }
  }

  if (dist[t] === Infinity) return null
  const out: RoutePoint[] = []
  for (let cur = t; cur !== -1; cur = prev[cur]) out.unshift(wNodes[cur])
  return out
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
  | { ok: false; reason: 'no-node' | 'no-path' }

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
  if (!startNode || !endNode) return { ok: false, reason: 'no-node' }

  // Primary path: true shortest walk along the real pedestrian network. This is
  // the most efficient distance the given paths allow — it isn't constrained to
  // the illustrative building-to-building graph. The graph is only a fallback.
  const sPix = startNode.position.pixel
  const ePix = endNode.position.pixel
  if (!accessibleOnly && sPix && ePix) {
    const wp = walkPath(sPix, ePix)
    if (wp && wp.length) {
      const head = routeSegment(sPix, wp[0])
      const tail = routeSegment(wp[wp.length - 1], ePix)
      const points = dedupe([sPix, ...head, ...wp.slice(1), ...tail])
      const totalMeters = Math.round(polylineMeters(points) / 5) * 5
      return {
        ok: true,
        route: {
          path: [startNode.id, endNode.id],
          points,
          steps: synthSteps(points),
          totalMeters,
          unverified: !startNode.provenance.verified || !endNode.provenance.verified,
        },
      }
    }
  }

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
