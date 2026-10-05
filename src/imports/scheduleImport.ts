import type { Building, Day, ScheduleItem } from './types'

// Turns an uploaded schedule (.ics, .csv, or a Titan Online PDF) into ScheduleItems.
// Everything runs in the browser. Imported rows always start unconfirmed so the
// student reviews each location; a building is only filled in on a clear match.

export type ScheduleSource = 'ics' | 'csv' | 'pdf'
export type ImportedSchedule = { term: string; items: ScheduleItem[]; warnings: string[] }

/** A problem worth showing to the student as-is. */
export class ScheduleImportError extends Error {}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const ACCEPTED_UPLOADS = '.pdf,.ics,.csv,application/pdf,text/calendar,text/csv'
const MAX_ITEMS = 60

export const CSV_TEMPLATE = [
  'Course,Title,Component,Section,Class Nbr,Days,Start,End,Location,Start Date,End Date',
  'CPSC 362,Software Engineering,Lecture,01,10001,MoWe,9:00 AM,10:15 AM,EC 063 - Lecture Room,2026-08-22,2026-12-11',
  'PHYS 225,General Physics,Lab,01L,10005,Fr,12:00 PM,2:45 PM,MH 452 - Laboratory,2026-08-22,2026-12-11',
  'CPSC 335,Algorithm Engineering,Lecture,03,10006,Mo,7:00 PM,9:45 PM,Online,2026-08-22,2026-12-11',
  '',
].join('\r\n')

const DAY_ORDER: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')

// Longest first so "Th" wins over "T" and "Sa" over "S".
const DAY_ALIASES = (
  [
    ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
    ['tues', 'Tue'], ['weds', 'Wed'], ['thurs', 'Thu'], ['thur', 'Thu'],
    ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
    ['mo', 'Mon'], ['tu', 'Tue'], ['we', 'Wed'], ['th', 'Thu'], ['fr', 'Fri'], ['sa', 'Sat'], ['su', 'Sun'],
    ['m', 'Mon'], ['t', 'Tue'], ['w', 'Wed'], ['r', 'Thu'], ['f', 'Fri'], ['s', 'Sat'], ['u', 'Sun'],
  ] as [string, Day][]
).sort((a, b) => b[0].length - a[0].length)

/** "MoWe", "MWF", "TTh", "Tue/Thu" → days; [] for TBA/online; null when unreadable. */
export function parseDays(text: string): Day[] | null {
  let s = text.toLowerCase().replace(/\band\b|[\s,/&.+-]/g, '')
  if (!s || /^(tba|tbd|arr|arranged|none|online)$/.test(s)) return []
  const found = new Set<Day>()
  while (s) {
    const hit = DAY_ALIASES.find(([alias]) => s.startsWith(alias))
    if (!hit) return null
    found.add(hit[1])
    s = s.slice(hit[0].length)
  }
  return DAY_ORDER.filter((d) => found.has(d))
}

/** "9:00 AM", "9am", "21:45" → "HH:MM" (24h); null when unreadable. */
export function parseTime(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?\s*$/i.exec(text)
  if (!m || (!m[2] && !m[3])) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.toLowerCase()
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null
  if (ap === 'p' && h < 12) h += 12
  if (ap === 'a' && h === 12) h = 0
  return `${pad(h)}:${pad(min)}`
}

/** "2026-08-22", "08/22/2026", "8/22/26" → ISO date; null when unreadable. */
export function parseDate(text: string): string | null {
  const t = text.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  const [y, mo, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : us
      ? [us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]), Number(us[1]), Number(us[2])]
      : [0, 0, 0]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** CSUF terms by start month. */
export function termFor(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Imported schedule'
  const [y, mo] = isoDate.split('-').map(Number)
  return `${mo === 1 ? 'Winter' : mo <= 5 ? 'Spring' : mo <= 7 ? 'Summer' : 'Fall'} ${y}`
}

