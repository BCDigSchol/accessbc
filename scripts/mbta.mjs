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
// Parts of the day whose train frequency is measured separately (hours; 24+ is after midnight)
const DAY_PARTS = [[0, 7], [7, 9.5], [9.5, 15.5], [15.5, 19], [19, 30]];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(Math.round(minutes % 60))}`;
// The next weekday (Tuesday to Thursday, a typical day), Saturday and Sunday from today, as YYYY-MM-DD in Boston
function nextDates() {
  const out = {};
  for (let d = 1; d <= 8; d++) {
    const date = new Date(Date.now() + d * 864e5);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(date.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }));
    const iso = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if ([2, 3, 4].includes(day)) out.weekday ||= iso;
    if (day === 6) out.saturday ||= iso;
    if (day === 0) out.sunday ||= iso;
  }
  return out;
}
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

const DATES = nextDates();
console.log(`Measuring train frequency on ${Object.entries(DATES).map(([k, v]) => `${k} ${v}`).join(', ')}`);
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
    // When trains run there, and how often, through the day, on a weekday, a Saturday and a Sunday
    const service = [];
    for (const [dayType, date] of Object.entries(DATES)) {
      const q = new URLSearchParams({ 'filter[route]': route, 'filter[direction_id]': direction, 'filter[stop]': middle, 'filter[date]': date });
      const { data: day } = await get(`/schedules?${q}`);
      // Minutes after that day's midnight, from the times' own Boston clock time ("2026-10-21T05:12:00-04:00");
      // trains after midnight belong to the service day before, so count past 24:00
      const leaves = day.map((r) => r.attributes.departure_time || r.attributes.arrival_time).filter(Boolean).map((t) => {
        const [, d, h, m] = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)/.exec(t);
        return Number(h) * 60 + Number(m) + (d > date ? 1440 : 0);
      }).sort((a, b) => a - b);
      if (leaves.length < 2) continue;
      const days = { weekday: [1, 2, 3, 4, 5], saturday: [6], sunday: [0] }[dayType];
      // Parts meet at their boundaries (no gap between, say, 6:58 and 7:05); the day starts with the first train
      // and ends with the last
      const first = leaves[0], last = leaves.at(-1) + 1;
      for (const [from, to] of DAY_PARTS) {
        const start = Math.max(from * 60, first), end = Math.min(to * 60, last);
        if (start >= end) continue;
        const inPart = leaves.filter((m) => m >= from * 60 && m < to * 60);
        const partGaps = inPart.slice(1).map((m, i) => m - inPart[i]).sort((a, b) => a - b);
        const partEvery = partGaps.length ? Math.round(partGaps[Math.floor(partGaps.length / 2)]) : every;
        service.push({ days, from: hhmm(start), to: hhmm(end), every: Math.max(4, partEvery) });
      }
    }
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
      loop: false, service: service.length ? service : [{ days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '25:00', every }],
      stops: stops.map((st) => ({ ...st, at: st.at - first })), line: track.slice(first, last + 1),
    });
    console.log(`  ${line} toward ${routeInfo.attributes.direction_destinations[direction]}: ${stops.map((st) => st.name).join(' → ')}`);
    for (const sv of service) console.log(`      ${sv.days.length === 5 ? 'weekdays' : sv.days[0] === 6 ? 'Saturday' : 'Sunday'} ${sv.from}–${sv.to}: every ${sv.every} min`);
  }
}
// A branch with no trains through here in the window that day (a diversion, buses replacing trains, a holiday) keeps
// its previous data, so one unusual day doesn't take it out of routing
const previous = fs.existsSync(TRAINS_OUT) ? JSON.parse(fs.readFileSync(TRAINS_OUT, 'utf8')).routes : [];
for (const old of previous) {
  if (trainRoutes.some((r) => r.id === old.id)) continue;
  console.warn(`  ${old.name} toward ${old.toward}: no trains in today's schedule here; keeping the previous data`);
  trainRoutes.push(old);
}
const expected = Object.keys(BRANCHES).length * 2;
if (trainRoutes.length < expected) console.warn(`  Only ${trainRoutes.length} of ${expected} branch directions: check the MBTA's service changes, and run this again on a normal weekday`);
fs.writeFileSync(TRAINS_OUT, JSON.stringify({
  source: `MBTA V3 API schedules, ${new Date().toISOString().slice(0, 10)}`,
  note: 'From the MBTA schedule for a typical weekday, a Saturday and a Sunday: first and last trains, and how often they run in each part of the day.',
  routes: trainRoutes,
}) + '\n');
console.log(`Wrote ${path.relative(ROOT, TRAINS_OUT)}: ${trainRoutes.length} train routes`);
