// MBTA Green Line stations near campus (mbta-stations.geojson, see scripts/mbta.mjs): on the map, in Where to?, in
// Find nearby, and as the start or end of a trip. Whether each is wheelchair accessible comes with the data; elevator
// outages and other access problems, and the next trains, are fetched live from the MBTA when a station's
// information or a route to or from it is shown.

const MBTA_API = 'https://api-v3.mbta.com';
// The kinds of alert that matter for getting into and through a station, or for the trains not running there
const MBTA_EFFECTS = new Set(['ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'ACCESS_ISSUE', 'STATION_CLOSURE', 'STOP_CLOSURE', 'SUSPENSION', 'SHUTTLE']);
const MBTA_ALERTS_FRESH_MS = 2 * 60 * 1000;
const mbtaAlertCache = new Map(); // station id -> {at, alerts}
const MBTA_TRAINS_FRESH_MS = 30 * 1000;
const TRAINS_SHOWN = 2; // per direction
const mbtaTrainCache = new Map(); // station id -> {at, trains}

// The next trains leaving a station, live: [{line, toward, minutes: [n, …], accessible}] by direction, or null if
// the MBTA can't be reached. At the end of a line (Boston College, Cleveland Circle) the MBTA predicts trains
// arriving, not leaving, since each turns round there: those come back as {line, arriving: true, minutes}.
async function mbtaTrains(stationId) {
  const cached = mbtaTrainCache.get(stationId);
  if (cached && Date.now() - cached.at < MBTA_TRAINS_FRESH_MS) return cached.trains;
  try {
    const query = new URLSearchParams({ 'filter[stop]': stationId, 'filter[route]': 'Green-B,Green-C,Green-D', include: 'trip', sort: 'departure_time' });
    const res = await fetch(`${MBTA_API}/predictions?${query}`);
    if (!res.ok) return null;
    const body = await res.json();
    const trips = new Map((body.included || []).filter((i) => i.type === 'trip').map((i) => [i.id, i.attributes]));
    const groups = new Map(), arrivals = new Map();
    for (const p of body.data) {
      const leaves = p.attributes.departure_time && Date.parse(p.attributes.departure_time);
      const arrives = p.attributes.arrival_time && Date.parse(p.attributes.arrival_time);
      if (!leaves && arrives && arrives > Date.now() - 30000) {
        const line = `Green Line ${p.relationships.route.data.id.replace('Green-', '')}`;
        arrivals.set(line, [...(arrivals.get(line) || []), Math.max(0, Math.round((arrives - Date.now()) / 60000))]);
        continue;
      }
      if (!leaves || leaves < Date.now() - 30000) continue;
      const trip = trips.get(p.relationships.trip.data?.id) || {};
      const line = `Green Line ${p.relationships.route.data.id.replace('Green-', '')}`;
      const key = `${line}|${trip.headsign}`;
      if (!groups.has(key)) groups.set(key, { line, toward: trip.headsign || 'its destination', minutes: [], accessible: [] });
      const g = groups.get(key);
      if (g.minutes.length < TRAINS_SHOWN) {
        g.minutes.push(Math.max(0, Math.round((leaves - Date.now()) / 60000)));
        g.accessible.push(trip.wheelchair_accessible);
      }
    }
    const trains = [...groups.values()].map((g) => ({ ...g, accessible: g.accessible.every((a) => a === 1) ? 'yes' : g.accessible.some((a) => a === 2) ? 'no' : 'unknown' }));
    // The end of a line: arriving trains, for lines with no departures predicted
    for (const [line, minutes] of arrivals) {
      if (!trains.some((t) => t.line === line)) trains.push({ line, arriving: true, minutes: minutes.sort((a, b) => a - b).slice(0, TRAINS_SHOWN) });
    }
    mbtaTrainCache.set(stationId, { at: Date.now(), trains });
    return trains;
  } catch {
    return null;
  }
}

function trainsHtml(trains) {
  if (trains === null) return `<p class="route-note">Live train times aren’t available${navigator.onLine ? ' right now' : ' offline'}.</p>`;
  if (!trains.length) return '<p class="route-note">No trains are expected to leave there soon (MBTA, live).</p>';
  const when = (m) => (m === 0 ? 'now' : `${m} min`);
  return `<h3 class="mbta-heading">Next trains <span class="route-note">(MBTA, live)</span></h3>
    <ul class="mbta-trains">${trains.map((t) => (t.arriving
      ? `<li><strong>${escapeHtml(t.line)}</strong>: trains arrive at the end of the line in ${t.minutes.map(when).join(' and ')}, and leave again from here toward downtown a few minutes later</li>`
      : `<li><strong>${escapeHtml(t.line)}</strong> toward ${escapeHtml(t.toward)}: ${t.minutes.map(when).join(', ')}${t.accessible === 'no' ? ' <span class="nearby-broken">(not all wheelchair accessible)</span>' : ''}</li>`)).join('')}</ul>`;
}

const stationLabel = (f) => `${f.properties.Name} T station`;
const stationFeatures = () => routePoints?.['mbta-stations']?.features || [];
const stationByLabel = (label) => stationFeatures().find((f) => stationLabel(f) === label);

// Current alerts for a station that affect access ([{effect, header}]), or null if the MBTA can't be reached
async function mbtaAlerts(stationId) {
  const cached = mbtaAlertCache.get(stationId);
  if (cached && Date.now() - cached.at < MBTA_ALERTS_FRESH_MS) return cached.alerts;
  try {
    const query = new URLSearchParams({ 'filter[stop]': stationId, 'filter[datetime]': 'NOW' });
    const res = await fetch(`${MBTA_API}/alerts?${query}`);
    if (!res.ok) return null;
    const alerts = (await res.json()).data.map((a) => a.attributes).filter((a) => MBTA_EFFECTS.has(a.effect))
      .map((a) => ({ effect: a.effect, header: a.header }));
    mbtaAlertCache.set(stationId, { at: Date.now(), alerts });
    return alerts;
  } catch {
    return null;
  }
}

// The nearest wheelchair-accessible station to a station that isn't (straight-line), for the notes
function nearestAccessibleStation(feature) {
  const { proj, dist } = routing.module;
  const p = proj(feature.geometry.coordinates);
  return stationFeatures().filter((f) => f.properties.Wheelchair === 'yes')
    .map((f) => ({ f, d: dist(p, proj(f.geometry.coordinates)) })).sort((a, b) => a.d - b.d)[0];
}

function accessibilityLine(feature) {
  const p = feature.properties;
  if (p.Wheelchair === 'yes') return `${escapeHtml(p.Name)} station is wheelchair accessible (MBTA).`;
  const other = p.Wheelchair === 'no' && nearestAccessibleStation(feature);
  const instead = other ? ` The nearest accessible station is ${escapeHtml(other.f.properties.Name)} (${escapeHtml(other.f.properties.Lines)}), about ${feet(other.d)} away.` : '';
  return p.Wheelchair === 'no' ? `<strong>${escapeHtml(p.Name)} station isn’t wheelchair accessible</strong> (MBTA).${instead}` : `Whether ${escapeHtml(p.Name)} station is wheelchair accessible isn’t known.`;
}

function alertsHtml(alerts) {
  if (alerts === null) return `<p class="route-note">Live MBTA alerts aren’t available${navigator.onLine ? ' right now' : ' offline'}. Check <a href="https://www.mbta.com/alerts/access" target="_blank" rel="noopener">mbta.com/alerts</a>.</p>`;
  if (!alerts.length) return '<p class="route-note">No elevator, access, or service alerts there right now (MBTA, live).</p>';
  return `<ul class="mbta-alerts">${alerts.map((a) => `<li>${escapeHtml(a.header)}</li>`).join('')}</ul>`;
}

// A station's map popup: its line, accessibility, live alerts (filled in when they arrive), and directions
function stationPopupHtml(feature) {
  const p = feature.properties, coords = feature.geometry.coordinates.join(',');
  return `<h2>${escapeHtml(p.Name)} station</h2>
    <p>${escapeHtml(p.Lines)}</p>
    <p>${accessibilityLine(feature)}</p>
    <div class="mbta-live" data-mbta-alerts="${escapeHtml(p.Id)}"><p class="route-note">Checking MBTA alerts…</p></div>
    <div class="mbta-live" data-mbta-trains="${escapeHtml(p.Id)}"><p class="route-note">Checking train times…</p></div>
    <button type="button" data-place-directions="${coords}" data-label="${escapeHtml(stationLabel(feature))}">Directions here</button>
    <button type="button" data-place-from="${coords}" data-label="${escapeHtml(stationLabel(feature))}">Directions from here</button>
    <a href="https://www.mbta.com/stops/${encodeURIComponent(p.Id)}" target="_blank" rel="noopener">Station page (MBTA)</a>`;
}

async function fillStationAlerts(element) {
  const alerts = element.querySelector('[data-mbta-alerts]'), trains = element.querySelector('[data-mbta-trains]');
  await Promise.all([
    alerts && mbtaAlerts(alerts.dataset.mbtaAlerts).then((a) => { alerts.innerHTML = alertsHtml(a); }),
    trains && mbtaTrains(trains.dataset.mbtaTrains).then((t) => { trains.innerHTML = trainsHtml(t); }),
  ]);
}

// On a route to or from a station: its accessibility and live alerts, under the route summary
async function showStationNotes() {
  const box = document.getElementById('station-notes');
  if (!box) return;
  const ends = [
    document.getElementById('route-from').value === HERE && routing.fromPlace && stationByLabel(routing.fromPlace.label),
    document.getElementById('route-to').value === PLACE && routing.place && stationByLabel(routing.place.label),
  ].filter(Boolean);
  if (!ends.length) return;
  const parts = await Promise.all(ends.map(async (f) => {
    const [alerts, trains] = await Promise.all([mbtaAlerts(f.properties.Id), mbtaTrains(f.properties.Id)]);
    const warn = f.properties.Wheelchair === 'no' || (alerts && alerts.length);
    // Live train times are for now: for a trip planned for later, they'd mislead
    const times = routing.departAt ? '<p class="route-note">Train times: see <a href="https://www.mbta.com/schedules/Green" target="_blank" rel="noopener">mbta.com</a> for the time you’re leaving.</p>' : trainsHtml(trains);
    return `<div class="${warn ? 'route-warning' : 'route-note'} station-note"><p>${accessibilityLine(f)}</p>${alertsHtml(alerts)}${times}</div>`;
  }));
  box.innerHTML = parts.join('');
  if (ends.some((f) => f.properties.Wheelchair === 'no')) announce(box.textContent.trim());
}

document.addEventListener('DOMContentLoaded', () => {
  // "Directions from here": the trip starts at the station; choose where to, if there's no destination yet
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-place-from]');
    if (!button || !routing) return;
    document.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove());
    setPlaceStart({ label: button.dataset.label, lonlat: button.dataset.placeFrom.split(',').map(Number) });
    routing.fromChosen = true;
    if (document.getElementById('route-to').value) {
      updateRoute(window.map);
      document.getElementById('route-title').focus();
      return;
    }
    setView('route');
    document.getElementById('route-title').textContent = `From ${button.dataset.label}`;
    askForStart('<p>Choose where you’re going, under To.</p>');
    document.getElementById('route-to').focus();
  });
});
