// Imports OpenStreetMap streets, paths and places around campus into src/imports.
// Dev-time only (`pnpm import:osm`); the app reads the saved files and never calls the network.
// Raw responses are cached in node_modules/.cache/import-osm; pass --fresh to download again.
// Data © OpenStreetMap contributors, ODbL — the area map must show that credit.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = `${ROOT}node_modules/.cache/import-osm`
const FRESH = process.argv.includes('--fresh')
// Public Overpass instances, tried in turn.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const ROAD_RADIUS_M = 4000

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
})
const { CAMPUS_CENTER: C, NEARBY_RADIUS_M, distanceM } = await server.ssrLoadModule('/src/imports/geo.ts')
await server.close()

async function overpass(query) {
  const cached = `${CACHE}/${createHash('sha1').update(query).digest('hex')}.json`
  if (!FRESH && existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))
  let last
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length]
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'FullyRoute (CSUF CPSC 362 student project; one-off data import)',
        },
        body: 'data=' + encodeURIComponent(query),
      })
      if (res.ok) {
        const { elements } = await res.json()
        mkdirSync(CACHE, { recursive: true })
        writeFileSync(cached, JSON.stringify(elements))
        return elements
      }
      last = new Error(`Overpass ${res.status} from ${url}`)
    } catch (err) {
      last = err
    }
    // Busy servers answer 429/504; back off before the next try.
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
  }
  throw last
}

const round = (v) => Math.round(v * 1e6) / 1e6
const at = `${C.lat},${C.lng}`

// --- Campus boundary ---------------------------------------------------------
// `around` measures to the outline, not the interior, so search wide and match by name.
const campusEls = await overpass(`[out:json][timeout:60];
wr["amenity"="university"](around:1500,${at});
out tags geom;`)

// Join way pieces end to end into one ring (multipolygon outers are split up).
function stitch(pieces) {
  const key = (p) => `${p.lat},${p.lon}`
  const left = pieces.map((p) => [...p])
  const ring = left.shift() ?? []
  while (left.length) {
    const end = key(ring[ring.length - 1])
    const i = left.findIndex((p) => key(p[0]) === end || key(p[p.length - 1]) === end)
    if (i === -1) break
    const [next] = left.splice(i, 1)
    if (key(next[0]) !== end) next.reverse()
    ring.push(...next.slice(1))
  }
  return ring
}

const campusRing = (() => {
  const named = campusEls.filter((e) => /state university,? fullerton/i.test(e.tags?.name ?? ''))
  const rings = named.map((e) =>
    e.type === 'way' ? e.geometry : stitch(e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry)),
  )
  rings.sort((a, b) => b.length - a.length)
  return (rings[0] ?? []).map((p) => [round(p.lat), round(p.lon)])
})()
if (campusRing.length < 4) throw new Error('Campus boundary not found in OpenStreetMap')

function inRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ya, xa] = ring[i]
    const [yb, xb] = ring[j]
    if (ya > lat !== yb > lat && lng < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside
  }
  return inside
}

// --- Streets and paths -------------------------------------------------------
const HIGHWAYS = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor',
]
const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
])
const DEFAULT_MPH = {
  motorway: 65, trunk: 50, primary: 40, secondary: 35, tertiary: 30, unclassified: 25, residential: 25,
  living_street: 15, service: 10, road: 20, motorway_link: 35, trunk_link: 30, primary_link: 25,
  secondary_link: 25, tertiary_link: 25,
}
// Parking aisles are most of the service roads; trips end at the street next to the place instead.
const SKIP_SERVICE = new Set(['driveway', 'drive-through', 'emergency_access', 'parking_aisle'])
const NO = new Set(['no', 'private'])
const YES = new Set(['yes', 'designated', 'permissive', 'destination'])

function speedMps(t) {
  const m = /^(\d+(?:\.\d+)?)\s*(mph)?$/.exec(t.maxspeed ?? '')
  const mps = m && Number(m[1]) > 0 ? (m[2] ? Number(m[1]) * 0.44704 : Number(m[1]) / 3.6) : DEFAULT_MPH[t.highway] * 0.44704
  return Math.round(mps * 100) / 100
}

const wayEls = await overpass(`[out:json][timeout:180];
way["highway"~"^(${HIGHWAYS.join('|')})$"](around:${ROAD_RADIUS_M},${at});
out geom;`)

