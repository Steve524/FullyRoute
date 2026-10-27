import graphData from './graph.json'
import buildingsData from './buildings.json'
import { anchors, type Anchor } from './anchors'
import { synthSteps, type RouteStep } from './directions'
import { dedupe, polylineMeters, type RoutePoint } from './geometry'
import { routeSegment } from './obstacles'
import { avoidObstacles, barriersSurveyed, walkPathMulti } from './walkwayNetwork'
import type { Building, Graph, PathEdge, PathNode } from './types'

// Public routing API. Implementation lives in geometry, obstacles,
// walkwayNetwork (sidewalk graph), anchors (doors per place) and directions (steps).
export type { RoutePoint } from './geometry'
export type { RouteStep } from './directions'
export type { WalkwayBarrier } from './walkwayNetwork'
export { doorCoverage, placeDoors, placePin, type AnchorSource, type DoorCoverage } from './anchors'

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
  stepFreeUnchecked?: StepFreeGap[] // what a step-free route still relies on unsurveyed
}

export type StepFreeGap = 'start-door' | 'end-door' | 'paths'

export type RouteOutcome =
  | { ok: true; route: RouteResult }
  | { ok: false; reason: 'no-node' | 'no-accessible-door'; place: 'start' | 'end' }
  | { ok: false; reason: 'no-path' }

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
const graphAdj = buildAdjacency(graph.edges)

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
  // Step-free routes skip known barriers and doors marked not accessible.
  // Doors surveyed as accessible win over unsurveyed ones; unsurveyed doors
  // are only used when nothing better exists, and are flagged in the result.
  if (startDoors && endDoors) {
    const usable = (list: Anchor[]) => {
      if (!accessibleOnly) return list
      const ok = list.filter((a) => a.accessible !== false)
      const sure = ok.filter((a) => a.accessible === true)
      return sure.length ? sure : ok
    }
    const froms = usable(startDoors)
    const tos = usable(endDoors)
    if (!froms.length) return { ok: false, reason: 'no-accessible-door', place: 'start' }
    if (!tos.length) return { ok: false, reason: 'no-accessible-door', place: 'end' }
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
      const gaps: StepFreeGap[] = []
      if (from.accessible !== true) gaps.push('start-door')
      if (to.accessible !== true) gaps.push('end-door')
      if (!barriersSurveyed) gaps.push('paths')
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
          stepFreeConfirmed: accessibleOnly && gaps.length === 0,
          stepFreeUnchecked: accessibleOnly ? gaps : undefined,
        },
      }
    }
  }

  if (startDoors && endDoors) return { ok: false, reason: 'no-path' }
  if (!startNode) return { ok: false, reason: 'no-node', place: 'start' }
  if (!endNode) return { ok: false, reason: 'no-node', place: 'end' }

  const adj = graphAdj
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

  // Graph edges carry their own accessible flag; it only counts once verified in person.
  return {
    ok: true,
    route: {
      path,
      points,
      steps,
      totalMeters,
      unverified,
      stepFree: accessibleOnly,
      stepFreeConfirmed: accessibleOnly && !unverified,
      stepFreeUnchecked: accessibleOnly ? (unverified ? ['paths'] : []) : undefined,
    },
  }
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
