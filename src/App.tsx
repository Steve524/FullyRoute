import { useEffect, useMemo, useState } from 'react'
import buildingsData from './imports/buildings.json'
import type { Building } from './imports/types'
import AppIcon from './imports/AppIcon'
import BuildingPicker from './imports/BuildingPicker'
import CampusMap, { type BuildingKind, type MapDoor, type MapHighlight, type MapMarker } from './imports/CampusMap'
import RouteSteps from './imports/RouteSteps'
import InteriorMap from './imports/InteriorMap'
import { interiorByBuilding } from './imports/interiorRouting'
import entrancesData from './imports/entrances.json'
import { findRoute, placeDoors, placePin, routableBuildingIds, type RouteOutcome } from './imports/routing'

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

  const [startId, setStartId] = useState<string | null>(null)
  const [destId, setDestId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<RouteOutcome | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [stepFree, setStepFree] = useState(false)
  const [interiorFor, setInteriorFor] = useState<string | null>(null)

  const start = selectable.find((b) => b.id === startId) ?? null
  const dest = selectable.find((b) => b.id === destId) ?? null

  const sameBuilding = Boolean(startId && destId && startId === destId)
  const canGetRoute = Boolean(startId && destId && !sameBuilding)

  // Clear any shown route when the selection changes.
  useEffect(() => {
    setOutcome(null)
  }, [startId, destId])

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
      setStartId(id)
    } else if (id === startId) {
      // already the start — leave it
    } else if (!destId) {
      setDestId(id)
    } else {
      setStartId(id)
      setDestId(null)
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
        <section className="order-2 min-h-[52vh] lg:order-1 lg:min-h-0">
          <CampusMap highlights={highlights} doors={doors} route={route?.points} markers={markers} showCategories={showCategories} onSelectBuilding={handleMapSelect} />
        </section>

        <section className="order-1 flex flex-col gap-4 lg:order-2">
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
            <BuildingPicker label="Start" placeholder="Where are you now?" options={selectable} value={startId} onChange={setStartId} accent="start" routableIds={routableBuildingIds} />
            <BuildingPicker label="Destination" placeholder="Where are you going?" options={selectable} value={destId} onChange={setDestId} accent="destination" routableIds={routableBuildingIds} />

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
                onClick={() => {
                  const next = !stepFree
                  setStepFree(next)
                  // Re-route in place if a route is already showing.
                  if (outcome && startId && destId && !sameBuilding) setOutcome(findRoute(startId, destId, next))
                }}
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

          {interiorFor && interiorByBuilding.has(interiorFor) && (
            <InteriorMap
              interior={interiorByBuilding.get(interiorFor)!}
              arrivalEntranceId={arrivalEntranceId(interiorFor, route?.endDoorPoint)}
              stepFree={stepFree}
              onClose={() => setInteriorFor(null)}
            />
          )}

          {outcome && !outcome.ok && (
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-ink">We couldn't find a walking route</p>
              <p className="mt-1 text-sm text-ink-soft">
                {outcome.reason === 'no-node'
                  ? 'One of these places isn’t on the walking network yet.'
                  : outcome.reason === 'no-accessible-door'
                    ? 'Every entrance on record for one of these places is marked not accessible.'
                    : stepFree
                      ? 'There’s no step-free path between these two places on the current map. Try turning off Step-free route.'
                      : 'There’s no connected path between these two places in the current map.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setStartId(null)
                  setDestId(null)
                }}
                className="mt-3 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:bg-ground"
              >
                Reset
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
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