const COURSE_RE = /\b([A-Z]{2,5})\s?-?\s?(\d{3}[A-Z]{0,2})\b/
const COMPONENTS: [RegExp, string][] = [
  [/\b(lec|lecture)\b/i, 'Lecture'],
  [/\b(lab|laboratory)\b/i, 'Lab'],
  [/\b(dis|disc|discussion)\b/i, 'Discussion'],
  [/\b(sem|seminar)\b/i, 'Seminar'],
  [/\b(act|activity)\b/i, 'Activity'],
  [/\b(sup|supervision)\b/i, 'Supervision'],
  [/\b(ind|independent study)\b/i, 'Independent Study'],
  [/\b(cln|clinical)\b/i, 'Clinical'],
  [/\b(fld|fieldwork)\b/i, 'Fieldwork'],
]
const componentOf = (text: string) => COMPONENTS.find(([re]) => re.test(text))?.[1] ?? null

const REMOTE_RE = /^(online|web|virtual|zoom|tba|tbd|arr|arranged|to be announced|asynchronous|synchronous)\b/i
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

type LocationMatch = Pick<ScheduleItem, 'buildingId' | 'buildingCode' | 'roomNumber' | 'roomDesc' | 'confidence'>

/** Matches a printed location ("EC 063 - Lecture Room", "Langsdorf Hall 315") to one campus place, or none. */
export function matchLocation(raw: string, places: Building[]): LocationMatch {
  const none: LocationMatch = { buildingId: null, buildingCode: null, roomNumber: null, roomDesc: null, confidence: 0.3 }
  const text = raw.trim()
  if (!text) return none
  if (REMOTE_RE.test(text)) return { ...none, confidence: 0.9 }

  const [head, ...rest] = text.split(/\s+[-–]\s+/)
  const roomDesc = rest.join(' - ') || null

  const coded = /^([A-Za-z]{1,5})[\s-]*(\d{1,4}[A-Za-z]{0,2})$/.exec(head)
  if (coded) {
    const code = coded[1].toUpperCase()
    const hits = places.filter((p) => p.code?.toUpperCase() === code)
    const place = hits.length === 1 ? hits[0] : null
    return { buildingId: place?.id ?? null, buildingCode: code, roomNumber: coded[2].toUpperCase(), roomDesc, confidence: place ? 0.9 : 0.4 }
  }

  const named = /^(.*?)[\s,-]+(?:room\s*)?(\d{1,4}[A-Za-z]{0,2})$/i.exec(head)
  const name = norm(named ? named[1] : head)
  if (name.length < 4) return { ...none, roomDesc }
  const exact = places.filter((p) => norm(p.name) === name)
  const loose = exact.length ? exact : places.filter((p) => norm(p.name).length >= 4 && (name.includes(norm(p.name)) || norm(p.name).includes(name)))
  const place = loose.length === 1 ? loose[0] : null
  return {
    buildingId: place?.id ?? null,
    buildingCode: place?.code ?? null,
    roomNumber: named ? named[2].toUpperCase() : null,
    roomDesc,
    confidence: place ? (exact.length ? 0.8 : 0.6) : 0.3,
  }
}

type Draft = Omit<ScheduleItem, 'id' | 'buildingId' | 'buildingCode' | 'roomNumber' | 'roomDesc' | 'roomId' | 'confidence' | 'confirmed'>

