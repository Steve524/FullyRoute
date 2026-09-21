# Guidelines

## Product context
- A web app for building-to-building walking navigation on the Cal State Fullerton
  campus, aimed at new students finding their way between classes.
- This is an MVP to validate the UI and core flow for a human dev team. It is not
  production code. A separate FastAPI + Docker backend will be built later; do not
  build or assume a backend here.

## Stack
- React + TypeScript. Tailwind for styling.
- No new dependencies without asking first. In particular, do NOT add a map library
  (Leaflet, Mapbox, Google Maps). The campus map is a static image.
- One component per file, PascalCase names.
- All data is local. Read from the files in /mock. Do not call any network API.

## Data (read these exact files)
- /mock/types.ts — the shape of every record. Follow it exactly.
- /mock/buildings.json — buildings, landmarks, and parking areas.
- /mock/graph.json — routing nodes and edges (central campus only for now).
- /mock/entrances.json — building entrances.
- /mock/map.json — the map image name and its pixel dimensions (6182 x 8000 space).
- /mock/schedule.json — a fictional student schedule (only if a prompt asks for it).

Rules for using the data:
- Key everything by `id`, never by `code`. Codes are not unique (two lots share "E1").
- Positions are in the map image's pixel space, defined in /mock/map.json. Scale the
  image and the coordinates together so pins land in the right place at any size.
- Parking areas (`kind: "parking"`) are NEVER selectable as a start or destination.
- `roomNumber` is always a string. Never convert it to a number.

## Scope
- In scope: choose a start building, choose a destination, show the route on the
  campus map, show a step-by-step list, and share the route as a link.
- Out of scope: accounts, login, PDF upload, schedule parsing, live location,
  indoor routing, room-level search, and any real API calls.
- Never add screens, buttons, or features not named in the current prompt.

## Users and sharing
- Guest access is the default. Core navigation must work with no account and no login UI.
- A shared route is a stateless URL carrying the start id, destination id, and the
  accessible flag (e.g. ?from=bldg-cs&to=bldg-h&accessible=1). It must contain no
  personal data. Opening such a URL restores that route.

## Design fidelity
- Match the attached Figma frames: spacing, type, color, and layout.
- Use existing Figma components and variables only. Do not invent new styles.
- Mobile first. The primary layout targets a phone screen; the map must pan and zoom
  so it is usable small.
- If the design is ambiguous or a frame is missing, ask a question instead of guessing.

## Behavior rules
- "Get route" is disabled until both a start and a destination are chosen.
- Start and destination cannot be the same building; show an inline message.
- No route found: show "We couldn't find a walking route" with a way to reset.
- Selecting a building highlights it on the map.
- Both pickers list only non-parking buildings and landmarks, searchable by name or code.

## Future-proofing (do NOT implement now, just don't block it)
- Use the Position type ({ pixel?, geo? }) for all locations. The MVP populates `pixel` only.
- Treat entrances as separate records linked to a building by `buildingId`.
- Routing must use each edge's `weightM`, never distance computed from pixels.

## Schedule (mock only)
- A schedule screen, if a prompt asks for one, reads /mock/schedule.json.
- Show an editable review screen before "confirming" rows. Rows with `confirmed: false`
  or a null `buildingId` are flagged for review, not hidden. Never fabricate a location.

## Editing rules
- Only change what the current prompt asks for. Do not refactor, restyle, or "improve"
  components that are already approved.
- At the end of each response, briefly summarize what you changed and what you left alone.
