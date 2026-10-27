import type { GoogleProfile } from './googleAuth'
import type { ScheduleItem } from './types'

// Schedules live in this browser's localStorage, one per Google account plus one for guests.
// Google's ID token is never stored; only the display name, email and account id.

export type SavedSchedule = {
  source: 'sample' | 'pdf' | 'ics' | 'csv'
  fileName: string | null
  savedAt: string
  term: string
  items: ScheduleItem[]
}

const ACCOUNT_KEY = 'fullyroute:account'
const scheduleKey = (account: GoogleProfile | null) => `fullyroute:schedule:${account ? `google-${account.sub}` : 'guest'}`

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked (private mode): the schedule just won't survive a reload.
  }
}

export function loadAccount(): GoogleProfile | null {
  const v = read(ACCOUNT_KEY) as Partial<GoogleProfile> | null
  return v && typeof v.sub === 'string' && typeof v.email === 'string' && typeof v.name === 'string'
    ? { sub: v.sub, email: v.email, name: v.name }
    : null
}

export const saveAccount = (account: GoogleProfile | null) => write(ACCOUNT_KEY, account)

export function loadSchedule(account: GoogleProfile | null): SavedSchedule | null {
  const v = read(scheduleKey(account)) as Partial<SavedSchedule> | null
  return v && Array.isArray(v.items) && typeof v.term === 'string' ? (v as SavedSchedule) : null
}

export const saveSchedule = (account: GoogleProfile | null, schedule: SavedSchedule | null) =>
  write(scheduleKey(account), schedule)