function finish(drafts: Draft[], places: Building[], warnings: string[], term?: string | null): ImportedSchedule {
  const seen = new Set<string>()
  const unique = drafts.filter((d) => {
    const key = `${d.courseLabel}|${d.component}|${d.days.join()}|${d.startTime}|${d.locationRaw}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length > MAX_ITEMS) warnings.push(`Only the first ${MAX_ITEMS} classes were kept.`)
  const items = unique.slice(0, MAX_ITEMS).map<ScheduleItem>((d, i) => ({
    id: `imp-${i + 1}`,
    ...d,
    ...matchLocation(d.locationRaw, places),
    roomId: null,
    confirmed: false,
  }))
  return { term: term ?? termFor(items.find((i) => i.startDate)?.startDate), items, warnings }
}

// ---- .ics (Google Calendar, Outlook, Apple Calendar exports) ----

type IcsProp = { params: string; value: string }
const ICS_DAYS: Record<string, Day> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }
const unescapeIcs = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

function icsMoment(prop: IcsProp | undefined) {
  const m = prop && /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/.exec(prop.value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (m[4] === undefined) return { date: `${y}-${pad(mo)}-${pad(d)}`, time: null, day: null }
  // UTC times are shown in the browser's zone; floating and TZID times are taken as written.
  const at = m[6] ? new Date(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]))) : null
  const date = at ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : `${y}-${pad(mo)}-${pad(d)}`
  const time = at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : `${m[4]}:${m[5]}`
  const weekday = at ? at.getDay() : new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return { date, time, day: DAY_ORDER[(weekday + 6) % 7] }
}

export function parseIcs(text: string, places: Building[]): ImportedSchedule {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new ScheduleImportError("That doesn't look like a calendar (.ics) file.")
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events: Record<string, IcsProp>[] = []
  let current: Record<string, IcsProp> | null = null
  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT') current = {}
    else if (upper === 'END:VEVENT') {
      if (current) events.push(current)
      current = null
    } else if (current) {
      const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line)
      if (m && !(m[1].toUpperCase() in current)) current[m[1].toUpperCase()] = { params: m[2], value: m[3] }
    }
  }

  const live = events.filter((e) => !e['RECURRENCE-ID'] && e.STATUS?.value.trim().toUpperCase() !== 'CANCELLED')
  const weekly = (e: Record<string, IcsProp>) => /FREQ=WEEKLY/i.test(e.RRULE?.value ?? '')
  const hasCourse = (e: Record<string, IcsProp>) => COURSE_RE.test(unescapeIcs(e.SUMMARY?.value ?? ''))
  // Personal calendars hold more than classes: prefer events named like courses.
  const picked = live.some(hasCourse) ? live.filter(hasCourse) : live.filter(weekly)
  const warnings: string[] = []

  const drafts = picked.flatMap<Draft>((e) => {
    const start = icsMoment(e.DTSTART)
    const end = icsMoment(e.DTEND)
    if (!start?.time) return []
    const rule = Object.fromEntries((e.RRULE?.value ?? '').split(';').map((p) => p.split('=') as [string, string]))
    const byDay = (rule.BYDAY ?? '').split(',').map((d: string) => ICS_DAYS[d.replace(/^[+-]?\d+/, '').toUpperCase()]).filter(Boolean)
    const days = DAY_ORDER.filter((d) => (byDay.length ? byDay : [start.day]).includes(d))
    const until = rule.UNTIL ? icsMoment({ params: '', value: rule.UNTIL.slice(0, 8) }) : null
    const summary = unescapeIcs(e.SUMMARY?.value ?? '')
    const description = unescapeIcs(e.DESCRIPTION?.value ?? '')
    const course = COURSE_RE.exec(summary)
    const title = course
      ? summary.replace(course[0], '').replace(/\((?:lec|lecture|lab|laboratory|dis|discussion|sem|seminar)\)/i, '').replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '')
      : ''
    return [
      {
        courseLabel: course ? `${course[1]} ${course[2]}` : summary || 'Untitled event',
        courseTitle: title,
        section: /\bsection[:#\s]+(\w+)/i.exec(description)?.[1] ?? '',
        classNbr: /\bclass\s*(?:nbr|number|#)[:#\s]*(\d+)/i.exec(description)?.[1] ?? '',
        component: componentOf(summary) ?? componentOf(description) ?? 'Class',
        startDate: start.date,
        endDate: until?.date ?? end?.date ?? start.date,
        days,
        startTime: start.time,
        endTime: end?.time ?? null,
        locationRaw: unescapeIcs(e.LOCATION?.value ?? ''),
      },
    ]
  })
  const skipped = picked.length - drafts.length
  if (skipped > 0) warnings.push(`Skipped ${skipped} all-day ${skipped === 1 ? 'event' : 'events'}.`)
  if (!drafts.length) throw new ScheduleImportError("We couldn't find any classes in that calendar file.")
  return finish(drafts, places, warnings)
}

// ---- .csv (our template, or a spreadsheet with similar headers) ----

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') field += src[++i]
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows.filter((r) => r.some((f) => f.trim()))
}

const CSV_COLUMNS = {
  course: ['course', 'class', 'course code', 'subject'],
  title: ['title', 'course title', 'description'],
  component: ['component', 'type'],
  section: ['section', 'sec'],
  classNbr: ['class nbr', 'class number', 'class #', 'nbr'],
  days: ['days', 'day', 'meeting days', 'days & times', 'days and times'],
  start: ['start', 'start time', 'begins'],
  end: ['end', 'end time', 'ends'],
  location: ['location', 'room', 'where'],
  startDate: ['start date', 'first day'],
  endDate: ['end date', 'last day'],
} as const

const TIME_TEXT = String.raw`\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?`
const DAYS_AND_TIMES_RE = new RegExp(String.raw`^(.*?)\s*(${TIME_TEXT})\s*(?:-|–|to)\s*(${TIME_TEXT})$`, 'i')

export function parseCsv(text: string, places: Building[]): ImportedSchedule {
  const [header, ...rows] = parseCsvRows(text)
  const names = (header ?? []).map((h) => h.trim().toLowerCase())
  const col = Object.fromEntries(
    Object.entries(CSV_COLUMNS).map(([key, aliases]) => [key, names.findIndex((n) => (aliases as readonly string[]).includes(n))]),
  ) as Record<keyof typeof CSV_COLUMNS, number>
  if (col.course < 0 || col.days < 0 || col.location < 0) {
    throw new ScheduleImportError('The CSV needs Course, Days and Location columns. Download the template to see the format.')
  }

  const warnings: string[] = []
  const drafts = rows.map<Draft>((r, i) => {
    const cell = (k: keyof typeof CSV_COLUMNS) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '')
    const line = i + 2
    // "MoWe 10:00AM - 11:15AM" in the Days column carries the times too.
    const combined = DAYS_AND_TIMES_RE.exec(cell('days'))
    const daysText = combined ? combined[1] : cell('days')
    const startText = combined ? combined[2] : cell('start')
    const endText = combined ? combined[3] : cell('end')

    const days = parseDays(daysText)
    if (days === null) warnings.push(`Row ${line}: couldn't read the days "${daysText}".`)
    const time = (t: string, label: string) => {
      const out = t ? parseTime(t) : null
      if (t && !out && !/^(tba|tbd|arr)/i.test(t)) warnings.push(`Row ${line}: couldn't read the ${label} time "${t}".`)
      return out
    }
    const course = COURSE_RE.exec(cell('course'))
    return {
      courseLabel: course ? `${course[1]} ${course[2]}` : cell('course') || `Row ${line}`,
      courseTitle: cell('title'),
      section: cell('section'),
      classNbr: cell('classNbr'),
      component: componentOf(cell('component')) ?? (cell('component') || 'Class'),
      startDate: parseDate(cell('startDate')) ?? '',
      endDate: parseDate(cell('endDate')) ?? '',
      days: days ?? [],
      startTime: time(startText, 'start'),
      endTime: time(endText, 'end'),
      locationRaw: cell('location'),
    }
  })
  if (!drafts.length) throw new ScheduleImportError('That CSV has a header but no classes.')
  return finish(drafts, places, warnings)
}

