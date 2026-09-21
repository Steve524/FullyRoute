import { useEffect, useMemo, useRef, useState } from 'react'
import type { Building } from './types'

interface BuildingPickerProps {
  label: string
  placeholder: string
  options: Building[]
  value: string | null // building id, never code
  onChange: (id: string | null) => void
  accent: 'start' | 'destination'
  // Ids that have a node on the walking graph. Others are shown but disabled,
  // since a route can't currently start or end there.
  routableIds: ReadonlySet<string>
}

/**
 * Searchable dropdown. Search matches on building name or code.
 * The option value is always the building `id`.
 */
export default function BuildingPicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  accent,
  routableIds = new Set<string>(),
}: BuildingPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => options.find((b) => b.id === value) ?? null,
    [options, value],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = !q
      ? options
      : options.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            (b.code?.toLowerCase().includes(q) ?? false),
        )
    // Routable buildings first, then the rest — each group alphabetical.
    return [...matched].sort((a, b) => {
      const ra = routableIds.has(a.id) ? 0 : 1
      const rb = routableIds.has(b.id) ? 0 : 1
      return ra - rb || a.name.localeCompare(b.name)
    })
  }, [options, query, routableIds])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const dot = accent === 'start' ? 'bg-navy' : 'bg-titan'

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1.5 flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-wide text-ink-soft">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </label>

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setQuery('')
        }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-3 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-navy/40"
      >
        <span className={selected ? 'text-ink' : 'text-ink-soft'}>
          {selected ? (
            <span className="flex items-center gap-2">
              {selected.name}
              {selected.code && (
                <span className="rounded-md bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                  {selected.code}
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className={`shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or code…"
              className="w-full rounded-lg bg-ground px-3 py-2 text-sm outline-none placeholder:text-ink-soft/70"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {selected && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-ink-soft hover:bg-ground"
                >
                  Clear selection
                </button>
              </li>
            )}
            {results.length === 0 && (
              <li className="px-3.5 py-6 text-center text-sm text-ink-soft">No matches</li>
            )}
            {results.map((b) => {
              const routable = routableIds.has(b.id)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={!routable}
                    aria-disabled={!routable}
                    title={routable ? undefined : 'Not on the walking route map yet'}
                    onClick={() => {
                      if (!routable) return
                      onChange(b.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition ${
                      routable
                        ? `hover:bg-ground ${b.id === value ? 'bg-ground' : ''}`
                        : 'cursor-not-allowed opacity-45'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {b.name}
                      <span className="text-[11px] capitalize text-ink-soft">{b.kind}</span>
                    </span>
                    {routable ? (
                      b.code && (
                        <span className="rounded-md bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                          {b.code}
                        </span>
                      )
                    ) : (
                      <span className="shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-ink-soft">
                        Not on route map
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
