import { useEffect, useMemo, useState } from 'react'
import buildingsData from './imports/buildings.json'
import type { Building } from './imports/types'
import AppIcon from './imports/AppIcon'
import BuildingPicker from './imports/BuildingPicker'
import CampusMap, { type BuildingKind, type MapHighlight, type MapMarker } from './imports/CampusMap'
import RouteSteps from './imports/RouteSteps'
import { findRoute, routableBuildingIds, type RouteOutcome } from './imports/routing'

const HELPER_DISABLED = 'Choose a start and destination'

export default function App() {
  // Buildings and landmarks only — parking areas are never selectable.
  const selectable = useMemo(
    () => (buildingsData as Building[]).filter((b) => b.kind !== 'parking'),
    [],
  )

  // Every building with a placed position, colored by category on the map.
  const markers: MapMarker[] = useMemo(
    () =>
      (buildingsData as Building[])
        .filter((b) => b.position.pixel)
        .map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code ?? null,
          kind: b.kind as BuildingKind,
          x: b.position.pixel!.x,
          y: b.position.pixel!.y,
        })),
    [],
  )

  const [startId, setStartId] = useState<string | null>(null)
  const [destId, setDestId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<RouteOutcome | null>(null)
  const [showCategories, setShowCategories] = useState(false)

  const start = selectable.find((b) => b.id === startId) ?? null
  const dest = selectable.find((b) => b.id === destId) ?? null

  const sameBuilding = Boolean(startId && destId && startId === destId)
  const canGetRoute = Boolean(startId && destId && !sameBuilding)

  // Clear any shown route when the selection changes.
  useEffect(() => {
    setOutcome(null)
  }, [startId, destId])

  const route = outcome?.ok ? outcome.route : undefined

  const highlights: MapHighlight[] = useMemo(() => {
    const list: MapHighlight[] = []
    const px = start?.position.pixel
    if (start && px)
      list.push({ id: `start-${start.id}`, name: start.name, code: start.code, role: 'start', x: px.x, y: px.y })
    const dpx = dest?.position.pixel
    if (dest && dpx && dest.id !== start?.id)
      list.push({ id: `dest-${dest.id}`, name: dest.name, code: dest.code, role: 'destination', x: dpx.x, y: dpx.y })
    return list
  }, [start, dest])

  // Clicking a building on the map fills the next relevant field: start first,
  // then destination; once both are set a new click starts a fresh selection.
  const handleMapSelect = (id: string) => {
    if (!selectable.some((b) => b.id === id)) return // parking etc. isn't routable
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
    setOutcome(findRoute(startId, destId))
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
          <CampusMap highlights={highlights} route={route?.points} markers={markers} showCategories={showCategories} onSelectBuilding={handleMapSelect} />
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
            <RouteSteps route={route} startName={start.name} destName={dest.name} />
          )}

          {outcome && !outcome.ok && (
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-ink">We couldn't find a walking route</p>
              <p className="mt-1 text-sm text-ink-soft">
                {outcome.reason === 'no-node'
                  ? 'One of these places isn’t on the walking network yet — the routable map currently covers central campus only.'
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
