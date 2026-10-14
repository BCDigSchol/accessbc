// Builds the routing graph exactly as the site does and checks it: build time, which buildings
// can reach each other, and routes whose detour over the straight-line distance looks suspicious.
//
// Usage: node scripts/routing/check-routes.mjs ["From building" "To building"]
import { load, buildGraph, routeBetweenBuildings, campusOf, proj, dist } from './lib.mjs';
import { terrainTileLoader } from '../terrain.mjs';
import { createTerrain, segmentGrades } from '../../src/js/routing/elevation.mjs';

const t0 = performance.now();
const graph = buildGraph({ paths: load('accessiblepaths.geojson'), entrances: load('entrances.geojson'), buildings: load('buildings.geojson') });
const buildMs = performance.now() - t0;
const edgeCount = graph.adjacency.reduce((s, a) => s + a.length, 0) / 2;
console.log(`Graph: ${graph.nodes.length} nodes, ${edgeCount} edges, ${graph.entrances.length} linked entrances, built in ${buildMs.toFixed(0)} ms\n`);

const [from, to] = process.argv.slice(2);
if (from && to) {
  const r = routeBetweenBuildings(graph, from, to);
  console.log(r ? `${from} → ${to}: ${r.length.toFixed(0)} m over ${r.nodes.length} nodes` : `No route from ${from} to ${to}`);
  process.exit();
}

const allBuildings = new Set(load('buildings.geojson').map((b) => b.properties.NAME));
const routable = [...new Set(graph.entrances.map((e) => e.building))].sort();
const doorOf = Object.fromEntries(routable.map((b) => [b, graph.nodes[graph.entrances.find((e) => e.building === b).node]]));
console.log(`Buildings with an accessible entrance linked to a path: ${routable.length} of ${allBuildings.size}`);

const byCampus = {};
const suspicious = [];
const t1 = performance.now();
let routes = 0;
for (let i = 0; i < routable.length; i++) {
  for (let j = i + 1; j < routable.length; j++) {
    const a = routable[i], b = routable[j];
    const campus = campusOf(doorOf[a]);
    if (campus !== campusOf(doorOf[b])) continue; // the campuses aren't connected by paths
    const stats = (byCampus[campus] ||= { pairs: 0, routed: 0 });
    stats.pairs++;
    const r = routeBetweenBuildings(graph, a, b);
    routes++;
    if (!r) continue;
    stats.routed++;
    const straight = dist(proj(graph.nodes[r.nodes[0]]), proj(graph.nodes[r.nodes.at(-1)]));
    if (straight > 50 && r.length / straight > 2.5) suspicious.push({ a, b, length: r.length, straight });
  }
}
const perRoute = (performance.now() - t1) / routes;
console.log(`\nBuilding pairs on the same campus that can be routed (${perRoute.toFixed(1)} ms per route):`);
for (const [campus, s] of Object.entries(byCampus)) console.log(`  ${campus}: ${s.routed} of ${s.pairs} (${((s.routed / s.pairs) * 100).toFixed(0)}%)`);

// The same, with the slope limits offered in the directions panel.
const grades = await segmentGrades(createTerrain(terrainTileLoader(), graph.buildings), graph);
const totals = Object.values(byCampus).reduce((t, s) => ({ pairs: t.pairs + s.pairs, routed: t.routed + s.routed }), { pairs: 0, routed: 0 });
for (const [label, max] of [['1:12 (8.3%)', 1 / 12], ['1:20 (5%)', 0.05]]) {
  const cost = (e) => (e.seg >= 0 && grades[e.seg] > max ? Infinity : e.length);
  let routed = 0;
  for (let i = 0; i < routable.length; i++)
    for (let j = i + 1; j < routable.length; j++)
      if (campusOf(doorOf[routable[i]]) === campusOf(doorOf[routable[j]]) && routeBetweenBuildings(graph, routable[i], routable[j], cost)) routed++;
  console.log(`  Staying within ${label}: ${routed} of ${totals.pairs} (${totals.routed} with no limit)`);
}

const unreachable = routable.filter((b) => {
  const campus = campusOf(doorOf[b]);
  const peers = routable.filter((o) => o !== b && campusOf(doorOf[o]) === campus);
  return peers.length && peers.every((o) => !routeBetweenBuildings(graph, b, o));
});
console.log(`\nBuildings that can't reach any other building on their campus: ${unreachable.length}`);
unreachable.forEach((b) => console.log(`  ${b} (${campusOf(doorOf[b])})`));

suspicious.sort((x, y) => y.length / y.straight - x.length / x.straight);
console.log(`\nRoutes more than 2.5× the straight-line distance (possible missing links): ${suspicious.length}`);
suspicious.slice(0, 10).forEach((s) => console.log(`  ${s.a} → ${s.b}: ${s.length.toFixed(0)} m vs ${s.straight.toFixed(0)} m straight (${(s.length / s.straight).toFixed(1)}×)`));

// Fix list: each disconnected piece of the graph that has entrances on it, the buildings stranded
// there, and the shortest gap to the biggest piece on the same campus. Closing that gap in the data
// (or confirming it's a real barrier) is the most direct fix.
const pieceOf = new Int32Array(graph.nodes.length).fill(-1);
const pieces = [];
for (let start = 0; start < graph.nodes.length; start++) {
  if (pieceOf[start] !== -1) continue;
  const members = [start];
  pieceOf[start] = pieces.length;
  for (let k = 0; k < members.length; k++)
    for (const { to } of graph.adjacency[members[k]]) if (pieceOf[to] === -1) { pieceOf[to] = pieces.length; members.push(to); }
  pieces.push(members);
}
const entrancesIn = (pi) => graph.entrances.filter((e) => pieceOf[e.node] === pi);
const mainPiece = {};
pieces.forEach((members, pi) => {
  const campus = campusOf(graph.nodes[members[0]]);
  if (!mainPiece[campus] || members.length > pieces[mainPiece[campus]].length) mainPiece[campus] = pi;
});
const fixes = [];
pieces.forEach((members, pi) => {
  const doors = entrancesIn(pi);
  const campus = campusOf(graph.nodes[members[0]]);
  if (!doors.length || pi === mainPiece[campus]) return;
  let gap = { d: Infinity };
  for (const m of members)
    for (const o of pieces[mainPiece[campus]]) {
      const d = dist(proj(graph.nodes[m]), proj(graph.nodes[o]));
      if (d < gap.d) gap = { d, at: graph.nodes[m] };
    }
  fixes.push({ campus, buildings: [...new Set(doors.map((e) => e.building))], gap });
});
fixes.sort((a, b) => a.gap.d - b.gap.d);
console.log(`\nDisconnected pieces with entrances on them (${fixes.length}), closest to the main network first:`);
fixes.forEach((f) => console.log(`  ${f.gap.d.toFixed(1)} m from main ${f.campus} network at [${f.gap.at.join(', ')}]: ${f.buildings.join(', ')}`));

const missing = [...allBuildings].filter((b) => !routable.includes(b));
console.log(`\nBuildings with no linked accessible entrance: ${missing.length} (e.g. ${missing.slice(0, 6).join(', ')})`);
