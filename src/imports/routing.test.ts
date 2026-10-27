import { describe, expect, it } from 'vitest'
import { checkData } from './dataChecks'
import { doorCoverage, findRoute, routableBuildingIds, walkMinutes } from './routing'

const ok = (from: string, to: string, stepFree = false) => {
  const out = findRoute(from, to, stepFree)
  if (!out.ok) throw new Error(`expected a route ${from} -> ${to}, got ${JSON.stringify(out)}`)
  return out.route
}

describe('findRoute', () => {
  it('routes between two buildings along the walkways', () => {
    const r = ok('bldg-cs', 'bldg-pl')
    expect(r.totalMeters).toBeGreaterThan(0)
    expect(r.points.length).toBeGreaterThan(1)
    expect(r.steps.length).toBeGreaterThan(0)
    expect(r.startDoorPoint).toEqual(r.points[0])
    expect(r.endDoorPoint).toEqual(r.points[r.points.length - 1])
    expect(r.stepFree).toBe(false)
    expect(r.stepFreeUnchecked).toBeUndefined()
  })

  it('has roughly the same length in both directions', () => {
    const there = ok('bldg-cs', 'bldg-pl').totalMeters
    const back = ok('bldg-pl', 'bldg-cs').totalMeters
    expect(Math.abs(there - back)).toBeLessThanOrEqual(Math.max(there, back) * 0.25)
  })

  it('names the side that is unknown', () => {
    expect(findRoute('nope', 'bldg-cs')).toEqual({ ok: false, reason: 'no-node', place: 'start' })
    expect(findRoute('bldg-cs', 'nope')).toEqual({ ok: false, reason: 'no-node', place: 'end' })
  })

  it('never claims a step-free route is confirmed while doors and paths are unsurveyed', () => {
    const r = ok('bldg-cs', 'bldg-pl', true)
    expect(r.stepFree).toBe(true)
    expect(r.stepFreeConfirmed).toBe(false)
    expect(r.stepFreeUnchecked).toEqual(expect.arrayContaining(['start-door', 'end-door', 'paths']))
  })

  it('reaches every routable academic building from the library', () => {
    const academic = doorCoverage().filter((c) => c.kind === 'academic' && c.id !== 'bldg-pl')
    for (const c of academic) {
      if (!routableBuildingIds.has(c.id)) continue
      expect(findRoute('bldg-pl', c.id).ok, c.id).toBe(true)
    }
  })
})

describe('walkMinutes', () => {
  it('rounds to whole minutes with a one-minute floor', () => {
    expect(walkMinutes(0)).toBe(1)
    expect(walkMinutes(81)).toBe(1)
    expect(walkMinutes(810)).toBe(10)
  })
})

describe('local data', () => {
  it('has no broken cross-file references', () => {
    expect(checkData().problems).toEqual([])
  })
})
