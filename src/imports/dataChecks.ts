import buildingsData from './buildings.json'
import entrancesData from './entrances.json'
import graphData from './graph.json'
import interiorsData from './interiors.json'
import scheduleData from './schedule.json'
import walkwaysData from './walkways.json'
import walkwayAccessData from './walkway-access.json'
import nearbyData from './nearby.json'
import regionData from './region.json'
import { distanceM } from './geo'
import type { Building, Entrance, Graph, Interior, RegionData, ScheduleFile } from './types'

export interface DataReport {
  problems: string[] // broken references or invalid values; should always be empty
  warnings: string[] // known gaps that degrade a feature but don't break it
}

// Cross-file consistency of the local data.
export function checkData(): DataReport {
  const buildings = buildingsData as Building[]
  const entrances = entrancesData as Entrance[]
  const graph = graphData as Graph
  const interiors = interiorsData as unknown as Interior[]
  const schedule = scheduleData as ScheduleFile
  const walkwayCount = (walkwaysData as unknown[]).length
  const barriers = (walkwayAccessData as { barriers: { line: number }[] }).barriers

  const out: string[] = []
  const warnings: string[] = []
  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) out.push(`${kind}: duplicate id "${id}"`)
      seen.add(id)
    }
    return seen
  }

  const buildingIds = dupes('buildings', buildings.map((b) => b.id))
  for (const b of buildings)
    if (b.hostId && !buildingIds.has(b.hostId)) out.push(`buildings: ${b.id} hostId "${b.hostId}" not found`)

  const entranceById = new Map(entrances.map((e) => [e.id, e]))
  dupes('entrances', entrances.map((e) => e.id))
  for (const e of entrances) {
    if (!buildingIds.has(e.buildingId)) out.push(`entrances: ${e.id} buildingId "${e.buildingId}" not found`)
    if (!e.position.pixel && !e.position.geo) out.push(`entrances: ${e.id} has no position`)
  }

  const nodeIds = dupes('graph nodes', graph.nodes.map((n) => n.id))
  for (const n of graph.nodes)
    if (n.buildingId && !buildingIds.has(n.buildingId)) out.push(`graph: node ${n.id} buildingId "${n.buildingId}" not found`)
  dupes('graph edges', graph.edges.map((e) => e.id))
  for (const e of graph.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) out.push(`graph: edge ${e.id} joins a missing node`)
    if (!(e.weightM > 0)) out.push(`graph: edge ${e.id} weightM must be positive`)
  }

  for (const int of interiors) {
    const where = `interiors[${int.buildingId}]`
    if (!buildingIds.has(int.buildingId)) out.push(`${where}: building not found`)
    const floorIds = new Set(int.floors.map((f) => f.id))
    dupes(`${where} rooms`, int.floors.flatMap((f) => f.rooms.map((r) => r.id)))
    for (const c of int.cores)
      for (const f of c.floors) if (!floorIds.has(f)) out.push(`${where}: core ${c.id} serves missing floor "${f}"`)
    const unlinked: string[] = []
    for (const e of int.entrances) {
      if (!floorIds.has(e.floorId)) out.push(`${where}: entrance ${e.entranceId} on missing floor "${e.floorId}"`)
      const ent = entranceById.get(e.entranceId)
      if (!ent) unlinked.push(e.entranceId)
      else if (ent.buildingId !== int.buildingId)
        out.push(`${where}: entrance ${e.entranceId} belongs to ${ent.buildingId}`)
    }
    if (unlinked.length)
      warnings.push(
        `${where}: ${unlinked.length} of ${int.entrances.length} indoor entrances have no entrances.json door ` +
          `(${unlinked.join(', ')}), so indoor routes there can't start at the outdoor arrival door`,
      )
  }

  for (const i of schedule.items) {
    if (i.buildingId && !buildingIds.has(i.buildingId)) out.push(`schedule: ${i.id} buildingId "${i.buildingId}" not found`)
    if (i.roomNumber !== null && typeof i.roomNumber !== 'string') out.push(`schedule: ${i.id} roomNumber must be a string`)
  }

  for (const b of barriers)
    if (!Number.isInteger(b.line) || b.line < 0 || b.line >= walkwayCount)
      out.push(`walkway-access: barrier line ${b.line} is not a walkways.json index`)

  // Off-campus places (OpenStreetMap import) must stay separate from campus ids and inside the 2-mile area.
  const region = regionData as RegionData
  const nearby = nearbyData as Building[]
  for (const id of dupes('nearby', nearby.map((p) => p.id)))
    if (buildingIds.has(id)) out.push(`nearby: ${id} clashes with a buildings.json id`)
  for (const p of nearby) {
    if (p.kind !== 'poi' || !p.poiType) out.push(`nearby: ${p.id} must be a poi with a poiType`)
    if (!p.position.geo) out.push(`nearby: ${p.id} has no geo position`)
    else if (distanceM(region.center, p.position.geo) > region.radiusM + 1)
      out.push(`nearby: ${p.id} is outside the ${region.radiusM} m radius`)
  }
  const nodeCount = region.nodes.length
  region.ways.forEach((w, i) => {
    if (w.n.length < 2 || w.n.some((n) => !Number.isInteger(n) || n < 0 || n >= nodeCount))
      out.push(`region: way ${i} has an invalid node list`)
    if (w.drive && !(w.mps! > 0)) out.push(`region: way ${i} is drivable but has no speed`)
  })

  return { problems: out, warnings }
}
