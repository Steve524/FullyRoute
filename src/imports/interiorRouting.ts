import interiorsData from './interiors.json'
import entrancesData from './entrances.json'
import type { Entrance, Interior, InteriorRoom, PlanPoint, VerticalCore } from './types'

const interiors = interiorsData as unknown as Interior[]
const entranceById = new Map((entrancesData as Entrance[]).map((e) => [e.id, e]))

export const interiorByBuilding: ReadonlyMap<string, Interior> = new Map(
  interiors.map((i) => [i.buildingId, i]),
)

export const hasInterior = (buildingId: string | null | undefined) =>
  !!buildingId && interiorByBuilding.has(buildingId)

// Vertical travel expressed as equivalent walking meters per floor.
const STAIRS_M = 12
const ELEVATOR_M = 20
// Penalty for the non-preferred kind of vertical core, so routes stick to it unless there's no alternative.
const AVOID_FACTOR = 8
const AVOID_FLAT_M = 200

export type VerticalPreference = 'elevator' | 'stairs'

interface Node {
  floorId: string
  p: PlanPoint
}
interface Edge {
  to: number
  w: number
  core?: VerticalCore
}

interface IndoorGraph {
  nodes: Node[]
  adj: Edge[][]
  roomNode: Map<string, number>
  entranceNode: Map<string, number>
}

const graphs = new Map<string, IndoorGraph>()

const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

function buildGraph(int: Interior): IndoorGraph {
  const nodes: Node[] = []
  const adj: Edge[][] = []
  const keyed = new Map<string, number>()
  const node = (floorId: string, p: PlanPoint) => {
    const key = `${floorId}:${p[0].toFixed(2)},${p[1].toFixed(2)}`
    let i = keyed.get(key)
    if (i === undefined) {
      i = nodes.length
      nodes.push({ floorId, p })
      adj.push([])
      keyed.set(key, i)
    }
    return i
  }
  const link = (a: number, b: number, w: number, core?: VerticalCore) => {
    if (a === b) return
    adj[a].push({ to: b, w, core })
    adj[b].push({ to: a, w, core })
  }

  const roomNode = new Map<string, number>()
  const entranceNode = new Map<string, number>()
  const coreNode = new Map<string, number>() // `${coreId}:${floorId}`

  for (const floor of int.floors) {
    const segs: [PlanPoint, PlanPoint][] = []
    for (const line of floor.corridors) for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i]])

    // Everything that opens onto a corridor on this floor.
    const attach: { p: PlanPoint; bind: (n: number) => void }[] = []
    for (const r of floor.rooms) attach.push({ p: r.door, bind: (n) => roomNode.set(r.id, n) })
    for (const e of int.entrances)
      if (e.floorId === floor.id) attach.push({ p: e.point, bind: (n) => entranceNode.set(e.entranceId, n) })
    for (const c of int.cores)
      if (c.floors.includes(floor.id)) attach.push({ p: c.point, bind: (n) => coreNode.set(`${c.id}:${floor.id}`, n) })

    // Project each onto its nearest corridor segment, then chain each segment's
    // points in order so the corridor is split exactly where doors meet it.
    const onSeg: { t: number; p: PlanPoint }[][] = segs.map(([a, b]) => [
      { t: 0, p: a },
      { t: 1, p: b },
    ])
    const hooks: { at: PlanPoint; p: PlanPoint; bind: (n: number) => void }[] = []
    for (const a of attach) {
      let best = { d: Infinity, s: -1, t: 0, q: a.p as PlanPoint }
      segs.forEach(([s0, s1], s) => {
        const dx = s1[0] - s0[0]
        const dy = s1[1] - s0[1]
        const L = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((a.p[0] - s0[0]) * dx + (a.p[1] - s0[1]) * dy) / L))
        const q: PlanPoint = [s0[0] + t * dx, s0[1] + t * dy]
        const d = dist(q, a.p)
        if (d < best.d) best = { d, s, t, q }
      })
      if (best.s === -1) continue
      onSeg[best.s].push({ t: best.t, p: best.q })
      hooks.push({ at: best.q, p: a.p, bind: a.bind })
    }
    for (const pts of onSeg) {
      pts.sort((a, b) => a.t - b.t)
      for (let i = 1; i < pts.length; i++)
        link(node(floor.id, pts[i - 1].p), node(floor.id, pts[i].p), dist(pts[i - 1].p, pts[i].p))
    }
    for (const h of hooks) {
      const at = node(floor.id, h.at)
      const n = dist(h.at, h.p) < 0.01 ? at : node(floor.id, h.p)
      link(at, n, dist(h.at, h.p))
      h.bind(n)
    }
  }

  // Stairs and elevators join the same core between consecutive floors.
  const byLevel = [...int.floors].sort((a, b) => a.level - b.level)
  for (const c of int.cores) {
    const served = byLevel.filter((f) => c.floors.includes(f.id))
    for (let i = 1; i < served.length; i++) {
      const a = coreNode.get(`${c.id}:${served[i - 1].id}`)
      const b = coreNode.get(`${c.id}:${served[i].id}`)
      // Skipped levels (floors not mapped yet) still cost their full climb.
      const span = Math.max(1, served[i].level - served[i - 1].level)
      if (a !== undefined && b !== undefined) link(a, b, (c.type === 'stairs' ? STAIRS_M : ELEVATOR_M) * span, c)
    }
  }
  return { nodes, adj, roomNode, entranceNode }
}

const graphFor = (int: Interior) => {
  let g = graphs.get(int.buildingId)
  if (!g) graphs.set(int.buildingId, (g = buildGraph(int)))
  return g
}

export interface IndoorLeg {
  floorId: string
  points: PlanPoint[]
}

