# Routing tools

Building-to-building routing runs in the browser on a graph built from
[src/geojson/accessiblepaths.geojson](../../src/geojson/accessiblepaths.geojson) and
[entrances.geojson](../../src/geojson/entrances.geojson) each time the page loads (about 60 ms). There is no
generated graph file: edit the GeoJSON and routing picks up the change. The graph code is in
[src/js/routing/network.mjs](../../src/js/routing/network.mjs), which these scripts share with the site.

## How the graph is built

The paths were drawn without enforced topology, so the builder repairs the network as it goes:

| Problem in the data | What the builder does |
|---|---|
| Vertices at nearly the same spot (≤ 0.25 m) | Merges them into one node |
| A path end that stops just short of another path (≤ 2 m) | Joins it |
| Two exterior paths that cross without a shared vertex | Adds a junction |
| Two interior paths that cross | Nothing. They may be on different floors |
| A vertex sitting on the middle of another path (≤ 0.25 m) | Adds a junction. It was snapped there on purpose |
| An entrance near paths (≤ 15 m) | Links it to the nearest outdoor path, and to the nearest indoor path of its own building |
| An entrance with no `Building` name | Uses the building it's on or nearest to |

Anything less certain is left alone and reported for review.

## Route options

The directions panel's **Route options** change which paths a route may use and how they're weighed
([src/js/directions.js](../../src/js/directions.js)):

| Option | What it does |
|---|---|
| Avoid stairs (on by default) | Routes use only the mapped accessible paths. Turned off, OpenStreetMap footpaths and steps from `paths.geojson` are added (a second graph, built when first needed). Footpaths haven't been checked for accessibility, and the steps say so |
| Routes through buildings | *Use when shorter* (default); *Prefer* counts indoor distance at half, since indoors is where the elevators are; *Avoid* forbids indoor paths (e.g. after hours) |
| Steepest slope allowed | Forbids outdoor path segments steeper than 1:12 or 1:20. Grades for every segment are measured the first time a limit is chosen. Segments whose grade is unknown or unreliable aren't excluded |

If no route meets the settings, the panel shows the best route without the indoor and slope settings and says
which one it breaks. The data has no floor levels, and elevators are only points, so "elevator" means the
building on the route has one. It doesn't mean the route was planned through it.

## Slope and climb

Each route's outdoor stretches get an elevation profile from the terrain tiles
([src/js/routing/elevation.mjs](../../src/js/routing/elevation.mjs)), sampled every 3 m and measured over 15 m so
pixel noise doesn't read as a steep spot. The terrain data (about 3.5 m per pixel) is bare earth, interpolated
under buildings, so pixels on a building footprint are skipped. Indoor stretches get no slope: the data is the
ground outside.

| On the map | Grade | Meaning (ADA) |
|---|---|---|
| Blue | ≤ 5% | Within 1:20, the maximum for an accessible walkway |
| Orange | 5–8.33% | Steeper than 1:20 |
| Red | 8.33–20% | Steeper than 1:12, the maximum for an accessible ramp |
| Grey | > 20% | Not a real slope on an accessible path: almost always a footbridge (the data shows the ground below), a passage between buildings, or stairs. Left out of the climb and steepest-grade figures |

Known grey stretch: the O'Neill Library–Maloney Hall link (paths FID 32/33), where the ground drops 13 m over
about 25 m. It needs a site check: if it's a bridge the route is fine; if it's stairs, those paths shouldn't be in
the accessible network.

## Scripts

```bash
node scripts/routing/check-routes.mjs
```

Builds the graph as the site does and reports which buildings can reach each other, buildings stranded on
disconnected pieces (closest to the main network first), and routes with suspicious detours. Pass two
building names to test one route:

```bash
node scripts/routing/check-routes.mjs "Gasson Hall" "Bapst Library"
```

```bash
node scripts/routing/analyze-network.mjs qa/network-issues.geojson
```

Reports how well the raw paths connect and writes every problem to a GeoJSON file (`qa/` is git-ignored).
Open it in QGIS over `accessiblepaths.geojson` and style by the `issue` field:

| `issue` | Meaning |
|---|---|
| `gap-auto-joined` | Path end ≤ 2 m from another path. The router joins these. |
| `gap-review` | Path end 2–10 m from another path. Probably a connection; draw it in if so. |
| `dead-end` | Path end > 10 m from any path. Fine at a door or a real dead end, otherwise a missing link. |
| `crossing-auto-joined` | Exterior paths crossing. The router adds a junction. |
| `crossing-review` | Interior paths crossing. Add a shared vertex if they're on the same floor. |
| `entrance-unlinked` | Entrance > 15 m from any accessible path, so it can't be routed to. |
| `island` | Path segments not connected to their campus's main network. |

```bash
node scripts/routing/sample-instructions.mjs
```

Writes [docs/usability-testing/instruction-samples.md](../../docs/usability-testing/instruction-samples.md): the
step-by-step directions for a set of real routes, for an orientation and mobility instructor to review. Run it
after changing how instructions are worded.

## Fixing the data

Work from the `check-routes.mjs` fix list: each stranded piece shows the buildings it cuts off and where it
comes closest to the main network. In QGIS, enable snapping, extend or add a path so it shares a vertex with
the main network (or confirm the gap is a real barrier), save, and re-run the check.

## Reviewed gaps

Gaps that have been checked, so they aren't re-examined or "fixed" the wrong way. Evidence comes from the
mapped curb cuts, OpenStreetMap paths (`paths.geojson`, where `highway=steps` is a barrier), and building
outlines.

| Place | Gap | Decision | Why |
|---|---|---|---|
| 129 Lake Street | 9 m | Connected (path FID 280) | Matching curb cuts (91, 46) on both sides of the driveway |
| Higgins Hall | 0 m | Fixed in the builder | Indoor path vertex snapped onto the corridor line |
| 66 Commonwealth Avenue | 10 m | Not connected | The only link to the main network is OpenStreetMap steps |
| Voute Hall | 33 m | Needs a site check | The gap runs through the building. A real link would follow the Commonwealth Ave sidewalk (about 150 m), and there are steps on the east side |
| Conte Forum, side door 32 | 17 m | Left as is | Conte's other three entrances are already on the network |