// ---- Titan Online "My Class Schedule" (list view) saved as PDF ----

const COMPONENT_WORDS = 'Lecture|Laboratory|Lab|Discussion|Seminar|Activity|Supervision|Independent Study|Clinical|Fieldwork|LEC|LAB|DIS|SEM|ACT|SUP'
const TITAN_HEADER_RE = /^([A-Z]{2,5})\s+(\d{3}[A-Z]{0,2})\s+-\s+(.+)$/
const TITAN_TIME = String.raw`\d{1,2}:\d{2}\s*[AP]M`
const TITAN_MEETING_RE = new RegExp(
  String.raw`\b((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(${TITAN_TIME})\s*-\s*(${TITAN_TIME})|(?<=\b(?:${COMPONENT_WORDS})\s+)TBA\b`,
  'g',
)
const TITAN_PREFIX_RE = new RegExp(String.raw`(\d{4,5})\s+([0-9A-Z]{1,4})\s+(${COMPONENT_WORDS})\s*$`)
const TITAN_DATES_RE = /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/

/** The room is printed before the instructor in the same column run; keep only the room-like start. */
function titanRoom(text: string) {
  const t = text.trim()
  const m =
    /^(?:online|web|tba|arranged|arr)\b/i.exec(t) ??
    /^[A-Z]{1,5}[\s-]?\d{1,4}[A-Z]{0,2}\b/.exec(t) ??
    /^(?:[A-Z][A-Za-z.&']+\s+){1,5}\d{1,4}[A-Z]{0,2}\b/.exec(t)
  return (m ? m[0] : t).trim().slice(0, 80)
}

export function parseTitanText(lines: string[], places: Building[]): ImportedSchedule {
  const blocks: { label: string; title: string; text: string }[] = []
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    const header = TITAN_HEADER_RE.exec(line)
    if (header) blocks.push({ label: `${header[1]} ${header[2]}`, title: header[3].trim(), text: '' })
    else if (blocks.length) blocks[blocks.length - 1].text += ` ${line}`
  }

  const warnings: string[] = []
  const drafts: Draft[] = []
  for (const block of blocks) {
    if (/\b(Dropped|Withdrawn)\b/.test(block.text)) {
      warnings.push(`Skipped ${block.label} because it's marked dropped.`)
      continue
    }
    const anchors = [...block.text.matchAll(TITAN_MEETING_RE)]
    let last = { classNbr: '', section: '', component: 'Class' }
    anchors.forEach((a, k) => {
      const before = block.text.slice(k ? anchors[k - 1].index! + anchors[k - 1][0].length : 0, a.index)
      const prefix = TITAN_PREFIX_RE.exec(before)
      if (prefix) last = { classNbr: prefix[1], section: prefix[2], component: componentOf(prefix[3]) ?? prefix[3] }

      let tail = block.text.slice(a.index! + a[0].length, anchors[k + 1]?.index ?? block.text.length)
      tail = tail.replace(TITAN_PREFIX_RE, '')
      const dates = TITAN_DATES_RE.exec(tail)
      if (dates) tail = tail.slice(0, dates.index)

      drafts.push({
        courseLabel: block.label,
        courseTitle: block.title,
        ...last,
        startDate: dates ? (parseDate(dates[1]) ?? '') : '',
        endDate: dates ? (parseDate(dates[2]) ?? '') : '',
        days: a[1] ? (parseDays(a[1]) ?? []) : [],
        startTime: a[2] ? parseTime(a[2]) : null,
        endTime: a[3] ? parseTime(a[3]) : null,
        locationRaw: titanRoom(tail),
      })
    })
  }

  if (!drafts.length) {
    throw new ScheduleImportError(
      "We couldn't find any classes in that PDF. Save Titan Online's “My Class Schedule” list view as a PDF, or upload a .csv or .ics file instead.",
    )
  }
  const term = /\b(Spring|Summer|Fall|Winter)\s+(20\d{2})\b/.exec(lines.join(' '))
  return finish(drafts, places, warnings, term ? `${term[1]} ${term[2]}` : null)
}

export async function importScheduleFile(file: File, places: Building[]): Promise<ImportedSchedule & { source: ScheduleSource }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ScheduleImportError('That file is over 5 MB. Schedules are usually much smaller.')
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'ics') return { source: 'ics', ...parseIcs(await file.text(), places) }
  if (ext === 'csv') return { source: 'csv', ...parseCsv(await file.text(), places) }
  if (ext === 'pdf') {
    const { pdfLines } = await import('./pdfText')
    let lines: string[]
    try {
      lines = await pdfLines(await file.arrayBuffer())
    } catch {
      throw new ScheduleImportError("We couldn't open that PDF. If it's password-protected, save an unprotected copy.")
    }
    return { source: 'pdf', ...parseTitanText(lines, places) }
  }
  throw new ScheduleImportError('Choose a .pdf, .ics or .csv file.')
}
