// Builds src/geojson/sidewalks.geojson: city sidewalks, crossings and footways from OpenStreetMap around the
// campuses, so routes can go between campuses (and start from off campus) until shuttles are in the routing.
//
// Usage: node scripts/osm-sidewalks.mjs   (downloads from the public Overpass API, about 10 MB, ~30 s)
//
// The data is © OpenStreetMap contributors, under the Open Database License (ODbL): the output keeps that licence
// (see src/geojson/README.md), and the map credits OpenStreetMap. OpenStreetMap hasn't been checked for
// accessibility the way BC's own paths have, so the app says so wherever a route uses it.
//
// Each feature is one OpenStreetMap way, with properties:
//   Type     Sidewalk | Crossing | Street (a road tagged as having a sidewalk that isn't drawn separately) | Stairs
//   name     the street it runs along (sidewalks: the nearest named road), for directions
//   surface, width, incline, wheelchair, tactile   as tagged
//   crossing marked | traffic_signals | uncontrolled | unmarked ... (crossings)
//   kerb     the curbs at a crossing's ends: lowered | flush | raised | unknown (the worst of them)
//   rough    true for unpaved or broken surfaces, which accessible routes avoid
//   campus   true inside a BC campus boundary, where BC's own paths are used first
//   level    true for bridges and tunnels, which don't join paths they pass over or under
//   osm      the way's id
import fs from 'node:fs';
import path from 'node:path';
import { overpass } from './overpass.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/geojson/sidewalks.geojson');
// The campuses and the streets between them, with a margin for arriving from nearby (south, west, north, east)
const BBOX = [42.312, -71.207, 42.355, -71.145];

const WALKABLE = new Set(['footway', 'pedestrian', 'path', 'steps', 'living_street', 'cycleway', 'track']);
const ROADS = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'trunk', 'service', 'primary_link', 'secondary_link', 'tertiary_link']);
const ROUGH = new Set(['dirt', 'gravel', 'fine_gravel', 'grass', 'sand', 'ground', 'earth', 'mud', 'unpaved', 'woodchips', 'pebblestone', 'rock', 'compacted', 'grass_paver']);
const KERB_RANK = { raised: 3, rolled: 2, yes: 2, unknown: 1, lowered: 0, flush: 0, no: 0 };

