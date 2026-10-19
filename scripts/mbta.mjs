// Writes src/geojson/mbta-stations.geojson: the MBTA Green Line stations near the campuses (B, C, and D branches),
// with whether each is wheelchair accessible, from the MBTA's public API (api-v3.mbta.com). And
// src/geojson/mbta-trains.json: each branch and direction through those stations, in order, with the scheduled ride
// time between them, how often trains run (from today's late-morning schedule), and the track's line, in the same
// shape as shuttles.json, so routes can include a train ride.
//
// Usage: node scripts/mbta.mjs   (re-run if stations change; live alerts are fetched by the app itself)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/geojson/mbta-stations.geojson');
const TRAINS_OUT = path.join(ROOT, 'src/geojson/mbta-trains.json');
// When the Green Line runs (approximately, every day), for routing; the frequency is measured from the schedule
const TRAIN_HOURS = { from: '05:00', to: '25:00' };
const API = 'https://api-v3.mbta.com';
const CENTRE = { latitude: 42.335, longitude: -71.172 }, RADIUS_DEG = 0.035; // the campuses and a little beyond
const BRANCHES = { 'Green-B': 'Green Line B', 'Green-C': 'Green Line C', 'Green-D': 'Green Line D' };
const WHEELCHAIR = { 1: 'yes', 2: 'no' }; // 0: not known

// Without an API key the MBTA allows 20 requests a minute: when it says to slow down, wait and try again
async function get(pathAndQuery) {
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(API + pathAndQuery, { headers: { 'User-Agent': 'AccessBC/1.0 (Boston College accessibility map)' } });
    if (res.status !== 429) break;
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const wait = Math.min(65000, Math.max(5000, reset ? reset - Date.now() + 1000 : 15000));
    console.log(`  the MBTA asks to slow down; waiting ${Math.round(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
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

// ---- Train rides through these stations ----

// Google's encoded polyline format (precision 5) to [[lon, lat]]
function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) { lat += next(); lon += next(); out.push([+(lon / 1e5).toFixed(5), +(lat / 1e5).toFixed(5)]); }
  return out;
}
const metres = ([lon1, lat1], [lon2, lat2]) => Math.hypot((lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110540);

const trainRoutes = [];
for (const [route, line] of Object.entries(BRANCHES)) {
  const { data: [routeInfo] } = await get(`/routes?filter[id]=${route}`);
  for (const direction of [0, 1]) {
    // Today's late-morning trips in this direction: the stations each passes, in order, with times
    const query = new URLSearchParams({ 'filter[route]': route, 'filter[direction_id]': direction, 'filter[min_time]': '10:00', 'filter[max_time]': '11:30', include: 'stop' });
    const { data, included = [] } = await get(`/schedules?${query}`);
    const parentOf = new Map(included.map((st) => [st.id, st.relationships.parent_station.data?.id || st.id]));
    const trips = new Map();
    for (const row of data) {
      const station = parentOf.get(row.relationships.stop.data.id);
      const time = Date.parse(row.attributes.departure_time || row.attributes.arrival_time);
      const trip = row.relationships.trip.data.id;
      if (!trips.has(trip)) trips.set(trip, []);
      trips.get(trip).push({ seq: row.attributes.stop_sequence, station, time });
    }
    const longest = [...trips.values()].sort((a, b) => b.length - a.length)[0]?.sort((a, b) => a.seq - b.seq) || [];
    const ours = longest.filter((x) => stations.has(x.station));
    if (ours.length < 2) continue;
    // How often: the median gap between departures from the middle station here
    const middle = ours[Math.floor(ours.length / 2)].station;
    const times = [...trips.values()].flatMap((t) => t.filter((x) => x.station === middle).map((x) => x.time)).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / 60000).sort((a, b) => a - b);
    const every = Math.max(4, Math.round(gaps[Math.floor(gaps.length / 2)] || 10));
    // The track's line, from one of these trips
    const tripId = [...trips.keys()].find((id) => trips.get(id) === longest);
    const { included: shapes = [] } = await get(`/trips/${tripId}?include=shape`);
    const track = decodePolyline(shapes[0]?.attributes.polyline || '');
    let from = 0;
    const stops = ours.map((x, k) => {
      const st = stations.get(x.station);
      let best = { i: from, d: Infinity };
      for (let i = from; i < track.length; i++) { const d = metres(track[i], st.lonlat); if (d < best.d) best = { i, d }; }
      from = best.i;
      return { name: st.name, id: x.station, lonlat: st.lonlat.map((n) => +n.toFixed(6)), wheelchair: st.wheelchair,
        rideToNext: k + 1 < ours.length ? Math.round((ours[k + 1].time - x.time) / 1000) : 0, dwell: 0, at: best.i };
    });
    const first = stops[0].at, last = stops.at(-1).at;
    trainRoutes.push({
      id: `${route}-${direction}`, name: line, mode: 'train', toward: routeInfo.attributes.direction_destinations[direction],
      loop: false, service: [{ days: [0, 1, 2, 3, 4, 5, 6], ...TRAIN_HOURS, every }],
      stops: stops.map((st) => ({ ...st, at: st.at - first })), line: track.slice(first, last + 1),
    });
    console.log(`  ${line} toward ${routeInfo.attributes.direction_destinations[direction]}: ${stops.map((st) => st.name).join(' → ')}, every ${every} min`);
  }
}
fs.writeFileSync(TRAINS_OUT, JSON.stringify({
  source: `MBTA V3 API schedules, ${new Date().toISOString().slice(0, 10)}`,
  note: 'Approximate: the Green Line runs about 5 a.m. to 1 a.m.; frequency measured from a late-morning schedule.',
  routes: trainRoutes,
}) + '\n');
console.log(`Wrote ${path.relative(ROOT, TRAINS_OUT)}: ${trainRoutes.length} train routes`);
