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
