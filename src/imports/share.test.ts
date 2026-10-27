import { describe, expect, it } from 'vitest'
import { readShareState, shareHref } from './share'

const ids = new Set(['bldg-cs', 'bldg-pl'])

describe('readShareState', () => {
  it('reads known ids and the step-free flag', () => {
    expect(readShareState('?from=bldg-cs&to=bldg-pl&accessible=1', ids)).toEqual({
      from: 'bldg-cs',
      to: 'bldg-pl',
      accessible: true,
      room: null,
    })
  })

  it('drops unknown ids and anything but accessible=1', () => {
    expect(readShareState('?from=evil&to=bldg-pl&accessible=true', ids)).toEqual({
      from: null,
      to: 'bldg-pl',
      accessible: false,
      room: null,
    })
    expect(readShareState('', ids)).toEqual({ from: null, to: null, accessible: false, room: null })
  })
})

describe('shareHref', () => {
  it('writes only the set params and keeps unrelated ones', () => {
    const href = shareHref('https://x.test/app?lang=en&from=old&accessible=1', {
      from: null,
      to: 'bldg-pl',
      accessible: false,
    })
    const q = new URL(href).searchParams
    expect(q.get('lang')).toBe('en')
    expect(q.has('from')).toBe(false)
    expect(q.get('to')).toBe('bldg-pl')
    expect(q.has('accessible')).toBe(false)
  })

  it('round-trips through readShareState without a room', () => {
    const state = { from: 'bldg-cs', to: 'bldg-pl', accessible: true }
    expect(readShareState(new URL(shareHref('https://x.test/', state)).search, ids)).toEqual({ ...state, room: null })
  })

  it('round-trips a room', () => {
    for (const room of ['CS-110', 'MH 602']) {
      const state = { from: 'bldg-pl', to: 'bldg-cs', accessible: false, room }
      const href = shareHref('https://x.test/', state)
      expect(new URL(href).searchParams.get('room')).toBe(room)
      expect(readShareState(new URL(href).search, ids)).toEqual(state)
    }
  })

  it('drops a room without a destination, and odd room text', () => {
    expect(new URL(shareHref('https://x.test/', { from: 'bldg-cs', to: null, accessible: false, room: 'CS-110' })).searchParams.has('room')).toBe(false)
    expect(readShareState('?to=evil&room=CS-110', ids).room).toBeNull()
    expect(readShareState('?to=bldg-cs&room=%3Cscript%3E', ids).room).toBeNull()
    expect(readShareState('?to=bldg-cs&room=CS-110&from=bldg-pl', ids)).toEqual({ from: 'bldg-pl', to: 'bldg-cs', accessible: false, room: 'CS-110' })
  })
})
