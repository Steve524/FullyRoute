import { useEffect, useMemo, useRef, useState } from 'react'
import { nearbyPlaces as places, region, type AreaTrip } from './areaRouting'
import type { LatLng } from './types'

// Static map of the streets within ~2 miles of campus, drawn from region.json
// (OpenStreetMap). Units are local meters: x east, y south, origin at the campus center.

const M_LAT = 110574
const M_LNG = 111320 * Math.cos((region.center.lat * Math.PI) / 180)
const project = ({ lat, lng }: LatLng) => ({
  x: (lng - region.center.lng) * M_LNG,
  y: -(lat - region.center.lat) * M_LAT,
})
const at = (lat: number, lng: number) => project({ lat, lng })

type Layer = { classes: string[]; stroke: string; width: number; dash?: string; labelFrom?: number }
// Drawn in this order, minor first. labelFrom = largest meters-per-pixel at which names show.
const LAYERS: Layer[] = [
  { classes: ['footway', 'sidewalk', 'crossing', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor'], stroke: '#a7a294', width: 1, dash: '3 2' },
  { classes: ['service', 'living_street', 'road'], stroke: '#ffffff', width: 1.5 },
  { classes: ['residential', 'unclassified'], stroke: '#ffffff', width: 2.5, labelFrom: 1.6 },
  { classes: ['tertiary', 'tertiary_link', 'secondary_link', 'primary_link'], stroke: '#ffffff', width: 3.5, labelFrom: 4 },
  { classes: ['secondary', 'primary'], stroke: '#fde7a8', width: 4.5, labelFrom: 9 },
  { classes: ['trunk', 'trunk_link', 'motorway', 'motorway_link'], stroke: '#f6b26b', width: 5, labelFrom: 12 },
]

// Path data and one label spot (the longest straight piece) per street name, built once.
const drawn = LAYERS.map((layer) => {
  const set = new Set(layer.classes)
  const parts: string[] = []
  const longest = new Map<string, { len: number; x: number; y: number; angle: number }>()
  for (const w of region.ways) {
    if (!set.has(w.hw)) continue
    const pts = w.n.map((i) => at(region.nodes[i][0], region.nodes[i][1]))
    parts.push('M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L'))
    if (!layer.labelFrom || !w.name) continue
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k], pts[k + 1]]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len <= (longest.get(w.name)?.len ?? 0)) continue
      let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      if (angle > 90) angle -= 180
      if (angle < -90) angle += 180
      longest.set(w.name, { len, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle })
    }
  }
  return { ...layer, d: parts.join(''), labels: [...longest].map(([name, l]) => ({ name, ...l })) }
})

const campusD = 'M' + region.campus.map(([lat, lng]) => at(lat, lng)).map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + 'Z'

const HOME = { x: -3500, y: -3500, w: 7000, h: 7000 }
const MIN_W = 120
const MAX_W = 9000
const LIMIT = 4500 // keep the view center within this many meters of campus

type View = typeof HOME

interface AreaMapProps {
  selectedId: string | null
  onSelect: (id: string) => void
  origin: { name: string; geo: LatLng } | null
  trip: AreaTrip | null
}

