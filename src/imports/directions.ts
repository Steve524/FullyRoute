import buildingsData from './buildings.json'
import footprintsData from './footprints.json'
import { distanceToPoly, METERS_PER_PIXEL, type RoutePoint } from './geometry'
import type { Building } from './types'

// Turn-by-turn instructions synthesized from a drawn route polyline.

export interface RouteStep {
  instruction: string
  distanceM: number
  fromNodeId: string
  toNodeId: string
}

// Named footprints for landmark references in turn-by-turn steps. Prefer the
// short building code (as printed on the map) and fall back to the full name.
const nameToCode = new Map<string, string>()
for (const b of buildingsData as Building[]) if (b.code) nameToCode.set(b.name, b.code)

interface NamedFootprint {
  label: string
  poly: RoutePoint[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const namedFootprints: NamedFootprint[] = (footprintsData as { name: string | null; poly: number[][] }[])
  .filter((f) => f.name && f.poly.length >= 4)
  .map((f) => {
    const poly = f.poly.map(([x, y]) => ({ x, y }))
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    return {
      label: nameToCode.get(f.name!) ?? f.name!,
      poly,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  })

// Closest building label to a point, if one is within `maxPx`. Used to phrase
// steps like "Turn right at EC" instead of bare compass directions.
const LANDMARK_REACH = 85 // px (~17m) — only mention a building you're beside
function nearestLandmark(p: RoutePoint): string | null {
  let best: string | null = null
  let bestDist = LANDMARK_REACH
  for (const fp of namedFootprints) {
    if (p.x < fp.minX - bestDist || p.x > fp.maxX + bestDist) continue
    if (p.y < fp.minY - bestDist || p.y > fp.maxY + bestDist) continue
    const d = distanceToPoly(p, fp.poly)
    if (d < bestDist) {
      bestDist = d
      best = fp.label
    }
  }
  return best
}

// North is up on the map; pixel y increases downward.
function compass(dx: number, dy: number): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

// Collapse the dense walkway polyline into human turn-by-turn steps by keeping
// only meaningful corners, then classifying each turn left/right.
export function synthSteps(pts: RoutePoint[]): RouteStep[] {
  if (pts.length < 2) return []
  const corners: RoutePoint[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = corners[corners.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const h1 = Math.atan2(b.y - a.y, b.x - a.x)
    const h2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = ((h2 - h1) * 180) / Math.PI
    while (d > 180) d -= 360
    while (d < -180) d += 360
    if (Math.abs(d) > 22) corners.push(b)
  }
  corners.push(pts[pts.length - 1])

  const steps: RouteStep[] = []
  let lastLandmark: string | null = null
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]
    const b = corners[i + 1]
    const distanceM = Math.round((Math.hypot(b.x - a.x, b.y - a.y) * METERS_PER_PIXEL) / 5) * 5
    if (i !== 0 && distanceM < 5) continue
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    let instruction: string
    if (i === 0) {
      instruction = `Head ${compass(b.x - a.x, b.y - a.y)}`
      const lm = nearestLandmark(mid) ?? nearestLandmark(b)
      if (lm) {
        instruction += ` toward ${lm}`
        lastLandmark = lm
      }
    } else {
      const prev = corners[i - 1]
      const h1 = Math.atan2(a.y - prev.y, a.x - prev.x)
      const h2 = Math.atan2(b.y - a.y, b.x - a.x)
      let d = ((h2 - h1) * 180) / Math.PI
      while (d > 180) d -= 360
      while (d < -180) d += 360
      let turn: string
      if (d > 55) turn = 'Turn right'
      else if (d > 20) turn = 'Bear right'
      else if (d < -55) turn = 'Turn left'
      else if (d < -20) turn = 'Bear left'
      else turn = 'Continue straight'

      // Prefer the landmark at the corner where the turn happens; for a
      // straightaway, mention a building you pass along the way instead.
      const turning = turn !== 'Continue straight'
      const lm = turning ? nearestLandmark(a) : nearestLandmark(mid)
      if (lm && lm !== lastLandmark) {
        instruction = turning ? `${turn} at ${lm}` : `Continue straight past ${lm}`
        lastLandmark = lm
      } else {
        instruction = turn
        if (turning) lastLandmark = null
      }
    }
    steps.push({ instruction, distanceM, fromNodeId: `s${i}`, toNodeId: `s${i + 1}` })
  }
  return steps
}
