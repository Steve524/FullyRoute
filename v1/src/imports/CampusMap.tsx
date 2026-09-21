import { useEffect, useMemo, useRef, useState } from 'react'
import mapInfo from './map.json'
import mapImage from './CSUF-CAMPUS-MAP.png'
import footprintsData from './footprints.json'
import { buildRoundedPath } from './routing'
import type { RoutePoint } from './routing'

export interface MapHighlight {
  id: string
  name: string
  code: string | null
  role: 'start' | 'destination'
  // position in the source image's pixel space
  x: number
  y: number
}

export type BuildingKind =
  | 'academic'
  | 'service'
  | 'housing'
  | 'athletics'
  | 'landmark'
  | 'parking'

export interface MapMarker {
  id: string
  name: string
  code: string | null
  kind: BuildingKind
  x: number
  y: number
}

// Vibrant, distinct hue per category — tuned to sit harmoniously with the
// navy/titan brand while reading clearly against the map.
export const KIND_COLORS: Record<BuildingKind, string> = {
  academic: '#2f6df6', // blue
  service: '#0ea5a4', // teal
  housing: '#a855f7', // purple
  athletics: '#ef4444', // red
  landmark: '#ff7a1a', // titan orange
  parking: '#94a3b8', // slate
}

export const KIND_LABELS: Record<BuildingKind, string> = {
  academic: 'Academic',
  service: 'Service',
  housing: 'Housing',
  athletics: 'Athletics',
  landmark: 'Landmark',
  parking: 'Parking',
}

const KIND_ORDER: BuildingKind[] = [
  'academic',
  'service',
  'housing',
  'athletics',
  'landmark',
  'parking',
]

// Building footprints traced directly from the drawn campus map artwork, so
// each polygon matches the shape as illustrated (not real-world OSM geometry).
const rawFootprints = (footprintsData as { name: string | null; poly: number[][] }[]).filter(
  (f) => f.poly.length >= 3,
)

// Ray-cast point-in-polygon test (polygon as [x, y] pairs).
function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

interface CampusMapProps {
  highlights: MapHighlight[]
  route?: RoutePoint[]
  markers?: MapMarker[]
  showCategories?: boolean
  onSelectBuilding?: (id: string) => void
}

const MIN_SCALE = 1
const MAX_SCALE = 5
const ASPECT = mapInfo.width / mapInfo.height

/**
 * Static campus map that pans and zooms. The stage is locked to the image's
 * aspect ratio, so highlight/route coordinates (given in the image's pixel
 * space) stay exactly aligned at any size or zoom level.
 */
