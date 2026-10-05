import { useState } from 'react'
import type { Building, Day, ScheduleItem } from './types'

interface SchedulePanelProps {
  term: string
  note: string // where the schedule came from, e.g. "Sample schedule."
  items: ScheduleItem[]
  places: Building[] // routable, non-parking places a class can be assigned to
  onChange: (item: ScheduleItem) => void
  onRoute: (buildingId: string) => void
}

const DAY_ORDER: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const fmtTime = (t: string | null) => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const sortKey = (i: ScheduleItem) =>
  `${Math.min(...i.days.map((d) => DAY_ORDER.indexOf(d)), 9)}-${i.startTime ?? '99:99'}`

// Rows that aren't confirmed or have no building stay visible and flagged; a location is never guessed.
export default function SchedulePanel({ term, note, items, places, onChange, onRoute }: SchedulePanelProps) {
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const sorted = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  const toReview = items.filter((i) => !i.confirmed).length
  const placeById = new Map(places.map((p) => [p.id, p]))

  const setEdit = (id: string, on: boolean) =>
    setEditing((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const confirm = (item: ScheduleItem) => {
    const chosen = drafts[item.id] ?? item.buildingId ?? ''
    const place = placeById.get(chosen)
    onChange({ ...item, buildingId: place?.id ?? null, buildingCode: place ? place.code : null, confirmed: true })
    setEdit(item.id, false)
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink">My classes</h2>
        <span className="font-mono text-xs text-ink-soft">{term}</span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        {note}{' '}
        {toReview > 0 ? `${toReview} ${toReview === 1 ? 'class needs' : 'classes need'} a location check.` : 'All classes reviewed.'}
      </p>

      <ul className="mt-3 space-y-2">
        {sorted.map((item) => {
          const isEditing = !item.confirmed || editing.has(item.id)
          const place = item.buildingId ? placeById.get(item.buildingId) : undefined
          const time = item.startTime && `${fmtTime(item.startTime)}–${fmtTime(item.endTime)}`
          const selectId = `sched-${item.id}-place`
          return (
            <li
              key={item.id}
              className={`rounded-xl border px-3 py-2.5 ${isEditing ? 'border-titan/50 bg-titan/5' : 'border-line'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {item.courseLabel} <span className="font-normal text-ink-soft">· {item.component}</span>
                </p>
                <span className="shrink-0 font-mono text-[11px] text-ink-soft">
                  {item.days.join('/')} {time}
                </span>
              </div>
              <p className="text-xs text-ink-soft">{item.courseTitle}</p>
              <p className="mt-1 font-mono text-[11px] text-ink-soft">{item.locationRaw}</p>

              {isEditing ? (
                <div className="mt-2">
                  <p className="text-xs font-medium text-titan">
                    {item.confirmed
                      ? 'Edit the location for this class.'
                      : !item.locationRaw
                        ? 'Needs review — the file had no location for this class.'
                        : place
                          ? `Check the building — we matched “${item.locationRaw}” to ${place.name}.`
                          : `Needs review — we couldn't match “${item.locationRaw}” to a campus building.`}
                  </p>
                  <label htmlFor={selectId} className="mt-2 block text-xs text-ink-soft">
                    Building
                  </label>
                  <select
                    id={selectId}
                    value={drafts[item.id] ?? item.buildingId ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/30"
                  >
                    <option value="">No campus location (online / TBA)</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.code ? ` (${p.code})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirm(item)}
                      className="rounded-md bg-navy px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-navy/90"
                    >
                      Confirm
                    </button>
                    {item.confirmed && (
                      <button
                        type="button"
                        onClick={() => {
                          setDrafts(({ [item.id]: _, ...rest }) => rest)
                          setEdit(item.id, false)
                        }}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-ground"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {place ? (
                    <button
                      type="button"
                      onClick={() => onRoute(place.id)}
                      className="rounded-md bg-navy px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-navy/90"
                    >
                      Route to {place.code ?? place.name}
                    </button>
                  ) : (
                    <span className="rounded-full bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      {item.buildingId ? 'Building not on the route map yet' : 'No campus building'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEdit(item.id, true)}
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-ground"
                  >
                    Edit location
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
