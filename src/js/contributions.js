// Volunteers' contributions in the app: entrances, paths, and notes about buildings added on the contribute page
// (contribute.html), read back from the contributions Sheet (CONTRIBUTIONS_URL in config.js). Unverified ones are
// used in routes, marked as not checked; verified ones as checked, until they're imported into the data files
// (scripts/import-contributions.mjs). A copy is kept on this device for offline use and quick starts.

const CONTRIB_CACHE_KEY = 'accessbc.contributions';
const CONTRIB_FRESH_MS = 10 * 60 * 1000;  // a saved copy this recent is used without waiting for the network
const CONTRIB_WAIT_MS = 2500;             // otherwise wait this long for the Sheet before using the saved copy

function savedContributions() {
  try { return JSON.parse(localStorage.getItem(CONTRIB_CACHE_KEY) || 'null'); } catch { return null; }
}

// The entries in use, as quickly as possible: a recent saved copy straight away (and a fresh one fetched for next
// time), or the Sheet, or, failing that, any saved copy
async function loadContributions() {
  if (!CONTRIBUTIONS_URL) return [];
  const saved = savedContributions();
  const fetchFresh = () => fetch(CONTRIBUTIONS_URL).then((r) => r.json()).then((body) => {
    const copy = { at: Date.now(), entries: body.entries || [] };
    try { localStorage.setItem(CONTRIB_CACHE_KEY, JSON.stringify(copy)); } catch { /* storage unavailable */ }
    return copy.entries;
  });
  if (saved && Date.now() - saved.at < CONTRIB_FRESH_MS) {
    fetchFresh().catch(() => {});
    return saved.entries;
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), CONTRIB_WAIT_MS));
  const fresh = await Promise.race([fetchFresh().catch(() => null), timeout]);
  return fresh || saved?.entries || [];
}

// The map layers for volunteers' paths (dashed while unverified) and entrances, empty until the entries arrive
// (added with the other map data, so the map key can list them)
function addContributionLayers(map) {
  map.addSource('contributions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'contrib-paths', type: 'line', source: 'contributions', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#c05a00', 'line-width': 3, 'line-dasharray': ['case', ['get', 'Verified'], ['literal', [1, 0]], ['literal', [2, 1.5]]] },
  });
  map.addLayer({
    id: 'contrib-entrances', type: 'circle', source: 'contributions', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#f97b72', 'circle-stroke-color': '#c05a00', 'circle-stroke-width': 2 },
  });
  map.on('click', 'contrib-entrances', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ offset: [0, -10] }).setLngLat(e.features[0].geometry.coordinates).setHTML(`
      <h2>Accessible entrance${p.Building ? ` of ${escapeHtml(p.Building)}` : ''}</h2>
      <p>${p.Verified ? 'Added by a volunteer, and checked.' : '<strong>Added by a volunteer, not verified yet.</strong>'}</p>
      ${p.AutomaticDoor ? `<p>Automatic door: ${escapeHtml(p.AutomaticDoor)}${p.DoorButton ? ` (${escapeHtml(p.DoorButton)})` : ''}</p>` : ''}
      ${p.Comment ? `<p>${escapeHtml(p.Comment)}</p>` : ''}`).addTo(map);
  });
}

function showContributionsOnMap(map, data) {
  map.getSource('contributions')?.setData({ type: 'FeatureCollection', features: [...(data?.paths || []), ...(data?.entrances || [])] });
}

// Notes volunteers have added about a building, for its information
function buildingNotesHtml(building) {
  const notes = (routing?.contrib?.notes || []).filter((n) => n.building === building);
  if (!notes.length) return '';
  return `<h3>From volunteers</h3><ul class="around-list">${notes.map((n) => `<li>${escapeHtml(n.note)}${n.verified ? '' : ' <em>(not verified yet)</em>'}</li>`).join('')}</ul>`;
}

// A public report straight to the Sheet, as a suggestion for the admin to review. Returns whether it was sent.
async function sendReportToSheet({ about, building, lonlat, problem, details, text }) {
  if (!CONTRIBUTIONS_URL) return false;
  try {
    const entry = { kind: 'report', building: building || '', note: text, properties: { about, problem, details },
      geometry: lonlat ? { type: 'Point', coordinates: lonlat } : null };
    const res = await fetch(CONTRIBUTIONS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'add', entry }) });
    return !!(await res.json()).ok;
  } catch {
    return false;
  }
}
