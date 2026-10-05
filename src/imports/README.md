# /mock starter data

| File | What it is |
|---|---|
| `types.ts` | Shapes for everything below, plus the planned API contract |
| `map.json` | Map image name, real pixel size (6182x8000), revision, notes |
| `buildings.json` | 74 records: 46 buildings, 10 landmarks, 18 parking areas |
| `graph.json` | 14 nodes, 15 undirected edges (illustrative, central campus) |
| `entrances.json` | 11 entrances, one per graphed building |
| `schedule.json` | Fictional student, 7 sample classes covering edge cases |

## Caveats

- Every record has `verified: false`. Positions are read off the map image by eye.
  Re-trace them in Figma before relying on them.
- The graph covers only the central campus (TSU, B, PL, CPAC, EC, H, MH, DBH, KHS, E, CS)
  so the first routing slice can be tested. It is not a full campus network.
- `accessible` on entrances is `null` (unknown) and on edges is `true` by default. Neither is verified.
- Edge `weightM` values are rough estimates rounded to 5 m.
- `code` is not unique (both E1 lots share it). Always key by `id`.
- Parking (`kind: "parking"`) must never appear as a start or destination.
- `bldg-p` (Parking & Transportation Office) has no position: it is in the directory but I could not find it on the map.
- `schedule.json` is fictional. It includes an online class (`buildingId: null`),
  a lecture plus lab in one building, and an unresolved row (`ZZ 101`, `confirmed: false`)
  for the review screen.