// ---- Geometry (flat metres around the campus, as in src/js/routing/network.mjs) ----
const LON0 = -71.175, LAT0 = 42.335;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540;
const proj = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function main() {
  const b = BBOX.join(',');
  console.log('Downloading from OpenStreetMap (Overpass)…');
  const elements = await overpass(`[out:json][timeout:180];
    way["highway"](${b});
    out body geom;
    node["highway"="crossing"](${b});
    out;
    node["kerb"](${b});
    out;
    way["amenity"="university"]["name"~"Boston College"](${b});
    out geom;`);

  const kerbs = new Map(elements.filter((e) => e.type === 'node' && e.tags?.kerb).map((e) => [e.id, e.tags.kerb]));
  const crossingNodes = new Map(elements.filter((e) => e.type === 'node' && e.tags?.highway === 'crossing').map((e) => [e.id, e.tags]));
  const campuses = elements.filter((e) => e.type === 'way' && e.tags?.amenity === 'university' && e.geometry)
    .map((e) => e.geometry.map((g) => proj([g.lon, g.lat])));
  const ways = elements.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry && !(e.tags.amenity === 'university'));
  const namedRoads = ways.filter((w) => ROADS.has(w.tags.highway) && w.tags.name)
    .map((w) => ({ name: w.tags.name, xy: w.geometry.map((g) => proj([g.lon, g.lat])) }));

  const nearestRoadName = (xy) => {
    // The road nearest the middle of the way, within 30 m
    const mid = xy[Math.floor(xy.length / 2)];
    let best = { d: 30, name: '' };
    for (const r of namedRoads) {
      for (let i = 1; i < r.xy.length; i++) {
        const d = distToSegment(mid, r.xy[i - 1], r.xy[i]);
        if (d < best.d) best = { d, name: r.name };
      }
    }
    return best.name;
  };

  const features = [];
  for (const w of ways) {
    const t = w.tags;
    if (['private', 'no'].includes(t.access) || t.foot === 'no' || t.area === 'yes' || t.footway === 'private') continue;
    if (t.highway === 'cycleway' && !['yes', 'designated'].includes(t.foot)) continue;
    if (t.highway === 'track' && !['yes', 'designated'].includes(t.foot)) continue;
    let Type;
    if (t.highway === 'steps') Type = 'Stairs';
    else if (t.footway === 'crossing' || t.highway === 'crossing') Type = 'Crossing';
    else if (WALKABLE.has(t.highway)) Type = 'Sidewalk';
    else if (ROADS.has(t.highway) && ['both', 'left', 'right', 'yes'].some((v) => [t.sidewalk, t['sidewalk:both'], t['sidewalk:left'], t['sidewalk:right']].includes(v))) Type = 'Street';
    else continue;

    const coordinates = w.geometry.map((g) => [+g.lon.toFixed(7), +g.lat.toFixed(7)]);
    const xy = coordinates.map(proj);
    const props = { Type, osm: w.id };
    // Sidewalks are named after the street beside them, crossings after the street they cross
    const name = Type === 'Street' ? t.name : t.name || ((Type === 'Sidewalk' && t.footway === 'sidewalk') || Type === 'Crossing' ? nearestRoadName(xy) : '');
    if (name) props.name = name;
    for (const k of ['surface', 'width', 'incline', 'wheelchair']) if (t[k]) props[k] = t[k];
    if (t.tactile_paving) props.tactile = t.tactile_paving;
    if (ROUGH.has(t.surface) || ['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'].includes(t.smoothness)) props.rough = true;
    if (t.bridge || t.tunnel || (t.layer && t.layer !== '0')) props.level = true;
    if (Type === 'Crossing') {
      const node = w.nodes.map((id) => crossingNodes.get(id)).find(Boolean) || {};
      props.crossing = t.crossing || node.crossing || 'unknown';
      if (t['crossing:signals'] === 'yes' || node.crossing === 'traffic_signals') props.crossing = 'traffic_signals';
      // The curbs at each end: the first and last nodes, or tagged kerb nodes along the way
      const ends = [w.nodes[0], w.nodes.at(-1)].map((id) => kerbs.get(id) || 'unknown');
      const along = w.nodes.map((id) => kerbs.get(id)).filter(Boolean);
      const all = along.length ? [...along, ...(along.length < 2 ? ['unknown'] : [])] : ends;
      props.kerb = all.reduce((worst, k) => ((KERB_RANK[k] ?? 1) > (KERB_RANK[worst] ?? 1) ? k : worst));
      if (props.kerb === 'yes' || props.kerb === 'rolled') props.kerb = 'raised';
      if (props.kerb === 'no') props.kerb = 'flush';
    }
    if (campuses.some((ring) => xy.filter((p) => inRing(p, ring)).length > xy.length / 2)) props.campus = true;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates } });
  }

  const out = {
    type: 'FeatureCollection',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright',
    generated: new Date().toISOString().slice(0, 10),
    bbox: [BBOX[1], BBOX[0], BBOX[3], BBOX[2]],
    features,
  };
  fs.writeFileSync(OUT, `{"type":"FeatureCollection","license":${JSON.stringify(out.license)},"attribution":${JSON.stringify(out.attribution)},"generated":"${out.generated}","bbox":${JSON.stringify(out.bbox)},"features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`);
  const count = (k) => features.filter((f) => f.properties.Type === k).length;
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${features.length} ways (${count('Sidewalk')} sidewalks and footways, ${count('Crossing')} crossings, ${count('Street')} streets with sidewalks, ${count('Stairs')} steps), ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
  console.log(`Crossings by curb: ${JSON.stringify(Object.fromEntries(['lowered', 'flush', 'raised', 'unknown'].map((k) => [k, features.filter((f) => f.properties.kerb === k).length])))}`);
  console.log(`On campus: ${features.filter((f) => f.properties.campus).length}; rough: ${features.filter((f) => f.properties.rough).length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
