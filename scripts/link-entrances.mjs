// Writes src/geojson/entrance-links.geojson: short links from accessible entrances that aren't connected to any
// mapped path to the nearest path, so directions can reach buildings that otherwise can't be routed to.
//
// Usage: node scripts/link-entrances.mjs
//
// Only for buildings with no connected accessible entrance at all. Each link is a straight line from the entrance
// to the nearest point on one of BC's outdoor accessible paths or a city sidewalk (sidewalks.geojson), and is
// drawn only if it:
//   - is at most MAX_LINK_M long (longer ones are likelier to cross a road, a lawn, or a wall),
//   - doesn't cross a building (other than leaving its own wall at the entrance), or stairs,
//   - doesn't cross a street (any public road from OpenStreetMap; small service driveways are allowed, since
//     many entrances face one).
// When the nearest path is on the far side of the building, the link goes round it: via one or two of the
// building's corners (just outside its walls), up to MAX_AROUND_M in all.
// Links haven't been checked on the ground. Routing treats them like other unchecked paths (slightly less
// preferred, and said so on the route), and the slope limit applies to them. Check them, and replace them with
// real paths in accessiblepaths.geojson as they're surveyed; then re-run this, and they're dropped.
import fs from 'node:fs';
import path from 'node:path';
import { overpass } from './overpass.mjs';
import { ROOT, load, buildGraph, projectBuildings, proj, unproj, dist, nearestOnSegment, nearestBuilding, campusOf } from './routing/lib.mjs';

const OUT = path.join(ROOT, 'src/geojson/entrance-links.geojson');
const MAX_LINK_M = 60;
const MAX_AROUND_M = 90;
const CORNER_OFFSET_M = 2.5; // how far outside a corner a link passes
const LEAVE_WALL_M = 2;   // the first stretch from the entrance may run along a wall
const OWN_BUILDING_M = 5; // entrances are often drawn just inside their own building: the link may leave it within this

// Public streets from OpenStreetMap, which links mustn't cross
async function streets() {
  const elements = await overpass(`[out:json][timeout:120];way["highway"~"^(residential|tertiary|secondary|primary|unclassified|trunk|primary_link|secondary_link|tertiary_link|living_street)$"](42.312,-71.207,42.355,-71.145);out geom;`);
  return elements.map((w) => ({ type: 'Feature', properties: { Type: 'Street', name: w.tags.name }, geometry: { type: 'LineString', coordinates: w.geometry.map((g) => [g.lon, g.lat]) } }));
}
console.log('Downloading streets from OpenStreetMap…');
const streetLines = await streets();

const paths = load('accessiblepaths.geojson'), entrances = load('entrances.geojson'), buildingFeatures = load('buildings.geojson');
const sidewalks = fs.existsSync(path.join(ROOT, 'src/geojson/sidewalks.geojson')) ? load('sidewalks.geojson') : [];
const buildings = projectBuildings(buildingFeatures);
const graph = buildGraph({ paths, entrances, buildings: buildingFeatures, elevators: load('elevators.geojson') });
const linkedBuildings = new Set(graph.entrances.map((e) => e.building));
const nameOf = (f) => (f.properties.Building || '').trim() || nearestBuilding(buildings, proj(f.geometry.coordinates)).name;

// Lines in metres: where a link may end (outdoor paths), and what it mustn't cross (stairs, streets)
const toLines = (features, keep) => features.filter(keep).flatMap((f) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]).map((c) => ({ xy: c.map(proj), f })));
const targets = [
  ...toLines(paths, (f) => f.properties.Type === 'Exterior').map((l) => ({ ...l, to: 'BC path' })),
  ...toLines(sidewalks, (f) => f.properties.Type === 'Sidewalk' && !f.properties.rough && !f.properties.level).map((l) => ({ ...l, to: 'city sidewalk' })),
];
const barriers = [
  ...toLines(load('paths.geojson'), (f) => f.properties.highway === 'steps'),
  ...toLines(sidewalks, (f) => f.properties.Type === 'Stairs'),
  ...toLines(streetLines, () => true),
];

function crosses(p1, p2, q1, q2) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d(p1, p2, q1) * d(p1, p2, q2) < 0 && d(q1, q2, p1) * d(q1, q2, p2) < 0;
}
const crossesLine = (a, b, xy) => xy.some((_, i) => i > 0 && crosses(a, b, xy[i - 1], xy[i]));
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Whether a straight link from a (the entrance) to b is clear: no building in the way, and no stairs or street.
// It may leave the entrance's own building within OWN_BUILDING_M of the entrance, but not cross it after that.
function clear(a, b, own) {
  const len = dist(a, b);
  const along = (m) => (len > m ? [a[0] + ((b[0] - a[0]) * m) / len, a[1] + ((b[1] - a[1]) * m) / len] : b);
  for (const bld of buildings) {
    const start = along(bld.name === own ? OWN_BUILDING_M : LEAVE_WALL_M);
    const [x0, y0, x1, y1] = bld.bbox;
    if (Math.max(start[0], b[0]) < x0 || Math.min(start[0], b[0]) > x1 || Math.max(start[1], b[1]) < y0 || Math.min(start[1], b[1]) > y1) continue;
    for (const ring of bld.rings) {
      if (crossesLine(start, b, ring)) return `crosses ${bld.name || 'a building'}`;
      for (let t = 0.25; t < 1; t += 0.25) if (inRing([start[0] + t * (b[0] - start[0]), start[1] + t * (b[1] - start[1])], ring)) return `crosses ${bld.name || 'a building'}`;
    }
  }
  const barrier = barriers.find((l) => crossesLine(a, b, l.xy));
  return barrier ? (barrier.f.properties.Type === 'Street' ? `crosses ${barrier.f.properties.name || 'a street'}` : 'crosses stairs') : true;
}

