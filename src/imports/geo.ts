// Geo -> map pixel conversion.
//
// The campus map (map.json, 6182x8000 px) was georeferenced against building
// coordinates from OpenStreetMap using a least-squares affine fit
// (lon/lat -> pixel), RMS ~73px. These coefficients reproduce that fit, so any
// real GPS coordinate can be placed on the map in the same pixel space used by
// highlights, entrances, and the routing graph.

const CX = [447106.156, -8924.347, 53012273.325] as const
const CY = [11040.664, -538700.138, 19557994.033] as const

export interface LatLng {
  lat: number
  lng: number
}

export interface Pixel {
  x: number
  y: number
}

/** Decimal (lat, lng) -> map pixel space. */
export function geoToPixel({ lat, lng }: LatLng): Pixel {
  return {
    x: CX[0] * lng + CX[1] * lat + CX[2],
    y: CY[0] * lng + CY[1] * lat + CY[2],
  }
}

/** Map pixel space -> decimal (lat, lng); exact inverse of geoToPixel. */
export function pixelToGeo({ x, y }: Pixel): LatLng {
  const det = CX[0] * CY[1] - CX[1] * CY[0]
  const dx = x - CX[2]
  const dy = y - CY[2]
  return { lat: (CX[0] * dy - CY[0] * dx) / det, lng: (CY[1] * dx - CX[1] * dy) / det }
}

// Center of the campus map image (6182 x 8000 px).
export const CAMPUS_CENTER: LatLng = pixelToGeo({ x: 3091, y: 4000 })

// "Nearby" = within two miles of the campus center.
export const NEARBY_RADIUS_M = 3219

const EARTH_R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance in meters. */
export function distanceM(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/** Initial compass bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const COMPASS_8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
export const compassWord = (deg: number) => COMPASS_8[Math.round(deg / 45) % 8]

/**
 * Parse a degrees-minutes-seconds coordinate into decimal (lat, lng).
 * Accepts the common Google Maps / GPS forms, e.g.
 *   33°52'52.1"N 117°53'04.0"W
 *   33 52 52.1 N, 117 53 04.0 W
 * Longitude with a W (or S latitude) hemisphere is negated.
 */
export function parseDMS(input: string): LatLng {
  const parts = [...input.matchAll(/(\d+(?:\.\d+)?)[^\d.NSEW]+(\d+(?:\.\d+)?)[^\d.NSEW]+(\d+(?:\.\d+)?)[^\dNSEW]*([NSEW])/gi)]
  if (parts.length !== 2) throw new Error(`Could not parse DMS coordinate: "${input}"`)

  const toDecimal = (m: RegExpMatchArray) => {
    const value = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600
    const hemi = m[4].toUpperCase()
    return hemi === 'S' || hemi === 'W' ? -value : value
  }

  const decimals = parts.map(toDecimal)
  const latPart = parts.findIndex((m) => /[NS]/i.test(m[4]))
  if (latPart === -1) throw new Error(`No latitude hemisphere (N/S) in: "${input}"`)
  return { lat: decimals[latPart], lng: decimals[1 - latPart] }
}

/** Convenience: DMS string straight to map pixel space. */
export function dmsToPixel(input: string): Pixel {
  return geoToPixel(parseDMS(input))
}
