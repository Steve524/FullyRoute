// A shared route is a stateless URL: ?from=<id>&to=<id>&accessible=1&room=CS-110. No personal data.
export interface ShareState {
  from: string | null
  to: string | null
  accessible: boolean
  room?: string | null // room text in the destination building; the caller checks it against `to`
}

const KEYS = ['from', 'to', 'accessible', 'room'] as const
const ROOM_TEXT = /^[A-Za-z0-9 -]{1,20}$/

// Unknown or unroutable ids are dropped rather than trusted.
export function readShareState(search: string, validIds: ReadonlySet<string>): ShareState {
  const q = new URLSearchParams(search)
  const id = (key: string) => {
    const v = q.get(key)
    return v && validIds.has(v) ? v : null
  }
  const to = id('to')
  const room = q.get('room')?.trim()
  return { from: id('from'), to, accessible: q.get('accessible') === '1', room: to && room && ROOM_TEXT.test(room) ? room : null }
}

// `href` with the route params replaced; any other params are kept.
export function shareHref(href: string, state: ShareState): string {
  const url = new URL(href)
  for (const k of KEYS) url.searchParams.delete(k)
  if (state.from) url.searchParams.set('from', state.from)
  if (state.to) url.searchParams.set('to', state.to)
  if (state.accessible) url.searchParams.set('accessible', '1')
  if (state.to && state.room) url.searchParams.set('room', state.room)
  return url.toString()
}
