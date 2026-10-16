// Accessible directions: building-to-building routes on the accessible path network.
// The routing graph is built in the browser from the GeoJSON (see src/js/routing/network.mjs).

const MY_LOCATION = '__my_location__';
const PLACE = '__place__'; // a destination that isn't a building (e.g. a bench), set by "Find nearby"
const HERE = '__here__';   // a start that isn't a building: where you are partway through a trip
const MAX_STOPS = 5;

// Starting from the user's location only works if they're this close to a mapped accessible path.
const MAX_START_DISTANCE_M = 150;
const FEEDBACK_FORM = 'https://forms.gle/EqSt5qz31ub9eB5x7';

// The deploy stamps a version onto every script URL (?v=...) so browsers never mix old and new files
// after a release; the routing modules are loaded with the same stamp as this script.
const ASSET_VERSION = new URL(document.currentScript.src).search;

let routing = null; // {module, elevation, terrain, data, graphs: {accessible, withStairs}}
const OPTIONS_KEY = 'accessbc.routeOptions';
let routeMarkers = [];
let routeRequest = 0; // so a slow, superseded route lookup never overwrites a newer one

const feet = (m) => (m > 805 ? (m / 1609.34).toFixed(1) + ' mi' : Math.round(m * 3.28084).toLocaleString() + ' ft');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function setupDirections(map) {
  const base = new URL('src/', document.baseURI).href;
  const [module, elevation, guidance] = await Promise.all(['network', 'elevation', 'guidance'].map((m) => import(`${base}js/routing/${m}.mjs${ASSET_VERSION}`)));
  const load = async (name) => (await (await fetch(`${base}geojson/${name}.geojson`)).json()).features;
  const names = ['accessiblepaths', 'entrances', 'buildings', 'elevators', 'paths'];
  const [paths, entrances, buildings, elevators, footpaths] = await Promise.all(names.map(load));
  const data = { paths, entrances, buildings, elevators, footpaths };
  const accessible = module.buildGraph({ paths, entrances, buildings, elevators });
  const terrain = elevation.createTerrain(terrainTileLoader(base + 'basemap/terrain.pmtiles'), accessible.buildings);
  // stops: [{label, phrase?, building?, lonlat?}] in visiting order; an unchosen stop has neither building nor lonlat
  routing = { module, elevation, guidance, terrain, data, graphs: { accessible }, current: null, stops: [] };

  addRouteLayers(map);
  routing.pointsLoaded = loadRoutePoints().then(markReported); // full copies of the point layers, for showing only those near a route
  restoreOptions();
  populateBuildingSelects();
  // The route options, in Edit trip, also in Accessibility settings (to set once), and Avoid steep slopes on the route
  document.getElementById('set-slope').innerHTML = document.getElementById('opt-slope').innerHTML;
  syncOptionMirrors();
  for (const id of ['opt-stairs', 'opt-indoor', 'opt-slope']) {
    document.getElementById(id).addEventListener('change', (e) => setRouteOption(id, e.target.type === 'checkbox' ? e.target.checked : e.target.value));
  }
  document.getElementById('set-avoidStairs').addEventListener('change', (e) => setRouteOption('opt-stairs', e.target.checked));
  document.getElementById('set-slope').addEventListener('change', (e) => setRouteOption('opt-slope', e.target.value));
  document.addEventListener('click', async (e) => {
    if (e.target.id !== 'slope-toggle') return;
    await setRouteOption('opt-slope', document.getElementById('opt-slope').value ? '' : SLOPE_LIMIT_DEFAULT);
    document.getElementById('slope-toggle')?.focus(); // the route card is redrawn
  });

  const from = document.getElementById('route-from');
  const to = document.getElementById('route-to');
  document.getElementById('where-to').disabled = false;
  // Back from a route preview: forget the destination and stops, back to Where to?
  document.getElementById('route-back').addEventListener('click', () => {
    to.value = '';
    routing.place = null;
    routing.stops = [];
    renderStops();
    clearWhereTo();
    // The next trip starts from your location again, as in other map apps
    from.value = '';
    routing.fromChosen = false;
    routing.fromPlace = null;
    startFromMyLocation();
    updateRoute(map);
    document.getElementById('where-to').focus();
  });
  // "About <building>" in a route preview
  document.addEventListener('click', (e) => {
    const name = e.target.closest('[data-building-info]')?.dataset.buildingInfo;
    const feature = name && routing.data.buildings.find((b) => (b.properties.NAME || '').trim() === name);
    if (feature) openBuildingInfo(feature.properties);
  });
  document.getElementById('route-swap').addEventListener('click', () => {
    if ([HERE, PLACE].includes(from.value) || to.value === PLACE) return;
    [from.value, to.value] = [to.value, from.value];
    routing.fromChosen = true;
    routing.stops.reverse();
    renderStops();
    updateRoute(map);
  });
  document.getElementById('route-clear').addEventListener('click', () => {
    from.value = '';
    to.value = '';
    routing.fromChosen = false;
    startFromMyLocation(); // back to the default start
    routing.stops = [];
    renderStops();
    updateRoute(map);
  });

  // Stops: add, choose, reorder, remove
  document.getElementById('route-add-stop').addEventListener('click', () => {
    if (routing.stops.length >= MAX_STOPS) return;
    routing.stops.push({ label: '' });
    renderStops();
    document.getElementById(`stop-${routing.stops.length - 1}`)?.focus();
  });
  document.getElementById('route-stops').addEventListener('change', (e) => {
    const i = e.target.dataset.stopIndex;
    if (i === undefined) return;
    routing.stops[i] = e.target.value ? { label: e.target.value, building: e.target.value } : { label: '' };
    updateRoute(map);
  });
  document.getElementById('route-stops').addEventListener('click', (e) => {
    const { stopUp, stopDown, stopRemove } = e.target.dataset;
    const stops = routing.stops;
    if (stopUp !== undefined) [stops[stopUp - 1], stops[stopUp]] = [stops[stopUp], stops[stopUp - 1]];
    else if (stopDown !== undefined) [stops[+stopDown + 1], stops[stopDown]] = [stops[stopDown], stops[+stopDown + 1]];
    else if (stopRemove !== undefined) stops.splice(stopRemove, 1);
    else return;
    renderStops();
    updateRoute(map);
  });
  from.addEventListener('change', () => {
    routing.fromChosen = true; // the student picked a start, so keep it even if it's "My location" and that fails
    updateRoute(map);
  });
  to.addEventListener('change', () => updateRoute(map));

  // Show only the map features along the route, or all of them
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'route-focus') return;
    focusOnRoute = e.target.checked;
    if (focusOnRoute && routing.routeCoordinates) showOnlyPointsNear(map, routing.routeCoordinates);
    else showAllPoints(map);
  });

  // "Directions from/to here" buttons in the building popup
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-route-from], [data-route-to]');
    if (!button) return;
    if (button.dataset.routeFrom) {
      from.value = button.dataset.routeFrom;
      routing.fromChosen = true;
    }
    if (button.dataset.routeTo) to.value = button.dataset.routeTo;
    closeBuildingInfo();
    updateRoute(map);
    if (button.dataset.routeFrom) document.getElementById('edit-trip').open = true;
  });

  // A trip in the page address (after a reload, or from a shared link) comes back; otherwise start from your location
  if (!(await restoreTripFromUrl(map))) await startFromMyLocation();
}

