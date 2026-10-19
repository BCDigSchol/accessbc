// Tests for the routing modules the site uses (src/js/routing/): the graph builder, routes, step-by-step wording,
// shuttle rides and schedules, and slopes. Small made-up networks test each rule; the real campus data checks that
// whole routes still work.
//
// Usage: node --test tests/routing/   (no packages needed; Node 20 or later)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from '../../src/js/routing/network.mjs';
import * as transit from '../../src/js/routing/transit.mjs';
import { buildSteps } from '../../src/js/routing/guidance.mjs';
import { segmentGrades } from '../../src/js/routing/elevation.mjs';
import { load, ROOT } from '../../scripts/routing/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/geojson', name), 'utf8'));

// ---- Made-up networks, in metres around the campus origin ----

const at = (x, y) => net.unproj([x, y]);
let fid = 0;
const line = (Type, points, extra = {}) => ({ type: 'Feature', properties: { Type, FID: `t${++fid}`, ...extra }, geometry: { type: 'LineString', coordinates: points.map(([x, y]) => at(x, y)) } });
const sidewalk = (Type, points, city = {}) => ({ type: 'Feature', properties: { Type, osm: ++fid, ...city }, geometry: { type: 'LineString', coordinates: points.map(([x, y]) => at(x, y)) } });
const building = (name, x, y, half = 10) => ({ type: 'Feature', properties: { NAME: name }, geometry: { type: 'Polygon', coordinates: [[[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half], [x - half, y - half]].map(([a, b]) => at(a, b))] } });
const entrance = (id, name, x, y) => ({ type: 'Feature', properties: { OBJECTID: id, Building: name, Status: 'Working' }, geometry: { type: 'Point', coordinates: at(x, y) } });
const doors = (graph, name) => graph.entrances.filter((e) => e.building === name).map((e) => e.node);
const route = (graph, from, to, cost) => net.shortestRoute(graph, doors(graph, from), doors(graph, to), cost);

// Two buildings 200 m apart, with a path between their entrances
const twoBuildings = (paths) => ({
  paths,
  buildings: [building('West Hall', 0, 20), building('East Hall', 200, 20)],
  entrances: [entrance(1, 'West Hall', 0, 9), entrance(2, 'East Hall', 200, 9)],
});

test('entrances link to an outdoor path within 15 m, and not beyond', () => {
  const near = net.buildGraph(twoBuildings([line('Exterior', [[0, 0], [200, 0]])]));
  assert.deepEqual(near.entrances.map((e) => e.building).sort(), ['East Hall', 'West Hall']);
  const far = net.buildGraph({ ...twoBuildings([line('Exterior', [[0, -20], [200, -20]])]) });
  assert.equal(far.entrances.length, 0, 'entrances 29 m from the path are not linked');
});

test('a route between buildings follows the path, and is about as long as it', () => {
  const graph = net.buildGraph(twoBuildings([line('Exterior', [[0, 0], [100, 0], [200, 0]])]));
  const r = route(graph, 'West Hall', 'East Hall');
  assert.ok(r, 'a route is found');
  assert.ok(Math.abs(r.length - 218) < 3, `length ${r.length} is the path plus the two door links`);
});

test('an entrance link (Connector) makes an unconnected entrance routable, and counts as not checked', () => {
  const paths = [line('Exterior', [[0, -40], [200, -40]]), line('Connector', [[0, 9], [0, -40]]), line('Connector', [[200, 9], [200, -40]])];
  const graph = net.buildGraph(twoBuildings(paths));
  const r = route(graph, 'West Hall', 'East Hall');
  assert.ok(r, 'routable through the links');
  const d = net.describeRoute(graph, r);
  const unverified = d.steps.reduce((s, st) => s + st.unverifiedLength, 0);
  assert.ok(unverified > 90, `the links (98 m) count as not checked: ${unverified}`);
});

test('city sidewalks join BC paths where one ends near the other, and make an otherwise unreachable building reachable', () => {
  // BC path ends at x = 100; a city sidewalk starts 10 m on, and reaches East Hall's side
  const data = {
    ...twoBuildings([line('Exterior', [[0, 0], [100, 0]])]),
    sidewalks: [sidewalk('Sidewalk', [[110, 0], [200, 0]])],
  };
  // East Hall's entrance links to the outdoor path only if it's BC's or a Connector: add a link to the sidewalk
  data.paths.push(line('Connector', [[200, 9], [200, 0]]));
  assert.equal(route(net.buildGraph({ ...data, sidewalks: [] }), 'West Hall', 'East Hall'), null, 'no route on campus paths alone');
  const graph = net.buildGraph(data);
  const r = route(graph, 'West Hall', 'East Hall');
  assert.ok(r, 'a route on campus paths and city sidewalks');
  const types = new Set(r.nodes.slice(1).map((n, i) => graph.adjacency[r.nodes[i]].find((e) => e.to === n).type));
  assert.ok(types.has('Link') && types.has('Sidewalk'), `uses the join and the sidewalk: ${[...types]}`);
});

