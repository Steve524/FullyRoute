import { useEffect, useState } from 'react'
import type { RouteResult, StepFreeGap } from './routing'
import { walkMinutes } from './routing'

const GAP_LABEL: Record<StepFreeGap, string> = {
  'start-door': 'the start entrance',
  'end-door': 'the arrival entrance',
  paths: 'the walkways',
}

interface RouteStepsProps {
  route: RouteResult
  startName: string
  destName: string
  shareUrl: string
  onOpenInterior?: () => void // set when the destination has a floor plan
}

// Door names carry "(approximate)"; the footer note already says that once.
const door = (label: string) => label.replace(/\s*\(approximate\)/i, '')

const FEET_PER_METER = 3.28084

// Per-step distance: feet for short legs, yards once it gets long enough that
// feet would be unwieldy.
export const fmtDistance = (m: number) => {
  const feet = m * FEET_PER_METER
  if (feet < 300) return `${Math.max(5, Math.round(feet / 5) * 5)} ft`
  return `${Math.round(feet / 3 / 10) * 10} yd`
}

// Trip total: yards, rolling over to miles for long walks.
export const fmtTotal = (m: number) => {
  const feet = m * FEET_PER_METER
  if (feet >= 1584) return `${(feet / 5280).toFixed(1)} mi`
  return `${Math.round(feet / 3 / 10) * 10} yd`
}

export default function RouteSteps({ route, startName, destName, shareUrl, onOpenInterior }: RouteStepsProps) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    setCopy('idle')
  }, [shareUrl])

  useEffect(() => {
    if (copy !== 'copied') return
    const t = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(t)
  }, [copy])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopy('copied')
    } catch {
      // Clipboard can be blocked (e.g. in an iframe preview); show the link to copy by hand.
      setCopy('failed')
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
          Walking route
          {route.stepFree && (
            <span className="rounded-full bg-navy px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-white">
              Step-free
            </span>
          )}
        </h2>
        <span className="font-mono text-xs text-ink-soft">
          {fmtTotal(route.totalMeters)} · ~{walkMinutes(route.totalMeters)} min
        </span>
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:border-navy/40 hover:bg-ground"
        >
          {copy === 'copied' ? 'Link copied' : 'Copy link'}
        </button>
        <span className="sr-only" aria-live="polite">
          {copy === 'copied' ? 'Route link copied to clipboard' : ''}
        </span>
        {copy === 'failed' && (
          <input
            readOnly
            value={shareUrl}
            aria-label="Route link"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-md bg-ground px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/30"
          />
        )}
      </div>

      <ol className="mt-3 space-y-0">
        {/* Origin */}
        <li className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1 h-3 w-3 rounded-full bg-navy" />
            <span className="w-px flex-1 bg-line" />
          </div>
          <p className="pb-4 text-sm">
            <span className="font-semibold text-ink">Start</span>
            <span className="text-ink-soft">
              {' '}at {startName}
              {route.startDoor && <span className="text-ink-soft/80"> · {door(route.startDoor)}</span>}
            </span>
          </p>
        </li>

        {route.steps.map((step, i) => (
          <li key={`${step.fromNodeId}-${step.toNodeId}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-ground font-mono text-[10px] font-semibold text-ink-soft">
                {i + 1}
              </span>
              <span className="w-px flex-1 bg-line" />
            </div>
            <p className="pb-4 text-sm">
              <span className="text-ink">{step.instruction}</span>
              <span className="ml-1.5 font-mono text-xs text-ink-soft">{fmtDistance(step.distanceM)}</span>
            </p>
          </li>
        ))}

        {/* Destination */}
        <li className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1 h-3 w-3 rotate-45 rounded-[2px] bg-titan" />
          </div>
          <p className="text-sm">
            <span className="font-semibold text-ink">Arrive</span>
            <span className="text-ink-soft">
              {' '}at {destName}
              {route.endDoor && <span className="text-ink-soft/80"> · {door(route.endDoor)}</span>}
            </span>
            {onOpenInterior && (
              <button
                type="button"
                onClick={onOpenInterior}
                className="mt-1.5 block rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:border-navy/40 hover:bg-ground"
              >
                Continue inside to a room →
              </button>
            )}
          </p>
        </li>
      </ol>

      {route.stepFree && !route.stepFreeConfirmed && (
        <p className="mt-3 rounded-lg bg-navy/5 px-3 py-2 text-xs text-ink-soft">
          Avoids every barrier on record, but not yet checked for steps:{' '}
          {(route.stepFreeUnchecked ?? ['paths']).map((g) => GAP_LABEL[g]).join(', ')}.
        </p>
      )}

      {route.unverified && (
        <p className="mt-3 rounded-lg bg-ground px-3 py-2 text-xs text-ink-soft">
          Route positions are estimated from the campus map and not yet verified in person.
        </p>
      )}
    </div>
  )
}
