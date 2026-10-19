// Builds src/geojson/shuttles.json: BC's regular shuttle routes, so directions can include a shuttle ride.
//
// Usage: node scripts/shuttles.mjs
//
// Routes, stops (in order), ride times between stops, and route lines come from a snapshot of BC's public live
// shuttle tracker (bostoncollege.transloc.com, run by TransLoc). The days, hours, and frequencies aren't in the
// tracker data, so they're typed in below from BC's shuttle page:
//   https://www.bc.edu/bc-web/offices/aux-services/sites/transportation-parking/shuttles.html
// Re-run this, and check SERVICE against that page, whenever the routes or schedules change (each semester).
// Using the live tracker directly (arrival times) needs BC Transportation's agreement: see ROADMAP.md.
//
// Whether the shuttles have lifts or ramps isn't published, so the app says it isn't confirmed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/geojson/shuttles.json');
const STOPS_OUT = path.join(ROOT, 'src/geojson/shuttlestops.geojson'); // the stops, for the map and Find nearby
const TRACKER = 'https://bostoncollege.transloc.com/Services/JSONPRelay.svc/';
const SCHEDULE_PAGE = 'https://www.bc.edu/bc-web/offices/aux-services/sites/transportation-parking/shuttles.html';

// When each route runs, from BC's shuttle page (checked 2026-10-16). Keyed by tracker route id.
// days: 0 = Sunday … 6 = Saturday. Times are 24-hour "HH:MM"; past midnight continues the day ("26:00" = 2 a.m.).
// every: minutes between shuttles (the middle of a range like "8–10 minutes"). loop: the last stop runs on to the first.
// Event routes (football, holidays) aren't included.
const WEEKDAYS = [1, 2, 3, 4, 5], WEEKEND = [0, 6];
const SERVICE = {
  6: { name: 'Comm Ave Direct', loop: true, service: [{ days: WEEKDAYS, from: '07:00', to: '17:00', every: 9 }] },
  5: { name: 'Comm Ave All Stops', loop: true, service: [
    { days: WEEKDAYS, from: '17:00', to: '26:00', every: 12 },
    { days: WEEKEND, from: '08:00', to: '11:30', every: 30 },
    { days: WEEKEND, from: '11:30', to: '26:00', every: 12 },
  ] },
  14: { name: 'Newton Eagle Direct', loop: true, service: [{ days: WEEKDAYS, from: '07:00', to: '17:00', every: 9 }] },
  15: { name: 'Newton Limited', loop: true, service: [
    { days: WEEKDAYS, from: '17:00', to: '18:00', every: 10 },
    { days: WEEKEND, from: '08:15', to: '11:00', every: 30 },
  ] },
  13: { name: 'Newton All Stops', loop: true, service: [
    { days: WEEKDAYS, from: '18:00', to: '26:00', every: 12 },
    { days: WEEKEND, from: '11:00', to: '13:45', every: 30 },
    { days: WEEKEND, from: '13:45', to: '26:00', every: 12 },
  ] },
  45: { name: 'Brookline Campus', loop: true, service: [
    { days: [0, 1, 2, 3, 4], from: '07:00', to: '22:00', every: 20 },
    { days: [0, 1, 2, 3, 4], from: '22:00', to: '26:00', every: 40 },
    { days: [5, 6], from: '07:00', to: '26:00', every: 20 },
  ] },
  // Fixed departures (7:00, 7:40, 8:35, 9:20 from Reservoir; 3:10 and 5:00 p.m. from Newton): an average wait
  12: { name: 'Law School Express (morning)', loop: false, service: [{ days: WEEKDAYS, from: '06:55', to: '09:25', every: 45 }] },
  21: { name: 'Law School Express (afternoon)', loop: false, service: [{ days: WEEKDAYS, from: '15:05', to: '17:05', every: 110 }] },
  9: { name: 'Mall and Grocery Shuttle (Saturday)', loop: false, service: [{ days: [6], from: '11:00', to: '15:05', every: 60 }] },
  25: { name: 'Mall and Grocery Shuttle (Sunday)', loop: false, service: [{ days: [0], from: '11:00', to: '16:05', every: 60 }] },
  24: { name: 'Early Morning Shuttle (Newton)', loop: false, service: [
    { days: WEEKDAYS, from: '05:55', to: '06:35', every: 30 },
    { days: WEEKEND, from: '06:55', to: '07:35', every: 30 },
  ] },
};