test('a bridge or tunnel sidewalk does not join a path it crosses', () => {
  const data = {
    ...twoBuildings([line('Exterior', [[0, 0], [200, 0]])]),
    sidewalks: [sidewalk('Sidewalk', [[100, -50], [100, 50]], { level: true })],
  };
  const graph = net.buildGraph(data);
  const crossingNode = net.nearestNode(graph, at(100, 0));
  const types = new Set(graph.adjacency[crossingNode.node].map((e) => e.type));
  assert.ok(!(types.has('Sidewalk') && types.has('Exterior')), 'no junction between the bridge and the path below');
});

test('a street crossing is its own step, named, with its curb ramps', () => {
  // West Hall's path → a sidewalk along Beacon Street → a crossing of Beacon Street → a sidewalk → East Hall
  const data = {
    paths: [line('Exterior', [[0, 9], [0, 0]]), line('Connector', [[200, 9], [200, 40]])],
    buildings: [building('West Hall', 0, 20), building('East Hall', 200, 20)],
    entrances: [entrance(1, 'West Hall', 0, 9), entrance(2, 'East Hall', 200, 9)],
    sidewalks: [
      sidewalk('Sidewalk', [[0, 0], [100, 0]], { name: 'Beacon Street' }),
      sidewalk('Crossing', [[100, 0], [100, 40]], { name: 'Beacon Street', crossing: 'traffic_signals', kerb: 'lowered' }),
      sidewalk('Sidewalk', [[100, 40], [200, 40]], { name: 'Beacon Street' }),
    ],
  };
  const graph = net.buildGraph(data);
  const r = route(graph, 'West Hall', 'East Hall');
  assert.ok(r, 'a route');
  const texts = buildSteps(graph, r, { from: 'West Hall', to: 'East Hall' }).map((s) => s.text);
  assert.ok(texts.some((t) => t === 'Cross Beacon Street at the traffic lights. There are curb ramps on both sides.'), texts.join('\n'));
  assert.ok(texts.some((t) => /along Beacon Street/.test(t)), 'steps on the sidewalk name the street');
});

test('an unconfirmed crossing says its curb ramps are not confirmed', () => {
  const data = {
    paths: [line('Exterior', [[0, 9], [0, 0]]), line('Connector', [[200, 9], [200, 40]])],
    buildings: [building('West Hall', 0, 20), building('East Hall', 200, 20)],
    entrances: [entrance(1, 'West Hall', 0, 9), entrance(2, 'East Hall', 200, 9)],
    sidewalks: [
      sidewalk('Sidewalk', [[0, 0], [100, 0]]),
      sidewalk('Crossing', [[100, 0], [100, 40]], { name: 'Hammond Street', crossing: 'unmarked', kerb: 'unknown' }),
      sidewalk('Sidewalk', [[100, 40], [200, 40]]),
    ],
  };
  const graph = net.buildGraph(data);
  const texts = buildSteps(graph, route(graph, 'West Hall', 'East Hall'), { from: 'West Hall', to: 'East Hall' }).map((s) => s.text);
  assert.ok(texts.includes('Cross Hammond Street, where there’s no marked crosswalk. Curb ramps aren’t confirmed here.'), texts.join('\n'));
});

// A sidewalk with a jog in it (a step sideways and back, as at a driveway), from West Hall towards East Hall
const jogData = (Type) => ({
  paths: [line('Exterior', [[0, 9], [0, 0]]), line('Connector', [[200, 9], [200, 6]]),
    ...(Type === 'Exterior' ? [line('Exterior', [[0, 0], [80, 0], [86, 6], [200, 6]])] : [])],
  buildings: [building('West Hall', 0, 20), building('East Hall', 200, 20)],
  entrances: [entrance(1, 'West Hall', 0, 9), entrance(2, 'East Hall', 200, 9)],
  sidewalks: Type === 'Sidewalk' ? [sidewalk('Sidewalk', [[0, 0], [80, 0], [86, 6], [200, 6]], { name: 'Beacon Street' })] : [],
});