const osmNodes = new Map() // osm id -> [lat, lng]
const picked = []
for (const e of wayEls) {
  const t = e.tags ?? {}
  const hw = t.highway
  if (hw === 'service' && SKIP_SERVICE.has(t.service)) continue
  if (t.area === 'yes') continue
  const walk = hw !== 'motorway' && hw !== 'motorway_link' && !NO.has(t.foot) && (!NO.has(t.access) || YES.has(t.foot))
  const motor = t.motor_vehicle ?? t.motorcar ?? t.vehicle
  const drive = DRIVABLE.has(hw) && !NO.has(motor) && (!NO.has(t.access) || YES.has(motor))
  if (!walk && !drive) continue
  e.nodes.forEach((id, i) => osmNodes.set(id, [e.geometry[i].lat, e.geometry[i].lon]))

  // Sidewalks and crossings keep their own class so directions can say so.
  const way = { n: e.nodes, hw: hw === 'footway' && (t.footway === 'sidewalk' || t.footway === 'crossing') ? t.footway : hw }
  if (t.name ?? t.ref) way.name = t.name ?? t.ref
  way.walk = walk
  way.drive = drive
  if (drive) {
    const ow = t.oneway
    if (ow === '-1' || ow === 'reverse') way.oneway = -1
    else if (ow === 'yes' || ow === 'true' || ow === '1') way.oneway = 1
    else if (ow !== 'no' && (t.junction === 'roundabout' || t.junction === 'circular' || hw === 'motorway' || hw === 'motorway_link'))
      way.oneway = 1
    way.mps = speedMps(t)
  }
  if (hw === 'steps') way.steps = true
  picked.push(way)
}

// Drop in-between points that barely bend the line (< 2 m), keeping every junction and end.
const uses = new Map()
for (const w of picked) for (const id of w.n) uses.set(id, (uses.get(id) ?? 0) + 1)
const M_LAT = 110574
const M_LNG = 111320 * Math.cos((C.lat * Math.PI) / 180)
function offLine(p, a, b) {
  const [px, py, ax, ay, bx, by] = [p[1] * M_LNG, p[0] * M_LAT, a[1] * M_LNG, a[0] * M_LAT, b[1] * M_LNG, b[0] * M_LAT]
  const len = Math.hypot(bx - ax, by - ay)
  if (len === 0) return Math.hypot(px - ax, py - ay)
  return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
}
function simplify(ids) {
  if (ids.length < 3) return ids
  const a = osmNodes.get(ids[0])
  const b = osmNodes.get(ids[ids.length - 1])
  let worst = 0
  let at = 0
  for (let i = 1; i < ids.length - 1; i++) {
    const d = offLine(osmNodes.get(ids[i]), a, b)
    if (d > worst) [worst, at] = [d, i]
  }
  if (worst < 2) return [ids[0], ids[ids.length - 1]]
  return [...simplify(ids.slice(0, at + 1)), ...simplify(ids.slice(at)).slice(1)]
}

const round5 = (v) => Math.round(v * 1e5) / 1e5
const nodes = []
const nodeIdx = new Map()
const ways = []
for (const w of picked) {
  const kept = [w.n[0]]
  let from = 0
  for (let i = 1; i < w.n.length; i++) {
    if (i < w.n.length - 1 && uses.get(w.n[i]) === 1) continue
    kept.push(...simplify(w.n.slice(from, i + 1)).slice(1))
    from = i
  }
  w.n = kept.map((id) => {
    let idx = nodeIdx.get(id)
    if (idx === undefined) {
      const [lat, lng] = osmNodes.get(id)
      idx = nodes.length
      nodes.push([round5(lat), round5(lng)])
      nodeIdx.set(id, idx)
    }
    return idx
  })
  ways.push(w)
}

// Sidewalks are rarely named; note the street each one runs beside (within 30 m, roughly parallel)
// so walking directions can say "on Nutwood Avenue" instead of "on the sidewalk".
const lx = (i) => nodes[i][1] * M_LNG
const ly = (i) => nodes[i][0] * M_LAT
const named = []
for (const w of ways)
  if (w.drive && w.name) for (let k = 0; k + 1 < w.n.length; k++) named.push([w.n[k], w.n[k + 1], w.name])
