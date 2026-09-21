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