test('on city sidewalks, a jog (a turn and a turn back) is not a step; on campus paths it is', () => {
  const steps = (data) => { const g = net.buildGraph(data); return buildSteps(g, route(g, 'West Hall', 'East Hall'), { from: 'West Hall', to: 'East Hall' }); };
  const city = steps(jogData('Sidewalk')).filter((st) => st.kind === 'turn' && Math.abs(st.turn) < 60);
  const campus = steps(jogData('Exterior')).filter((st) => st.kind === 'turn' && Math.abs(st.turn) < 60);
  assert.equal(city.length, 0, city.map((st) => st.text).join('\n'));
  assert.equal(campus.length, 2, 'on campus, both bends are kept (they may be a ramp’s switchbacks)');
});

test('crossings right after one another are one step', () => {
  const data = {
    paths: [line('Exterior', [[0, 9], [0, 0]]), line('Connector', [[200, 9], [200, 40]])],
    buildings: [building('West Hall', 0, 20), building('East Hall', 200, 20)],
    entrances: [entrance(1, 'West Hall', 0, 9), entrance(2, 'East Hall', 200, 9)],
    sidewalks: [
      sidewalk('Sidewalk', [[0, 0], [100, 0]]),
      sidewalk('Crossing', [[100, 0], [100, 15]], { name: 'Service Road', crossing: 'marked', kerb: 'lowered' }),
      sidewalk('Sidewalk', [[100, 15], [100, 20]]),
      sidewalk('Crossing', [[100, 20], [100, 40]], { name: 'Grant Avenue', crossing: 'marked', kerb: 'flush' }),
      sidewalk('Sidewalk', [[100, 40], [200, 40]]),
    ],
  };
  const g = net.buildGraph(data);
  const texts = buildSteps(g, route(g, 'West Hall', 'East Hall'), { from: 'West Hall', to: 'East Hall' }).map((st) => st.text);
  assert.ok(texts.includes('Cross Service Road, then Grant Avenue at the crosswalk. There are curb ramps or level curbs at each.'), texts.join('\n'));
  assert.equal(texts.filter((t) => t.startsWith('Cross')).length, 1);
});

// ---- Slopes ----

test('segment slopes record the climb and the descent the way the path was drawn', async () => {
  // Ground rising 6% to the north; one path drawn northwards, one southwards
  const terrain = { ensureTiles: async () => {}, elevation: ([, lat]) => (lat - 42.335) * 110540 * 0.06 };
  const graph = net.buildGraph({
    paths: [line('Exterior', [[0, 0], [0, 100]]), line('Exterior', [[50, 100], [50, 0]])],
    buildings: [], entrances: [],
  });
  const grades = await segmentGrades(terrain, graph);
  const north = graph.segments.findIndex((s) => graph.lines[s.line].coordinates[0][0] === at(0, 0)[0]);
  const south = graph.segments.findIndex((s) => s !== graph.segments[north]);
  assert.ok(Math.abs(grades.up[north] - 0.06) < 0.01 && grades.down[north] < 0.01, `northwards: up ${grades.up[north]}, down ${grades.down[north]}`);
  assert.ok(Math.abs(grades.down[south] - 0.06) < 0.01 && grades.up[south] < 0.01, `southwards: up ${grades.up[south]}, down ${grades.down[south]}`);
  assert.ok(Math.abs(grades[north] - 0.06) < 0.01, 'the steepest either way');
});

// ---- Shuttles ----

const route24 = { name: 'Late Loop', loop: false, service: [{ days: [1, 2, 3, 4, 5], from: '17:00', to: '26:00', every: 12 }], stops: [], line: [] };
// Boston is UTC-4 in October
const boston = (iso) => new Date(`${iso}-04:00`);

test('shuttle schedules: running times, including service past midnight', () => {
  assert.equal(transit.runningService(route24, boston('2026-10-14T18:00:00'))?.every, 12, 'Wednesday 6 p.m.');
  assert.equal(transit.runningService(route24, boston('2026-10-14T16:59:00')), null, 'Wednesday before 5 p.m.');
  assert.ok(transit.runningService(route24, boston('2026-10-17T01:30:00')), 'Saturday 1:30 a.m. is Friday night’s service');
  assert.equal(transit.runningService(route24, boston('2026-10-18T01:30:00')), null, 'Sunday 1:30 a.m.: no Saturday service');
  assert.equal(transit.runningService(route24, boston('2026-10-17T02:00:00')), null, 'ends at 2 a.m.');
});

