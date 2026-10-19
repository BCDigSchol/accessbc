// Writes src/geojson/mbta-stations.geojson: the MBTA Green Line stations near the campuses (B, C, and D branches),
// with whether each is wheelchair accessible, from the MBTA's public API (api-v3.mbta.com).
//
// Usage: node scripts/mbta.mjs   (re-run if stations change; live alerts are fetched by the app itself)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/geojson/mbta-stations.geojson');
const API = 'https://api-v3.mbta.com';
const CENTRE = { latitude: 42.335, longitude: -71.172 }, RADIUS_DEG = 0.035; // the campuses and a little beyond
const BRANCHES = { 'Green-B': 'Green Line B', 'Green-C': 'Green Line C', 'Green-D': 'Green Line D' };
const WHEELCHAIR = { 1: 'yes', 2: 'no' }; // 0: not known

async function get(pathAndQuery) {
  const res = await fetch(API + pathAndQuery, { headers: { 'User-Agent': 'AccessBC/1.0 (Boston College accessibility map)' } });
  if (!res.ok) throw new Error(`${pathAndQuery}: ${res.status}`);
  return res.json();
}

const stations = new Map(); // parent station id -> {name, lonlat, wheelchair, lines, platforms}
for (const [route, line] of Object.entries(BRANCHES)) {
  const query = new URLSearchParams({ 'filter[route]': route, 'filter[latitude]': CENTRE.latitude, 'filter[longitude]': CENTRE.longitude, 'filter[radius]': RADIUS_DEG, include: 'parent_station' });
  const { data, included = [] } = await get(`/stops?${query}`);
  const parents = new Map(included.map((p) => [p.id, p.attributes]));
  for (const platform of data) {
    const parentId = platform.relationships.parent_station.data?.id || platform.id;
    const parent = parents.get(parentId) || platform.attributes;
    const station = stations.get(parentId) || { name: parent.name, lonlat: [parent.longitude, parent.latitude], wheelchair: WHEELCHAIR[parent.wheelchair_boarding] || 'unknown', lines: [], platforms: [] };
    if (!station.lines.includes(line)) station.lines.push(line);
    station.platforms.push({ toward: platform.attributes.platform_name, wheelchair: WHEELCHAIR[platform.attributes.wheelchair_boarding] || 'unknown' });
    stations.set(parentId, station);
  }
}

const features = [...stations].map(([id, s]) => ({
  type: 'Feature',
  properties: {
    Id: id, Name: s.name, Lines: s.lines.join(', '), Wheelchair: s.wheelchair,
    // Platforms that aren't step-free at a station that is (e.g. one direction only), for the popup
    Platforms: s.platforms.map((p) => `${p.toward}: ${p.wheelchair === 'yes' ? 'accessible' : p.wheelchair === 'no' ? 'not accessible' : 'not known'}`).join('; '),
  },
  geometry: { type: 'Point', coordinates: s.lonlat.map((n) => +n.toFixed(6)) },
})).sort((a, b) => a.properties.Name.localeCompare(b.properties.Name));
fs.writeFileSync(OUT, `{"type":"FeatureCollection","source":"MBTA V3 API, ${new Date().toISOString().slice(0, 10)}","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${features.length} stations (${features.filter((f) => f.properties.Wheelchair === 'yes').length} wheelchair accessible)`);
for (const f of features) console.log(`  ${f.properties.Name} (${f.properties.Lines}): ${f.properties.Wheelchair}`);