export default function AreaMap({ selectedId, onSelect, origin, trip }: AreaMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>(HOME)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; x: number; y: number; dist: number; moved: boolean; pick: string | null } | null>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Meters per screen pixel (the SVG letterboxes with "meet").
  const mpp = Math.max(view.w / size.w, view.h / size.h)

  const clampView = (v: View): View => {
    const w = Math.max(MIN_W, Math.min(MAX_W, v.w))
    const h = (v.h / v.w) * w
    const cx = Math.max(-LIMIT, Math.min(LIMIT, v.x + v.w / 2))
    const cy = Math.max(-LIMIT, Math.min(LIMIT, v.y + v.h / 2))
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }

  // Zoom by `f` (<1 = in) keeping the map point under (cx, cy) in place.
  const zoomAt = (v: View, f: number, cx = v.x + v.w / 2, cy = v.y + v.h / 2): View => {
    const w = Math.max(MIN_W, Math.min(MAX_W, v.w * f))
    const k = w / v.w
    return clampView({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k })
  }

  const toMap = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toMap(e.clientX, e.clientY)
      setView((v) => zoomAt(v, Math.exp(e.deltaY * 0.0015), p.x, p.y))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Frame the trip whenever a new one arrives.
  useEffect(() => {
    if (!trip) return
    const pts = trip.points.map(project)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const w = Math.max(400, (maxX - minX) * 1.25, ((maxY - minY) * 1.25 * size.w) / size.h)
    const h = (w * size.h) / size.w
    setView(clampView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h }))
  }, [trip])

  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) }
  }
  const center = () =>
    pointers.current.size === 2 ? twoFingers() : { ...[...pointers.current.values()][0], dist: 0 }

  const onPointerDown = (e: React.PointerEvent) => {
    // Capturing keeps drags smooth but retargets the click, so remember which dot was pressed.
    svgRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pick = pointers.current.size === 1 ? (e.target as Element).getAttribute('data-place') : null
    gesture.current = { view, ...center(), moved: false, pick }
  }

  // The map point under the gesture's start stays under the fingers; pinching scales around it.
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!pointers.current.has(e.pointerId) || !g) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const c = center()
    if (Math.hypot(c.x - g.x, c.y - g.y) > 4 || Math.abs(c.dist - g.dist) > 4) g.moved = true
    if (!g.moved) return
    const r = svgRef.current!.getBoundingClientRect()
    const [rx, ry] = [r.left + r.width / 2, r.top + r.height / 2]
    const k0 = Math.max(g.view.w / r.width, g.view.h / r.height)
    const ax = g.view.x + g.view.w / 2 + (g.x - rx) * k0
    const ay = g.view.y + g.view.h / 2 + (g.y - ry) * k0
    const w = Math.max(MIN_W, Math.min(MAX_W, g.view.w * (g.dist > 0 && c.dist > 0 ? g.dist / c.dist : 1)))
    const ratio = w / g.view.w
    const h = g.view.h * ratio
    const cx = ax - (c.x - rx) * k0 * ratio
    const cy = ay - (c.y - ry) * k0 * ratio
    setView(clampView({ x: cx - w / 2, y: cy - h / 2, w, h }))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size > 0) {
      // Lifting one finger of a pinch continues as a drag from where it is.
      gesture.current = { view, ...center(), moved: true, pick: null }
      return
    }
    gesture.current = null
    if (g && !g.moved && g.pick) onSelect(g.pick)
  }

  const KEY_PAN = 80 // screen px per arrow press
  const onKeyDown = (e: React.KeyboardEvent) => {
    const pan: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (pan[e.key]) setView((v) => clampView({ ...v, x: v.x + pan[e.key][0] * KEY_PAN * mpp, y: v.y + pan[e.key][1] * KEY_PAN * mpp }))
    else if (e.key === '+' || e.key === '=') setView((v) => zoomAt(v, 0.6))
    else if (e.key === '-' || e.key === '_') setView((v) => zoomAt(v, 1 / 0.6))
    else if (e.key === '0') setView(HOME)
    else return
    e.preventDefault()
  }

  const routeD = useMemo(
    () => (trip ? 'M' + trip.points.map(project).map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') : null),
    [trip],
  )
  const o = origin ? project(origin.geo) : null
  const selected = places.find((p) => p.id === selectedId) ?? null
  const dest = selected?.position.geo ? project(selected.position.geo) : null
  const font = 11 * mpp

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-line bg-[#ece8df]">
      <svg
        ref={svgRef}
        role="img"
        tabIndex={0}
        aria-label="Area map within two miles of campus. Arrow keys pan, plus and minus zoom, 0 resets."
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-titan"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <path d={campusD} fill="#ff7a1a" fillOpacity={0.1} stroke="#ff7a1a" strokeOpacity={0.6} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <circle r={region.radiusM} fill="none" stroke="#10233f" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />

        {drawn.map((l) => (
          <path key={l.classes[0]} d={l.d} fill="none" stroke={l.stroke} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}

        {drawn.map((l) =>
          l.labelFrom && mpp <= l.labelFrom
            ? l.labels
                .filter((s) => s.len > s.name.length * font * 0.55)
                .map((s) => (
                  <text
                    key={`${l.classes[0]}-${s.name}`}
                    transform={`translate(${s.x} ${s.y}) rotate(${s.angle})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={font * 0.95}
                    fill="#566173"
                    stroke="#ece8df"
                    strokeWidth={font * 0.3}
                    paintOrder="stroke"
                    className="pointer-events-none font-sans"
                  >
                    {s.name}
                  </text>
                ))
            : null,
        )}

        {routeD && (
          <>
            <path d={routeD} fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path
              d={routeD}
              fill="none"
              stroke={trip?.mode === 'drive' ? '#10233f' : '#ff7a1a'}
              strokeWidth={4.5}
              strokeDasharray={trip?.mode === 'walk' ? '1 7' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {places.map((p) => {
          if (!p.position.geo || p.id === selectedId) return null
          const c = project(p.position.geo)
          return (
            <circle
              key={p.id}
              cx={c.x}
              cy={c.y}
              r={5 * mpp}
              fill="#10233f"
              stroke="#fff"
              strokeWidth={1.5 * mpp}
              data-place={p.id}
              className="cursor-pointer"
            >
              <title>{p.name}</title>
            </circle>
          )
        })}

        {o && origin && (
          <g transform={`translate(${o.x} ${o.y})`} className="pointer-events-none">
            <circle r={7 * mpp} fill="#10233f" stroke="#fff" strokeWidth={2.5 * mpp} />
            <text y={-12 * mpp} textAnchor="middle" fontSize={font * 1.1} fontWeight={700} fill="#10233f" stroke="#fff" strokeWidth={font * 0.35} paintOrder="stroke" className="font-display">
              {origin.name}
            </text>
          </g>
        )}
        {dest && selected && (
          <g transform={`translate(${dest.x} ${dest.y})`} className="pointer-events-none">
            <rect x={-6 * mpp} y={-6 * mpp} width={12 * mpp} height={12 * mpp} rx={2 * mpp} transform="rotate(45)" fill="#ff7a1a" stroke="#fff" strokeWidth={2.5 * mpp} />
            <text y={-13 * mpp} textAnchor="middle" fontSize={font * 1.1} fontWeight={700} fill="#10233f" stroke="#fff" strokeWidth={font * 0.35} paintOrder="stroke" className="font-display">
              {selected.name}
            </text>
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-white/95 px-2.5 py-1.5 text-[11px] text-ink-soft shadow-sm">
        <span className="mr-1.5 inline-block h-0 w-4 border-t-2 border-dashed border-navy/50 align-middle" />2-mile radius
        <span className="ml-3 mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-titan/60 bg-titan/10 align-middle" />Campus
      </div>

      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-line bg-white/95 shadow-sm backdrop-blur">
        <button type="button" aria-label="Zoom in" onClick={() => setView((v) => zoomAt(v, 0.6))} className="h-10 w-10 text-lg font-semibold text-ink transition hover:bg-ground">+</button>
        <div className="h-px bg-line" />
        <button type="button" aria-label="Zoom out" onClick={() => setView((v) => zoomAt(v, 1 / 0.6))} className="h-10 w-10 text-lg font-semibold text-ink transition hover:bg-ground">−</button>
        <div className="h-px bg-line" />
        <button type="button" aria-label="Reset view" onClick={() => setView(HOME)} className="h-10 w-10 text-ink transition hover:bg-ground">⤢</button>
      </div>

      <p className="absolute bottom-0 left-0 rounded-tr-lg bg-white/85 px-2 py-0.5 text-[10px] text-ink-soft">
        Map data{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-ink">
          {region.attribution}
        </a>
      </p>
    </div>
  )
}