// ---- The trip in the page address -------------------------------------------------------------------
// The trip (start, stops, destination, and in step-by-step mode the step you're on and whether your location is
// followed) is kept in the address, so reloading the page doesn't lose it and the link can be shared:
//   ?from=Gasson Hall&stop=Fulton Hall&to=McElroy Commons&step=3&follow=1
// "me" is your location; a place that isn't a building is "place:lon,lat:label". The address is replaced, not
// added to history, so Back still leaves the page.

const placeParam = (place) => `place:${place.lonlat[0].toFixed(6)},${place.lonlat[1].toFixed(6)}:${place.label}`;

// A place from the address. Destinations and stops are "Find nearby" places, which read as "the outdoor seating near…".
function parsePlace(value, withPhrase = false) {
  const m = /^place:(-?[\d.]+),(-?[\d.]+):(.+)$/.exec(value);
  if (!m) return null;
  const label = m[3];
  return { label, lonlat: [Number(m[1]), Number(m[2])], ...(withPhrase ? { phrase: `the ${label[0].toLowerCase()}${label.slice(1)}` } : {}) };
}

function saveTripToUrl() {
  if (!routing) return;
  const from = document.getElementById('route-from').value, to = document.getElementById('route-to').value;
  const params = new URLSearchParams();
  // "My location" by default isn't saved: it's the default again after a reload
  if (from === MY_LOCATION && routing.fromChosen) params.set('from', 'me');
  else if (from === HERE && routing.fromPlace) params.set('from', placeParam(routing.fromPlace));
  else if (from && from !== MY_LOCATION) params.set('from', from);
  for (const stop of routing.stops) if (stop.building || stop.lonlat) params.append('stop', stop.building || placeParam(stop));
  if (to === MY_LOCATION) params.set('to', 'me');
  else if (to === PLACE && routing.place) params.set('to', placeParam(routing.place));
  else if (to) params.set('to', to);
  if (guide.active) {
    params.set('step', String(guide.index + 1));
    if (guide.watch !== null) params.set('follow', '1');
  }
  const query = params.toString();
  const url = query ? `?${query}` : location.pathname;
  if (url !== location.search) history.replaceState(null, '', url);
}

// "Share this trip": a link to the destination and stops, and the start if it's a building. Never your location:
// a link without a start begins from the location of whoever opens it.
function shareTripUrl() {
  const from = document.getElementById('route-from').value, to = document.getElementById('route-to').value;
  const params = new URLSearchParams();
  if (from && ![MY_LOCATION, HERE].includes(from)) params.set('from', from);
  for (const stop of routing.stops) if (stop.building || stop.lonlat) params.append('stop', stop.building || placeParam(stop));
  if (to === PLACE && routing.place) params.set('to', placeParam(routing.place));
  else if (to && to !== MY_LOCATION) params.set('to', to);
  return `${location.origin}${location.pathname}?${params}`;
}

async function shareTrip(button) {
  if (!routing?.current) return;
  const url = shareTripUrl();
  const title = `Accessible route to ${routing.current.to}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title}, on Access BC`, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // closed the share sheet
    }
  }
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied';
    announce('Link to this trip copied. Paste it into a message or email.');
    setTimeout(() => { button.textContent = label; }, 4000);
  } catch {
    window.prompt('Copy this link to the trip:', url);
  }
}
document.addEventListener('click', (e) => {
  const button = e.target.closest('.share-trip');
  if (button) shareTrip(button);
});

