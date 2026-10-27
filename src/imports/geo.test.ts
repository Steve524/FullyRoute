import { describe, expect, it } from 'vitest'
import { bearingDeg, compassWord, distanceM, geoToPixel, parseDMS, pixelToGeo } from './geo'

describe('pixelToGeo', () => {
  it('inverts geoToPixel', () => {
    const p = { x: 1234.5, y: 6789.25 }
    const back = geoToPixel(pixelToGeo(p))
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })
})

describe('distance and bearing', () => {
  it('measures one minute of latitude as one nautical mile', () => {
    expect(distanceM({ lat: 33.88, lng: -117.88 }, { lat: 33.88 + 1 / 60, lng: -117.88 })).toBeCloseTo(1853, -1)
  })

  it('names compass directions', () => {
    const o = { lat: 33.88, lng: -117.88 }
    expect(compassWord(bearingDeg(o, { lat: 33.89, lng: -117.88 }))).toBe('north')
    expect(compassWord(bearingDeg(o, { lat: 33.88, lng: -117.87 }))).toBe('east')
    expect(compassWord(bearingDeg(o, { lat: 33.87, lng: -117.89 }))).toBe('southwest')
  })
})

describe('parseDMS', () => {
  it('parses Google Maps style coordinates', () => {
    const { lat, lng } = parseDMS(`33°52'52.1"N 117°53'04.0"W`)
    expect(lat).toBeCloseTo(33.881139, 5)
    expect(lng).toBeCloseTo(-117.884444, 5)
  })

  it('accepts longitude first', () => {
    expect(parseDMS('117 53 04.0 W, 33 52 52.1 N')).toEqual(parseDMS(`33°52'52.1"N 117°53'04.0"W`))
  })

  it('rejects malformed input', () => {
    expect(() => parseDMS('33.88, -117.88')).toThrow()
  })
})
