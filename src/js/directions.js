// Accessible directions: building-to-building routes on the accessible path network.
// The routing graph is built in the browser from the GeoJSON (see src/js/routing/network.mjs).

const MY_LOCATION = '__my_location__';
// Starting from the user's location only works if they're this close to a mapped accessible path.
const MAX_START_DISTANCE_M = 150;
const FEEDBACK_FORM = 'https://forms.gle/EqSt5qz31ub9eB5x7';

let routing = null; // {module, graph, elevation, terrain}
let routeMarkers = [];
let routeRequest = 0; // so a slow, superseded route lookup never overwrites a newer one

const feet = (m) => (m > 805 ? (m / 1609.34).toFixed(1) + ' mi' : Math.round(m * 3.28084).toLocaleString() + ' ft');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function setupDirections(map) {
  const base = new URL('src/', document.baseURI).href;
  const [module, elevation] = await Promise.all([import(base + 'js/routing/network.mjs'), import(base + 'js/routing/elevation.mjs')]);
  const load = async (name) => (await (await fetch(`${base}geojson/${name}.geojson`)).json()).features;
  const [paths, entrances, buildings] = await Promise.all(['accessiblepaths', 'entrances', 'buildings'].map(load));
  const graph = module.buildGraph({ paths, entrances, buildings });
  const terrain = elevation.createTerrain(terrainTileLoader(base + 'basemap/terrain.pmtiles'), graph.buildings);
  routing = { module, graph, elevation, terrain };

  addRouteLayers(map);
  populateBuildingSelects();

  const panel = document.getElementById('directions-panel');
  const toggle = document.getElementById('directions-toggle');
  const from = document.getElementById('route-from');
  const to = document.getElementById('route-to');
  toggle.disabled = false;
  toggle.addEventListener('click', () => setPanelOpen(panel.hidden));
  document.getElementById('directions-close').addEventListener('click', () => setPanelOpen(false));
  document.getElementById('route-swap').addEventListener('click', () => {
    if (from.value === MY_LOCATION) return;
    [from.value, to.value] = [to.value, from.value];
    updateRoute(map);
  });
  document.getElementById('route-clear').addEventListener('click', () => {
    from.value = '';
    to.value = '';
    updateRoute(map);
  });
  from.addEventListener('change', () => updateRoute(map));
  to.addEventListener('change', () => updateRoute(map));

  // "Directions from/to here" buttons in the building popup
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-route-from], [data-route-to]');
    if (!button) return;
    if (button.dataset.routeFrom) from.value = button.dataset.routeFrom;
    if (button.dataset.routeTo) to.value = button.dataset.routeTo;
    document.getElementById('building-popup').classList.remove('visible');
    setPanelOpen(true);
    updateRoute(map);
  });
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

// Whether a building has an accessible entrance linked to the path network.
function isRoutable(building) {
  return !!routing && routing.graph.entrances.some((e) => e.building === building);
}

function setPanelOpen(open) {
  const panel = document.getElementById('directions-panel');
  panel.hidden = !open;
  document.getElementById('directions-toggle').setAttribute('aria-expanded', String(open));
  document.querySelector('.topnav').classList.remove('responsive');
  if (open) document.getElementById('route-from').focus();
}

function populateBuildingSelects() {
  const { module, graph } = routing;
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
  document.getElementById('route-from').innerHTML = `<option value="">Choose a starting point</option>${myLocation}${options}`;
  document.getElementById('route-to').innerHTML = `<option value="">Choose a destination</option>${options}`;
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
}

function getPosition() {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.longitude, p.coords.latitude]), reject, { enableHighAccuracy: true })
  );
}

function showResult(html) {
  document.getElementById('route-result').innerHTML = html;
}

function clearRoute(map) {
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  routeMarkers.forEach((m) => m.remove());
  routeMarkers = [];
}

async function updateRoute(map) {
  const { module, graph } = routing;
  const request = ++routeRequest;
  const fromValue = document.getElementById('route-from').value;
  const toValue = document.getElementById('route-to').value;
  clearRoute(map);
  if (!fromValue || !toValue) return showResult('');
  if (fromValue === toValue) return showResult('<p>Choose two different buildings.</p>');

  const doors = (name) => graph.entrances.filter((e) => e.building === name).map((e) => e.node);
  let sources, fromLabel, startNote = '';
  if (fromValue === MY_LOCATION) {
    showResult('<p>Finding your location…</p>');
    let here;
    try {
      here = await getPosition();
    } catch {
      if (request !== routeRequest) return;
      return showResult('<p>Your location isn\'t available. Check that location access is allowed, or choose a building to start from.</p>');
    }
    if (request !== routeRequest) return;
    const start = module.nearestNode(graph, here);
    if (start.d > MAX_START_DISTANCE_M) {
      return showResult(`<p>You're ${feet(start.d)} from the nearest mapped accessible path. Choose a building to start from instead.</p>`);
    }
    sources = [start.node];
    fromLabel = 'your location';
    if (start.d > 15) startNote = ` The route starts at the nearest mapped accessible path, ${feet(start.d)} from you.`;
  } else {
    sources = doors(fromValue);
    fromLabel = fromValue;
  }

  const route = module.shortestRoute(graph, sources, doors(toValue));
  if (!route) {
    const startNode = graph.nodes[sources[0]];
    const differentCampus = module.campusOf(startNode) !== module.campusOf(graph.nodes[doors(toValue)[0]]);
    return showResult(differentCampus
      ? `<p><strong>No walking route.</strong> ${escapeHtml(fromLabel)} and ${escapeHtml(toValue)} are on different campuses. The BC shuttle connects the campuses; see the shuttle stops on the map.</p>`
      : `<p><strong>No accessible route is mapped yet</strong> between ${escapeHtml(fromLabel)} and ${escapeHtml(toValue)}. The accessible path data still has gaps. If you know a route, please tell us through the <a href="${FEEDBACK_FORM}" target="_blank" rel="noopener">feedback form</a>.</p>`);
  }

  const description = module.describeRoute(graph, route);
  await addSlopes(description);
  if (request !== routeRequest) return;
  drawRoute(map, description);

  const steps = description.steps.map((step, i) => {
    const text = step.type === 'indoor'
      ? `Go through ${step.building ? escapeHtml(step.building) : 'the building'} (indoor accessible route)`
      : i === 0 ? 'Follow the outdoor accessible path' : 'Continue on the outdoor accessible path';
    return `<li>${text}: ${feet(step.length)}${stepSlope(step)}</li>`;
  });
  const leave = fromValue === MY_LOCATION ? '' : `<li>Leave ${escapeHtml(fromValue)} by its accessible entrance</li>`;
  const indoor = description.indoorLength ? `, ${feet(description.indoorLength)} of it indoors` : '';
  showResult(`
    <p class="route-summary"><strong>${feet(description.length)}</strong> (${Math.round(description.length)} m)${indoor}.${startNote}</p>
    ${slopeSummary(description)}
    <ol class="route-steps">${leave}${steps.join('')}<li>Arrive at the accessible entrance of ${escapeHtml(toValue)}</li></ol>`);
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
  map.fitBounds(bounds, { padding: unobstructedPadding(map), maxZoom: 18 });
}

// Map padding that keeps the route clear of the top bar, legend, and directions panel,
// wherever the current layout (desktop or phone) puts them.
function unobstructedPadding(map) {
  const view = map.getContainer().getBoundingClientRect();
  const padding = { top: 40, bottom: 40, left: 40, right: 40 };
  const overlays = ['.topnav', '#legend', '#directions-panel'].map((sel) => document.querySelector(sel));
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