// Restores a trip from the address. Returns whether there was one. Unknown buildings are ignored.
async function restoreTripFromUrl(map) {
  const params = new URLSearchParams(location.search);
  if (!params.has('to') && !params.has('from')) return false;
  const from = document.getElementById('route-from'), to = document.getElementById('route-to');
  const listed = (select, value) => [...select.options].some((o) => o.value === value);
  const f = params.get('from');
  if (f === 'me' && listed(from, MY_LOCATION)) from.value = MY_LOCATION;
  else if (f?.startsWith('place:') && parsePlace(f)) setPlaceStart(parsePlace(f));
  else if (f && listed(from, f)) from.value = f;
  if (from.value) routing.fromChosen = true;
  else await startFromMyLocation(); // none given, or not one we know
  routing.stops = params.getAll('stop')
    .map((v) => (v.startsWith('place:') ? parsePlace(v, true) : listed(to, v) ? { label: v, building: v } : null))
    .filter(Boolean).slice(0, MAX_STOPS);
  renderStops();
  const t = params.get('to');
  if (t === 'me' && listed(to, MY_LOCATION)) to.value = MY_LOCATION;
  else if (t?.startsWith('place:')) { const place = parsePlace(t, true); if (place) setPlaceDestination(place); }
  else if (t && listed(to, t)) to.value = t;

  // Back into step-by-step directions at the same step. Phones only allow speech and sound after a button press,
  // so say how to hear the step again.
  const step = Number(params.get('step'));
  if (step >= 1) routing.autoStart = { follow: params.get('follow') === '1', step: step - 1, restored: true, keepFocus: true };
  await routing.pointsLoaded; // step cues need the point layers
  updateRoute(map);
  return true;
}

// Reads terrain tiles straight from the PMTiles file and decodes them to RGBA pixels.
function terrainTileLoader(url) {
  const archive = new pmtiles.PMTiles(url);
  return async (z, x, y) => {
    const tile = await archive.getZxy(z, x, y);
    if (!tile) return null;
    // Decode without colour management, which would alter the encoded elevation values.
    const bitmap = await createImageBitmap(new Blob([tile.data], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
}

// The routing options chosen in the panel.
function routeOptions() {
  const slope = document.getElementById('opt-slope').value;
  return {
    stairs: !document.getElementById('opt-stairs').checked, // the checkbox is "Avoid stairs"
    indoor: document.getElementById('opt-indoor').value,
    maxGrade: slope ? Number(slope) : Infinity,
  };
}

// Options are remembered per browser; nothing breaks if storage is unavailable. Version 2: a 1:12 slope limit
// became the default (accessibility first), after no limit.
const OPTIONS_VERSION = 2;
function saveOptions() {
  try {
    const { stairs, indoor } = routeOptions();
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ version: OPTIONS_VERSION, stairs, indoor, slope: document.getElementById('opt-slope').value }));
  } catch { /* storage unavailable */ }
}
function restoreOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
    if (!saved) return;
    document.getElementById('opt-stairs').checked = !saved.stairs;
    document.getElementById('opt-indoor').value = saved.indoor || 'auto';
    // Options saved before version 2 had no slope limit by default: those get the new default (1:12) once
    if ((saved.version || 1) >= 2) document.getElementById('opt-slope').value = saved.slope || '';
  } catch { /* storage unavailable */ }
}

// Change a route option from any of its controls: remember it, keep the other controls in step, and find the
// route again (partway through a walk, from where you are, carrying on with walking directions).
const SLOPE_LIMIT_DEFAULT = '0.08333'; // Avoid steep slopes: 1:12, the steepest an accessible ramp may be
async function setRouteOption(id, value) {
  const control = document.getElementById(id);
  if (control.type === 'checkbox') control.checked = value;
  else control.value = value;
  saveOptions();
  syncOptionMirrors();
  if (id === 'opt-stairs') populateBuildingSelects();
  if (guide.active && routing.current) {
    prepareRerouteFromHere();
    Object.assign(routing.autoStart, { intro: 'New route, with your new route options.', keepFocus: true });
  }
  await updateRoute(window.map);
}

function syncOptionMirrors() {
  document.getElementById('set-avoidStairs').checked = document.getElementById('opt-stairs').checked;
  document.getElementById('set-slope').value = document.getElementById('opt-slope').value;
}

// The graph for the current options: accessible paths only, or with footpaths and stairs (built when first needed).
function currentGraph() {
  const { module, data, graphs } = routing;
  if (!routeOptions().stairs) return graphs.accessible;
  graphs.withStairs ||= module.buildGraph({ ...data, footpaths: data.footpaths });
  return graphs.withStairs;
}

// Edge costs for the options: forbid or discount indoor edges, and forbid edges steeper than the limit. Entrances
// and buildings reported not working (reports.js) cost much more, so they're used only when there's no other way.
function edgeCost(graph, options) {
  const preferIndoor = 0.5; // an indoor metre counts as half a metre when indoor routes are preferred
  const broken = brokenOnGraph(graph).edges;
  return (e) => {
    let cost = e.length;
    if (e.type === 'Interior') {
      if (options.indoor === 'avoid') return Infinity;
      if (options.indoor === 'prefer') cost = e.length * preferIndoor;
    }
    if (Number.isFinite(options.maxGrade) && e.seg >= 0 && graph.grades[e.seg] > options.maxGrade) return Infinity;
    return broken.has(e) ? cost + BROKEN_PENALTY_M : cost;
  };
}

// Whether a building can be routed to with the current options.
function isRoutable(building) {
  return !!routing && currentGraph().entrances.some((e) => e.building === building);
}

// The panel shows one view at a time: home (Where to?), results (nearest things), route (a route preview), or
// walk (directions as you go). Views not shown are hidden from screen readers too.
const VIEWS = ['home', 'results', 'route', 'walk'];
function setView(view) {
  const panel = document.getElementById('panel');
  panel.dataset.view = view;
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  panel.querySelector('.chips').hidden = view !== 'home';
  if (view !== 'home') {
    document.getElementById('more-kinds').hidden = true;
    document.getElementById('chip-more').setAttribute('aria-expanded', 'false');
    document.getElementById('chip-more').textContent = 'More…';
  }
  panel.querySelector('.where-to').hidden = view === 'walk';
}

function currentView() {
  return document.getElementById('panel').dataset.view;
}