test('shuttle schedules: when the next service starts, and how to say it', () => {
  const next = transit.nextService(route24, boston('2026-10-17T09:00:00')); // Saturday morning
  assert.deepEqual({ from: next.from, dayOffset: next.dayOffset }, { from: '17:00', dayOffset: 2 }, 'Monday at 5 p.m.');
  assert.equal(transit.clockTime('26:00'), '2 a.m.');
  assert.equal(transit.clockTime('08:15'), '8:15 a.m.');
  assert.equal(transit.nextServiceWords({ dayOffset: 0, from: '17:00' }), 'today at 5 p.m.');
  assert.equal(transit.nextServiceWords({ dayOffset: 1, from: '07:00' }), 'tomorrow at 7 a.m.');
  assert.equal(transit.serviceHours(route24), 'weekdays 5 p.m. – 2 a.m.');
});

test('shuttle rides go one way, cost the wait and the ride, and get their own steps', () => {
  // A 1 km path; a shuttle from a stop at the west end to one at the east end, 2 minutes' ride, every 10 minutes
  const graph = net.buildGraph(twoBuildings([line('Exterior', [[0, 0], [500, 0], [1000, 0]])].concat()));
  graph.entrances.length = 0;
  const shuttle = { name: 'Test Express', loop: false, service: [], line: [at(0, -5), at(1000, -5)],
    stops: [{ name: 'West stop', lonlat: at(0, -5), rideToNext: 120, dwell: 0, at: 0 }, { name: 'East stop', lonlat: at(1000, -5), rideToNext: 0, dwell: 0, at: 1 }] };
  const g = transit.addShuttles(graph, [{ route: shuttle, every: 10 }]);
  const cost = (e) => transit.shuttleCost(e) ?? e.length;
  const west = net.nearestNode(graph, at(0, 0)).node, east = net.nearestNode(graph, at(1000, 0)).node;
  const eastbound = net.shortestRoute(g, [west], [east], cost), westbound = net.shortestRoute(g, [east], [west], cost);
  const rides = (r) => r.nodes.slice(1).filter((n, i) => g.adjacency[r.nodes[i]].find((e) => e.to === n).type === 'Ride').length;
  assert.equal(rides(eastbound), 1, 'eastbound takes the shuttle (5 min wait + 2 min ride + 1 min, against 14 min walking)');
  assert.equal(rides(westbound), 0, 'westbound walks: the shuttle only goes east');
  const cheaper = transit.shuttleCost({ type: 'Board', wait: 360 }, 0.8) < transit.shuttleCost({ type: 'Board', wait: 360 }, 1.4);
  assert.ok(cheaper, 'at a slower pace, waiting costs fewer metres of walking');
  const texts = buildSteps(g, eastbound, { from: 'here', to: 'there', fromBuilding: false, toIsPlace: true }).map((s) => s.text);
  assert.ok(texts.some((t) => t.startsWith('At the West stop, take the Test Express shuttle to East stop (1 stop)')), texts.join('\n'));
  assert.ok(texts.some((t) => t.startsWith('Get off at East stop')), texts.join('\n'));
});

test('trains pass through stations, and avoiding stairs, are boarded and left only at accessible ones', () => {
  // A 3 km path; a train calling at West (accessible), Middle (not), and East (accessible), 2 minutes apart
  const graph = net.buildGraph({ paths: [line('Exterior', [[0, 0], [1500, 0], [3000, 0]])], buildings: [], entrances: [] });
  const train = { name: 'Green Line T', mode: 'train', toward: 'East', loop: false, service: [], line: [at(0, -5), at(1500, -5), at(3000, -5)],
    stops: [{ name: 'West', lonlat: at(0, -5), rideToNext: 120, at: 0, wheelchair: 'yes' }, { name: 'Middle', lonlat: at(1500, -5), rideToNext: 120, at: 1, wheelchair: 'no' },
      { name: 'East', lonlat: at(3000, -5), rideToNext: 0, at: 2, wheelchair: 'yes' }] };
  const cost = (e) => transit.shuttleCost(e) ?? e.length;
  const node = (x) => net.nearestNode(graph, at(x, 0)).node;
  const ridesIn = (g, r) => r.nodes.slice(1).filter((n, i) => g.adjacency[r.nodes[i]].find((e) => e.to === n).type === 'Ride').length;
  const stepFree = transit.addShuttles(graph, [{ route: train, every: 8 }], { stepFree: true });
  const any = transit.addShuttles(graph, [{ route: train, every: 8 }]);
  assert.equal(ridesIn(stepFree, net.shortestRoute(stepFree, [node(0)], [node(3000)], cost)), 2, 'West to East rides through Middle');
  assert.equal(ridesIn(stepFree, net.shortestRoute(stepFree, [node(0)], [node(1500)], cost)), 0, 'avoiding stairs, no getting off at Middle: walk');
  assert.equal(ridesIn(any, net.shortestRoute(any, [node(0)], [node(1500)], cost)), 1, 'allowing stairs, Middle is a stop');
  const r = net.shortestRoute(stepFree, [node(0)], [node(3000)], cost);
  const texts = buildSteps(stepFree, r, { from: 'here', to: 'there', fromBuilding: false, toIsPlace: true }).map((s) => s.text);
  assert.ok(texts.includes('At West station, take a Green Line T train toward East to East (2 stops). Trains come about every 8 minutes.'), texts.join('\n'));
});

