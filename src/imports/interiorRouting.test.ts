import { describe, expect, it } from 'vitest'
import { findIndoorRoute, interiorByBuilding } from './interiorRouting'
import type { Interior } from './types'

const topRoom = (int: Interior) => {
  const floor = [...int.floors].sort((a, b) => b.level - a.level)[0]
  return floor.rooms[0]
}

describe('findIndoorRoute', () => {
  for (const [buildingId, int] of interiorByBuilding) {
    describe(buildingId, () => {
      it('reaches a room on the top floor, entering at a known door', () => {
        const room = topRoom(int)
        const r = findIndoorRoute(int, room.id)
        expect(r, room.id).not.toBeNull()
        expect(int.entrances.map((e) => e.entranceId)).toContain(r!.entranceId)
        expect(r!.steps[0].text).toMatch(/^Enter through/)
        expect(r!.legs.at(-1)!.floorId).toBe(int.floors.find((f) => f.rooms.includes(room))!.id)
      })

      it('uses no stairs when step-free', () => {
        const r = findIndoorRoute(int, topRoom(int).id, { stepFree: true })
        if (r) expect(r.transfers.every((t) => t.core.type !== 'stairs')).toBe(true)
      })

      it('starts at the requested entrance', () => {
        const room = topRoom(int)
        for (const e of int.entrances) {
          const r = findIndoorRoute(int, room.id, { fromEntranceId: e.entranceId })
          if (r) expect(r.entranceId).toBe(e.entranceId)
        }
      })

      it('returns null for an unknown room', () => {
        expect(findIndoorRoute(int, 'no-such-room')).toBeNull()
      })
    })
  }
})
