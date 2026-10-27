import { useState, type FormEvent } from 'react'
import { hasInterior } from './interiorRouting'
import { likelyFloor, parseRoomQuery, roomLabel, type RoomQuery } from './roomSearch'

interface RoomNumberSearchProps {
  room: RoomQuery | null // the room being routed to, if any
  placeName: string | null // name of the room's building
  onFind: (room: RoomQuery) => void
  onContinue: () => void // open the floor plan at this room
}

// Typing a room ("MH 602") routes to its building, then offers the indoor route to the room.
export default function RoomNumberSearch({ room, placeName, onFind, onContinue }: RoomNumberSearchProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    const found = parseRoomQuery(text)
    if (!found) {
      setError(`We don't know a building for “${text.trim()}”. Try a code and number, like MH 602.`)
      return
    }
    setError(null)
    onFind(found)
  }

  const label = room && roomLabel(room)
  const floor = room && likelyFloor(room.roomNumber)

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit}>
        <label htmlFor="room-search" className="mb-1.5 block font-display text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Room number
        </label>
        <div className="flex gap-2">
          <input
            id="room-search"
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            placeholder="e.g. MH 602"
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? 'room-search-error' : undefined}
            className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-ink-soft/70 focus-visible:ring-2 focus-visible:ring-navy/40"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-semibold text-ink transition enabled:hover:bg-ground disabled:opacity-40"
          >
            Find
          </button>
        </div>
      </form>

      {error && (
        <p id="room-search-error" role="alert" className="rounded-lg bg-titan/10 px-3 py-2 text-sm font-medium text-titan">
          {error}
        </p>
      )}

      {room && !error &&
        (room.roomId ? (
          <button
            type="button"
            onClick={onContinue}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-left text-sm transition hover:border-navy/40"
          >
            <span>
              <span className="font-semibold text-ink">Continue to room {label}</span>
              <span className="block text-xs text-ink-soft">Indoor directions in {placeName}</span>
            </span>
            <span className="text-ink-soft">→</span>
          </button>
        ) : (
          <p role="status" className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-soft">
            {hasInterior(room.buildingId)
              ? `Room ${label} wasn't found in the ${placeName} floor plan. We'll get you to the building.`
              : `Floor plan for ${placeName} isn't available yet${floor ? ` — room ${room.roomNumber} is likely on ${floor}` : ''}.`}
          </p>
        ))}
    </div>
  )
}
