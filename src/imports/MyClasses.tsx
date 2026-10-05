import { useRef, useState, type DragEvent } from 'react'
import scheduleData from './schedule.json'
import type { Building, ScheduleFile, ScheduleItem } from './types'
import SchedulePanel from './SchedulePanel'
import GoogleSignInButton from './GoogleSignInButton'
import { signOutGoogle, type GoogleProfile } from './googleAuth'
import { ACCEPTED_UPLOADS, CSV_TEMPLATE, importScheduleFile, ScheduleImportError } from './scheduleImport'
import { loadAccount, loadSchedule, saveAccount, saveSchedule, type SavedSchedule } from './scheduleStore'

interface MyClassesProps {
  places: Building[] // routable, non-parking places a class can be assigned to
  onRoute: (buildingId: string) => void
}

const sample = scheduleData as ScheduleFile
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`

const sourceNote = (s: SavedSchedule) => (s.source === 'sample' ? 'Sample schedule.' : `From ${s.fileName ?? 'your file'}.`)

// Signing in or uploading a file unlocks the class list; nothing is required to use the rest of the app.
export default function MyClasses({ places, onRoute }: MyClassesProps) {
  const [account, setAccount] = useState(loadAccount)
  const [saved, setSaved] = useState(() => loadSchedule(loadAccount()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const store = (next: SavedSchedule | null) => {
    saveSchedule(account, next)
    setSaved(next)
  }

  const signIn = (profile: GoogleProfile) => {
    saveAccount(profile)
    setAccount(profile)
    // A schedule uploaded as a guest moves to the account if it has none yet.
    let mine = loadSchedule(profile)
    const guest = loadSchedule(null)
    if (!mine && guest) {
      saveSchedule(profile, guest)
      saveSchedule(null, null)
      mine = guest
    }
    setSaved(mine)
  }

  const signOut = () => {
    signOutGoogle()
    saveAccount(null)
    setAccount(null)
    setSaved(loadSchedule(null))
    setWarnings([])
  }

  const upload = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    setWarnings([])
    try {
      const result = await importScheduleFile(file, places)
      store({ source: result.source, fileName: file.name, savedAt: new Date().toISOString(), term: result.term, items: result.items })
      setWarnings(result.warnings)
    } catch (e) {
      setError(e instanceof ScheduleImportError ? e.message : "We couldn't read that file.")
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const loadSample = () => {
    setError(null)
    setWarnings([])
    store({ source: 'sample', fileName: null, savedAt: new Date().toISOString(), term: sample.term, items: sample.items })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void upload(e.dataTransfer.files[0])
  }

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPTED_UPLOADS}
      className="hidden"
      onChange={(e) => void upload(e.target.files?.[0])}
    />
  )

  const accountLine = account && (
    <p className="text-xs text-ink-soft">
      Signed in as <span className="font-medium text-ink">{account.name}</span>
      {account.name !== account.email && ` (${account.email})`} ·{' '}
      <button type="button" onClick={signOut} className="font-medium text-navy underline-offset-2 hover:underline">
        Sign out
      </button>
    </p>
  )

  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-titan/10 px-3 py-2 text-xs font-medium text-titan">
      {error}
    </p>
  )

  if (saved) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-3">
          {account ? accountLine : <GoogleSignInButton onSignIn={signIn} compact />}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-ground disabled:opacity-50"
            >
              {busy ? 'Reading…' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Remove this schedule from this device?')) return
                store(null)
                setWarnings([])
              }}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-ground"
            >
              Remove
            </button>
          </div>
          {picker}
        </div>
        {errorBox}
        {warnings.length > 0 && (
          <ul className="rounded-lg bg-ground px-3 py-2 text-xs text-ink-soft">
            {warnings.slice(0, 5).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {warnings.length > 5 && <li>…and {warnings.length - 5} more.</li>}
          </ul>
        )}
        <SchedulePanel
          term={saved.term}
          note={sourceNote(saved)}
          items={saved.items}
          places={places}
          onChange={(item: ScheduleItem) => store({ ...saved, items: saved.items.map((i) => (i.id === item.id ? item : i)) })}
          onRoute={onRoute}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
      <div>
        <h2 className="font-display text-base font-bold text-ink">My classes</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {account
            ? 'Upload your schedule to see where each class meets.'
            : 'Sign in to keep your classes with your Google account, or upload your schedule without an account.'}
        </p>
      </div>

      {account ? accountLine : <GoogleSignInButton onSignIn={signIn} />}

      {!account && (
        <div className="flex items-center gap-3 text-xs text-ink-soft" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
          dragging ? 'border-navy bg-navy/5' : 'border-line'
        }`}
      >
        <p className="text-sm font-semibold text-ink">Upload your schedule</p>
        <p className="mt-1 text-xs text-ink-soft">Titan Online “My Class Schedule” PDF, a calendar file (.ics), or a CSV</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="mt-3 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-navy/90 disabled:opacity-50"
        >
          {busy ? 'Reading file…' : 'Choose file'}
        </button>
        {picker}
      </div>

      {errorBox}

      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
        <a href={TEMPLATE_HREF} download="fullyroute-schedule-template.csv" className="font-medium text-navy underline-offset-2 hover:underline">
          Download CSV template
        </a>
        <button type="button" onClick={loadSample} className="font-medium text-navy underline-offset-2 hover:underline">
          Try a sample schedule
        </button>
      </p>

      <p className="text-center text-[11px] text-ink-soft">
        Files are read in your browser and saved only on this device. You'll review each class's building before routing.
      </p>
    </div>
  )
}
