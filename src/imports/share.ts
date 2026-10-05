// A shared route is a stateless URL: ?from=<id>&to=<id>&accessible=1. No personal data.
export interface ShareState {
  from: string | null
  to: string | null
  accessible: boolean
}

const KEYS = ['from', 'to', 'accessible'] as const

// Unknown or unroutable ids are dropped rather than trusted.
export function readShareState(search: string, validIds: ReadonlySet<string>): ShareState {
  const q = new URLSearchParams(search)
  const id = (key: string) => {
    const v = q.get(key)
    return v && validIds.has(v) ? v : null
  }
  return { from: id('from'), to: id('to'), accessible: q.get('accessible') === '1' }
}

// `href` with the route params replaced; any other params are kept.
export function shareHref(href: string, state: ShareState): string {
  const url = new URL(href)
  for (const k of KEYS) url.searchParams.delete(k)
  if (state.from) url.searchParams.set('from', state.from)
  if (state.to) url.searchParams.set('to', state.to)
  if (state.accessible) url.searchParams.set('accessible', '1')
  return url.toString()
}
