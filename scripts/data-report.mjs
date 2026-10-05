// Data health report: cross-file problems, then how each place's route doors are sourced.
// Run with `pnpm report:data`. Exits non-zero if there are data problems.
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const KIND_ORDER = ['academic', 'service', 'housing', 'athletics', 'landmark', 'poi', 'parking']
const SOURCE_LABEL = {
  entrance: 'hand-placed entrances',
  outline: 'estimated from footprint',
  pin: 'estimated from map pin',
  none: 'not routable',
}

const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
})

let problems = []
try {
  const { checkData } = await server.ssrLoadModule('/src/imports/dataChecks.ts')
  const { doorCoverage } = await server.ssrLoadModule('/src/imports/routing.ts')
  const report = checkData()
  problems = report.problems
  const coverage = doorCoverage()

  console.log(`\nData problems: ${problems.length || 'none'}`)
  for (const p of problems) console.log(`  - ${p}`)
  console.log(`\nKnown gaps: ${report.warnings.length || 'none'}`)
  for (const w of report.warnings) console.log(`  - ${w}`)

  console.log(`\nDoor coverage (${coverage.length} places)`)
  for (const source of Object.keys(SOURCE_LABEL)) {
    const n = coverage.filter((c) => c.source === source).length
    if (n) console.log(`  ${String(n).padStart(3)}  ${SOURCE_LABEL[source]}`)
  }
  const doors = coverage.reduce((s, c) => s + c.doors, 0)
  const verified = coverage.reduce((s, c) => s + c.verified, 0)
  const surveyed = coverage.reduce((s, c) => s + c.accessibleKnown, 0)
  console.log(`  Doors: ${doors} total, ${verified} verified in person, ${surveyed} with step-free status`)

  // Survey priority: estimated doors first, then places whose doors have no step-free status; academic first.
  const rank = (c) => (c.source === 'entrance' ? 1 : 0)
  const todo = coverage
    .filter((c) => c.kind !== 'parking' && (c.source !== 'entrance' || c.accessibleKnown === 0))
    .sort(
      (a, b) =>
        rank(a) - rank(b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name),
    )
  console.log(`\nSurvey next (${todo.length} places):`)
  for (const c of todo) {
    const why = c.source === 'entrance' ? 'step-free status unknown' : SOURCE_LABEL[c.source]
    console.log(`  ${c.kind.padEnd(10)} ${c.id.padEnd(28)} ${c.name}  [${why}]`)
  }
  console.log()
} finally {
  await server.close()
}
process.exitCode = problems.length ? 1 : 0