// When a start is needed (no location): open Edit trip, where From is, and say so.
function askForStart(html) {
  document.getElementById('edit-trip').open = true;
  return showResult(html);
}

// Like other map apps, directions start from your location unless you choose somewhere else. Not when location
// access has been refused; when it hasn't been asked yet, the browser asks when the first route needs it (after
// the student picks a destination), not as the page loads.
async function startFromMyLocation() {
  const from = document.getElementById('route-from');
  if (!('geolocation' in navigator)) return;
  let state = 'prompt';
  try {
    state = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { /* the Permissions API isn't available: assume we can ask */ }
  if (state === 'denied' || routing.fromChosen || from.value) return;
  from.value = MY_LOCATION;
}

function populateBuildingSelects() {
  const { module } = routing;
  const graph = currentGraph();
  const from = document.getElementById('route-from'), to = document.getElementById('route-to');
  const keep = [from.value, to.value];
  const campusOfBuilding = {};
  for (const e of graph.entrances) campusOfBuilding[e.building] ||= module.campusOf(graph.nodes[e.node]);
  const names = Object.keys(campusOfBuilding).sort((a, b) => a.localeCompare(b));

  const options = Object.keys(module.CAMPUSES)
    .map((campus) => {
      const inCampus = names.filter((n) => campusOfBuilding[n] === campus);
      if (!inCampus.length) return '';
      return `<optgroup label="${campus}">${inCampus.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</optgroup>`;
    })
    .join('');
  const myLocation = 'geolocation' in navigator ? `<option value="${MY_LOCATION}">My location</option>` : '';
  routing.buildingOptions = options;
  from.innerHTML = `<option value="">Choose a starting point</option>${myLocation}${options}`;
  to.innerHTML = `<option value="">Choose a destination</option>${myLocation}${options}`;
  // Keep the current choices if they're still in the list.
  if ([...from.options].some((o) => o.value === keep[0])) from.value = keep[0];
  if (routing.place) {
    to.options[0].after(new Option(routing.place.label, PLACE));
  }
  if (routing.fromPlace) from.options[0].after(new Option(routing.fromPlace.label, HERE));
  if ([...from.options].some((o) => o.value === keep[0])) from.value = keep[0];
  renderStops();
  if ([...to.options].some((o) => o.value === keep[1])) to.value = keep[1];
  document.getElementById('route-coverage').textContent =
    `${names.length} buildings currently have a mapped accessible entrance and can be routed to.`;
}

function addRouteLayers(map) {
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const before = 'bluelight'; // keep point layers (entrances, elevators, ...) above the route
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 10 },
  }, before);
  map.addLayer({
    id: 'route-outdoor', type: 'line', source: 'route', filter: ['==', ['get', 'type'], 'outdoor'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'grade'], 'very-steep', '#c00000', 'steep', '#e07000', 'unreliable', '#8a8a8a', '#0050d0'],
      'line-width': 6,
    },
  }, before);
  map.addLayer({
    id: 'route-indoor', type: 'line', source: 'route', filter: ['==', ['get', 'type'], 'indoor'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#0050d0', 'line-width': 6, 'line-dasharray': [1, 1] },
  }, before);
  map.addLayer({
    id: 'route-stairs', type: 'line', source: 'route', filter: ['==', ['get', 'type'], 'stairs'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#b8860b', 'line-width': 7, 'line-dasharray': [0.6, 0.4] },
  }, before);

  // The current step in step-by-step mode: drawn on top, with a ring where the step starts.
  map.addSource('route-step', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-step-casing', type: 'line', source: 'route-step', filter: ['==', ['get', 'kind'], 'line'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 14 },
  }, before);
  map.addLayer({
    id: 'route-step-line', type: 'line', source: 'route-step', filter: ['==', ['get', 'kind'], 'line'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0050d0', 'line-width': 9 },
  }, before);
  map.addLayer({
    id: 'route-step-point', type: 'circle', source: 'route-step', filter: ['==', ['get', 'kind'], 'point'],
    paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-color': '#0050d0', 'circle-stroke-width': 4 },
  });
}

function getPosition() {
  return new Promise((resolve, reject) =>
    // Without a timeout, a browser with location turned off can leave this waiting forever
    navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.longitude, p.coords.latitude]), reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
  );
}

// Show a result in the panel and announce it to screen readers: the given message, or else the result's
// own text (fine for one-line messages; a found route passes a short summary instead of its step list).
function showResult(html, message) {
  const result = document.getElementById('route-result');
  result.innerHTML = html;
  const text = message ?? result.textContent.trim();
  if (text) announce(text);
}

function clearRoute(map) {
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  routeMarkers.forEach((m) => m.remove());
  routeMarkers = [];
  showAllPoints(map);
}

// While a route is shown, point layers show only features near it and path lines are dimmed, to cut the noise. How near depends on
// the feature: curb cuts and entrances on the route itself, blue-light phones and shuttle stops a little
// further. Each source's data is swapped for the nearby subset (the seating layer is clustered, so a
// filter wouldn't work) and put back when the route is cleared or the option is turned off.
const ROUTE_POINT_RADIUS_M = { entrances: 15, elevators: 15, curbcuts: 12, bluelights: 40, reststop: 30, shuttlestops: 60, bikeracks: 20 };
const DIMMED_PATH_LAYERS = ['accessiblepaths-ext', 'accessiblepaths-int', 'paths'];
const DIMMED_OPACITY = 0.25;
let pathOpacity = null; // each path layer's own line-opacity, kept while dimmed
let routePoints = null; // source name -> full FeatureCollection
let pointsFiltered = false;
let focusOnRoute = true;

async function loadRoutePoints() {
  const base = new URL('src/geojson/', document.baseURI).href;
  const entries = await Promise.all(Object.keys(ROUTE_POINT_RADIUS_M).map(async (name) => [name, await (await fetch(`${base}${name}.geojson`)).json()]));
  routePoints = Object.fromEntries(entries);
}

