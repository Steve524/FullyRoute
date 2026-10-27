import buildingsData from './buildings.json'
import { findRoom, interiorByBuilding } from './interiorRouting'
import type { Building } from './types'

// "CODE NUMBER" room text, shared by the room search box, shared links and schedule import.

export interface RoomQuery {
  buildingId: string
  buildingCode: string
  roomNumber: string // as typed, uppercased: "602", "110A"
  roomId: string | null // the floor-plan room, when the building has one and it lists this room
}

const ROOM_RE = /^([A-Za-z]{1,5})[\s-]*(\d{1,4}[A-Za-z]{0,2})$/

// Parking lots share codes ("E1") and are never destinations.
const searchable = (buildingsData as Building[]).filter((b) => b.kind !== 'parking')

/** "MH 602", "mh602", "CS-110A" → { code: "MH", roomNumber: "602" }; null when the text isn't CODE NUMBER. */
export function splitRoomCode(text: string): { code: string; roomNumber: string } | null {
  const m = ROOM_RE.exec(text.trim())
  return m ? { code: m[1].toUpperCase(), roomNumber: m[2].toUpperCase() } : null
}

/** The one place with this code, or null when none or several share it. */
export function placeByCode(code: string, places: Building[]): Building | null {
  const hits = places.filter((p) => p.code?.toUpperCase() === code.toUpperCase())
  return hits.length === 1 ? hits[0] : null
}

// "CS 110" and "cs-110" compare equal; so do "EC 063" and "EC-63".
const normRoom = (s: string) => s.replace(/[\s-]/g, '').toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1')

/** The floor-plan room id for "110" or "CS-110" in a building, or null. */
export function findRoomId(buildingId: string, code: string, roomNumber: string): string | null {
  const int = interiorByBuilding.get(buildingId)
  if (!int) return null
  const wanted = new Set([normRoom(roomNumber), normRoom(`${code}${roomNumber}`)])
  for (const f of int.floors) for (const r of f.rooms) if (wanted.has(normRoom(r.number))) return r.id
  return null
}

/** "MH 602" → its building and, if the floor plan lists it, the room; null for unknown codes or other text. */
export function parseRoomQuery(q: string, places: Building[] = searchable): RoomQuery | null {
  const split = splitRoomCode(q)
  const place = split && placeByCode(split.code, places.filter((p) => p.kind !== 'parking'))
  if (!split || !place) return null
  return { buildingId: place.id, buildingCode: split.code, roomNumber: split.roomNumber, roomId: findRoomId(place.id, split.code, split.roomNumber) }
}

/** How to show (and share) the room: the floor plan's number when known, else "MH 602". */
export function roomLabel(r: RoomQuery): string {
  const int = r.roomId ? interiorByBuilding.get(r.buildingId) : undefined
  return (int && r.roomId && findRoom(int, r.roomId)?.room.number) || `${r.buildingCode} ${r.roomNumber}`
}

/** CSUF room numbers start with the floor: "602" → "floor 6", "063" → "the basement"; null when too short to tell. */
export function likelyFloor(roomNumber: string): string | null {
  const digits = /^\d+/.exec(roomNumber)?.[0] ?? ''
  if (digits.length < 3) return null
  return digits[0] === '0' ? 'the basement' : `floor ${digits[0]}`
}
