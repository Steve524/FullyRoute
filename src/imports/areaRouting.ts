import regionData from './region.json'
import nearbyData from './nearby.json'
import { bearingDeg, compassWord, distanceM } from './geo'
import type { Building, LatLng, RegionData, RegionWay, TravelMode } from './types'

// Walking and driving routes over the OpenStreetMap streets around campus
// (region.json, imported by scripts/import-osm.mjs). Everything runs locally.

export const region = regionData as RegionData
export const nearbyPlaces = nearbyData as Building[]

const WALK_MPS = 1.35 // ~3 mph, matches campus walk times
const DRIVE_TURN_S = 20

export interface AreaStep {
  instruction: string
  distanceM: number
}

export interface AreaTrip {
  mode: TravelMode
  stepFree: boolean
  points: LatLng[] // from the start point to the destination
  meters: number
  seconds: number
  steps: AreaStep[]
}

// --- Graph -------------------------------------------------------------------
const N = region.nodes.length
const M_LAT = 110574
const M_LNG = 111320 * Math.cos((region.center.lat * Math.PI) / 180)
// Local planar meters (x east, y north) — accurate to well under 1% across 4 km.
const nx = region.nodes.map(([, lng]) => (lng - region.center.lng) * M_LNG)
const ny = region.nodes.map(([lat]) => (lat - region.center.lat) * M_LAT)
const geoOf = (i: number): LatLng => ({ lat: region.nodes[i][0], lng: region.nodes[i][1] })

interface Edge {
  to: number
  m: number // meters
  cost: number // walk: meters, drive: seconds
  way: number
}

interface Graph {
  adj: Edge[][]
  main: Uint8Array // 1 = node in the largest connected piece (where snapping is allowed)
  segs: [number, number, number][] // [a, b, way] snappable segments, both nodes in main
}

const usable = (w: RegionWay, mode: TravelMode, stepFree: boolean) =>
  mode === 'walk' ? w.walk && !(stepFree && w.steps) : w.drive

function buildGraph(mode: TravelMode, stepFree: boolean): Graph {
  const adj: Edge[][] = Array.from({ length: N }, () => [])
  region.ways.forEach((w, wi) => {
    if (!usable(w, mode, stepFree)) return
    for (let k = 0; k + 1 < w.n.length; k++) {
      const a = w.n[k]
      const b = w.n[k + 1]
      const m = Math.hypot(nx[a] - nx[b], ny[a] - ny[b])
      const cost = mode === 'walk' ? m : m / (w.mps ?? 8)
      // Walkers can go either way; drivers follow one-way streets.
      if (mode === 'walk' || w.oneway !== -1) adj[a].push({ to: b, m, cost, way: wi })
      if (mode === 'walk' || w.oneway !== 1) adj[b].push({ to: a, m, cost, way: wi })
    }
  })

  // Largest piece, ignoring direction, so a place never snaps onto an isolated scrap of path.
  const undirected: number[][] = Array.from({ length: N }, () => [])
  adj.forEach((es, a) => es.forEach((e) => (undirected[a].push(e.to), undirected[e.to].push(a))))
  const comp = new Int32Array(N).fill(-1)
  const sizes: number[] = []
  for (let s = 0; s < N; s++) {
    if (comp[s] !== -1 || undirected[s].length === 0) continue
    const id = sizes.length
    let size = 0
    const stack = [s]
    comp[s] = id
    while (stack.length) {
      const u = stack.pop()!
      size++
      for (const v of undirected[u]) if (comp[v] === -1) (comp[v] = id), stack.push(v)
    }
    sizes.push(size)
  }
  const biggest = sizes.indexOf(Math.max(...sizes))
  const main = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (comp[i] === biggest) main[i] = 1

  const segs: [number, number, number][] = []
  region.ways.forEach((w, wi) => {
    if (!usable(w, mode, stepFree)) return
    for (let k = 0; k + 1 < w.n.length; k++) if (main[w.n[k]]) segs.push([w.n[k], w.n[k + 1], wi])
  })
  return { adj, main, segs }
}

const graphs = new Map<string, Graph>()
function graphFor(mode: TravelMode, stepFree: boolean) {
  const key = mode === 'walk' ? `walk-${stepFree}` : 'drive'
  let g = graphs.get(key)
  if (!g) graphs.set(key, (g = buildGraph(mode, stepFree)))
  return g
}

// --- Snapping ----------------------------------------------------------------
interface Snap {
  seg: [number, number, number]
  t: number // 0..1 along a -> b
  x: number
  y: number
  off: number // meters from the place to the street
}

function toLocal(p: LatLng) {
  return { x: (p.lng - region.center.lng) * M_LNG, y: (p.lat - region.center.lat) * M_LAT }
}