function showOnlyPointsNear(map, coordinates) {
  if (!routePoints || !focusOnRoute) return;
  const { proj, nearestOnSegment } = routing.module;
  const line = coordinates.map(proj);
  const distanceToRoute = (p) => {
    let d = Infinity;
    for (let i = 1; i < line.length; i++) d = Math.min(d, nearestOnSegment(p, line[i - 1], line[i]).d);
    return d;
  };
  for (const [name, collection] of Object.entries(routePoints)) {
    const radius = ROUTE_POINT_RADIUS_M[name];
    const near = collection.features.filter((f) => f.geometry && distanceToRoute(proj(f.geometry.coordinates)) <= radius);
    map.getSource(name)?.setData({ type: 'FeatureCollection', features: near });
  }
  // Dim the path lines so the route stands out; the layers' own opacity rules (e.g. interior vs. exterior)
  // are kept and scaled down.
  if (!pathOpacity) {
    pathOpacity = Object.fromEntries(DIMMED_PATH_LAYERS.map((id) => [id, map.getPaintProperty(id, 'line-opacity')]));
    for (const [id, opacity] of Object.entries(pathOpacity)) {
      const own = opacity ?? 1; // undefined means the layer uses the default, fully opaque
      map.setPaintProperty(id, 'line-opacity', typeof own === 'number' ? own * DIMMED_OPACITY : ['*', DIMMED_OPACITY, own]);
    }
  }
  pointsFiltered = true;
}

function showAllPoints(map) {
  if (!routePoints || !pointsFiltered) return;
  for (const [name, collection] of Object.entries(routePoints)) map.getSource(name)?.setData(collection);
  if (pathOpacity) {
    for (const [id, opacity] of Object.entries(pathOpacity)) map.setPaintProperty(id, 'line-opacity', opacity);
    pathOpacity = null;
  }
  pointsFiltered = false;
}

