import buildingsData from './buildings.json'
import entrancesData from './entrances.json'
import footprintsData from './footprints.json'
import graphData from './graph.json'
import { geoToPixel } from './geo'
import { offsetPolygon, type RoutePoint } from './geometry'
import { CLEARANCE } from './obstacles'
import { snapToWalkway, wAdj, wNodes } from './walkwayNetwork'
import type { Building, Entrance, Graph } from './types'

const buildings = buildingsData as Building[]
const graph = graphData as Graph
const buildingById = new Map<string, Building>(buildings.map((b) => [b.id, b]))

// --- Route anchors -----------------------------------------------------------
// Where a route starts/ends for any place — building, parking lot or landmark —
// independent of the illustrative graph. Most precise source wins:
//   1. hand-placed entrances, 2. footprint corners nearest walkways (up to
//   three, one per side), 3. the place's own map pin. Each is then joined to the walkway network.

const MAX_SNAP = 700 // px; farther than this from any walkway = not routable

export interface Anchor {
  point: RoutePoint
  verified: boolean
  label: string | null // entrance name, e.g. "North entrance"; null for a bare pin
  accessible: boolean | null // step-free door? null = not surveyed
  source: AnchorSource
}

// entrance = hand-placed door; outline / pin = estimated from the footprint or map pin.
export type AnchorSource = 'entrance' | 'outline' | 'pin'

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
  return picked.map((p) => ({ point: p, verified: false, label: `${compassFrom(c, p)} side`, accessible: null, source: 'outline' as const }))
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
  return picked.map(({ p, side }) => ({ point: p, verified: false, label: `${side} access`, accessible: null, source: 'pin' as const }))
}

// Map pin for any place: its pixel, else its GPS position, else its host's pin.
export function placePin(id: string): RoutePoint | undefined {
  const b = buildingById.get(id)
  if (!b) return undefined
  if (b.position.pixel) return b.position.pixel
  if (b.position.geo) return geoToPixel(b.position.geo)
  if (b.hostId && b.hostId !== id) return placePin(b.hostId)
  return graph.nodes.find((n) => n.buildingId === id)?.position.pixel
}

function computeAnchors(b: Building): Anchor[] {
  const doors = (entrancesByBuilding.get(b.id) ?? [])
    .filter((e) => snapDist(e.position.pixel!) <= MAX_SNAP)
    .map((e) => ({
      point: e.position.pixel!,
      verified: e.provenance.verified,
      label: e.name,
      accessible: e.accessible,
      source: 'entrance' as const,
    }))
  if (doors.length) return doors

  const derived = outlineDoors(b.name)
  if (derived.length) return derived

  const pin = placePin(b.id)
  if (!pin) return []
  const access = pinAccess(pin)
  if (access.length) return access
  if (snapDist(pin) <= MAX_SNAP) return [{ point: pin, verified: false, label: null, accessible: null, source: 'pin' }]
  return []
}

const anchorMap = new Map<string, Anchor[]>()
for (const b of buildings) {
  if (b.hostId) continue
  const list = computeAnchors(b).map(onMainNet)
  if (list.length) anchorMap.set(b.id, list)
}
// POIs inside a building reuse its doors ("via Titan Student Union · …").
for (const b of buildings) {
  if (!b.hostId) continue
  const host = buildingById.get(b.hostId)
  const list = anchorMap.get(b.hostId)
  if (host && list) anchorMap.set(b.id, list.map((a) => ({ ...a, label: `via ${host.name}${a.label ? ` · ${a.label}` : ''}` })))
}
export const anchors: ReadonlyMap<string, Anchor[]> = anchorMap

// Doors for a place, for drawing on the map.
export function placeDoors(id: string): { point: RoutePoint; label: string | null }[] {
  return (anchors.get(id) ?? []).map(({ point, label }) => ({ point, label }))
}

export interface DoorCoverage {
  id: string
  name: string
  kind: Building['kind']
  source: AnchorSource | 'none' // where its route doors come from
  doors: number
  verified: number // doors confirmed in person
  accessibleKnown: number // doors with a surveyed step-free value
}

// How well each place's doors are mapped, to show the team what to survey next.
export function doorCoverage(): DoorCoverage[] {
  return buildings
    .filter((b) => !b.hostId)
    .map((b) => {
      const list = anchors.get(b.id) ?? []
      return {
        id: b.id,
        name: b.name,
        kind: b.kind,
        source: list[0]?.source ?? 'none',
        doors: list.length,
        verified: list.filter((a) => a.verified).length,
        accessibleKnown: list.filter((a) => a.accessible !== null).length,
      }
    })
}
