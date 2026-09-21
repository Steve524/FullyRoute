import type { RouteResult } from './routing'
import { walkMinutes } from './routing'

interface RouteStepsProps {
  route: RouteResult
  startName: string
  destName: string
}

const FEET_PER_METER = 3.28084

// Per-step distance: feet for short legs, yards once it gets long enough that
// feet would be unwieldy.
const fmtDistance = (m: number) => {
  const feet = m * FEET_PER_METER
  if (feet < 300) return `${Math.max(5, Math.round(feet / 5) * 5)} ft`
  return `${Math.round(feet / 3 / 10) * 10} yd`
}

// Trip total: yards, rolling over to miles for long walks.
const fmtTotal = (m: number) => {
  const feet = m * FEET_PER_METER
  if (feet >= 1584) return `${(feet / 5280).toFixed(1)} mi`
  return `${Math.round(feet / 3 / 10) * 10} yd`
}

export default function RouteSteps({ route, startName, destName }: RouteStepsProps) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink">Walking route</h2>
        <span className="font-mono text-xs text-ink-soft">
          {fmtTotal(route.totalMeters)} · ~{walkMinutes(route.totalMeters)} min
        </span>
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
            <span className="text-ink-soft"> at {startName}</span>
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
            <span className="text-ink-soft"> at {destName}</span>
          </p>
        </li>
      </ol>

      {route.unverified && (
        <p className="mt-3 rounded-lg bg-ground px-3 py-2 text-xs text-ink-soft">
          Route positions are estimated from the campus map and not yet verified in person.
        </p>
      )}
    </div>
  )
}
