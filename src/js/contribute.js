// The contribute page (contribute.html): volunteers add entrances, paths, and notes about buildings to the
// contributions Sheet (CONTRIBUTIONS_URL in config.js; scripts/contributions/Code.gs); the admin verifies or
// rejects entries. What's added shows in Access BC straight away, marked not verified yet (contributions.js).
import { proj, unproj, nearestOnSegment, dist } from './routing/network.mjs';
import { contributionData, entryProblem } from './routing/contributions.mjs';

const BOUNDS = [[-71.215, 42.305], [-71.135, 42.360]];
const SNAP_M = 6;          // a path's end this close to an existing path joins it
const RECORD_STEP_M = 4;   // recording a walk: a point every so many metres
const RECORD_ACCURACY_M = 15;
const MINE_KEY = 'accessbc.contributions.mine', PASS_KEY = 'accessbc.contributions.passcode', WHO_KEY = 'accessbc.contributions.who';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const feet = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };

async function post(body) {
  const res = await fetch(CONTRIBUTIONS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  return res.json();
}

// ---- The map ----

let map, existingLines = [];
const drawing = { point: null, path: [], mode: null }; // mode: 'point' | 'draw' | null

function setupMap() {
  maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
  const base = new URL('src/basemap/', document.baseURI).href;
  map = new maplibregl.Map({
    container: 'map', center: [-71.1708, 42.3362], zoom: 16, maxBounds: BOUNDS,
    style: { version: 8, glyphs: `${base}fonts/{fontstack}/{range}.pbf`, sprite: `${base}sprites/white`, layers: BASEMAP_STYLES.white,
      sources: { protomaps: { type: 'vector', url: `pmtiles://${base}basemap.pmtiles`, attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } } },
  });
  window.map = map; // as on the main page, for checking it in a browser's console (and the browser tests)
  map.on('load', async () => {
    for (const name of ['buildings', 'accessiblepaths', 'entrance-links', 'entrances']) map.addSource(name, { type: 'geojson', data: `src/geojson/${name}.geojson` });
    map.addSource('contributions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('drawing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#8fb3d9', 'fill-opacity': 0.45 } });
    map.addLayer({ id: 'paths', type: 'line', source: 'accessiblepaths', paint: { 'line-color': ['match', ['get', 'Type'], 'Interior', '#5F4690', '#0F8554'], 'line-width': 2 } });
    map.addLayer({ id: 'links', type: 'line', source: 'entrance-links', paint: { 'line-color': '#0F8554', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
    map.addLayer({ id: 'contrib-paths', type: 'line', source: 'contributions', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#c05a00', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'entrances', type: 'circle', source: 'entrances', paint: { 'circle-radius': 4, 'circle-color': '#f97b72' } });
    map.addLayer({ id: 'contrib-entrances', type: 'circle', source: 'contributions', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#f97b72', 'circle-stroke-color': '#c05a00', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'drawing-line', type: 'line', source: 'drawing', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#c00000', 'line-width': 4 } });
    map.addLayer({ id: 'drawing-points', type: 'circle', source: 'drawing', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#c00000', 'circle-stroke-width': 3 } });
    // Existing lines, for joining a new path's ends to them; and what's been added so far
    const [paths, links] = await Promise.all(['accessiblepaths', 'entrance-links'].map(async (n) => (await (await fetch(`src/geojson/${n}.geojson`)).json()).features));
    existingLines = [...paths, ...links].filter((f) => f.properties.Type !== 'Interior').flatMap((f) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates])).map((c) => c.map(proj));
    if (CONTRIBUTIONS_URL) {
      try {
        const { entries = [] } = await (await fetch(CONTRIBUTIONS_URL)).json();
        const data = contributionData(entries);
        map.getSource('contributions').setData({ type: 'FeatureCollection', features: [...data.paths, ...data.entrances] });
      } catch { /* shown when the Sheet answers */ }
    }
  });
  map.on('click', (e) => {
    const lonlat = [e.lngLat.lng, e.lngLat.lat];
    if (drawing.mode === 'point') setPoint(lonlat, 'chosen on the map');
    if (drawing.mode === 'draw') addPathPoint(lonlat, true);
  });
}

function redraw() {
  const features = [];
  if (drawing.point) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: drawing.point } });
  for (const c of drawing.path) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
  if (drawing.path.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawing.path } });
  map?.getSource('drawing')?.setData({ type: 'FeatureCollection', features });
}

function setPoint(lonlat, how) {
  drawing.point = lonlat.map((n) => +n.toFixed(7));
  $('point-status').textContent = `Entrance at ${drawing.point[1].toFixed(5)}, ${drawing.point[0].toFixed(5)} (${how}).`;
  redraw();
}

// The nearest point on an existing path within SNAP_M, or the point itself
function snap(lonlat) {
  const p = proj(lonlat);
  let best = { d: SNAP_M, point: null };
  for (const line of existingLines) for (let i = 1; i < line.length; i++) {
    const r = nearestOnSegment(p, line[i - 1], line[i]);
    if (r.d < best.d) best = r;
  }
  return best.point ? unproj(best.point) : lonlat;
}

function pathLength() {
  let m = 0;
  for (let i = 1; i < drawing.path.length; i++) m += dist(proj(drawing.path[i - 1]), proj(drawing.path[i]));
  return m;
}

function showPathStatus() {
  $('path-status').textContent = drawing.path.length ? `${drawing.path.length} points, about ${feet(pathLength())}.` : 'No points yet.';
}

function addPathPoint(lonlat, snapEnds) {
  // The first point joins a path it starts on; each new last point does too (and the one before stays as drawn)
  drawing.path.push((snapEnds ? snap(lonlat) : lonlat).map((n) => +n.toFixed(7)));
  redraw();
  showPathStatus();
}

// Recording a walk: a point every few metres, from accurate fixes only
let watch = null;
function setRecording(on) {
  $('record').setAttribute('aria-pressed', String(on));
  $('record').textContent = on ? 'Stop recording' : 'Record as I walk';
  if (!on) {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    if (drawing.path.length >= 2) drawing.path[drawing.path.length - 1] = snap(drawing.path.at(-1)); // the end joins a path
    redraw();
    return;
  }
  watch = navigator.geolocation.watchPosition((pos) => {
    if (pos.coords.accuracy > RECORD_ACCURACY_M) return void ($('path-status').textContent = `Waiting for a more accurate location (now within ${feet(pos.coords.accuracy)})…`);
    const here = [pos.coords.longitude, pos.coords.latitude];
    const last = drawing.path.at(-1);
    if (last && dist(proj(last), proj(here)) < RECORD_STEP_M) return;
    addPathPoint(drawing.path.length ? here : snap(here), false);
  }, () => { $('path-status').textContent = 'Your location isn’t available.'; setRecording(false); }, { enableHighAccuracy: true });
}

// ---- Adding ----

const kind = () => document.querySelector('input[name="kind"]:checked').value;

function showKind() {
  for (const el of document.querySelectorAll('.kind-entrance')) el.hidden = kind() !== 'entrance';
  for (const el of document.querySelectorAll('.kind-path')) el.hidden = kind() !== 'path';
  $('building-field').hidden = kind() === 'path';
  drawing.mode = null;
  $('pick-point').setAttribute('aria-pressed', 'false');
  $('draw').setAttribute('aria-pressed', 'false');
}

function currentEntry() {
  const k = kind();
  const entry = { kind: k, contributor: $('contributor').value.trim(), email: $('email').value.trim(), note: $('note').value.trim(), building: k === 'path' ? '' : $('building').value };
  if (k === 'entrance') {
    entry.geometry = drawing.point && { type: 'Point', coordinates: drawing.point };
    entry.properties = { stepFree: $('step-free').value, automaticDoor: $('automatic-door').value === 'button' ? 'yes' : $('automatic-door').value || undefined, button: $('automatic-door').value === 'button' ? ($('button-where').value.trim() || 'push button') : undefined };
  }
  if (k === 'path') {
    entry.geometry = drawing.path.length >= 2 && { type: 'LineString', coordinates: drawing.path };
    entry.properties = { stepFree: $('path-step-free').value, surface: $('surface').value || undefined, curbRamps: $('curb-ramps').value || undefined };
  }
  return entry;
}

function showMine() {
  const mine = store.get(MINE_KEY, []);
  $('mine').innerHTML = mine.length ? mine.slice(-10).reverse().map((m) => `<li>${escapeHtml(m.what)} <span class="route-note">(${escapeHtml(m.at)}, not verified yet)</span></li>`).join('') : '<li class="route-note">Nothing yet.</li>';
}

async function submit() {
  const entry = currentEntry();
  const problem = entryProblem(entry);
  if (problem) return void ($('submit-status').textContent = problem);
  const passcode = $('passcode').value;
  if (!passcode) return void ($('submit-status').textContent = 'Enter the volunteer passcode first.');
  if (!$('email').checkValidity() || !entry.email) {
    $('email').focus();
    return void ($('submit-status').textContent = 'Enter your email, so the Access BC team knows who added this.');
  }
  $('submit-status').textContent = 'Adding…';
  try {
    const result = await post({ action: 'add', passcode, entry });
    if (!result.ok) return void ($('submit-status').textContent = `Not added: ${result.error}`);
    if ($('remember').checked) store.set(PASS_KEY, passcode);
    store.set(WHO_KEY, { email: entry.email, name: entry.contributor });
    const what = entry.kind === 'entrance' ? `Entrance of ${entry.building}` : entry.kind === 'path' ? `A path, about ${feet(pathLength())}` : `A note about ${entry.building}`;
    store.set(MINE_KEY, [...store.get(MINE_KEY, []), { id: result.id, what, at: new Date().toLocaleString() }]);
    showMine();
    $('submit-status').textContent = `Added: ${what}. It's in Access BC now, marked not verified yet. Thank you!`;
    // Ready for the next one
    drawing.point = null; drawing.path = []; $('note').value = ''; redraw(); showPathStatus(); $('point-status').textContent = '';
  } catch {
    $('submit-status').textContent = 'Couldn’t reach the contributions Sheet. Check your connection and try again.';
  }
}

// ---- Reviewing ----

let reviewing = [];
const STATUS_WORDS = { suggestion: 'Suggestion from the public (not in use)', unverified: 'In use, not verified yet', verified: 'Verified', rejected: 'Rejected', imported: 'Imported into the data files' };

function entrySummary(e) {
  const p = e.properties || {};
  const bits = [e.kind === 'report' ? p.about : e.building, e.kind === 'path' && e.geometry ? `${e.geometry.coordinates.length} points` : '',
    p.problem, p.stepFree && `step-free: ${p.stepFree}`, p.surface && `surface: ${p.surface}`, p.automaticDoor && `automatic door: ${p.automaticDoor}`].filter(Boolean);
  return bits.join(' · ');
}

function renderEntries() {
  const order = { suggestion: 0, unverified: 1, verified: 2, rejected: 3, imported: 4 };
  const list = [...reviewing].sort((a, b) => order[a.status] - order[b.status] || String(b.created).localeCompare(String(a.created)));
  $('entries').innerHTML = list.length ? `<ol class="review-items">${list.map((e) => `
    <li class="review-item"><fieldset>
      <legend>${escapeHtml({ entrance: 'Entrance', path: 'Path', building: 'Building note', report: 'Report' }[e.kind] || e.kind)}: ${escapeHtml(entrySummary(e))}</legend>
      <p><strong>${escapeHtml(STATUS_WORDS[e.status] || e.status)}</strong>${e.reviewed_by ? ` (by ${escapeHtml(e.reviewed_by)})` : ''}</p>
      ${e.note ? `<p>${escapeHtml(e.note)}</p>` : ''}
      <p class="route-note">${escapeHtml([e.contributor, e.email && `<${e.email}>`].filter(Boolean).join(' ') || (e.source === 'public' ? 'A member of the public' : 'No name'))}, ${escapeHtml(String(e.created).slice(0, 16).replace('T', ' '))} · ${escapeHtml(e.id)}</p>
      ${e.geometry ? `<button type="button" data-show="${escapeHtml(e.id)}">Show on the map</button>` : ''}
      ${['suggestion', 'unverified', 'rejected'].includes(e.status) ? `<button type="button" data-review="${escapeHtml(e.id)}" data-status="verified">Verify</button>` : ''}
      ${['suggestion', 'unverified', 'verified'].includes(e.status) ? `<button type="button" data-review="${escapeHtml(e.id)}" data-status="rejected">Reject</button>` : ''}
    </fieldset></li>`).join('')}</ol>` : '<p>No entries yet.</p>';
}

async function loadEntries() {
  $('review-status').textContent = 'Loading…';
  try {
    const result = await post({ action: 'list', adminPasscode: $('admin').value });
    if (result.error) return void ($('review-status').textContent = result.error);
    reviewing = result.entries;
    const waiting = reviewing.filter((e) => ['suggestion', 'unverified'].includes(e.status)).length;
    $('review-status').textContent = `${reviewing.length} entries; ${waiting} waiting for review.`;
    renderEntries();
  } catch {
    $('review-status').textContent = 'Couldn’t reach the contributions Sheet.';
  }
}

async function review(id, status) {
  const result = await post({ action: 'review', adminPasscode: $('admin').value, id, status, by: $('reviewer').value.trim() });
  if (!result.ok) return void ($('review-status').textContent = result.error || 'Not changed.');
  const e = reviewing.find((x) => x.id === id);
  Object.assign(e, { status, reviewed_by: $('reviewer').value.trim() });
  $('review-status').textContent = `${status === 'verified' ? 'Verified' : 'Rejected'}: ${entrySummary(e)}.`;
  renderEntries();
}

function showEntry(e) {
  const g = e.geometry;
  if (g.type === 'Point') { drawing.point = g.coordinates; drawing.path = []; map.flyTo({ center: g.coordinates, zoom: 19 }); }
  else { drawing.point = null; drawing.path = g.coordinates; map.fitBounds(g.coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(g.coordinates[0], g.coordinates[0])), { padding: 60, maxZoom: 19 }); }
  redraw();
}

// ---- The page ----

async function main() {
  $('not-set-up').hidden = !!CONTRIBUTIONS_URL;
  $('submit').disabled = $('load-entries').disabled = !CONTRIBUTIONS_URL;
  setupMap();
  const buildings = (await (await fetch('src/geojson/buildings.geojson')).json()).features.map((f) => (f.properties.NAME || '').trim()).filter(Boolean);
  $('building').innerHTML += [...new Set(buildings)].sort((a, b) => a.localeCompare(b)).map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  $('passcode').value = store.get(PASS_KEY, '');
  $('remember').checked = !!$('passcode').value;
  const who = store.get(WHO_KEY, {});
  $('email').value = who.email || '';
  $('contributor').value = who.name || '';
  showKind();
  showMine();
  showPathStatus();

  for (const r of document.querySelectorAll('input[name="kind"]')) r.addEventListener('change', showKind);
  $('use-location').addEventListener('click', () => {
    $('point-status').textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition((pos) => {
      setPoint([pos.coords.longitude, pos.coords.latitude], `your location, within ${feet(pos.coords.accuracy)}`);
      map.flyTo({ center: drawing.point, zoom: 19 });
    }, () => { $('point-status').textContent = 'Your location isn’t available: choose the spot on the map instead.'; }, { enableHighAccuracy: true, timeout: 15000 });
  });
  const toggleMode = (button, mode) => {
    drawing.mode = drawing.mode === mode ? null : mode;
    button.setAttribute('aria-pressed', String(drawing.mode === mode));
    map.getCanvas().style.cursor = drawing.mode ? 'crosshair' : '';
  };
  $('pick-point').addEventListener('click', (e) => toggleMode(e.currentTarget, 'point'));
  $('draw').addEventListener('click', (e) => toggleMode(e.currentTarget, 'draw'));
  $('record').addEventListener('click', () => setRecording(watch === null));
  $('undo').addEventListener('click', () => { drawing.path.pop(); redraw(); showPathStatus(); });
  $('clear-path').addEventListener('click', () => { drawing.path = []; redraw(); showPathStatus(); });
  $('submit').addEventListener('click', submit);
  $('load-entries').addEventListener('click', loadEntries);
  $('entries').addEventListener('click', (e) => {
    const { show, review: id, status } = e.target.dataset;
    if (show) showEntry(reviewing.find((x) => x.id === show));
    if (id) review(id, status);
  });
  for (const [tab, section] of [['tab-add', 'add'], ['tab-review', 'review']]) {
    $(tab).addEventListener('click', () => {
      for (const [t, s] of [['tab-add', 'add'], ['tab-review', 'review']]) { $(t).setAttribute('aria-pressed', String(t === tab)); $(s).hidden = s !== section; }
      $(section).querySelector('input, button').focus();
    });
  }
}

main();
