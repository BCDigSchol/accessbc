// Reports how routable the accessible path network in src/geojson/ is: how well the paths connect,
// where the gaps are, and how entrances attach to paths. Optionally writes the problems as GeoJSON
// for review in QGIS (or any GIS).
//
// Usage: node scripts/routing/analyze-network.mjs [issues-output.geojson]
import fs from 'node:fs';
import path from 'node:path';
import {
  load, proj, unproj, dist, projectBuildings, nearestBuilding, buildNetwork, danglingGaps, findCrossings, nearestSegment,
  JOIN_GAP_M, REVIEW_GAP_M, ENTRANCE_LINK_M,
} from './lib.mjs';

const net = buildNetwork(load('accessiblepaths.geojson'));
const { nodes, segments, lines } = net;
const gaps = danglingGaps(net);
const crossings = findCrossings(net);
const buildings = projectBuildings(load('buildings.geojson'));
const fmt = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m.toFixed(0) + ' m');
const totalLength = lines.reduce((s, l) => s + l.length, 0);

// Connected pieces via union-find, with optional extra node pairs treated as joined.
function components(joins = []) {
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  [...segments.map((s) => [s.a, s.b]), ...joins].forEach(([a, b]) => { parent[find(a)] = find(b); });
  const pieces = new Map();
  segments.forEach((s) => {
    const r = find(s.a);
    const piece = pieces.get(r) || { root: r, length: 0, segments: [] };
    piece.length += dist(nodes[s.a].xy, nodes[s.b].xy);
    piece.segments.push(s);
    pieces.set(r, piece);
  });
  return { list: [...pieces.values()].sort((a, b) => b.length - a.length), find };
}
const gapJoins = (max) => gaps.filter((g) => g.d <= max).map((g) => [g.node, g.seg.a]);
const crossingJoins = (types) => crossings.filter((c) => types.includes(c.types)).map((c) => [c.segs[0].a, c.segs[1].a]);
const histogram = (values, edges) => {
  const out = {};
  edges.forEach((e, i) => { out[`≤ ${e} m`] = values.filter((v) => v <= e && (i === 0 || v > edges[i - 1])).length; });
  out[`> ${edges.at(-1)} m`] = values.filter((v) => v > edges.at(-1)).length;
  return out;
};

console.log('# Accessible path network\n');
console.log(`Lines: ${lines.length} (${lines.filter((l) => l.type === 'Exterior').length} exterior, ${lines.filter((l) => l.type === 'Interior').length} interior), ${fmt(totalLength)} total`);
console.log(`Nodes: ${nodes.length}, segments: ${segments.length}, dangling endpoints: ${gaps.length}\n`);

for (const [label, joins] of [
  ['As drawn', []],
  [`Joining gaps ≤ ${JOIN_GAP_M} m and exterior crossings (roughly what the router does; check-routes.mjs is exact)`, [...gapJoins(JOIN_GAP_M), ...crossingJoins(['Exterior/Exterior'])]],
  [`Also joining gaps ≤ ${REVIEW_GAP_M} m and interior crossings`, [...gapJoins(REVIEW_GAP_M), ...crossingJoins(['Exterior/Exterior', 'Interior/Interior'])]],
]) {
  const { list } = components(joins);
  console.log(`## ${label}: ${list.length} connected pieces`);
  console.log(`Largest: ${fmt(list[0].length)} (${((list[0].length / totalLength) * 100).toFixed(1)}% of path length). Next: ${list.slice(1, 6).map((c) => fmt(c.length)).join(', ')}\n`);
}

console.log('## Dangling endpoints, by distance to the nearest other path');
console.log(histogram(gaps.map((g) => g.d), [0.5, JOIN_GAP_M, 5, REVIEW_GAP_M, 30]));
const farEnds = gaps.filter((g) => g.d > REVIEW_GAP_M);
console.log(`${farEnds.filter((g) => nearestBuilding(buildings, nodes[g.node].xy).d <= 5).length} of the ${farEnds.length} endpoints more than ${REVIEW_GAP_M} m from another path end within 5 m of a building.\n`);

console.log(`## Crossings without a shared node: ${crossings.length}`);
console.log(crossings.reduce((acc, c) => ((acc[c.types] = (acc[c.types] || 0) + 1), acc), {}), '\n');

const entrances = load('entrances.geojson').map((e) => {
  const xy = proj(e.geometry.coordinates);
  return { id: e.properties.OBJECTID, name: (e.properties.Building || '').trim(), xy, path: nearestSegment(net, xy), building: nearestBuilding(buildings, xy) };
});
console.log(`## Entrances (${entrances.length}), by distance to the nearest accessible path`);
console.log(histogram(entrances.map((e) => e.path.d), [3, ENTRANCE_LINK_M, 30, 100]));
const unnamed = entrances.filter((e) => !e.name);
console.log(`Unnamed: ${unnamed.length}, of which ${unnamed.filter((e) => e.building.d <= 10).length} are on or within 10 m of a building (name can be filled in).`);
console.log(`Named, but nearest a different building: ${entrances.filter((e) => e.name && e.building.d <= 10 && e.building.name !== e.name).length}\n`);

const elevators = load('elevators.geojson').map((e) => nearestSegment(net, proj(e.geometry.coordinates)).d);
console.log(`## Elevators (${elevators.length}), by distance to the nearest accessible path`);
console.log(histogram(elevators, [3, ENTRANCE_LINK_M, 30, 100]));

const out = process.argv[2];
if (out) {
  const point = (xy, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: unproj(xy) } });
  const line = (a, b, properties) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: [unproj(a), unproj(b)] } });
  const features = [];
  for (const g of gaps) {
    const p = nodes[g.node].xy;
    if (g.d <= REVIEW_GAP_M) features.push(line(p, g.point, { issue: g.d <= JOIN_GAP_M ? 'gap-auto-joined' : 'gap-review', meters: +g.d.toFixed(2) }));
    else features.push(point(p, { issue: 'dead-end', meters_to_path: +g.d.toFixed(1), near_building: nearestBuilding(buildings, p).d <= 5 }));
  }
  for (const c of crossings) {
    features.push(point(c.point, { issue: c.types === 'Exterior/Exterior' ? 'crossing-auto-joined' : 'crossing-review', types: c.types, fids: c.fids.join(',') }));
  }
  for (const e of entrances.filter((e) => e.path.d > ENTRANCE_LINK_M)) {
    features.push(point(e.xy, { issue: 'entrance-unlinked', id: e.id, building: e.name || e.building.name, meters_to_path: +e.path.d.toFixed(1) }));
  }
  components([...gapJoins(JOIN_GAP_M), ...crossingJoins(['Exterior/Exterior'])]).list.slice(1).forEach((piece, i) => {
    for (const s of piece.segments) features.push(line(nodes[s.a].xy, nodes[s.b].xy, { issue: 'island', island: i + 1, island_m: Math.round(piece.length) }));
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`\nWrote ${features.length} issue features to ${out}`);
}