function snap(g: Graph, p: LatLng): Snap | null {
  const { x, y } = toLocal(p)
  let best: Snap | null = null
  for (const seg of g.segs) {
    const [a, b] = seg
    const dx = nx[b] - nx[a]
    const dy = ny[b] - ny[a]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - nx[a]) * dx + (y - ny[a]) * dy) / len2))
    const sx = nx[a] + t * dx
    const sy = ny[a] + t * dy
    const off = Math.hypot(x - sx, y - sy)
    if (!best || off < best.off) best = { seg, t, x: sx, y: sy, off }
  }
  return best
}

// --- Shortest path -------------------------------------------------------------
// Binary-heap Dijkstra. Two extra nodes, S = N and T = N + 1, sit at the snapped points.
function shortest(g: Graph, mode: TravelMode, s: Snap, t: Snap) {
  const S = N
  const T = N + 1
  const extra = new Map<number, Edge[]>()
  const link = (from: number, e: Edge) => {
    const list = extra.get(from) ?? []
    list.push(e)
    extra.set(from, list)
  }
  const segEdges = (sn: Snap, virt: number, outbound: boolean) => {
    const [a, b, wi] = sn.seg
    const w = region.ways[wi]
    const len = Math.hypot(nx[b] - nx[a], ny[b] - ny[a])
    const speed = mode === 'walk' ? 1 : (w.mps ?? 8)
    const toA = { m: sn.t * len, way: wi }
    const toB = { m: (1 - sn.t) * len, way: wi }
    const canAB = mode === 'walk' || w.oneway !== -1 // a -> b allowed
    const canBA = mode === 'walk' || w.oneway !== 1
    if (outbound) {
      if (canBA) link(virt, { to: a, ...toA, cost: toA.m / speed })
      if (canAB) link(virt, { to: b, ...toB, cost: toB.m / speed })
    } else {
      if (canAB) link(a, { to: virt, ...toA, cost: toA.m / speed })
      if (canBA) link(b, { to: virt, ...toB, cost: toB.m / speed })
    }
  }
  segEdges(s, S, true)
  segEdges(t, T, false)
  // Both on the same stretch of street: allow the direct hop.
  if (s.seg === t.seg) {
    const w = region.ways[s.seg[2]]
    const forward = t.t >= s.t
    if (mode === 'walk' || (forward ? w.oneway !== -1 : w.oneway !== 1)) {
      const m = Math.hypot(t.x - s.x, t.y - s.y)
      link(S, { to: T, m, cost: mode === 'walk' ? m : m / (w.mps ?? 8), way: s.seg[2] })
    }
  }

  const size = N + 2
  const dist = new Float64Array(size).fill(Infinity)
  const prev = new Int32Array(size).fill(-1)
  const prevEdge: (Edge | null)[] = new Array(size).fill(null)
  const heap: [number, number][] = []
  const push = (d: number, v: number) => {
    heap.push([d, v])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
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
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  dist[S] = 0
  push(0, S)
  while (heap.length) {
    const [d, u] = pop()
    if (d > dist[u]) continue
    if (u === T) break
    const out = u < N ? g.adj[u] : []
    const more = extra.get(u)
    for (const list of more ? [out, more] : [out])
      for (const e of list) {
        const nd = d + e.cost
        if (nd < dist[e.to]) {
          dist[e.to] = nd
          prev[e.to] = u
          prevEdge[e.to] = e
          push(nd, e.to)
        }
      }
  }
  if (!Number.isFinite(dist[T])) return null

  const nodes: number[] = []
  const edges: Edge[] = []
  for (let v = T; v !== -1; v = prev[v]) {
    nodes.push(v)
    if (prevEdge[v]) edges.push(prevEdge[v]!)
  }
  return { nodes: nodes.reverse(), edges: edges.reverse(), cost: dist[T] }
}

// --- Directions --------------------------------------------------------------
const UNNAMED: Record<string, string> = {
  footway: 'the footpath',
  sidewalk: 'the sidewalk',
  crossing: 'the crosswalk',
  path: 'the path',
  pedestrian: 'the plaza',
  steps: 'the stairs',
  cycleway: 'the bike path',
  track: 'the trail',
  corridor: 'the corridor',
  service: 'the service road',
  motorway_link: 'the ramp',
  trunk_link: 'the ramp',
  primary_link: 'the connector',
  secondary_link: 'the connector',
  tertiary_link: 'the connector',
}
const wayLabel = (w: RegionWay) => w.name ?? w.along ?? UNNAMED[w.hw] ?? 'the road'

interface Leg {
  label: string
  hw: string
  m: number
  inBearing: number
  outBearing: number
}

function turnPhrase(delta: number, mode: TravelMode) {
  const a = Math.abs(delta)
  const side = delta > 0 ? 'right' : 'left'
  if (a < 25) return 'Continue'
  if (a < 60) return `Bear ${side}`
  if (a < 150 || mode === 'walk') return `Turn ${side}`
  return 'Make a U-turn'
}

function buildSteps(legs: Leg[], mode: TravelMode, destName: string): AreaStep[] {
  // Fold tiny unnamed slivers (< 15 m) into the leg before them; keep crosswalks.
  const merged: Leg[] = []
  for (const leg of legs) {
    const last = merged[merged.length - 1]
    if (last && (leg.label === last.label || (leg.m < 15 && leg.hw !== 'crossing'))) {
      last.m += leg.m
      last.outBearing = leg.outBearing
    } else merged.push({ ...leg })
  }
  const steps: AreaStep[] = merged.map((leg, i) => {
    if (i === 0) return { instruction: `Head ${compassWord(leg.inBearing)} on ${leg.label}`, distanceM: leg.m }
    if (leg.hw === 'crossing') return { instruction: 'Cross the street at the crosswalk', distanceM: leg.m }
    if (leg.hw === 'steps') return { instruction: 'Take the stairs', distanceM: leg.m }
    // Measure turns against the leg before a crosswalk, so crossing a side street doesn't read as a turn.
    const before = merged[i - 1].hw === 'crossing' && i >= 2 ? merged[i - 2] : merged[i - 1]
    if (before.label === leg.label) return { instruction: `Continue on ${leg.label}`, distanceM: leg.m }
    const delta = ((leg.inBearing - before.outBearing + 540) % 360) - 180
    return { instruction: `${turnPhrase(delta, mode)} onto ${leg.label}`, distanceM: leg.m }
  })
  steps.push({ instruction: `Arrive at ${destName}`, distanceM: 0 })
  return steps
}

// --- Public ------------------------------------------------------------------
export type AreaOutcome =
  | { ok: true; trip: AreaTrip }
  | { ok: false; reason: 'off-map' | 'no-path'; place?: 'start' | 'destination' }

// Places farther than this from any usable street are outside the imported area.
const MAX_SNAP_M = 400

export function findAreaRoute(from: LatLng, to: LatLng, destName: string, mode: TravelMode, stepFree: boolean): AreaOutcome {
  const g = graphFor(mode, stepFree)
  const s = snap(g, from)
  const t = snap(g, to)
  if (!s || s.off > MAX_SNAP_M) return { ok: false, reason: 'off-map', place: 'start' }
  if (!t || t.off > MAX_SNAP_M) return { ok: false, reason: 'off-map', place: 'destination' }
  const path = shortest(g, mode, s, t)
  if (!path) return { ok: false, reason: 'no-path' }

  const local = (v: number) => (v === N ? { x: s.x, y: s.y } : v === N + 1 ? { x: t.x, y: t.y } : { x: nx[v], y: ny[v] })
  const toGeo = ({ x, y }: { x: number; y: number }): LatLng => ({
    lat: region.center.lat + y / M_LAT,
    lng: region.center.lng + x / M_LNG,
  })
  const points: LatLng[] = [from, ...path.nodes.map((v) => (v < N ? geoOf(v) : toGeo(local(v)))), to]

  // Group consecutive edges by street.
  const legs: Leg[] = []
  path.edges.forEach((e, i) => {
    const a = local(path.nodes[i])
    const b = local(path.nodes[i + 1])
    if (e.m < 0.5) return
    const bearing = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI
    const w = region.ways[e.way]
    const label = wayLabel(w)
    const last = legs[legs.length - 1]
    if (last && last.label === label && last.hw === w.hw) {
      last.m += e.m
      last.outBearing = (bearing + 360) % 360
    } else legs.push({ label, hw: w.hw, m: e.m, inBearing: (bearing + 360) % 360, outBearing: (bearing + 360) % 360 })
  })

  // The short hop between each place and its street is walked at walking pace in both modes.
  // Driving adds a rough allowance per turn for signals and stop signs (no live traffic).
  const offM = s.off + t.off
  const streetM = path.edges.reduce((sum, e) => sum + e.m, 0)
  const steps = buildSteps(legs, mode, destName)
  const turns = steps.filter((st) => /^(Turn|Bear|Make)/.test(st.instruction)).length
  const seconds = (mode === 'walk' ? path.cost / WALK_MPS : path.cost + turns * DRIVE_TURN_S) + offM / WALK_MPS
  return {
    ok: true,
    trip: {
      mode,
      stepFree: mode === 'walk' && stepFree,
      points,
      meters: streetM + offM,
      seconds,
      steps,
    },
  }
}

/** Straight-line distance and compass direction from a point, for sorting and labels. */
export function straightLine(from: LatLng, to: LatLng) {
  return { meters: distanceM(from, to), direction: compassWord(bearingDeg(from, to)) }
}
