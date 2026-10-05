import { useEffect, useMemo, useState } from 'react'
import BuildingPicker from './BuildingPicker'
import { fmtDistance, fmtTotal } from './RouteSteps'
import { CAMPUS_CENTER } from './geo'
import { findAreaRoute, nearbyPlaces, region, straightLine, type AreaOutcome, type AreaTrip } from './areaRouting'
import type { Building, LatLng, PoiType, TravelMode } from './types'

// Off-campus places within two miles, with walking or driving directions from a campus building.

const CATEGORIES: { label: string; types: PoiType[] }[] = [
  { label: 'Food', types: ['dining'] },
  { label: 'Groceries', types: ['grocery'] },
  { label: 'Health', types: ['pharmacy', 'health'] },
  { label: 'Banks', types: ['bank', 'atm'] },
  { label: 'Gas & EV', types: ['fuel', 'ev'] },
  { label: 'Shopping', types: ['shopping'] },
  { label: 'Parks & gyms', types: ['park', 'fitness'] },
  { label: 'Transit', types: ['transit', 'bike'] },
  { label: 'Library & mail', types: ['library', 'post'] },
]
const TYPE_LABEL: Partial<Record<PoiType, string>> = {
  dining: 'Food',
  grocery: 'Groceries',
  pharmacy: 'Pharmacy',
  health: 'Health care',
  bank: 'Bank',
  atm: 'ATM',
  fuel: 'Gas station',
  ev: 'EV charging',
  shopping: 'Shopping',
  park: 'Park',
  fitness: 'Gym',
  transit: 'Transit',
  bike: 'Bike rental',
  library: 'Library',
  post: 'Mail & shipping',
}