async function updateRoute(map) {
  const { module, elevation, terrain } = routing;
  const request = ++routeRequest;
  const options = routeOptions();
  const graph = currentGraph();
  const fromValue = document.getElementById('route-from').value;
  const toValue = document.getElementById('route-to').value;
  stopGuidance(map);
  routing.current = null;
  routing.routeCoordinates = null;
  clearRoute(map);
  saveTripToUrl();
  // The route view, unless a re-route mid-walk is about to go straight back into walking directions
  if (!toValue) {
    if (currentView() === 'route') setView('home');
    return showResult('');
  }
  if (!routing.autoStart) setView('route');
  const title = toValue === PLACE && routing.place ? routing.place.label : toValue === MY_LOCATION ? 'your location' : toValue;
  document.getElementById('route-title').textContent = `To ${title}`;
  if (!fromValue) return askForStart('<p>Choose where you’re starting from, under From.</p>');
  if (fromValue === toValue) return askForStart('<p>The start and destination are the same. Choose a different start, under From.</p>');

  const doors = (name) => graph.entrances.filter((e) => e.building === name).map((e) => e.node);
  // Graph nodes for a building's entrances, or for a place found by "Find nearby" ({label, building} or {label, lonlat})
  const nodesFor = (target) => (target.building ? doors(target.building) : [module.nearestNode(graph, target.lonlat).node]);
  // Your location, for a route from it (the default) or to it
  let start = null;
  if (fromValue === MY_LOCATION || toValue === MY_LOCATION) {
    showResult('<p>Finding your location…</p>');
    let here;
    try {
      here = await getPosition();
    } catch {
      if (request !== routeRequest) return;
      // From was only "My location" by default: ask for a starting point instead
      if (fromValue === MY_LOCATION && !routing.fromChosen) {
        document.getElementById('route-from').value = '';
        return askForStart('<p>Choose where you’re starting from, under From. (Your location isn’t available; to use it, allow location access for this site.)</p>');
      }
      return askForStart('<p>Your location isn\'t available. Check that location access is allowed, or choose a building instead.</p>');
    }
    if (request !== routeRequest) return;
    start = module.nearestNode(graph, here);
    if (start.d > MAX_START_DISTANCE_M) {
      if (fromValue === MY_LOCATION && !routing.fromChosen) {
        document.getElementById('route-from').value = '';
        return askForStart(`<p>Choose where you’re starting from, under From. (You’re ${feet(start.d)} from the nearest mapped campus path, so directions can’t start from where you are.)</p>`);
      }
      return askForStart(`<p>You're ${feet(start.d)} from the nearest mapped path. Choose a building instead.</p>`);
    }
  }
  const toMe = toValue === MY_LOCATION;
  const toIsPlace = toMe || (toValue === PLACE && !!routing.place);
  const toLabel = toMe ? 'your location' : toIsPlace ? routing.place.phrase || routing.place.label : toValue;
  const targets = toMe ? [start.node] : toIsPlace ? nodesFor(routing.place) : doors(toValue);
  let sources, fromLabel, startNote = '';
  if (fromValue === MY_LOCATION) {
    sources = [start.node];
    fromLabel = 'your location';
    if (start.d > 15) startNote = ` The route starts at the nearest mapped accessible path, ${feet(start.d)} from you.`;
  } else if (fromValue === HERE && routing.fromPlace) {
    sources = nodesFor(routing.fromPlace);
    fromLabel = routing.fromPlace.label;
  } else {
    sources = doors(fromValue);
    fromLabel = fromValue;
  }

  if (Number.isFinite(options.maxGrade) && !graph.grades) {
    showResult('<p>Measuring slopes…</p>');
    await ensureGrades(graph);
    if (request !== routeRequest) return;
  }

  // Through any stops in order: one leg per stop, joined into one route that records where each stop is.
  const stops = routing.stops.filter((st) => st.building || st.lonlat);
  let failedStop = null;
  const findRoute = (cost) => {
    let route = null, start = sources;
    const marks = [];
    for (const stop of [...stops, null]) {
      const leg = module.shortestRoute(graph, start, stop ? nodesFor(stop) : targets, cost);
      if (!leg) { failedStop = stop; return null; }
      route = route ? module.joinRoutes(route, leg) : leg;
      if (stop) marks.push({ index: route.nodes.length - 1, label: stop.phrase || stop.label });
      start = [leg.nodes.at(-1)];
    }
    route.stops = marks;
    return route;
  };

  // The best route that meets the options. If none does, show the best route without the indoor and
  // slope options and say which of them it breaks.
  let route = findRoute(edgeCost(graph, options));
  let unmet = '';
  if (!route && (options.indoor === 'avoid' || Number.isFinite(options.maxGrade))) {
    route = findRoute(edgeCost(graph, { ...options, indoor: 'auto', maxGrade: Infinity }));
    if (route) {
      const limits = [
        options.indoor === 'avoid' && 'avoids indoor routes',
        Number.isFinite(options.maxGrade) && `stays within ${document.getElementById('opt-slope').selectedOptions[0].dataset.label}`,
      ].filter(Boolean).join(' and ');
      unmet = `<p class="route-warning">No mapped route ${limits}. This is the best route without ${limits.includes(' and ') ? 'those settings' : 'that setting'}.</p>`;
    }
  }
  if (!route) {
    const startNode = graph.nodes[sources[0]];
    const differentCampus = module.campusOf(startNode) !== module.campusOf(graph.nodes[targets[0]]);
    const via = failedStop ? ` that reaches stop ${stops.indexOf(failedStop) + 1} (${escapeHtml(failedStop.phrase || failedStop.label)})` : '';
    return showResult(differentCampus
      ? `<p><strong>No walking route.</strong> ${escapeHtml(fromLabel)} and ${escapeHtml(toLabel)} are on different campuses. The BC shuttle connects the campuses; see the shuttle stops on the map.</p>`
      : `<p><strong>No ${options.stairs ? '' : 'accessible '}route is mapped yet</strong> between ${escapeHtml(fromLabel)} and ${escapeHtml(toLabel)}${via}. The path data still has gaps. If you know a route, please tell us through the <a href="${FEEDBACK_FORM}" target="_blank" rel="noopener">feedback form</a>.</p>`);
  }

  const description = module.describeRoute(graph, route);
  await addSlopes(description);
  if (request !== routeRequest) return;
  drawRoute(map, description);
  routing.routeCoordinates = description.steps.flatMap((st) => st.coordinates);
  showOnlyPointsNear(map, routing.routeCoordinates);

  const steps = description.steps.map((step, i) => {
    if (step.type === 'stairs') return `<li>Take the stairs: ${feet(step.length)}</li>`;
    if (step.type === 'indoor') {
      const building = step.building ? escapeHtml(step.building) : 'the building';
      return `<li>Go through ${building} (indoor accessible route${step.elevator ? '; this building has an elevator' : ''}): ${feet(step.length)}</li>`;
    }
    const unverified = step.unverifiedLength >= 10 && step.length - step.unverifiedLength >= 10
      ? ` (${feet(step.unverifiedLength)} of it on footpaths not checked for accessibility)`
      : step.unverifiedLength >= 10 ? ' (a footpath not checked for accessibility)' : '';
    const text = i === 0 ? 'Follow the outdoor path' : 'Continue on the outdoor path';
    return `<li>${text}${unverified}: ${feet(step.length)}${stepSlope(step)}</li>`;
  });
  const fromIsBuilding = fromValue !== MY_LOCATION && fromValue !== HERE; // not your location, or a spot mid-trip
  const leave = fromIsBuilding ? `<li>Leave ${escapeHtml(fromValue)} by its accessible entrance</li>` : '';
  const indoor = description.indoorLength ? `, ${feet(description.indoorLength)} of it indoors` : '';
  const stairs = description.steps.filter((st) => st.type === 'stairs').reduce((sum, st) => sum + st.length, 0);
  const stairsNote = stairs ? `<p class="route-warning">This route uses stairs (${feet(stairs)}).</p>` : '';
  const stopsSaid = stops.length ? `, with ${stops.length === 1 ? 'a stop' : `${stops.length} stops`}` : '';
  // A gentle walking pace (about 1.2 m/s); wheelchair and cane users vary, so it's only a guide
  const minutes = Math.max(1, Math.round(description.length / 1.2 / 60));
  const broken = brokenRouteNotes(graph, route, [fromIsBuilding && fromValue, !toIsPlace && toValue].filter(Boolean));
  const slopeLimit = Number.isFinite(options.maxGrade) ? document.getElementById('opt-slope').selectedOptions[0].dataset.label : '';
  const slopeSaid = slopeLimit && !unmet ? `, nothing steeper than ${slopeLimit}` : '';
  const message = `Route found: about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, ${feet(description.length)}${stairs ? ', using stairs' : ''}${slopeSaid}${stopsSaid}.${broken.text ? ` ${broken.text}` : ''}${routing.autoStart ? '' : ' Press Start to begin.'}`;
  const speaks = 'speechSynthesis' in window && !settings.screenReader;
  showResult(`
    ${unmet}
    ${broken.html}
    <p class="route-summary"><strong>About ${minutes} min</strong> · ${feet(description.length)}${indoor}${stairs ? '' : ' · <span class="badge">Step-free</span>'}</p>
    <div class="quick-option">
      <button type="button" id="slope-toggle" class="option-toggle" aria-pressed="${!!slopeLimit}" aria-describedby="slope-toggle-note">Avoid steep slopes</button>
      <span id="slope-toggle-note" class="route-note">${slopeLimit ? `On: nothing steeper than ${slopeLimit}` : 'Off: the route may have steep parts'}</span>
    </div>
    ${startNote ? `<p class="route-note">${startNote.trim()}</p>` : ''}
    ${stopNote(stops)}
    ${stairsNote}
    <button type="button" id="guidance-start-audio" class="route-start" aria-describedby="start-help">Start</button>
    <p id="start-help" class="route-note">Follows your location${speaks ? ', reads each step aloud,' : ''} and finds a new route if you go off it.</p>
    <p class="live-warning" role="note"><strong>Still in development:</strong> don’t rely on live directions as an assistive device yet. Use your usual mobility skills, and take care.</p>
    <div class="route-secondary">
      <button type="button" id="guidance-start">Preview the steps one by one</button>
      ${toMe ? '' : '<button type="button" class="share-trip">Share this trip</button>'}
      ${!toIsPlace ? `<button type="button" data-building-info="${escapeHtml(toValue)}">About ${escapeHtml(toValue)}</button>` : ''}
    </div>
    <details class="route-options route-steps-details">
      <summary>Route details</summary>
      ${slopeSummary(description)}
      <ol class="route-steps">${leave}${steps.join('')}<li>${toIsPlace ? `Arrive at ${escapeHtml(toLabel)}` : `Arrive at the accessible entrance of ${escapeHtml(toLabel)}`}</li></ol>
    </details>`, message);

  routing.current = { graph, route, from: fromLabel, to: toLabel, toIsPlace, fromBuilding: fromIsBuilding };
  // Screen readers hear the summary (showResult announces it); nothing is read aloud until you Start
  if (routing.autoStart) {
    const { follow, step, intro, keepFocus, restored } = routing.autoStart;
    routing.autoStart = null;
    await startGuidance(map, { follow, step: step || 0, intro, keepFocus });
    if (restored && (settings.readAloud || settings.soundCues)) guidanceStatus('Your trip is back where you left it. Choose Repeat to hear the current step.');
  }
}

