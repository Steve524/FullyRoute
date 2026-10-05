import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import buildingsData from './imports/buildings.json'
import type { Building, TravelMode } from './imports/types'
import AppIcon from './imports/AppIcon'
import BuildingPicker from './imports/BuildingPicker'
import CampusMap, { type BuildingKind, type MapDoor, type MapHighlight, type MapMarker } from './imports/CampusMap'
import RouteSteps from './imports/RouteSteps'
import InteriorMap from './imports/InteriorMap'
import MyClasses from './imports/MyClasses'
import { interiorByBuilding } from './imports/interiorRouting'
import entrancesData from './imports/entrances.json'
import { findRoute, placeDoors, placePin, routableBuildingIds, type RouteOutcome } from './imports/routing'
import { readShareState, shareHref } from './imports/share'
import { pixelToGeo } from './imports/geo'
import type { AreaTrip } from './imports/areaRouting'

// The area map and its street data load only when first opened.
const AreaMap = lazy(() => import('./imports/AreaMap'))
const NearbyPanel = lazy(() => import('./imports/NearbyPanel'))

type Tab = 'route' | 'classes' | 'nearby'

const HELPER_DISABLED = 'Choose a start and destination'

export default function App() {
  // Every building, parking lot and landmark can be a route endpoint.
  const selectable = useMemo(() => buildingsData as Building[], [])

  // Every building with a placed position, colored by category on the map.
  const markers: MapMarker[] = useMemo(
    () =>
      (buildingsData as Building[]).flatMap((b) => {
        const pin = placePin(b.id)
        if (!pin) return []
        return [{ id: b.id, name: b.name, code: b.code ?? null, kind: b.kind as BuildingKind, x: pin.x, y: pin.y }]
      }),
    [],
  )

  // A shared link restores its start, destination and step-free setting, and shows the route.
  const [shared] = useState(() => readShareState(window.location.search, routableBuildingIds))
  const [startId, setStartId] = useState<string | null>(shared.from)
  const [destId, setDestId] = useState<string | null>(shared.to)
  const [outcome, setOutcome] = useState<RouteOutcome | null>(() =>
    shared.from && shared.to && shared.from !== shared.to ? findRoute(shared.from, shared.to, shared.accessible) : null,
  )
  const [showCategories, setShowCategories] = useState(false)
  const [stepFree, setStepFree] = useState(shared.accessible)
  const [interiorFor, setInteriorFor] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('route')
  const [mapView, setMapView] = useState<'campus' | 'area'>('campus')
  const [nearbyId, setNearbyId] = useState<string | null>(null)
  const [travelMode, setTravelMode] = useState<TravelMode>('walk')
  const [areaTrip, setAreaTrip] = useState<AreaTrip | null>(null)

  // Keep the address bar in sync so it can be shared or bookmarked at any point.
  useEffect(() => {
    const next = shareHref(window.location.href, { from: startId, to: destId, accessible: stepFree })
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [startId, destId, stepFree])

  const classPlaces = useMemo(
    () =>
      selectable
        .filter((b) => b.kind !== 'parking' && routableBuildingIds.has(b.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [selectable],
  )

  const start = selectable.find((b) => b.id === startId) ?? null
  const dest = selectable.find((b) => b.id === destId) ?? null

  // Off-campus trips leave from the start place's pin.
  const origin = useMemo(() => {
    const px = start ? placePin(start.id) : undefined
    return start && px ? { name: start.name, geo: pixelToGeo(px) } : null
  }, [start])

  // The Nearby tab brings up the area map; leaving it goes back to campus.
  const chooseTab = (key: Tab) => {
    setTab(key)
    if (key === 'nearby') setMapView('area')
    else if (tab === 'nearby') setMapView('campus')
  }
  const selectNearby = (id: string | null) => {
    setNearbyId(id)
    if (id) {
      setTab('nearby')
      setMapView('area')
    }
  }

  const sameBuilding = Boolean(startId && destId && startId === destId)
  const canGetRoute = Boolean(startId && destId && !sameBuilding)

  // Changing either end clears the shown route.
  const pickStart = (id: string | null) => {
    setStartId(id)
    setOutcome(null)
  }
  const pickDest = (id: string | null) => {
    setDestId(id)
    setOutcome(null)
  }
  const reset = () => {
    pickStart(null)
    pickDest(null)
  }

  // Swapping keeps a shown route by routing the reverse trip.
  const swap = () => {
    setStartId(destId)
    setDestId(startId)
    setOutcome(outcome && startId && destId ? findRoute(destId, startId, stepFree) : null)
  }

  const changeStepFree = (next: boolean) => {
    setStepFree(next)
    if (outcome && startId && destId && !sameBuilding) setOutcome(findRoute(startId, destId, next))
  }

  // From the class list: make the class the destination and route there if a start is set.
  const routeToClass = (buildingId: string) => {
    setTab('route')
    setDestId(buildingId)
    setOutcome(startId && startId !== buildingId ? findRoute(startId, buildingId, stepFree) : null)
  }

  const route = outcome?.ok ? outcome.route : undefined

  // Every entrance on campus; picked places' doors and the pair in use stand out.
  const doors: MapDoor[] = useMemo(() => {
    const same = (a: { x: number; y: number }, b?: { x: number; y: number }) =>
      !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1
    // POIs inside a building share its doors — only draw them once, unless picked.
    return selectable.flatMap((b) =>
      (b.hostId && b.id !== startId && b.id !== destId ? [] : placeDoors(b.id))
        .filter((d) => d.label) // bare pins aren't doors
        .map((d, i) => {
          const picked = b.id === startId || b.id === destId
          const state: MapDoor['state'] =
            b.id === startId && same(d.point, route?.startDoorPoint)
              ? 'start'
              : b.id === destId && same(d.point, route?.endDoorPoint)
                ? 'end'
                : picked
                  ? 'candidate'
                  : 'idle'
          return { key: `${b.id}-${i}`, placeId: b.id, x: d.point.x, y: d.point.y, label: `${b.name} · ${d.label!.replace(/\s*\(approximate\)/i, '')}`, state }
        }),
    )
  }, [selectable, startId, destId, route])

  const highlights: MapHighlight[] = useMemo(() => {
    const list: MapHighlight[] = []
    const px = start ? placePin(start.id) : undefined
    if (start && px)
      list.push({ id: `start-${start.id}`, name: start.name, code: start.code, role: 'start', x: px.x, y: px.y })
    const dpx = dest ? placePin(dest.id) : undefined
    if (dest && dpx && dest.id !== start?.id) {
      // A POI and its host share a pin — stack the labels instead of overlapping.
      const shared = px && Math.hypot(px.x - dpx.x, px.y - dpx.y) < 60
      list.push({ id: `dest-${dest.id}`, name: dest.name, code: dest.code, role: 'destination', x: dpx.x, y: dpx.y, stack: shared ? 1 : 0 })
    }
    return list
  }, [start, dest])

  // Clicking a building on the map fills the next relevant field: start first,
  // then destination; once both are set a new click starts a fresh selection.
  const handleMapSelect = (id: string) => {
    if (!routableBuildingIds.has(id)) return // not reachable from any walkway
    if (!startId) {
      pickStart(id)
    } else if (id === startId) {
      // already the start — leave it
    } else if (!destId) {
      pickDest(id)
    } else {
      pickStart(id)
      pickDest(null)
    }
  }

  const handleGetRoute = () => {
    if (!startId || !destId || sameBuilding) return
    setOutcome(findRoute(startId, destId, stepFree))
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6">
      <header className="mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <AppIcon className="h-12 w-12 shrink-0 rounded-[26%] shadow-sm" />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-titan">FullyRoute</p>
            <h1 className="mt-0.5 font-display text-2xl font-bold text-ink sm:text-3xl">Find your way across campus and beyond</h1>
          </div>
        </div>
        <p className="mt-2 text-sm text-ink-soft">Pick a start and destination to map your walk between buildings.</p>
      </header>

      <main className="grid flex-1 gap-4 lg:grid-cols-[1fr_380px]">
        <section className="relative order-2 min-h-[52vh] min-w-0 lg:order-1 lg:min-h-0">
          {mapView === 'campus' ? (
            <CampusMap highlights={highlights} doors={doors} route={route?.points} markers={markers} showCategories={showCategories} onSelectBuilding={handleMapSelect} />
          ) : (
            <Suspense fallback={<MapLoading />}>
              <AreaMap selectedId={nearbyId} onSelect={selectNearby} origin={origin} trip={areaTrip} />
            </Suspense>
          )}
          <div role="group" aria-label="Map" className="absolute right-3 top-3 z-10 flex rounded-xl border border-line bg-white/95 p-1 shadow-sm backdrop-blur">
            {(
              [
                ['campus', 'Campus'],
                ['area', 'Area (2 mi)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={mapView === key}
                onClick={() => setMapView(key)}
                className={`rounded-lg px-3 py-1.5 font-display text-xs font-semibold transition ${
                  mapView === key ? 'bg-navy text-white' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <div role="tablist" aria-label="Sidebar" className="flex rounded-xl bg-white p-1 ring-1 ring-line">
            {(
              [
                ['route', 'Directions'],
                ['classes', 'My classes'],
                ['nearby', 'Nearby'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => chooseTab(key)}
                className={`flex-1 rounded-lg px-3 py-2 font-display text-sm font-semibold transition ${
                  tab === key ? 'bg-navy text-white' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'route' ? (
            <div role="tabpanel" id="panel-route" aria-labelledby="tab-route" className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
                <BuildingPicker label="Start" placeholder="Where are you now?" options={selectable} value={startId} onChange={pickStart} accent="start" routableIds={routableBuildingIds} />
                <div className="-my-2 flex justify-end">
                  <button
                    type="button"
                    onClick={swap}
                    disabled={!startId && !destId}
                    aria-label="Swap start and destination"
                    title="Swap start and destination"
                    className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-ink-soft transition enabled:hover:border-navy/40 enabled:hover:text-ink disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                      <path d="M5 2v11M2 10l3 3 3-3M11 14V3M8 6l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                <BuildingPicker label="Destination" placeholder="Where are you going?" options={selectable} value={destId} onChange={pickDest} accent="destination" routableIds={routableBuildingIds} />

                {sameBuilding && (
                  <p className="rounded-lg bg-titan/10 px-3 py-2 text-sm font-medium text-titan">
                    Start and destination can't be the same building.
                  </p>
                )}

                <div className="pt-1">
                  <button
                    type="button"
                    disabled={!canGetRoute}
                    onClick={handleGetRoute}
                    title={canGetRoute ? undefined : HELPER_DISABLED}
                    className="w-full rounded-xl bg-navy px-4 py-3.5 font-display text-sm font-semibold text-white transition enabled:hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Get route
                  </button>
                  {!canGetRoute && !sameBuilding && (
                    <p className="mt-2 text-center text-xs text-ink-soft">{HELPER_DISABLED}</p>
                  )}
                </div>

                <label className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span>
                    <span className="block text-sm font-medium text-ink">Step-free route</span>
                    <span className="block text-xs text-ink-soft">Avoid stairs and doors marked inaccessible</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={stepFree}
                    onClick={() => changeStepFree(!stepFree)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      stepFree ? 'bg-navy' : 'bg-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        stepFree ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </label>

                <label className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-sm font-medium text-ink">Color-code buildings</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showCategories}
                    onClick={() => setShowCategories((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      showCategories ? 'bg-titan' : 'bg-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        showCategories ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </label>
              </div>

              {/* Route result */}
              {route && start && dest && (
                <RouteSteps
                  route={route}
                  startName={start.name}
                  destName={dest.name}
                  shareUrl={shareHref(window.location.href, { from: startId, to: destId, accessible: stepFree })}
                  onOpenInterior={interiorByBuilding.has(dest.id) ? () => setInteriorFor(dest.id) : undefined}
                />
              )}

              {!route &&
                [start, dest].map(
                  (b) =>
                    b &&
                    interiorByBuilding.has(b.id) && (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setInteriorFor(b.id)}
                        className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 text-left text-sm transition hover:border-navy/40"
                      >
                        <span>
                          <span className="font-semibold text-ink">Find a room in {interiorByBuilding.get(b.id)!.code}</span>
                          <span className="block text-xs text-ink-soft">Floor plans for {b.name}</span>
                        </span>
                        <span className="text-ink-soft">→</span>
                      </button>
                    ),
                )}

              {outcome && !outcome.ok && (
                <div role="alert" className="rounded-2xl border border-line bg-white p-4">
                  <p className="text-sm font-semibold text-ink">We couldn't find a walking route</p>
                  <p className="mt-1 text-sm text-ink-soft">{failureMessage(outcome, start, dest, stepFree)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stepFree && (
                      <button
                        type="button"
                        onClick={() => changeStepFree(false)}
                        className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy/90"
                      >
                        Try without step-free
                      </button>
                    )}
                    {outcome.reason !== 'no-path' && (
                      <button
                        type="button"
                        onClick={() => (outcome.place === 'start' ? pickStart(null) : pickDest(null))}
                        className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:bg-ground"
                      >
                        Choose a different {outcome.place === 'start' ? 'start' : 'destination'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:bg-ground"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'classes' ? (
            <div role="tabpanel" id="panel-classes" aria-labelledby="tab-classes">
              <MyClasses places={classPlaces} onRoute={routeToClass} />
            </div>
          ) : (
            <div role="tabpanel" id="panel-nearby" aria-labelledby="tab-nearby">
              <Suspense fallback={<p className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-soft">Loading nearby places…</p>}>
                <NearbyPanel
                  campusPlaces={selectable}
                  routableIds={routableBuildingIds}
                  fromId={startId}
                  onFromChange={pickStart}
                  origin={origin}
                  selectedId={nearbyId}
                  onSelect={selectNearby}
                  mode={travelMode}
                  onModeChange={setTravelMode}
                  stepFree={stepFree}
                  onStepFreeChange={changeStepFree}
                  onTrip={setAreaTrip}
                />
              </Suspense>
            </div>
          )}

          {interiorFor && interiorByBuilding.has(interiorFor) && (
            <InteriorMap
              interior={interiorByBuilding.get(interiorFor)!}
              arrivalEntranceId={arrivalEntranceId(interiorFor, route?.endDoorPoint)}
              stepFree={stepFree}
              onClose={() => setInteriorFor(null)}
            />
          )}
        </section>
      </main>
    </div>
  )
}

function MapLoading() {
  return (
    <div className="grid h-full w-full place-items-center rounded-2xl border border-line bg-[#ece8df] text-sm text-ink-soft">
      Loading area map…
    </div>
  )
}

function failureMessage(
  outcome: Extract<RouteOutcome, { ok: false }>,
  start: Building | null,
  dest: Building | null,
  stepFree: boolean,
): string {
  if (outcome.reason === 'no-path')
    return stepFree
      ? 'There’s no step-free path between these two places on the current map.'
      : 'There’s no connected path between these two places on the current map. Try a nearby building instead.'
  const name = (outcome.place === 'start' ? start : dest)?.name ?? 'This place'
  return outcome.reason === 'no-node'
    ? `${name} isn’t on the walking network yet.`
    : `Every entrance on record for ${name} is marked not accessible.`
}

// The entrances.json door the outdoor route ends at, so the indoor route starts there.
function arrivalEntranceId(buildingId: string, pt: { x: number; y: number } | null | undefined) {
  if (!pt) return null
  let best: string | null = null
  let bestD = 40 * 40
  for (const e of entrancesData as { id: string; buildingId: string; position: { pixel?: { x: number; y: number } } }[]) {
    const p = e.position.pixel
    if (e.buildingId !== buildingId || !p) continue
    const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2
    if (d < bestD) [best, bestD] = [e.id, d]
  }
  return best
}
