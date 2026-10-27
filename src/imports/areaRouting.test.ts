import { describe, expect, it } from 'vitest'
import buildingsData from './buildings.json'
import { findAreaRoute, nearbyPlaces, region } from './areaRouting'
import { CAMPUS_CENTER, distanceM, NEARBY_RADIUS_M, pixelToGeo } from './geo'
import { placePin } from './routing'
import type { Building } from './types'

const campusGeo = pixelToGeo(placePin('bldg-cs')!)
// A place a fair walk away, so the route has several streets.
const target = nearbyPlaces
  .filter((p) => p.poiType === 'grocery')
  .sort((a, b) => distanceM(campusGeo, b.position.geo!) - distanceM(campusGeo, a.position.geo!))[0]

describe('nearby places', () => {
  it('have unique ids that never clash with campus places', () => {
    const ids = nearbyPlaces.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const campus = new Set((buildingsData as Building[]).map((b) => b.id))
    expect(ids.filter((id) => campus.has(id))).toEqual([])
  })

  it('are within two miles of campus and credited to OpenStreetMap', () => {
    for (const p of nearbyPlaces) {
      expect(distanceM(CAMPUS_CENTER, p.position.geo!)).toBeLessThanOrEqual(NEARBY_RADIUS_M + 1)
      expect(p.provenance).toMatchObject({ source: 'imported', verified: false })
    }
    expect(region.attribution).toMatch(/OpenStreetMap/)
  })
})

describe('findAreaRoute', () => {
  it('walks from a campus building to a nearby place', () => {
    const r = findAreaRoute(campusGeo, target.position.geo!, target.name, 'walk', false)
    if (!r.ok) throw new Error(`no route: ${JSON.stringify(r)}`)
    const straight = distanceM(campusGeo, target.position.geo!)
    expect(r.trip.meters).toBeGreaterThanOrEqual(straight * 0.99)
    expect(r.trip.meters).toBeLessThan(straight * 2)
    expect(r.trip.steps[0].instruction).toMatch(/^Head (north|south|east|west)/)
    expect(r.trip.steps.at(-1)!.instruction).toBe(`Arrive at ${target.name}`)
    expect(r.trip.points[0]).toEqual(campusGeo)
  })

  it('drives there faster than walking', () => {
    const walk = findAreaRoute(campusGeo, target.position.geo!, target.name, 'walk', false)
    const drive = findAreaRoute(campusGeo, target.position.geo!, target.name, 'drive', false)
    if (!walk.ok || !drive.ok) throw new Error('no route')
    expect(drive.trip.seconds).toBeLessThan(walk.trip.seconds)
  })

  it('a step-free walk is never shorter than the regular one', () => {
    const plain = findAreaRoute(campusGeo, target.position.geo!, target.name, 'walk', false)
    const free = findAreaRoute(campusGeo, target.position.geo!, target.name, 'walk', true)
    if (!plain.ok || !free.ok) throw new Error('no route')
    expect(free.trip.meters).toBeGreaterThanOrEqual(plain.trip.meters - 1)
    expect(free.trip.stepFree).toBe(true)
  })

  it('reports places outside the imported area', () => {
    expect(findAreaRoute(campusGeo, { lat: 34.2, lng: -118.3 }, 'Far away', 'walk', false)).toMatchObject({
      ok: false,
      reason: 'off-map',
      place: 'destination',
    })
  })
})
