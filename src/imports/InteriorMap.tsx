import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Interior, InteriorFloor, InteriorRoom, PlanPoint, RoomType } from './types'
import { findIndoorRoute, findRoom, type VerticalPreference } from './interiorRouting'
import { fmtDistance } from './RouteSteps'

// Source photos of the plans, bundled so "View original" works offline.
const photoUrls = import.meta.glob('./floorplans/*', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

const ROOM_FILL: Record<RoomType, string> = {
  room: '#ffffff',
  classroom: '#eef3ff',
  lab: '#e8f5ec',
  office: '#fdf5e4',
  restroom: '#ecefff',
  service: '#e9ece6',
  lobby: '#fff0e3',
  lounge: '#fbedf3',
}

const TYPE_LABEL: Record<RoomType, string> = {
  room: 'Room',
  classroom: 'Classroom',
  lab: 'Lab',
  office: 'Office',
  restroom: 'Restroom',
  service: 'Building services',
  lobby: 'Lobby',
  lounge: 'Lounge',
}

// Plan space is y-down meters; Leaflet's CRS.Simple is y-up.
const ll = (p: PlanPoint) => L.latLng(-p[1], p[0])

const centroid = (poly: PlanPoint[]): PlanPoint => [
  poly.reduce((s, p) => s + p[0], 0) / poly.length,
  poly.reduce((s, p) => s + p[1], 0) / poly.length,
]

const polyArea = (poly: PlanPoint[]) =>
  Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2

// Elevator-panel label: "L" for the lower floor, otherwise the level number.
const floorKey = (f: InteriorFloor) => (f.level === 0 ? 'L' : String(f.level))

interface InteriorMapProps {
  interior: Interior
  initialRoomId?: string | null
  arrivalEntranceId?: string | null // door the outdoor route arrives at, if known
  stepFree: boolean
  onClose: () => void
}

export default function InteriorMap({ interior, initialRoomId, arrivalEntranceId, stepFree, onClose }: InteriorMapProps) {
  const floorsDesc = useMemo(() => [...interior.floors].sort((a, b) => b.level - a.level), [interior])
  const entryFloorId = interior.entrances[0]?.floorId ?? floorsDesc[floorsDesc.length - 1].id

  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null)
  const [floorId, setFloorId] = useState<string>(
    () => (initialRoomId && findRoom(interior, initialRoomId)?.floor.id) || entryFloorId,
  )
  const [fromId, setFromId] = useState<string>(
    arrivalEntranceId && interior.entrances.some((e) => e.entranceId === arrivalEntranceId) ? arrivalEntranceId : 'nearest',
  )
  const [query, setQuery] = useState('')
  const [prefer, setPrefer] = useState<VerticalPreference>('elevator')
  const [photoOpen, setPhotoOpen] = useState(false)

  const selected = roomId ? findRoom(interior, roomId) : undefined
  const route = useMemo(
    () =>
      roomId
        ? findIndoorRoute(interior, roomId, { fromEntranceId: fromId === 'nearest' ? null : fromId, stepFree, prefer })
        : null,
    [interior, roomId, fromId, stepFree, prefer],
  )
  const routeFloors = new Set(route?.legs.map((l) => l.floorId))
  const floor = interior.floors.find((f) => f.id === floorId)!

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return floorsDesc.map((f) => ({
      floor: f,
      rooms: f.rooms
        .filter(
          (r) =>
            !q ||
            r.number.toLowerCase().includes(q) ||
            r.number.toLowerCase().replace(/^[a-z]+-/, '').startsWith(q) ||
            r.name.toLowerCase().includes(q) ||
            TYPE_LABEL[r.type].toLowerCase().includes(q),
        )
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    }))
  }, [floorsDesc, query])

  const pickRoom = (r: InteriorRoom, f: InteriorFloor) => {
    setRoomId(r.id)
    setFloorId(f.id)
  }

  // Esc backs out of the plan photo first, then closes the viewer. Tab stays inside the dialog.
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return trapTab(e, dialogRef.current)
      if (e.key !== 'Escape') return
      if (photoOpen) setPhotoOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, photoOpen])

  // Focus the room search on open and hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => opener?.focus()
  }, [])

  // --- Leaflet ---------------------------------------------------------------
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const map = L.map(el, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      minZoom: 1,
      maxZoom: 7,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    const pts = [...interior.outline.flat(), ...interior.floors.flatMap((f) => f.outline?.flat() ?? [])]
    map.fitBounds(L.latLngBounds(pts.map(ll)), { padding: [36, 36] })
    map.setMinZoom(map.getZoom() - 1)
    const syncZoom = () => el.setAttribute('data-detail', map.getZoom() >= map.getMinZoom() + 1.75 ? 'hi' : 'lo')
    map.on('zoomend', syncZoom)
    syncZoom()
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // The panel animates in; re-measure once it has its final size.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [interior])

  useEffect(() => {
    const group = layerRef.current
    if (!group) return
    group.clearLayers()

    if (floor.plan) {
      const [a, b] = floor.plan.bounds
      L.imageOverlay(floor.plan.image, L.latLngBounds(ll(a), ll(b)), { opacity: 0.9 }).addTo(group)
    }

    // Building shell — its fill doubles as the corridor floor.
    for (const ring of floor.outline ?? interior.outline)
      L.polygon(ring.map(ll), {
        color: '#10233f',
        weight: 2.5,
        fillColor: '#e4e8e1',
        fillOpacity: floor.plan ? 0 : 1,
        interactive: false,
      }).addTo(group)

    for (const r of floor.rooms) {
      const isSel = r.id === roomId
      const shape = L.polygon(r.poly.map(ll), {
        color: isSel ? '#ff7a1a' : '#10233f',
        weight: isSel ? 2.5 : 1,
        opacity: isSel ? 1 : 0.45,
        fillColor: isSel ? '#ffd9bd' : ROOM_FILL[r.type],
        fillOpacity: floor.plan ? (isSel ? 0.55 : 0) : 1,
        className: 'fr-room',
      })
      shape.on('mouseover', () => !isSel && shape.setStyle({ fillColor: '#fff4ec', opacity: 0.8 }))
      shape.on('mouseout', () => !isSel && shape.setStyle({ fillColor: ROOM_FILL[r.type], opacity: 0.45 }))
      shape.on('click', () => pickRoom(r, floor))
      shape.addTo(group)

      const small = polyArea(r.poly) < 22
      const label = r.number.replace(/^[A-Z]+-/, '')
      L.marker(ll(centroid(r.poly)), {
        interactive: false,
        icon: L.divIcon({
          className: `fr-room-label${small ? ' is-small' : ''}${isSel ? ' is-selected' : ''}`,
          html: `<span>${label}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(group)
    }

    // Route on this floor.
    for (const leg of route?.legs ?? []) {
      if (leg.floorId !== floor.id) continue
      const line = leg.points.map(ll)
      L.polyline(line, { color: '#ff7a1a', weight: 14, opacity: 0.22, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group)
      L.polyline(line, { color: '#ff7a1a', weight: 4.5, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group)
    }

    for (const c of interior.cores) {
      if (!c.floors.includes(floor.id)) continue
      L.marker(ll(c.point), {
        title: c.name,
        icon: L.divIcon({
          className: 'fr-core',
          html: `<span data-type="${c.type}">${c.type === 'elevator' ? ELEVATOR_SVG : STAIRS_SVG}</span>`,
          iconSize: [22, 22],
        }),
      }).addTo(group)
    }

    for (const e of interior.entrances) {
      if (e.floorId !== floor.id) continue
      const used = route?.entranceId === e.entranceId
      L.circleMarker(ll(e.point), {
        radius: used ? 8 : 5,
        color: '#fff',
        weight: 2.5,
        fillColor: '#10233f',
        fillOpacity: 1,
      })
        .bindTooltip(e.name.replace(/\s*\(approximate\)/i, ''), { direction: 'top', className: 'fr-tip', offset: [0, -6] })
        .addTo(group)
    }

    // Where the route leaves this floor, point to the next one.
    for (const t of route?.transfers ?? []) {
      if (t.floorId !== floor.id) continue
      const next = interior.floors.find((f) => f.level === t.toLevel)!
      L.marker(ll(t.point), {
        icon: L.divIcon({
          className: 'fr-transfer',
          html: `<button type="button">${t.core.type === 'elevator' ? 'Elevator' : 'Stairs'} to ${floorKey(next)} ↗</button>`,
          iconSize: [0, 0],
        }),
      })
        .on('click', () => setFloorId(next.id))
        .addTo(group)
    }
    // Arrived from another floor: mark the landing.
    const landing = route?.legs.find((l, i) => i > 0 && l.floorId === floor.id)
    if (landing)
      L.circleMarker(ll(landing.points[0]), { radius: 6, color: '#fff', weight: 2.5, fillColor: '#ff7a1a', fillOpacity: 1 }).addTo(group)
    // pickRoom only calls setters, so it's safe to leave out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interior, floor, roomId, route])

  // Bring the selected room into view when it's on the floor being shown.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected || selected.floor.id !== floorId) return
    const b = L.latLngBounds(selected.room.poly.map(ll))
    if (!map.getBounds().pad(-0.15).contains(b)) map.panTo(b.getCenter(), { animate: true })
  }, [selected, floorId])

  const photo = floor.sourcePhoto ? photoUrls[`./${floor.sourcePhoto}`] : undefined
  const isTranscribed = interior.provenance.source === 'emergency-plan'

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/45 p-0 backdrop-blur-[2px] sm:p-4 lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`${interior.name} floor plans`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="grid h-full w-full max-w-6xl grid-rows-[auto_1fr] overflow-hidden bg-white shadow-2xl sm:rounded-2xl lg:grid-cols-[340px_1fr] lg:grid-rows-1">
        {/* Sidebar */}
        <aside className="flex max-h-[46vh] min-h-0 flex-col border-b border-line lg:max-h-none lg:border-r lg:border-b-0">
          <header className="flex items-start gap-3 border-b border-line px-4 py-3.5">
            <span className="mt-0.5 rounded-md bg-navy px-2 py-1 font-mono text-xs font-medium text-white">{interior.code}</span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-base font-bold leading-tight text-ink">{interior.name}</h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                {isTranscribed ? 'From the posted evacuation plans' : 'Sample layout — not the real floor plan'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close floor plans"
              className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft transition hover:bg-ground hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {selected && route ? (
            <section className="border-b border-line px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-sm font-bold text-ink">
                  {selected.room.number}
                  {selected.room.name && <span className="font-sans font-normal text-ink-soft"> · {selected.room.name}</span>}
                </p>
                <span className="shrink-0 font-mono text-[11px] text-ink-soft">{fmtDistance(route.meters)} inside</span>
              </div>

              <label className="mt-2.5 flex items-center gap-2 text-xs text-ink-soft">
                From
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/30"
                >
                  <option value="nearest">Closest door</option>
                  {interior.entrances.map((e) => (
                    <option key={e.entranceId} value={e.entranceId}>
                      {e.name.replace(/\s*\(approximate\)/i, '')}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2.5 flex items-center gap-2 text-xs text-ink-soft">
                Prefer
                <div role="radiogroup" aria-label="Prefer elevators or stairs" className="flex flex-1 rounded-md bg-ground p-0.5">
                  {(['elevator', 'stairs'] as const).map((v) => {
                    const disabled = stepFree && v === 'stairs'
                    const on = (stepFree ? 'elevator' : prefer) === v
                    return (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => setPrefer(v)}
                        title={disabled ? 'Step-free routes use elevators only' : undefined}
                        className={`flex-1 rounded px-2 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          on ? 'bg-white text-ink shadow-sm' : 'hover:text-ink'
                        }`}
                      >
                        {v === 'elevator' ? 'Elevators' : 'Stairs'}
                      </button>
                    )
                  })}
                </div>
              </div>

              <ol className="mt-3 space-y-1.5">
                {route.steps.map((s, i) => {
                  const f = interior.floors.find((x) => x.id === s.floorId)!
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setFloorId(s.floorId)}
                        className="flex w-full items-start gap-2.5 rounded-md px-1 py-0.5 text-left text-sm transition hover:bg-ground"
                      >
                        <span
                          className={`mt-0.5 grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[10px] font-semibold ${
                            s.floorId === floorId ? 'bg-navy text-white' : 'bg-ground text-ink-soft'
                          }`}
                          title={f.name}
                        >
                          {floorKey(f)}
                        </span>
                        <span className="flex-1 text-ink">{s.text}</span>
                        {s.meters ? <span className="mt-0.5 font-mono text-[11px] text-ink-soft">{fmtDistance(s.meters)}</span> : null}
                      </button>
                    </li>
                  )
                })}
              </ol>
              {stepFree && <p className="mt-2 text-[11px] text-ink-soft">Step-free: uses elevators only.</p>}
            </section>
          ) : selected ? (
            <p className="border-b border-line px-4 py-3 text-sm text-ink-soft">
              {stepFree && findIndoorRoute(interior, selected.room.id, { prefer })
                ? `${selected.room.number} can only be reached by stairs or through doors not marked accessible on these plans.`
                : `No ${stepFree ? 'step-free ' : ''}route to ${selected.room.number} from the mapped entrances.`}
            </p>
          ) : null}

          <div className="px-4 pt-3">
            <input
              data-autofocus
              aria-label="Search rooms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search room number or type…"
              className="w-full rounded-lg bg-ground px-3 py-2 text-sm outline-none placeholder:text-ink-soft/70 focus-visible:ring-2 focus-visible:ring-navy/30"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3">
            {results.every((g) => g.rooms.length === 0) && (
              <p className="px-2 py-6 text-center text-sm text-ink-soft">No rooms match</p>
            )}
            {results.map(
              ({ floor: f, rooms }) =>
                rooms.length > 0 && (
                  <div key={f.id}>
                    <p className="sticky top-0 z-10 bg-white/95 px-2 pt-2.5 pb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft backdrop-blur">
                      {f.name}
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {rooms.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => pickRoom(r, f)}
                          title={r.name || TYPE_LABEL[r.type]}
                          className={`truncate rounded-md px-2 py-1.5 text-left font-mono text-xs transition ${
                            r.id === roomId ? 'bg-titan text-white' : 'text-ink hover:bg-ground'
                          }`}
                        >
                          {r.type === 'restroom' ? `${r.number.replace(/^[A-Z]+-/, '')} WC` : r.number.replace(/^[A-Z]+-/, '')}
                        </button>
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>
        </aside>

        {/* Map */}
        <section className="relative min-h-0 bg-ground">
          <div ref={elRef} className="fr-interior absolute inset-0" />

          {/* Floor switcher, styled like an elevator button panel. */}
          <nav
            aria-label="Floors"
            className="absolute top-4 right-4 z-[500] flex flex-col gap-1.5 rounded-2xl border border-line bg-white/95 p-1.5 shadow-lg backdrop-blur"
          >
            {floorsDesc.map((f) => {
              const active = f.id === floorId
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFloorId(f.id)}
                  aria-pressed={active}
                  title={f.name}
                  className={`relative grid h-10 w-10 place-items-center rounded-full font-display text-sm font-bold transition ${
                    active ? 'bg-navy text-white shadow-inner' : 'text-ink hover:bg-ground'
                  }`}
                >
                  {floorKey(f)}
                  {routeFloors.has(f.id) && (
                    <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-titan ring-2 ring-white" />
                  )}
                </button>
              )
            })}
          </nav>

          <div className="pointer-events-none absolute top-4 left-4 z-[500]">
            <p className="font-display text-2xl font-extrabold tracking-tight text-ink">{floor.name}</p>
            {!isTranscribed && (
              <p className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Sample layout
              </p>
            )}
          </div>

          <div className="absolute bottom-4 left-4 z-[500] flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-3 rounded-full border border-line bg-white/95 px-3 py-1.5 text-[11px] text-ink-soft shadow-sm backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-navy ring-2 ring-white" /> Door
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] bg-navy text-[8px] text-white">E</span> Elevator
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] bg-white text-[8px] text-navy ring-1 ring-navy">S</span> Stairs
              </span>
            </span>
            {photo && (
              <button
                type="button"
                onClick={() => setPhotoOpen(true)}
                className="rounded-full border border-line bg-white/95 px-3 py-1.5 text-[11px] font-medium text-ink shadow-sm backdrop-blur transition hover:border-navy/40"
              >
                View posted plan
              </button>
            )}
          </div>

          {/* Posted plan photo, shown in place so the map is one click away. */}
          {photo && photoOpen && (
            <div className="absolute inset-0 z-[1000] flex flex-col bg-ink/90 backdrop-blur-sm">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPhotoOpen(false)}
                  autoFocus
                  className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-ink shadow transition hover:bg-ground"
                >
                  <span aria-hidden>←</span> Back to map
                </button>
                <p className="min-w-0 truncate text-xs text-white/75">Posted evacuation plan · {floor.name}</p>
                <a
                  href={photo}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto shrink-0 text-xs font-medium text-white/75 underline-offset-2 hover:text-white hover:underline"
                >
                  Open full size ↗
                </a>
              </div>
              <PhotoZoom src={photo} alt={`Posted evacuation plan for the ${floor.name}`} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// Wrap Tab / Shift+Tab around the dialog's visible focusable elements.
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return
  const items = [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!root.contains(active) || (e.shiftKey ? active === first : active === last)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}

const ELEVATOR_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M5 6.5 8 3.5l3 3M5 9.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const STAIRS_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2.5 13h3v-3h3V7h3V4h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

// Pan/zoom viewer for a plan photo — Leaflet again, so wheel, pinch, drag and the +/- buttons match the map.
function PhotoZoom({ src, alt }: { src: string; alt: string }) {
  const elRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const map = L.map(el, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    let ro: ResizeObserver | undefined
    const img = new Image()
    img.onload = () => {
      // One map unit per image pixel; y-down like the image.
      const bounds = L.latLngBounds([-img.naturalHeight, 0], [0, img.naturalWidth])
      L.imageOverlay(src, bounds, { alt }).addTo(map)
      map.fitBounds(bounds, { padding: [16, 16] })
      const fit = map.getZoom()
      map.setMinZoom(fit - 0.5)
      map.setMaxZoom(fit + 4)
      map.setMaxBounds(bounds.pad(0.25))
      ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(el)
    }
    img.src = src
    return () => {
      img.onload = null
      ro?.disconnect()
      map.remove()
    }
  }, [src, alt])
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={elRef} className="fr-interior absolute inset-0" role="img" aria-label={alt} />
      <p className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-full bg-ink/70 px-3 py-1 text-[11px] text-white/85">
        Scroll or pinch to zoom · drag to pan
      </p>
    </div>
  )
}
