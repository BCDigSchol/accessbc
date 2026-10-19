// MBTA Green Line stations near campus (mbta-stations.geojson, see scripts/mbta.mjs): on the map, in Where to?, in
// Find nearby, and as the start or end of a trip. Whether each is wheelchair accessible comes with the data; elevator
// outages and other access problems are fetched live from the MBTA when a station's information or a route to or
// from it is shown.

const MBTA_API = 'https://api-v3.mbta.com';
// The kinds of alert that matter for getting into and through a station, or for the trains not running there
const MBTA_EFFECTS = new Set(['ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'ACCESS_ISSUE', 'STATION_CLOSURE', 'STOP_CLOSURE', 'SUSPENSION', 'SHUTTLE']);
const MBTA_ALERTS_FRESH_MS = 2 * 60 * 1000;
const mbtaAlertCache = new Map(); // station id -> {at, alerts}

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
    <button type="button" data-place-directions="${coords}" data-label="${escapeHtml(stationLabel(feature))}">Directions here</button>
    <button type="button" data-place-from="${coords}" data-label="${escapeHtml(stationLabel(feature))}">Directions from here</button>
    <a href="https://www.mbta.com/stops/${encodeURIComponent(p.Id)}" target="_blank" rel="noopener">Station page (MBTA)</a>`;
}

async function fillStationAlerts(element) {
  const box = element.querySelector('[data-mbta-alerts]');
  if (!box) return;
  box.innerHTML = alertsHtml(await mbtaAlerts(box.dataset.mbtaAlerts));
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
    const alerts = await mbtaAlerts(f.properties.Id);
    const warn = f.properties.Wheelchair === 'no' || (alerts && alerts.length);
    return `<div class="${warn ? 'route-warning' : 'route-note'} station-note"><p>${accessibilityLine(f)}</p>${alertsHtml(alerts)}</div>`;
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
