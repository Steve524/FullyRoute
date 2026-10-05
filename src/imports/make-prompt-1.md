# Make prompt 1 — Start & destination pickers

Paste this into Figma Make with the home-screen frame attached. It builds only the
pickers and the map, not the route. Guidelines.md handles the standing rules.

---

Build the home screen from the attached frame: the CSUF campus map with a "start"
picker and a "destination" picker. Use only the data in /mock. Do not build the route
display, the step list, or sharing yet.

Requirements:
1. Show the campus map image (name and pixel size are in /mock/map.json). It must pan
   and zoom, and stay usable on a phone-width screen.
2. Two pickers, "Start" and "Destination", each a searchable dropdown built from
   /mock/buildings.json. Search matches on `name` or `code`.
3. Exclude every record with `kind: "parking"` from both pickers. Buildings and
   landmarks only.
4. Selecting a building in either picker highlights that building on the map at its
   `position.pixel` (scale the coordinate with the image so it stays aligned).
5. "Get route" is present but disabled until both pickers have a value. When disabled,
   a tooltip or helper text reads "Choose a start and destination".
6. Start and destination cannot be the same building. If they match, show an inline
   message and keep "Get route" disabled.
7. Use `id` as the value of each option, never `code` (codes are not unique).

Do not add anything not listed above, and do not touch any other screen.
At the end, summarize what you built and list anything you were unsure about.

---

## After it runs, check
- [ ] No parking lots appear in either picker.
- [ ] Searching "CS" and "Computer Science" both find the CS building.
- [ ] Selecting a building moves/shows a highlight on the correct spot on the map.
- [ ] "Get route" stays disabled until both are set, and when start == destination.
- [ ] The map pans and zooms on a narrow (phone) frame.

## Next prompts (later, one at a time)
2. Route display: draw the path from /mock/graph.json between the two buildings, plus a step list. Use edge `weightM` for distances.
3. Share: a copy-link button producing ?from=&to=&accessible=, and restoring state from that URL on load.
4. States: loading, empty (no route), and error.
5. (Optional) Mocked schedule screen from /mock/schedule.json with the review behavior.