for (const w of ways) {
  if (w.hw !== 'sidewalk' || w.name) continue
  const votes = new Map()
  for (let k = 0; k + 1 < w.n.length; k++) {
    const [a, b] = [w.n[k], w.n[k + 1]]
    const len = Math.hypot(lx(b) - lx(a), ly(b) - ly(a))
    if (len < 1) continue
    const mx = (lx(a) + lx(b)) / 2
    const my = (ly(a) + ly(b)) / 2
    let best = null
    let bestD = 30
    for (const [c, d, name] of named) {
      const dx = lx(d) - lx(c)
      const dy = ly(d) - ly(c)
      const l2 = dx * dx + dy * dy
      if (l2 === 0) continue
      const cos = Math.abs(dx * (lx(b) - lx(a)) + dy * (ly(b) - ly(a))) / (Math.sqrt(l2) * len)
      if (cos < 0.87) continue // more than ~30° apart
      const t = Math.max(0, Math.min(1, ((mx - lx(c)) * dx + (my - ly(c)) * dy) / l2))
      const dist = Math.hypot(mx - lx(c) - t * dx, my - ly(c) - t * dy)
      if (dist < bestD) [best, bestD] = [name, dist]
    }
    if (best) votes.set(best, (votes.get(best) ?? 0) + len)
  }
  const top = [...votes].sort((p, q) => q[1] - p[1])[0]
  if (top) w.along = top[0]
}

// --- Places ------------------------------------------------------------------
const POI = {
  amenity: {
    restaurant: 'dining', cafe: 'dining', fast_food: 'dining', food_court: 'dining', ice_cream: 'dining',
    pharmacy: 'pharmacy', hospital: 'health', clinic: 'health', doctors: 'health', dentist: 'health',
    bank: 'bank', atm: 'atm', fuel: 'fuel', charging_station: 'ev', bus_station: 'transit',
    library: 'library', post_office: 'post', bicycle_rental: 'bike',
  },
  shop: {
    supermarket: 'grocery', convenience: 'grocery', greengrocer: 'grocery', chemist: 'pharmacy',
    mall: 'shopping', department_store: 'shopping', books: 'shopping', stationery: 'shopping',
    electronics: 'shopping', copyshop: 'shopping', variety_store: 'shopping', clothes: 'shopping',
    hardware: 'shopping', mobile_phone: 'shopping', computer: 'shopping',
  },
  railway: { station: 'transit' },
  leisure: { park: 'park', fitness_centre: 'fitness', sports_centre: 'fitness' },
}
const UNNAMED_SUFFIX = { atm: 'ATM', ev: 'EV charging' }

const R = NEARBY_RADIUS_M
const poiEls = await overpass(`[out:json][timeout:120];
(
${Object.entries(POI)
  .map(([k, v]) => `  nwr["${k}"~"^(${Object.keys(v).join('|')})$"](around:${R},${at});`)
  .join('\n')}
);
out center tags;`)

const places = []
for (const e of poiEls) {
  const t = e.tags ?? {}
  const key = Object.keys(POI).find((k) => POI[k][t[k]])
  if (!key) continue
  const poiType = POI[key][t[key]]
  const who = t.brand ?? t.operator
  const name = t.name ?? (who && UNNAMED_SUFFIX[poiType] ? `${who} ${UNNAMED_SUFFIX[poiType]}` : null)
  if (!name) continue
  const lat = round(e.lat ?? e.center?.lat)
  const lng = round(e.lon ?? e.center?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
  if (distanceM(C, { lat, lng }) > R) continue
  if (inRing([lat, lng], campusRing)) continue // campus places come from buildings.json
  // The same shop is often mapped as both a point and a building outline.
  if (places.some((p) => p.name === name && distanceM(p.position.geo, { lat, lng }) < 60)) continue
  places.push({
    id: `near-${e.type[0]}${e.id}`,
    code: null,
    name,
    kind: 'poi',
    poiType,
    position: { geo: { lat, lng } },
    provenance: { source: 'imported', sourceRef: `https://www.openstreetmap.org/${e.type}/${e.id}`, verified: false },
  })
}
places.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

const region = {
  source: 'OpenStreetMap',
  license: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  fetchedAt: new Date().toISOString(),
  center: { lat: round(C.lat), lng: round(C.lng) },
  radiusM: R,
  roadRadiusM: ROAD_RADIUS_M,
  campus: campusRing,
  nodes,
  ways,
}
writeFileSync(`${ROOT}src/imports/region.json`, JSON.stringify(region))
writeFileSync(`${ROOT}src/imports/nearby.json`, JSON.stringify(places, null, 2) + '\n')
console.log(`campus ring ${campusRing.length} pts, ${ways.length} ways, ${nodes.length} nodes, ${places.length} places`)
