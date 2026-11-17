// Small subset of the OpenStreetMap opening_hours syntax: "24/7" and rules like
// "Mo-Fr 08:00-17:00; Sa 09:00-12:00,13:00-15:00; Su off". Anything else is unknown.

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseDays(spec: string): Set<number> | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const [a, b] = part.trim().split('-')
    const from = DAYS.indexOf(a)
    const to = b === undefined ? from : DAYS.indexOf(b)
    if (from < 0 || to < 0) return null
    for (let d = from; ; d = (d + 1) % 7) {
      out.add(d)
      if (d === to) break
    }
  }
  return out
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

type Rule = { days: Set<number>; ranges: [number, number][] }

function parse(hours: string): Rule[] | null {
  if (hours.trim() === '24/7') return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), ranges: [[0, 1440]] }]
  const rules: Rule[] = []
  for (const raw of hours.split(';')) {
    const m = raw.trim().match(/^(?:([A-Za-z,-]+)\s+)?(off|\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\d{1,2}:\d{2}-\d{1,2}:\d{2})*)$/)
    if (!m) return null
    const days = m[1] ? parseDays(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6])
    if (!days) return null
    const ranges: [number, number][] = m[2] === 'off' ? [] : m[2].split(',').map((r) => {
      const [s, e] = r.split('-')
      return [toMin(s), toMin(e)]
    })
    // A later rule replaces earlier ones for the days it names.
    for (const prev of rules) for (const d of days) prev.days.delete(d)
    rules.push({ days, ranges })
  }
  return rules
}

/** true/false when the hours can be read, null when unknown. */
export function isOpenNow(hours: string | undefined, now = new Date()): boolean | null {
  if (!hours) return null
  const rules = parse(hours)
  if (!rules) return null
  const day = now.getDay()
  const min = now.getHours() * 60 + now.getMinutes()
  for (const r of rules) {
    for (const [s, e] of r.ranges) {
      const overnight = e <= s
      if (r.days.has(day) && min >= s && (overnight || min < e)) return true
      if (overnight && r.days.has((day + 6) % 7) && min < e) return true
    }
  }
  return false
}