async function tracker(method, params = {}) {
  const url = new URL(method, TRACKER);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': 'AccessBC/1.0 (Boston College accessibility map)' } });
  if (!res.ok) throw new Error(`${method}: ${res.status}`);
  return res.json();
}

// Google's encoded polyline format (precision 5) to [[lon, lat]]
function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([+(lon / 1e5).toFixed(5), +(lat / 1e5).toFixed(5)]);
  }
  return out;
}

const metres = ([lon1, lat1], [lon2, lat2]) => Math.hypot((lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110540);

// The index of the route line's point nearest each stop, in order along the line (a loop may pass a place twice)
function stopIndexes(line, stops) {
  const out = [];
  let from = 0;
  for (const stop of stops) {
    let best = { i: from, d: Infinity };
    for (let i = from; i < line.length; i++) {
      const d = metres(line[i], stop.lonlat);
      if (d < best.d) best = { i, d };
    }
    out.push(best.i);
    from = best.i;
  }
  return out;
}

async function main() {
  console.log('Reading BC’s public shuttle tracker…');
  const config = await tracker('GetMapConfig');
  const routes = await tracker('GetRoutesForMapWithScheduleWithEncodedLine', { apiKey: config.ApiKey, isDispatch: 'false' });
  const out = [];
  for (const [id, info] of Object.entries(SERVICE)) {
    const r = routes.find((x) => String(x.RouteID) === id);
    if (!r) { console.warn(`  route ${id} (${info.name}) isn't in the tracker any more: check SERVICE`); continue; }
    const line = decodePolyline(r.EncodedPolyline || '');
    let stops = r.Stops.map((s) => ({
      name: s.Description.replace(/\s*\(\d+\)\s*$/, '').trim(),
      lonlat: [+s.Longitude.toFixed(6), +s.Latitude.toFixed(6)],
      rideToNext: s.SecondsToNextStop,
      dwell: s.SecondsAtStop,
    }));
    // A loop listed with its first stop again at the end: keep it once
    if (stops.length > 1 && metres(stops[0].lonlat, stops.at(-1).lonlat) < 30 && stops[0].name === stops.at(-1).name) stops = stops.slice(0, -1);
    const at = stopIndexes(line, stops);
    stops.forEach((s, k) => { s.at = at[k]; });
    out.push({ id: Number(id), name: info.name, tracker: r.Description, color: r.MapLineColor, loop: info.loop, service: info.service, stops, line });
    console.log(`  ${info.name}: ${stops.map((s) => s.name).join(' → ')}${info.loop ? ' → (back to start)' : ''}`);
  }
  const data = {
    source: 'Snapshot of BC’s public shuttle tracker (bostoncollege.transloc.com); schedules from BC’s shuttle page',
    schedulePage: SCHEDULE_PAGE,
    snapshot: new Date().toISOString().slice(0, 10),
    routes: out,
  };
  fs.writeFileSync(OUT, JSON.stringify(data) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${out.length} routes, ${(fs.statSync(OUT).size / 1e3).toFixed(0)} kB`);

  // The stops as map points: one per place (within 20 m, or 30 m with the same name), with the routes that stop there.
  // Shelter and heater details carry over from the stops already in the file, where one is within 30 m.
  const old = fs.existsSync(STOPS_OUT) ? JSON.parse(fs.readFileSync(STOPS_OUT, 'utf8')).features : [];
  const places = [];
  for (const route of out) {
    for (const stop of route.stops) {
      // The same stop can have different names on different routes ("Reservoir T Stop", "Reservoir MBTA stop")
      let place = places.find((p) => metres(p.lonlat, stop.lonlat) < (p.name === stop.name ? 30 : 20));
      if (!place) places.push(place = { name: stop.name, lonlat: stop.lonlat, routes: [] });
      if (!place.routes.includes(route.name)) place.routes.push(route.name);
    }
  }
  const features = places.map((p, i) => {
    const before = old.find((f) => metres(f.geometry.coordinates, p.lonlat) < 30)?.properties || {};
    const properties = { OBJECTID: i + 1, Name: p.name, Routes: p.routes.join('; ') };
    for (const k of ['Sheltered', 'Heater']) if (before[k]) properties[k] = before[k];
    return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: p.lonlat } };
  });
  fs.writeFileSync(STOPS_OUT, `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`);
  console.log(`Wrote ${path.relative(ROOT, STOPS_OUT)}: ${features.length} stops`);
}

main().catch((err) => { console.error(err); process.exit(1); });
