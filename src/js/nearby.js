// "Find nearby": the closest vending machine, restroom, bench, etc. by walking distance on the accessible
// network (honouring the route options), measured from your location, from your starting building, or
// along your current route. Each result can become your destination, or a stop on the way.

const NEARBY_KINDS = {
  vending: { label: 'Vending machines', fields: ['Food_vend'] },
  cafe: { label: 'Cafés', fields: ['Food_cafe'] },
  dining: { label: 'Dining halls', fields: ['Food_dinin'] },
  restroom: { label: 'Single-use restrooms', fields: ['Single_res'] },
  lactation: { label: 'Lactation rooms', fields: ['Lactation'] },
  printing: { label: 'Printing', fields: ['Printing'] },
  seating: { label: 'Indoor seating', fields: ['Seating_gr', 'Seating_in'] },
  benches: { label: 'Outdoor seating', source: 'reststop', name: 'Outdoor seating' },
  bluelights: { label: 'Blue-light emergency phones', source: 'bluelights', name: 'Blue-light phone' },
  shuttle: { label: 'Shuttle stops', source: 'shuttlestops', name: 'Shuttle stop' },
  elevators: { label: 'Elevators', source: 'elevators', name: 'Elevator' },
};
const SNAP_TO_PATH_M = 40; // a point feature counts if it's this close to a mapped path
const NEARBY_RESULTS = 5;
let nearbyResults = [];
let nearbyMarker = null;

// Candidate places for a kind on a graph: [{label, building?, lonlat, nodes, offset}], cached per graph.
function nearbyCandidates(graph, kind) {
  graph.nearby ||= {};
  if (graph.nearby[kind]) return graph.nearby[kind];
  const { module, data } = routing;
  const config = NEARBY_KINDS[kind];
  let candidates;
  if (config.fields) {
    const has = new Set(data.buildings.filter((b) => config.fields.some((f) => b.properties[f] === 'Yes')).map((b) => (b.properties.NAME || '').trim()));
    const byBuilding = {};
    for (const e of graph.entrances) if (has.has(e.building)) (byBuilding[e.building] ||= []).push(e.node);
    candidates = Object.entries(byBuilding).map(([building, nodes]) => ({ label: building, building, nodes, offset: 0, lonlat: graph.nodes[nodes[0]] }));
  } else {
    const features = (routePoints && routePoints[config.source]?.features) || [];
    candidates = [];
    for (const f of features) {
      const lonlat = f.geometry.coordinates;
      const near = module.nearestNode(graph, lonlat);
      if (near.d > SNAP_TO_PATH_M) continue;
      const building = module.nearestBuilding(graph.buildings, module.proj(lonlat));
      const where = kind === 'elevators' && (f.properties.Building || '').trim() ? `in ${f.properties.Building.trim()}` : `near ${building.name}`;
      const label = `${config.name} ${where}`;
      // How it reads mid-sentence ("Arrive at the outdoor seating near Gasson Hall")
      const phrase = `the ${label[0].toLowerCase()}${label.slice(1)}`;
      candidates.push({ label, phrase, lonlat, nodes: [near.node], offset: near.d });
    }
  }
  return (graph.nearby[kind] = candidates);
}

