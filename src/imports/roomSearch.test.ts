import { describe, expect, it } from 'vitest'
import buildingsData from './buildings.json'
import type { Building } from './types'
import { likelyFloor, parseRoomQuery, roomLabel } from './roomSearch'

describe('parseRoomQuery', () => {
  it('accepts spaced, joined, dashed and lowercase forms', () => {
    for (const q of ['MH 602', 'mh602', 'MH-602', ' mh - 602 ']) {
      expect(parseRoomQuery(q)).toEqual({ buildingId: 'bldg-mh', buildingCode: 'MH', roomNumber: '602', roomId: null })
    }
  })

  it('keeps letter suffixes on the room number', () => {
    expect(parseRoomQuery('CS-110A')).toMatchObject({ buildingId: 'bldg-cs', buildingCode: 'CS', roomNumber: '110A' })
    expect(parseRoomQuery('ec 127b')).toMatchObject({ buildingId: 'bldg-ec', roomNumber: '127B', roomId: 'ec-127b' })
  })

  it('finds the floor-plan room by normalizing both sides', () => {
    expect(parseRoomQuery('cs 110')).toMatchObject({ buildingId: 'bldg-cs', roomNumber: '110', roomId: 'cs-110' })
    expect(parseRoomQuery('cs 101')).toMatchObject({ buildingId: 'bldg-cs', roomNumber: '101', roomId: 'cs-101' })
    expect(parseRoomQuery('CS101')?.roomId).toBe('cs-101')
    expect(parseRoomQuery('h-305')?.roomId).toBe('h-305')
    expect(parseRoomQuery('CS 110')?.roomId).toBe('cs-110')
    expect(parseRoomQuery('EC 063')?.roomId).toBe('ec-63')
  })

  it('leaves roomId null when the floor plan has no such room', () => {
    expect(parseRoomQuery('cs 999')).toEqual({ buildingId: 'bldg-cs', buildingCode: 'CS', roomNumber: '999', roomId: null })
    expect(parseRoomQuery('CS-110A')?.roomId).toBeNull()
  })

  it('leaves roomId null when the building has no floor plan', () => {
    expect(parseRoomQuery('MH 602')?.roomId).toBeNull()
  })

  it('rejects unknown codes and text that is not CODE NUMBER', () => {
    expect(parseRoomQuery('ZZ 101')).toBeNull()
    expect(parseRoomQuery('McCarthy')).toBeNull()
    expect(parseRoomQuery('602')).toBeNull()
    expect(parseRoomQuery('')).toBeNull()
  })

  it('ignores parking codes, even when passed parking places', () => {
    expect(parseRoomQuery('SCPS 101')).toBeNull()
    expect(parseRoomQuery('NPS 2')).toBeNull()
    expect(parseRoomQuery('SCPS 101', buildingsData as Building[])).toBeNull()
  })
})

describe('roomLabel / likelyFloor', () => {
  it('shows the floor-plan number when found, else CODE NUMBER', () => {
    expect(roomLabel(parseRoomQuery('cs101')!)).toBe('CS-101')
    expect(roomLabel(parseRoomQuery('mh-602')!)).toBe('MH 602')
  })

  it('reads the floor from the first digit', () => {
    expect(likelyFloor('602')).toBe('floor 6')
    expect(likelyFloor('110A')).toBe('floor 1')
    expect(likelyFloor('063')).toBe('the basement')
    expect(likelyFloor('9')).toBeNull()
  })

  it('labels round-trip through parseRoomQuery', () => {
    for (const q of ['CS 101', 'MH 602', 'EC-127B']) {
      const r = parseRoomQuery(q)!
      expect(parseRoomQuery(roomLabel(r))).toEqual(r)
    }
  })
})