// Slope figures for every segment of a graph, measured the first time a slope limit is used.
async function ensureGrades(graph) {
  if (graph.grades) return;
  try {
    graph.grades = await routing.elevation.segmentGrades(routing.terrain, graph);
  } catch (err) {
    console.warn('Slope estimates unavailable:', err);
    graph.grades = new Float32Array(graph.segments.length).fill(NaN);
  }
}

function stopNote(stops) {
  if (!stops.length) return '';
  const names = stops.map((st) => `<strong>${escapeHtml(st.phrase || st.label)}</strong>`);
  return `<p class="route-stop">${stops.length === 1 ? 'With a stop at' : `With ${stops.length} stops, in order:`} ${names.join(', ')}.</p>`;
}

// The stop rows between From and To. A building stop is a dropdown; a place from "Find nearby" is text.
function renderStops() {
  const list = document.getElementById('route-stops');
  const stops = routing.stops;
  list.innerHTML = stops.map((st, i) => {
    const place = st.lonlat && !st.building;
    const field = place
      ? `<span class="stop-place">${escapeHtml(st.label)}</span>`
      : `<select id="stop-${i}" data-stop-index="${i}"><option value="">Choose a stop</option>${routing.buildingOptions || ''}</select>`;
    return `<li class="stop-row">
      ${place ? `<span class="stop-label">Stop ${i + 1}</span>` : `<label class="stop-label" for="stop-${i}">Stop ${i + 1}</label>`}
      ${field}
      <span class="stop-buttons">
        <button type="button" data-stop-up="${i}" aria-label="Move stop ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-stop-down="${i}" aria-label="Move stop ${i + 1} later" ${i === stops.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" data-stop-remove="${i}" aria-label="Remove stop ${i + 1}">×</button>
      </span>
    </li>`;
  }).join('');
  stops.forEach((st, i) => {
    const select = document.getElementById(`stop-${i}`);
    if (select) select.value = st.building || '';
  });
  document.getElementById('route-add-stop').disabled = stops.length >= MAX_STOPS;
}

// Add a stop where it fits along the current route (before the first stop that comes later), or at the end.
function insertStop(stop) {
  const current = routing.current, stops = routing.stops;
  const chosen = stops.filter((st) => st.building || st.lonlat);
  if (!current || !chosen.length || !stop.lonlat) return stops.push(stop);
  const { proj, dist } = routing.module;
  const nodes = current.route.nodes, p = proj(stop.lonlat);
  let at = 0, best = Infinity;
  nodes.forEach((n, i) => { const d = dist(proj(current.graph.nodes[n]), p); if (d < best) { best = d; at = i; } });
  const marks = current.route.stops || [];
  const before = marks.findIndex((m) => m.index > at);
  if (before === -1) return stops.push(stop);
  stops.splice(stops.indexOf(chosen[before]), 0, stop);
}

// Start a route from a point that isn't a building (where you are partway through a trip).
function setPlaceStart(place) {
  routing.fromPlace = place;
  const from = document.getElementById('route-from');
  let option = from.querySelector(`option[value="${HERE}"]`);
  if (!option) {
    option = document.createElement('option');
    option.value = HERE;
    from.options[0].after(option);
  }
  option.textContent = place.label;
  from.value = HERE;
}

// Make a place found by "Find nearby" the destination.
function setPlaceDestination(place) {
  routing.place = place;
  const to = document.getElementById('route-to');
  let option = to.querySelector(`option[value="${PLACE}"]`);
  if (!option) {
    option = document.createElement('option');
    option.value = PLACE;
    to.options[0].after(option); // right after "Choose a destination" (later options sit inside campus groups)
  }
  option.textContent = place.label;
  to.value = PLACE;
}