async function findNearby(map) {
  const { module } = routing;
  const kind = document.getElementById('nearby-kind').value;
  const near = document.getElementById('nearby-from').value;
  const graph = currentGraph();
  const options = routeOptions();
  const out = document.getElementById('nearby-results');
  out.innerHTML = '<p>Searching…</p>';

  // Where to measure from
  let sources, startOffset = 0, fromWhat;
  if (near === 'route') {
    if (!routing.current) return (out.innerHTML = '<p>Find a route first, then search along it.</p>');
    sources = routing.current.route.nodes;
    fromWhat = 'route';
  } else if (near === 'start') {
    const from = document.getElementById('route-from').value;
    if (!from || from === MY_LOCATION) return (out.innerHTML = '<p>Choose a starting building under From first.</p>');
    sources = graph.entrances.filter((e) => e.building === from).map((e) => e.node);
    fromWhat = from;
  } else {
    let here;
    try {
      here = await getPosition();
    } catch {
      return (out.innerHTML = '<p>Your location isn’t available. Check that location access is allowed, or search near your starting building.</p>');
    }
    const start = module.nearestNode(graph, here);
    if (start.d > MAX_START_DISTANCE_M) return (out.innerHTML = `<p>You're ${feet(start.d)} from the nearest mapped path, so walking distances can't be measured.</p>`);
    sources = [start.node];
    startOffset = start.d;
    fromWhat = 'you';
  }

  if (Number.isFinite(options.maxGrade)) await ensureGrades(graph);
  const distances = module.walkingDistances(graph, sources, edgeCost(graph, options));
  nearbyResults = nearbyCandidates(graph, kind)
    .map((c) => ({ ...c, distance: Math.min(...c.nodes.map((n) => distances[n])) + c.offset + startOffset }))
    .filter((c) => Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_RESULTS);

  const label = NEARBY_KINDS[kind].label.toLowerCase();
  if (!nearbyResults.length) {
    out.innerHTML = `<p>No ${label} can be reached on mapped ${options.stairs ? '' : 'accessible '}paths from ${fromWhat === 'route' ? 'your route' : fromWhat === 'you' ? 'your location' : escapeHtml(fromWhat)}.</p>`;
    return;
  }
  const along = fromWhat === 'route';
  // Along a route, the start and destination buildings are already on it: say so, rather than offer them as stops.
  const ends = along ? { [document.getElementById('route-from').value]: 'your starting building', [routing.current.to]: 'your destination' } : {};
  const items = nearbyResults.map((r, i) => {
    const end = r.building && ends[r.building];
    const how = end || (along ? (r.distance < 15 ? 'on your route' : `${feet(r.distance)} off your route`) : `${feet(r.distance)} walk`);
    return `<li>
      <span class="nearby-name">${escapeHtml(r.label)}</span> <span class="nearby-distance">${how}</span>
      <span class="nearby-actions">
        ${along && !end ? `<button type="button" data-nearby-stop="${i}" aria-label="Add ${escapeHtml(r.label)} as a stop">Add as a stop</button>` : ''}
        ${end ? '' : `<button type="button" data-nearby-go="${i}" aria-label="Directions to ${escapeHtml(r.label)}">Directions</button>`}
        <button type="button" data-nearby-show="${i}" aria-label="Show ${escapeHtml(r.label)} on the map">Show</button>
      </span>
    </li>`;
  });
  out.innerHTML = `<p class="nearby-heading">Nearest ${label}${along ? ' along your route' : ''}:</p><ol class="nearby-list">${items.join('')}</ol>`;
  const first = nearbyResults[0];
  speak(`The nearest is ${first.label}, ${along ? (first.distance < 15 ? 'on your route' : `${feet(first.distance)} off your route`) : `${feet(first.distance)} away`}.`);
}

function showNearbyOnMap(map, result) {
  if (nearbyMarker) nearbyMarker.remove();
  nearbyMarker = new maplibregl.Marker({ color: '#6b2fa3' }).setLngLat(result.lonlat).addTo(map);
  moveMap(map, 'flyTo', { center: result.lonlat, zoom: Math.max(map.getZoom(), 17.5) });
}

document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('nearby-kind');
  select.innerHTML = Object.entries(NEARBY_KINDS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  document.getElementById('nearby-search').addEventListener('click', () => {
    if (routing) findNearby(window.map);
  });
  // Default to searching along the route when there is one
  document.querySelector('.nearby').addEventListener('toggle', (e) => {
    if (e.target.open && routing?.current) document.getElementById('nearby-from').value = 'route';
  });

  document.addEventListener('click', (e) => {
    const go = e.target.dataset?.nearbyGo, stop = e.target.dataset?.nearbyStop, show = e.target.dataset?.nearbyShow;
    if (go === undefined && stop === undefined && show === undefined) return;
    const result = nearbyResults[Number(go ?? stop ?? show)];
    if (!result) return;
    const map = window.map;
    if (show !== undefined) return showNearbyOnMap(map, result);
    if (nearbyMarker) { nearbyMarker.remove(); nearbyMarker = null; }
    const from = document.getElementById('route-from');
    if (stop !== undefined) {
      routing.stop = { label: result.phrase || result.label, building: result.building, lonlat: result.lonlat };
    } else {
      // Directions there: from wherever the search was measured
      const near = document.getElementById('nearby-from').value;
      if (near === 'me') from.value = MY_LOCATION;
      routing.stop = null;
      if (result.building) {
        routing.place = null;
        document.getElementById('route-to').value = result.building;
      } else {
        setPlaceDestination({ label: result.label, phrase: result.phrase, lonlat: result.lonlat });
      }
    }
    updateRoute(map);
    document.getElementById('route-result').scrollIntoView({ block: 'nearest' });
  });
});
