import { describe, expect, it } from 'vitest'
import { readShareState, shareHref } from './share'

const ids = new Set(['bldg-cs', 'bldg-pl'])

describe('readShareState', () => {
  it('reads known ids and the step-free flag', () => {
    expect(readShareState('?from=bldg-cs&to=bldg-pl&accessible=1', ids)).toEqual({
      from: 'bldg-cs',
      to: 'bldg-pl',
      accessible: true,
    })
  })

  it('drops unknown ids and anything but accessible=1', () => {
    expect(readShareState('?from=evil&to=bldg-pl&accessible=true', ids)).toEqual({
      from: null,
      to: 'bldg-pl',
      accessible: false,
    })
    expect(readShareState('', ids)).toEqual({ from: null, to: null, accessible: false })
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

  it('round-trips through readShareState', () => {
    const state = { from: 'bldg-cs', to: 'bldg-pl', accessible: true }
    expect(readShareState(new URL(shareHref('https://x.test/', state)).search, ids)).toEqual(state)
  })
})