// Adds an elevation profile to each outdoor step. Indoor steps get none: the terrain data is the ground
// outside, and says nothing about floors, ramps, or elevators inside a building.
async function addSlopes(description) {
  const { elevation, terrain } = routing;
  try {
    await Promise.all(description.steps.filter((s) => s.type === 'outdoor').map(async (step) => {
      step.profile = await elevation.profile(terrain, step.coordinates);
    }));
  } catch (err) {
    console.warn('Slope estimates unavailable:', err);
    description.steps.forEach((s) => delete s.profile);
  }
}

// Slope details for one outdoor step, e.g. ", 3 ft up, 12 ft down, steepest 6.2% downhill (steeper than 1:20)".
function stepSlope(step) {
  const p = step.profile;
  if (!p || step.length < 15) return '';
  if (step.length - p.unreliableLength < 15) return ', elevation unknown (see note above)';
  const unknown = p.unreliableLength >= 3 ? `; elevation unknown for ${feet(p.unreliableLength)}` : '';
  return `, ${feet(p.climb)} up, ${feet(p.descent)} down, steepest ${gradeText(p.maxGrade)}${unknown}`;
}

// e.g. "6.2% uphill (steeper than 1:20)"
function gradeText(grade) {
  const { elevation } = routing;
  const percent = (Math.abs(grade) * 100).toFixed(1);
  const direction = Math.abs(grade) < 0.005 ? '' : grade > 0 ? ' uphill' : ' downhill';
  const note = { 'very-steep': ' (steeper than 1:12)', steep: ' (steeper than 1:20)', gentle: '', unreliable: '' }[elevation.gradeClass(grade)];
  return `${percent}%${direction}${note}`;
}

function slopeSummary(description) {
  const profiles = description.steps.map((s) => s.profile).filter(Boolean);
  if (!profiles.length) return '';
  const climb = profiles.reduce((sum, p) => sum + p.climb, 0);
  const descent = profiles.reduce((sum, p) => sum + p.descent, 0);
  const steepest = profiles.reduce((m, p) => (Math.abs(p.maxGrade) > Math.abs(m) ? p.maxGrade : m), 0);
  const unreliable = profiles.reduce((sum, p) => sum + p.unreliableLength, 0);
  const cls = routing.elevation.gradeClass(steepest);
  const warning = {
    'very-steep': '<p class="route-warning">Part of this route is steeper than 1:12, the maximum allowed for an accessible ramp.</p>',
    steep: '<p class="route-warning">Part of this route is steeper than 1:20, the recommended maximum for an accessible walkway.</p>',
    gentle: '',
  }[cls];
  const unknown = unreliable >= 3
    ? `<p class="route-note">On ${feet(unreliable)} of this route (shown in grey) the elevation data can't be trusted, usually because of a bridge, a passage between buildings, or stairs. It's left out of these numbers.</p>` : '';
  return `<p>Outdoors it climbs <strong>${feet(climb)}</strong> and descends ${feet(descent)}. Steepest stretch: about ${gradeText(steepest)}.</p>${warning}${unknown}`;
}

function drawRoute(map, description) {
  map.getSource('route').setData({
    type: 'FeatureCollection',
    features: description.steps.flatMap((s) => (s.profile
      ? s.profile.pieces.map((p) => ({ type: 'Feature', properties: { type: 'outdoor', grade: p.class }, geometry: { type: 'LineString', coordinates: p.coordinates } }))
      : [{ type: 'Feature', properties: { type: s.type }, geometry: { type: 'LineString', coordinates: s.coordinates } }])),
  });
  const all = description.steps.flatMap((s) => s.coordinates);
  routeMarkers = [
    new maplibregl.Marker({ color: '#1a7f37' }).setLngLat(all[0]).addTo(map),
    new maplibregl.Marker({ color: '#A8100B' }).setLngLat(all.at(-1)).addTo(map),
  ];
  const bounds = all.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(all[0], all[0]));
  moveMap(map, 'fitBounds', { bounds, padding: unobstructedPadding(map), maxZoom: 18 });
}

// Map padding that keeps the route clear of the top bar, legend, and directions panel,
// wherever the current layout (desktop or phone) puts them.
function unobstructedPadding(map) {
  const view = map.getContainer().getBoundingClientRect();
  const padding = { top: 40, bottom: 40, left: 40, right: 40 };
  const overlays = ['#panel', '.panel-top', '.panel-body', '.walk-banner', '.walk-bar', '#legend'].map((sel) => document.querySelector(sel));
  for (const el of overlays) {
    if (!el || el.hidden || !el.offsetWidth) continue;
    const r = el.getBoundingClientRect();
    const covers = (a, b) => b - a > 0;
    if (r.width > view.width * 0.6) {
      // full-width bar: pad the edge it sits on
      if (r.top <= view.top + 1) padding.top = Math.max(padding.top, r.bottom - view.top + 20);
      else padding.bottom = Math.max(padding.bottom, view.bottom - r.top + 20);
    } else if (r.left - view.left < view.width / 2) {
      if (covers(r.top, r.bottom)) padding.left = Math.max(padding.left, r.right - view.left + 20);
    } else {
      padding.right = Math.max(padding.right, view.right - r.left + 20);
    }
  }
  // Leave at least a modest window for the route itself.
  const maxH = view.width - 120, maxV = view.height - 120;
  if (padding.left + padding.right > maxH) padding.left = padding.right = Math.max(20, maxH / 2);
  if (padding.top + padding.bottom > maxV) padding.bottom = Math.max(20, maxV - padding.top);
  return padding;
}

// The skip link at the top of the page goes straight to Where to?
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('skip-to-search').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('where-to').focus();
  });
});