export default function CampusMap({
  highlights,
  route,
  markers,
  showCategories = false,
  onSelectBuilding,
}: CampusMapProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ code: string | null; name: string; x: number; y: number } | null>(
    null,
  )
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const dragged = useRef(false)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  // Fit the stage inside the frame while preserving the image aspect ratio.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => {
      const fw = el.clientWidth
      const fh = el.clientHeight
      if (fw / fh > ASPECT) setStage({ w: fh * ASPECT, h: fh })
      else setStage({ w: fw, h: fw / ASPECT })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Clamp panning so scaled content can't be dragged fully out of view.
  const clamp = (next: { x: number; y: number }, s: number) => {
    const el = frameRef.current
    if (!el) return next
    const maxX = Math.max(0, (stage.w * s - el.clientWidth) / 2)
    const maxY = Math.max(0, (stage.h * s - el.clientHeight) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    }
  }

  // Bounding box of the mapped route in image pixel space, if any.
  const routeBounds = useMemo(() => {
    if (!route || route.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of route) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
  }, [route])

  // Offset that centers a given image-space point in the frame at scale `s`.
  const offsetForCenter = (imgX: number, imgY: number, s: number) => {
    const localX = (imgX / mapInfo.width) * stage.w
    const localY = (imgY / mapInfo.height) * stage.h
    return clamp({ x: -s * (localX - stage.w / 2), y: -s * (localY - stage.h / 2) }, s)
  }

  const zoomTo = (nextScale: number, focus?: { x: number; y: number }) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale))
    setScale(s)
    if (focus) setOffset(offsetForCenter(focus.x, focus.y, s))
    else setOffset((o) => clamp(o, s))
  }

  // Zoom-in that frames the mapped route: first press fits the whole route in
  // view, subsequent presses step in further while keeping the route centered.
  const zoomIn = () => {
    const el = frameRef.current
    if (!routeBounds || !el || !stage.w) {
      zoomTo(scale + 0.5)
      return
    }
    const boxW = ((routeBounds.maxX - routeBounds.minX) / mapInfo.width) * stage.w
    const boxH = ((routeBounds.maxY - routeBounds.minY) / mapInfo.height) * stage.h
    const pad = 0.82
    const fit = Math.min(
      boxW > 0 ? (el.clientWidth * pad) / boxW : MAX_SCALE,
      boxH > 0 ? (el.clientHeight * pad) / boxH : MAX_SCALE,
    )
    const fitScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit))
    const next = scale < fitScale - 0.05 ? fitScale : scale + 0.5
    zoomTo(next, { x: routeBounds.cx, y: routeBounds.cy })
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    zoomTo(scale - e.deltaY * 0.005)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragged.current = false
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 4) dragged.current = true
    setOffset(
      clamp(
        {
          x: drag.current.ox + (e.clientX - drag.current.x),
          y: drag.current.oy + (e.clientY - drag.current.y),
        },
        scale,
      ),
    )
  }

  const onPointerUp = () => {
    drag.current = null
  }

  const resetView = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  // Touch pinch-to-zoom.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { dist: dist(e.touches), scale }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault()
        zoomTo(pinch.current.scale * (dist(e.touches) / pinch.current.dist))
      }
    }
    const onEnd = () => {
      pinch.current = null
    }
    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [scale])

  const routeD = route && route.length > 1 ? buildRoundedPath(route, 130) : null

  // Match each footprint to the building whose center sits inside it, so the
  // polygon inherits that building's category color. Buildings with no matching
  // footprint fall back to a colored dot so they're still color-coded.
  const { polys, unmatched } = useMemo(() => {
    const MATCH_RADIUS = 300 // px; nearest-center fallback when none is strictly inside
    const matched = new Set<string>()
    const polys: {
      key: string
      id: string
      kind: BuildingKind
      points: string
      name: string
      code: string | null
    }[] = []
    rawFootprints.forEach((fp, fpIndex) => {
      const cx = fp.poly.reduce((s, p) => s + p[0], 0) / fp.poly.length
      const cy = fp.poly.reduce((s, p) => s + p[1], 0) / fp.poly.length
      let best: MapMarker | null = null
      let bestDist = Infinity
      for (const m of markers ?? []) {
        // A center inside the polygon wins outright (distance 0); otherwise take
        // the closest center within the match radius.
        const inside = pointInPoly(m.x, m.y, fp.poly)
        const d = inside ? 0 : Math.hypot(m.x - cx, m.y - cy)
        if (d > MATCH_RADIUS) continue
        if (d < bestDist) {
          bestDist = d
          best = m
        }
      }
      if (!best) return
      matched.add(best.id)
      polys.push({
        key: `${best.id}-${fpIndex}`,
        id: best.id,
        kind: best.kind,
        points: fp.poly.map((p) => p.join(',')).join(' '),
        name: best.name,
        code: best.code,
      })
    })
    const unmatched = (markers ?? []).filter((m) => !matched.has(m.id))
    return { polys, unmatched }
  }, [markers])

  // Categories present among the given markers, in display order, for the legend.
  const legendKinds = KIND_ORDER.filter((k) => markers?.some((m) => m.kind === k))
  const hasMarkers = Boolean(markers && markers.length)

  // Track pointer position (relative to the map container) for the tooltip.
  const trackHover = (e: React.MouseEvent, p: { code: string | null; name: string }) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ code: p.code, name: p.name, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden rounded-2xl border border-line bg-[#0b1a30]"
    >
      <div
        ref={frameRef}
        className="flex h-full w-full items-center justify-center cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          className="relative origin-center transition-transform duration-75 ease-out"
          style={{
            width: stage.w || '100%',
            height: stage.h || '100%',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          <img
            src={mapImage}
            alt="Cal State Fullerton campus map"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ filter: 'saturate(1.35) contrast(1.05) brightness(1.02)' }}
          />

          {/* Category color layer — building footprints filled by kind. */}
          {showCategories && (
            <svg
              className="absolute inset-0 h-full w-full"
              style={{ pointerEvents: 'none' }}
              viewBox={`0 0 ${mapInfo.width} ${mapInfo.height}`}
              preserveAspectRatio="none"
            >
              {polys.map((p) => (
                <polygon
                  key={p.key}
                  points={p.points}
                  fill={KIND_COLORS[p.kind]}
                  fillOpacity={hover && hover.name === p.name ? 0.78 : 0.55}
                  stroke={KIND_COLORS[p.kind]}
                  strokeWidth={(hover && hover.name === p.name ? 20 : 10) / scale}
                  strokeLinejoin="round"
                  style={{ pointerEvents: 'auto', cursor: onSelectBuilding ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => trackHover(e, p)}
                  onMouseMove={(e) => trackHover(e, p)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (!dragged.current) onSelectBuilding?.(p.id)
                  }}
                />
              ))}
            </svg>
          )}

          {/* Buildings without a footprint still get a colored dot. */}
          {showCategories &&
            unmatched.map((m) => (
              <div
                key={m.id}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(m.x / mapInfo.width) * 100}%`, top: `${(m.y / mapInfo.height) * 100}%` }}
              >
                <span
                  className="block rounded-full ring-2 ring-white/90 shadow"
                  style={{
                    width: 16 / scale,
                    height: 16 / scale,
                    background: KIND_COLORS[m.kind],
                  }}
                />
              </div>
            ))}

          {/* Route path, drawn in the image's pixel space, bent around buildings. */}
          {routeD && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${mapInfo.width} ${mapInfo.height}`}
              preserveAspectRatio="none"
            >
              <path d={routeD} fill="none" stroke="#ff7a1a" strokeWidth={92 / scale} strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />
              <path d={routeD} fill="none" stroke="#ff7a1a" strokeWidth={44 / scale} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}

          {highlights.map((h) => (
            <div
              key={h.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
              style={{ left: `${(h.x / mapInfo.width) * 100}%`, top: `${(h.y / mapInfo.height) * 100}%` }}
            >
              <div className="flex flex-col items-center" style={{ transform: `scale(${1 / scale})` }}>
                <span
                  className="whitespace-nowrap rounded-full border px-2 py-0.5 font-display text-[11px] font-semibold shadow-sm"
                  style={{
                    background: h.role === 'start' ? '#10233f' : '#ff7a1a',
                    color: '#fff',
                    borderColor: 'rgba(255,255,255,0.7)',
                  }}
                >
                  {h.role === 'start' ? 'Start' : 'End'} · {h.name}
                </span>
                <span
                  className="mt-0.5 h-3 w-3 rotate-45 rounded-[2px] border-2 border-white shadow"
                  style={{ background: h.role === 'start' ? '#10233f' : '#ff7a1a' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hover tooltip: building code abbreviation with full name beneath. */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
          style={{ left: hover.x, top: hover.y - 14 }}
        >
          <div className="rounded-lg border border-line bg-white/95 px-2.5 py-1.5 text-center shadow-md backdrop-blur">
            {hover.code && (
              <div className="font-display text-sm font-bold leading-tight text-ink">{hover.code}</div>
            )}
            <div className={`text-[11px] leading-tight ${hover.code ? 'text-ink-soft' : 'font-semibold text-ink'}`}>
              {hover.name}
            </div>
          </div>
        </div>
      )}

      {/* Category legend */}
      {hasMarkers && showCategories && (
        <div className="absolute left-3 top-3 max-w-[60%] rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
          <div className="mb-2">
            <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Categories
            </span>
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {legendKinds.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
                  style={{ background: KIND_COLORS[k] }}
                />
                <span className="text-[11px] text-ink">{KIND_LABELS[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-line bg-white/95 shadow-sm backdrop-blur">
        <button type="button" aria-label={routeBounds ? 'Zoom in on route' : 'Zoom in'} onClick={zoomIn} className="h-10 w-10 text-lg font-semibold text-ink transition hover:bg-ground">+</button>
        <div className="h-px bg-line" />
        <button type="button" aria-label="Zoom out" onClick={() => zoomTo(scale - 0.5, routeBounds ? { x: routeBounds.cx, y: routeBounds.cy } : undefined)} className="h-10 w-10 text-lg font-semibold text-ink transition hover:bg-ground">−</button>
        <div className="h-px bg-line" />
        <button type="button" aria-label="Reset view" onClick={resetView} className="h-10 w-10 text-ink transition hover:bg-ground">⤢</button>
      </div>
    </div>
  )
}
