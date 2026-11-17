import { describe, expect, it } from 'vitest'
import { isOpenNow } from './openingHours'

const at = (iso: string) => new Date(iso) // local time, 2026-11-16 is a Monday

describe('isOpenNow', () => {
  it('reads weekday rules and off days', () => {
    const h = 'Mo-Sa 08:00-22:00; Su off'
    expect(isOpenNow(h, at('2026-11-16T12:00:00'))).toBe(true)
    expect(isOpenNow(h, at('2026-11-16T23:00:00'))).toBe(false)
    expect(isOpenNow(h, at('2026-11-15T12:00:00'))).toBe(false)
  })

  it('handles 24/7 and hours that run past midnight', () => {
    expect(isOpenNow('24/7', at('2026-11-16T03:00:00'))).toBe(true)
    expect(isOpenNow('Fr-Sa 10:00-01:00', at('2026-11-14T00:30:00'))).toBe(true)
  })

  it('returns null when hours are missing or unreadable', () => {
    expect(isOpenNow(undefined)).toBeNull()
    expect(isOpenNow('sunrise-sunset')).toBeNull()
  })
})