// The corners of a building's outline, pushed CORNER_OFFSET_M outwards (away from its middle)
function aroundCorners(name) {
  const out = [];
  for (const bld of buildings.filter((b) => b.name === name)) {
    for (const ring of bld.rings) {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      for (const [x, y] of ring.slice(0, -1)) {
        const d = Math.hypot(x - cx, y - cy) || 1;
        out.push([x + ((x - cx) / d) * CORNER_OFFSET_M, y + ((y - cy) / d) * CORNER_OFFSET_M]);
      }
    }
  }
  return out;
}

const links = [], skipped = [];
for (const f of entrances) {
  const building = nameOf(f);
  if (!building || linkedBuildings.has(building)) continue;
  const a = proj(f.geometry.coordinates);
  // How far inside its own building the entrance point is drawn (0 if on or outside the wall)
  const own = buildings.filter((b) => b.name === building);
  const inside = own.some((b) => b.rings.some((r) => inRing(a, r)))
    ? Math.min(...own.flatMap((b) => b.rings.flatMap((r) => r.slice(1).map((q, i) => nearestOnSegment(a, r[i], q).d))))
    : 0;
  // Candidates: the nearest point on each target line, nearest first; the first clear one wins
  const candidates = targets.map((l) => {
    let best = { d: Infinity };
    for (let i = 1; i < l.xy.length; i++) {
      const r = nearestOnSegment(a, l.xy[i - 1], l.xy[i]);
      if (r.d < best.d) best = r;
    }
    return { ...best, to: l.to };
  }).filter((c) => c.d <= MAX_LINK_M).sort((x, y) => x.d - y.d);
  const checks = candidates.map((c) => clear(a, c.point, building));
  let pick = candidates[checks.indexOf(true)], via = [];
  if (!pick) {
    // Round the building: entrance → corner (→ corner) → the nearest point on a path, each leg clear
    const corners = aroundCorners(building);
    const legClear = (p, q) => clear(p, q, null) === true;
    const pathsFrom = (p, budget) => targets.map((l) => {
      let best = { d: Infinity };
      for (let i = 1; i < l.xy.length; i++) { const r = nearestOnSegment(p, l.xy[i - 1], l.xy[i]); if (r.d < best.d) best = r; }
      return { ...best, to: l.to };
    }).filter((c) => c.d <= budget).sort((x, y) => x.d - y.d);
    let best = null;
    for (const c1 of corners) {
      const d1 = dist(a, c1);
      if (d1 >= MAX_AROUND_M || clear(a, c1, building) !== true) continue;
      const tryEnd = (from, used, chain) => {
        for (const t of pathsFrom(from, MAX_AROUND_M - used)) {
          if (best && used + t.d >= best.total) break;
          if (legClear(from, t.point)) { best = { ...t, total: used + t.d, via: chain }; break; }
        }
      };
      tryEnd(c1, d1, [c1]);
      for (const c2 of corners) {
        if (c2 === c1) continue;
        const d2 = d1 + dist(c1, c2);
        if (d2 < MAX_AROUND_M && (!best || d2 < best.total) && legClear(c1, c2)) tryEnd(c2, d2, [c1, c2]);
      }
    }
    if (best) { pick = { ...best, d: best.total }; via = best.via; }
  }
  if (!pick) {
    // Why the nearest path couldn't be used, for whoever draws the path by hand
    const why = candidates.length ? `nearest path ${candidates[0].d.toFixed(0)} m away, but the way ${checks[0]}` : `no path within ${MAX_LINK_M} m`;
    skipped.push({ building, id: f.properties.OBJECTID, reason: why });
    continue;
  }
  links.push({
    type: 'Feature',
    properties: { Type: 'Connector', FID: `connector-${f.properties.OBJECTID}`, Building: building, Entrance: f.properties.OBJECTID, To: pick.to, Length_m: +pick.d.toFixed(1), Campus: campusOf(f.geometry.coordinates),
      ...(inside > 3 ? { Check: `the entrance point is ${inside.toFixed(0)} m inside the building: where is the door?` } : {}),
      Comment: 'Drawn automatically from the entrance to the nearest path; not checked on the ground' },
    geometry: { type: 'LineString', coordinates: [f.geometry.coordinates, ...via.map(unproj), unproj(pick.point)] },
  });
}

fs.writeFileSync(OUT, `{"type":"FeatureCollection","features":[\n${links.map((l) => JSON.stringify(l)).join(',\n')}\n]}\n`);
const reached = new Set(links.map((l) => l.properties.Building));
const missing = [...new Set(skipped.map((s) => s.building))].filter((b) => !reached.has(b));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${links.length} links for ${reached.size} buildings (${links.filter((l) => l.properties.To === 'BC path').length} to BC paths, ${links.filter((l) => l.properties.To === 'city sidewalk').length} to city sidewalks); median ${links.map((l) => l.properties.Length_m).sort((x, y) => x - y)[Math.floor(links.length / 2)] ?? 0} m`);
if (missing.length) {
  console.log(`Not linked (${missing.length} buildings):`);
  for (const b of missing) console.log(`  ${b}: ${skipped.find((s) => s.building === b).reason}`);
}
const check = links.filter((l) => l.properties.Check);
if (check.length) {
  console.log(`Entrance points to check (drawn well inside their building, so the door may be elsewhere): ${check.length}`);
  for (const l of check) console.log(`  ${l.properties.Building} (entrance ${l.properties.Entrance}): ${l.properties.Check}`);
}
