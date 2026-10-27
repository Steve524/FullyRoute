import { describe, expect, it } from 'vitest'
import buildingsData from './buildings.json'
import type { Building } from './types'
import { CSV_TEMPLATE, matchLocation, parseCsv, parseDays, parseIcs, parseTime, parseTitanText, ScheduleImportError } from './scheduleImport'
import { profileFromCredential } from './googleAuth'

const places = (buildingsData as Building[]).filter((b) => b.kind !== 'parking')

describe('field parsers', () => {
  it('reads common day formats', () => {
    expect(parseDays('MoWe')).toEqual(['Mon', 'Wed'])
    expect(parseDays('MWF')).toEqual(['Mon', 'Wed', 'Fri'])
    expect(parseDays('TTh')).toEqual(['Tue', 'Thu'])
    expect(parseDays('TR')).toEqual(['Tue', 'Thu'])
    expect(parseDays('Tue/Thu')).toEqual(['Tue', 'Thu'])
    expect(parseDays('TBA')).toEqual([])
    expect(parseDays('xyz')).toBeNull()
  })

  it('reads 12h and 24h times', () => {
    expect(parseTime('9:00 AM')).toBe('09:00')
    expect(parseTime('12:15pm')).toBe('12:15')
    expect(parseTime('12:00 AM')).toBe('00:00')
    expect(parseTime('21:45')).toBe('21:45')
    expect(parseTime('9')).toBeNull()
  })

  it('matches locations by code or name and keeps room numbers as strings', () => {
    expect(matchLocation('EC 063 - Lecture Room', places)).toMatchObject({ buildingId: 'bldg-ec', roomNumber: '063', roomDesc: 'Lecture Room' })
    expect(matchLocation('Langsdorf Hall 315', places)).toMatchObject({ buildingId: 'bldg-lh', roomNumber: '315' })
    expect(matchLocation('ZZ 101', places)).toMatchObject({ buildingId: null, buildingCode: 'ZZ' })
    expect(matchLocation('Online', places).buildingId).toBeNull()
  })
})

describe('CSV import', () => {
  it('reads the template and leaves every row for review', () => {
    const { items, warnings } = parseCsv(CSV_TEMPLATE, places)
    expect(warnings).toEqual([])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ courseLabel: 'CPSC 362', days: ['Mon', 'Wed'], startTime: '09:00', endTime: '10:15', buildingId: 'bldg-ec', roomNumber: '063' })
    expect(items[2].buildingId).toBeNull()
    expect(items.every((i) => !i.confirmed)).toBe(true)
  })

  it('handles quoted fields and a combined Days & Times column', () => {
    const csv = 'Course,Title,Days & Times,Room\r\n"MATH 150A","Calculus, I",MoWe 10:00AM - 11:15AM,MH 110\r\n'
    const [item] = parseCsv(csv, places).items
    expect(item).toMatchObject({ courseLabel: 'MATH 150A', courseTitle: 'Calculus, I', days: ['Mon', 'Wed'], startTime: '10:00', endTime: '11:15', buildingId: 'bldg-mh' })
  })

  it('explains missing columns', () => {
    expect(() => parseCsv('Name,Time\nx,y', places)).toThrow(ScheduleImportError)
  })
})

describe('calendar import', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'SUMMARY:CPSC 362 - Software Engineering (Lecture)',
    'DTSTART;TZID=America/Los_Angeles:20260824T090000',
    'DTEND;TZID=America/Los_Angeles:20260824T101500',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261211T075959Z',
    'LOCATION:EC 063 - Lec',
    ' ture Room',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Dentist',
    'DTSTART:20260901T170000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('keeps course events and reads weekly rules', () => {
    const { items, term } = parseIcs(ics, places)
    expect(term).toBe('Fall 2026')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      courseLabel: 'CPSC 362',
      courseTitle: 'Software Engineering',
      component: 'Lecture',
      days: ['Mon', 'Wed'],
      startTime: '09:00',
      endTime: '10:15',
      endDate: '2026-12-11',
      locationRaw: 'EC 063 - Lecture Room',
      buildingId: 'bldg-ec',
      confirmed: false,
    })
  })

  it('rejects files that are not calendars', () => {
    expect(() => parseIcs('hello', places)).toThrow(ScheduleImportError)
  })
})

describe('Titan Online PDF text', () => {
  const lines = [
    'Fall 2026 | Undergraduate | California State University, Fullerton',
    'CPSC 362 - Foundations of Software Engineering',
    'Status Units Grading Grade Deadlines',
    'Enrolled 3.00 Graded',
    'Class Nbr Section Component Days & Times Room Instructor Start/End Date',
    '12345 01 Lecture MoWe 10:00AM - 11:15AM EC 063 Staff 08/24/2026 - 12/12/2026',
    'PHYS 225 - General Physics',
    'Enrolled 4.00 Graded',
    '20001 01 Lecture TuTh 9:30AM - 10:45AM Langsdorf Hall 315 J. Doe 08/24/2026 - 12/12/2026',
    '20002 01L Laboratory Fr 12:00PM -',
    '2:45PM MH 452 J. Doe 08/24/2026 - 12/12/2026',
    'CPSC 335 - Algorithm Engineering',
    '30001 03 Lecture TBA Online Staff 08/24/2026 - 12/12/2026',
    'HIST 110 - World History',
    'Dropped 3.00 Graded',
    '40001 07 Lecture Fr 9:00AM - 11:45AM ZZ 101 Staff 08/24/2026 - 12/12/2026',
  ]

  it('reads each meeting, including wrapped rows and TBA', () => {
    const { term, items, warnings } = parseTitanText(lines, places)
    expect(term).toBe('Fall 2026')
    expect(items.map((i) => [i.courseLabel, i.component, i.days.join(), i.startTime, i.locationRaw, i.buildingId])).toEqual([
      ['CPSC 362', 'Lecture', 'Mon,Wed', '10:00', 'EC 063', 'bldg-ec'],
      ['PHYS 225', 'Lecture', 'Tue,Thu', '09:30', 'Langsdorf Hall 315', 'bldg-lh'],
      ['PHYS 225', 'Lab', 'Fri', '12:00', 'MH 452', 'bldg-mh'],
      ['CPSC 335', 'Lecture', '', null, 'Online', null],
    ])
    expect(items[2]).toMatchObject({ classNbr: '20002', section: '01L', endTime: '14:45', startDate: '2026-08-24', endDate: '2026-12-12' })
    expect(warnings).toEqual(['Skipped HIST 110 because it\'s marked dropped.'])
  })

  it('explains when nothing looks like a schedule', () => {
    expect(() => parseTitanText(['Just some text'], places)).toThrow(ScheduleImportError)
  })
})

describe('Google sign-in profile', () => {
  const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
  const now = Date.UTC(2026, 9, 4)
  const good = { aud: 'client-1', iss: 'https://accounts.google.com', exp: now / 1000 + 600, sub: '42', email: 'tuffy@csu.fullerton.edu', name: 'Tuffy Titan' }

  it('reads name and email from a token meant for this app', () => {
    expect(profileFromCredential(token(good), 'client-1', now)).toEqual({ sub: '42', email: 'tuffy@csu.fullerton.edu', name: 'Tuffy Titan' })
  })

  it('rejects tokens for another app, expired tokens and junk', () => {
    expect(profileFromCredential(token(good), 'client-2', now)).toBeNull()
    expect(profileFromCredential(token({ ...good, exp: now / 1000 - 1 }), 'client-1', now)).toBeNull()
    expect(profileFromCredential('not-a-token', 'client-1', now)).toBeNull()
  })
})