const fetched = new Date(region.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

interface NearbyPanelProps {
  campusPlaces: Building[]
  routableIds: ReadonlySet<string>
  fromId: string | null
  onFromChange: (id: string | null) => void
  origin: { name: string; geo: LatLng } | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  mode: TravelMode
  onModeChange: (mode: TravelMode) => void
  stepFree: boolean
  onStepFreeChange: (next: boolean) => void
  onTrip: (trip: AreaTrip | null) => void
}

export default function NearbyPanel({
  campusPlaces,
  routableIds,
  fromId,
  onFromChange,
  origin,
  selectedId,
  onSelect,
  mode,
  onModeChange,
  stepFree,
  onStepFreeChange,
  onTrip,
}: NearbyPanelProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const anchor = origin?.geo ?? CAMPUS_CENTER
  const list = useMemo(() => {
    const types = CATEGORIES.find((c) => c.label === category)?.types
    const q = query.trim().toLowerCase()
    return nearbyPlaces
      .filter((p) => p.position.geo && (!types || types.includes(p.poiType!)) && (!q || p.name.toLowerCase().includes(q)))
      .map((p) => ({ place: p, ...straightLine(anchor, p.position.geo!) }))
      .sort((a, b) => a.meters - b.meters)
  }, [anchor, category, query])

  const selected = nearbyPlaces.find((p) => p.id === selectedId) ?? null

  const outcome: AreaOutcome | null = useMemo(
    () =>
      origin && selected?.position.geo
        ? findAreaRoute(origin.geo, selected.position.geo, selected.name, mode, stepFree)
        : null,
    [origin, selected, mode, stepFree],
  )
  const trip = outcome?.ok ? outcome.trip : null

  useEffect(() => {
    onTrip(trip)
  }, [trip, onTrip])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
        <BuildingPicker label="From" placeholder="Where on campus are you?" options={campusPlaces} value={fromId} onChange={onFromChange} accent="start" routableIds={routableIds} />

        <div role="radiogroup" aria-label="Travel mode" className="flex rounded-xl bg-ground p-1">
          {(
            [
              ['walk', 'Walk'],
              ['drive', 'Drive'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => onModeChange(key)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                mode === key ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'walk' && (
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-ink">Step-free route</span>
              <span className="block text-xs text-ink-soft">Avoid stairs mapped on OpenStreetMap</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={stepFree}
              onClick={() => onStepFreeChange(!stepFree)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${stepFree ? 'bg-navy' : 'bg-line'}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  stepFree ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        )}
      </div>

      {selected && <TripCard place={selected} outcome={outcome} hasOrigin={!!origin} mode={mode} stepFree={stepFree} onClear={() => onSelect(null)} />}

      <div className="rounded-2xl border border-line bg-white p-4">
        <label className="block">
          <span className="sr-only">Search nearby places</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search places within 2 miles"
            className="w-full rounded-lg border border-line bg-ground px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-navy/30"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={category === c.label}
              onClick={() => setCategory((v) => (v === c.label ? null : c.label))}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                category === c.label ? 'border-navy bg-navy text-white' : 'border-line text-ink hover:border-navy/40'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-ink-soft" aria-live="polite">
          {list.length} {list.length === 1 ? 'place' : 'places'} · distance in a straight line from {origin?.name ?? 'the campus center'}
        </p>
        <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto">
          {list.map(({ place, meters, direction }) => (
            <li key={place.id}>
              <button
                type="button"
                aria-pressed={place.id === selectedId}
                onClick={() => onSelect(place.id)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-left transition ${
                  place.id === selectedId ? 'bg-titan/10' : 'hover:bg-ground'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{place.name}</span>
                  <span className="block text-xs text-ink-soft">{TYPE_LABEL[place.poiType!] ?? 'Place'}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-soft">
                  {fmtTotal(meters)} {direction}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-ink-soft">
          Places and streets from OpenStreetMap (imported {fetched}). Hours and details aren't included and nothing here has been checked in person.
        </p>
      </div>
    </div>
  )
}

function TripCard({
  place,
  outcome,
  hasOrigin,
  mode,
  stepFree,
  onClear,
}: {
  place: Building
  outcome: AreaOutcome | null
  hasOrigin: boolean
  mode: TravelMode
  stepFree: boolean
  onClear: () => void
}) {
  const clear = (
    <button
      type="button"
      onClick={onClear}
      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:border-navy/40 hover:bg-ground"
    >
      Clear
    </button>
  )

  if (!hasOrigin)
    return (
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-ink">{place.name}</p>
          {clear}
        </div>
        <p className="mt-1 text-sm text-ink-soft">Choose where you're starting on campus to get directions.</p>
      </div>
    )

  if (!outcome?.ok)
    return (
      <div role="alert" className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-ink">We couldn't find a {mode === 'walk' ? 'walking' : 'driving'} route</p>
          {clear}
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {outcome?.reason === 'off-map'
            ? `${outcome.place === 'start' ? 'Your start' : place.name} is too far from any street on the area map.`
            : mode === 'walk' && stepFree
              ? 'There’s no step-free path on the current map. Try turning off step-free.'
              : 'The streets on the current map don’t connect these places.'}
        </p>
      </div>
    )

  const trip = outcome.trip
  const minutes = Math.max(1, Math.round(trip.seconds / 60))
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex flex-wrap items-center gap-2 font-display text-base font-bold text-ink">
          {trip.mode === 'walk' ? 'Walking route' : 'Driving route'}
          {trip.stepFree && (
            <span className="rounded-full bg-navy px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-white">Step-free</span>
          )}
        </h2>
        {clear}
      </div>
      <p className="mt-0.5 font-mono text-xs text-ink-soft">
        {fmtTotal(trip.meters)} · ~{minutes} min to {place.name}
      </p>

      <ol className="mt-3 space-y-2">
        {trip.steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ground font-mono text-[10px] font-semibold text-ink-soft">
              {i + 1}
            </span>
            <span>
              <span className="text-ink">{s.instruction}</span>
              {s.distanceM > 0 && <span className="ml-1.5 font-mono text-xs text-ink-soft">{fmtDistance(s.distanceM)}</span>}
            </span>
          </li>
        ))}
      </ol>

      <ul className="mt-3 space-y-1.5 rounded-lg bg-ground px-3 py-2 text-xs text-ink-soft">
        {trip.mode === 'drive' ? (
          <li>Time assumes no traffic. Turn restrictions aren't mapped, so follow posted signs. Parking isn't included.</li>
        ) : (
          trip.stepFree && <li>Avoids stairs mapped on OpenStreetMap; curb ramps and sidewalk conditions aren't checked.</li>
        )}
        <li>Street data comes from OpenStreetMap and hasn't been verified in person.</li>
      </ul>
    </div>
  )
}