export interface IndoorStep {
  text: string
  meters?: number
  floorId: string
}

export interface IndoorRoute {
  legs: IndoorLeg[]
  steps: IndoorStep[]
  meters: number
  entranceId: string
  // Where the route changes floor, for markers on each floor involved.
  transfers: { floorId: string; point: PlanPoint; toLevel: number; core: VerticalCore }[]
}

export function findRoom(int: Interior, roomId: string) {
  for (const f of int.floors) {
    const room = f.rooms.find((r) => r.id === roomId)
    if (room) return { room, floor: f }
  }
  return undefined
}

/**
 * Shortest indoor walk from a building entrance to a room. `fromEntranceId`
 * pins the start door (e.g. the one the outdoor route arrives at); otherwise
 * every entrance competes. Step-free skips stairs and inaccessible doors.
 */
export function findIndoorRoute(
  int: Interior,
  roomId: string,
  {
    fromEntranceId,
    stepFree = false,
    prefer = 'elevator',
  }: { fromEntranceId?: string | null; stepFree?: boolean; prefer?: VerticalPreference } = {},
): IndoorRoute | null {
  const g = graphFor(int)
  const target = g.roomNode.get(roomId)
  if (target === undefined) return null

  const doorOk = (id: string) => !stepFree || entranceById.get(id)?.accessible !== false
  let starts = [...g.entranceNode].filter(([id]) => doorOk(id))
  if (fromEntranceId && starts.some(([id]) => id === fromEntranceId))
    starts = starts.filter(([id]) => id === fromEntranceId)
  if (!starts.length) return null

  const d = new Float64Array(g.nodes.length).fill(Infinity)
  const prev = new Int32Array(g.nodes.length).fill(-1)
  const via: (Edge | undefined)[] = []
  const origin = new Map<number, string>()
  const done = new Uint8Array(g.nodes.length)
  for (const [id, n] of starts) {
    d[n] = 0
    origin.set(n, id)
  }
  // Graph is a few hundred nodes; linear-scan Dijkstra is plenty.
  for (;;) {
    let u = -1
    for (let i = 0; i < d.length; i++) if (!done[i] && d[i] < Infinity && (u === -1 || d[i] < d[u])) u = i
    if (u === -1 || u === target) break
    done[u] = 1
    for (const e of g.adj[u]) {
      if (stepFree && e.core?.type === 'stairs') continue
      // The other kind of core stays usable, but only when the preferred one can't get there.
      const nd = d[u] + (e.core && e.core.type !== prefer ? e.w * AVOID_FACTOR + AVOID_FLAT_M : e.w)
      if (nd < d[e.to]) {
        d[e.to] = nd
        prev[e.to] = u
        via[e.to] = e
      }
    }
  }
  if (d[target] === Infinity) return null

  const path: number[] = []
  for (let c = target; c !== -1; c = prev[c]) path.unshift(c)
  const entranceId = origin.get(path[0])!
  const int_ = int
  const levelOf = (floorId: string) => int_.floors.find((f) => f.id === floorId)!.level
  const floorPhrase = (floorId: string) => {
    const name = int_.floors.find((f) => f.id === floorId)!.name
    return /^floor\b/i.test(name) ? name : `the ${name.toLowerCase()}`
  }

  const legs: IndoorLeg[] = []
  const transfers: IndoorRoute['transfers'] = []
  const steps: IndoorStep[] = []
  const ent = int.entrances.find((e) => e.entranceId === entranceId)!
  const doorName = ent.name.replace(/\s*\(approximate\)/i, '')
  steps.push({ text: `Enter through the ${doorName[0].toLowerCase()}${doorName.slice(1)}`, floorId: ent.floorId })

  let leg: IndoorLeg = { floorId: g.nodes[path[0]].floorId, points: [g.nodes[path[0]].p] }
  let walked = 0
  for (let i = 1; i < path.length; i++) {
    const e = via[path[i]]!
    const a = g.nodes[path[i - 1]]
    const b = g.nodes[path[i]]
    if (e.core) {
      // Collapse a run of floor-to-floor hops on one core into a single step.
      let j = i
      while (j + 1 < path.length && via[path[j + 1]]?.core?.id === e.core.id) j++
      const top = g.nodes[path[j]]
      if (walked > 0) steps.push({ text: `Walk to ${e.core.name}`, meters: walked, floorId: a.floorId })
      steps.push({
        text: `Take the ${e.core.type === 'elevator' ? 'elevator' : 'stairs'} to ${floorPhrase(top.floorId)}`,
        floorId: a.floorId,
      })
      transfers.push({ floorId: a.floorId, point: a.p, toLevel: levelOf(top.floorId), core: e.core })
      legs.push(leg)
      leg = { floorId: top.floorId, points: [top.p] }
      walked = 0
      i = j
      continue
    }
    walked += e.w
    leg.points.push(b.p)
  }
  legs.push(leg)

  // Arrival: which side of the corridor the door is on.
  const found = findRoom(int, roomId)!
  const pts = leg.points
  let side = ''
  if (pts.length >= 3) {
    const [p0, p1, door] = [pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]]
    const cross = (p1[0] - p0[0]) * (door[1] - p1[1]) - (p1[1] - p0[1]) * (door[0] - p1[0])
    side = cross > 0 ? ' on your right' : cross < 0 ? ' on your left' : ''
  }
  steps.push({
    text: `${found.room.number}${roomTitle(found.room)} is${side || ' ahead'}`,
    meters: walked,
    floorId: leg.floorId,
  })

  return { legs, steps, meters: Math.round(path.slice(1).reduce((m, n) => m + via[n]!.w, 0)), entranceId, transfers }
}

const roomTitle = (r: InteriorRoom) => (r.name ? ` (${r.name})` : '')