test('mbta-trains.json: each branch through campus, with service for every day and no gaps within a day', () => {
  const { routes } = readJson('mbta-trains.json');
  assert.equal(routes.length, 6, 'B, C and D, both directions');
  for (const r of routes) {
    assert.ok(r.stops.length >= 2 && r.stops.slice(0, -1).every((st) => st.rideToNext > 0), `${r.name} toward ${r.toward}: ride times`);
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const parts = r.service.filter((sv) => sv.days.includes(day)).sort((a, b) => a.from.localeCompare(b.from));
      assert.ok(parts.length, `${r.name} toward ${r.toward} runs on day ${day}`);
      parts.slice(1).forEach((sv, i) => assert.equal(sv.from, parts[i].to, `${r.name} toward ${r.toward}, day ${day}: no gap at ${parts[i].to}`));
    }
  }
  const d = routes.find((r) => r.id === 'Green-D-0');
  assert.ok(transit.runningService(d, boston('2026-10-21T07:00:00')), 'a D train at 7 a.m. on a Wednesday (a part boundary)');
  assert.equal(transit.runningService(d, boston('2026-10-21T03:30:00')), null, 'no trains at 3:30 a.m.');
});

// ---- The real campus data ----

const data = {
  paths: [...load('accessiblepaths.geojson'), ...load('entrance-links.geojson')],
  entrances: load('entrances.geojson'), buildings: load('buildings.geojson'), elevators: load('elevators.geojson'),
};
const campus = net.buildGraph(data);

test('campus: routes between well-used buildings still work', () => {
  for (const [from, to] of [['Gasson Hall', 'McElroy Commons'], ["O'Neill Library", 'Gasson Hall'], ['Stokes Hall', 'Robsham Theater']]) {
    const r = route(campus, from, to);
    assert.ok(r, `${from} → ${to}`);
    assert.ok(r.length < 1200, `${from} → ${to} is ${Math.round(r.length)} m`);
  }
});

test('campus: Gasson Hall to McElroy Commons goes through Stokes Hall', () => {
  const steps = net.describeRoute(campus, route(campus, 'Gasson Hall', 'McElroy Commons')).steps;
  assert.ok(steps.some((s) => s.type === 'indoor' && s.building === 'Stokes Hall'), steps.map((s) => `${s.type} ${s.building || ''}`).join(', '));
});

test('campus and city: Newton campus and buildings reached only by entrance links are routable', () => {
  const city = net.buildGraph({ ...data, sidewalks: load('sidewalks.geojson').filter((f) => f.properties.Type !== 'Stairs' && !f.properties.rough && f.properties.kerb !== 'raised') });
  assert.equal(route(campus, 'Gasson Hall', 'Kenny Cottle Library'), null, 'campus paths alone don’t reach Newton');
  assert.ok(route(city, 'Gasson Hall', 'Kenny Cottle Library'), 'with city sidewalks, they do');
  assert.ok(route(city, 'Gasson Hall', 'Murray House'), 'Murray House, through its entrance link');
});

test('shuttles.json: every route has ordered stops with ride times, and valid schedules', () => {
  const { routes } = readJson('shuttles.json');
  for (const r of routes) {
    assert.ok(r.stops.length >= 2, r.name);
    assert.ok(r.stops.slice(0, -1).every((s) => Number.isFinite(s.rideToNext) && s.rideToNext >= 0), `${r.name}: ride times`);
    for (const s of r.service) assert.match(`${s.from} ${s.to}`, /^\d\d:\d\d \d\d:\d\d$/, `${r.name}: times`);
  }
  assert.ok(transit.serves(routes.find((r) => r.name === 'Newton Eagle Direct'), 'Main Gate Chestnut Hill', 'Stuart'), 'the Eagle Direct goes from the Main Gate to Stuart');
});
