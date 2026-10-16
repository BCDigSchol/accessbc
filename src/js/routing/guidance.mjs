// Turns a route into walking steps for step-by-step guidance: one step per turn, building entry or exit,
// stairs, and arrival, each with a heading (for turning the map to face the way you walk), a nearby
// landmark, and a plain-language instruction. Plain ES module, shared by the browser and Node.

import { proj, dist, unproj, nearestOnSegment } from './network.mjs';

const TURN_MIN_DEG = 35;     // smaller changes of direction are just bends in the path
const HEADING_WINDOW_M = 8;  // direction is measured over this distance, smoothing digitizing zigzags
const MERGE_UNDER_M = 6;     // turns closer together than this are one manoeuvre
const LANDMARK_MAX_M = 30;   // only name buildings this close to where a step starts

const bearing = (a, b) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI; // clockwise from north
const normalise = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function formatDistance(m) {
  return m > 805 ? `${(m / 1609.34).toFixed(1)} miles` : `${Math.max(5, Math.round((m * 3.28084) / 5) * 5).toLocaleString()} feet`;
}

// The route as a polyline in metres, with each piece's edge type and distance from the start.
function routeLine(graph, route) {
  const pts = [], types = [], info = [], at = [0], nodeAt = new Map([[0, 0]]);
  for (let i = 0; i < route.nodes.length; i++) {
    const p = proj(graph.nodes[route.nodes[i]]);
    if (i > 0) {
      const edge = graph.adjacency[route.nodes[i - 1]].find((e) => e.to === route.nodes[i]);
      // A shuttle ride follows the route line between stops
      for (const c of edge.coords?.slice(1, -1) || []) {
        const q = proj(c), len = dist(pts.at(-1), q);
        if (len < 0.01) continue;
        types.push('Ride');
        info.push(edge.shuttle);
        at.push(at.at(-1) + len);
        pts.push(q);
      }
      const len = dist(pts.at(-1), p);
      nodeAt.set(i, at.at(-1) + (len < 0.01 ? 0 : len));
      if (len < 0.01) continue;
      types.push(edge.type === 'Entrance' ? 'Exterior' : edge.type);
      info.push(edge.shuttle || (edge.seg >= 0 ? graph.lines[graph.segments[edge.seg].line].city || null : null)); // city sidewalk or shuttle details
      at.push(at.at(-1) + len);
    }
    pts.push(p);
  }
  return { pts, types, info, at, nodeAt, length: at.at(-1) };
}

// Point at distance s along the polyline.
function pointAt(line, s) {
  s = Math.max(0, Math.min(line.length, s));
  let i = 1;
  while (i < line.at.length - 1 && line.at[i] < s) i++;
  const t = (s - line.at[i - 1]) / (line.at[i] - line.at[i - 1] || 1);
  const [a, b] = [line.pts[i - 1], line.pts[i]];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// Direction of travel just after / just before distance s.
const headingAt = (line, s) => bearing(pointAt(line, s), pointAt(line, s + HEADING_WINDOW_M));
const headingBefore = (line, s) => bearing(pointAt(line, s - HEADING_WINDOW_M), pointAt(line, s));
const turnAt = (line, s) => normalise(headingAt(line, s) - headingBefore(line, s));

// Nearest building outline point to p (metres), with the building's name.
function nearestBuildingPoint(buildings, p) {
  let best = { d: Infinity };
  for (const b of buildings) {
    if (!b.name || !b.name.trim()) continue;
    if (p[0] < b.bbox[0] - LANDMARK_MAX_M || p[0] > b.bbox[2] + LANDMARK_MAX_M || p[1] < b.bbox[1] - LANDMARK_MAX_M || p[1] > b.bbox[3] + LANDMARK_MAX_M) continue;
    for (const ring of b.rings)
      for (let i = 1; i < ring.length; i++) {
        const r = nearestOnSegment(p, ring[i - 1], ring[i]);
        if (r.d < best.d) best = { d: r.d, name: b.name.trim(), point: r.point };
      }
  }
  return best;
}

// 'left' or 'right' of travel for a point, facing `heading` at `from`.
const sideOf = (from, heading, point) => {
  const h = (heading * Math.PI) / 180;
  const cross = Math.sin(h) * (point[1] - from[1]) - Math.cos(h) * (point[0] - from[0]);
  return cross > 0 ? 'left' : 'right';
};

function turnWord(deg) {
  const a = Math.abs(deg), dir = deg > 0 ? 'right' : 'left';
  if (a > 150) return 'Turn around';
  if (a > 120) return `Turn sharply ${dir}`;
  if (a > 60) return `Turn ${dir}`;
  return `Bear ${dir}`;
}

// Steps for a route: [{kind, turn, length, heading, start ([lon, lat]), coordinates, type, building, elevator,
// landmark: {name, side}, text}]. The last step has kind 'arrive' and no length. A route may carry stops
// ([{index, label}], index into route.nodes), each of which becomes a 'stop' step.
export function buildSteps(graph, route, { from, to, fromBuilding = true, toIsPlace = false }) {
  const line = routeLine(graph, route);
  const kindOf = (type) => ({ Interior: 'indoor', Stairs: 'stairs', Ride: 'shuttle', Board: 'shuttle', Alight: 'shuttle' }[type] || 'outdoor');

  // Breaks: type changes, street crossings, and turns of at least TURN_MIN_DEG.
  const breaks = [{ s: 0, kind: 'depart' }];
  const crossing = (i) => line.types[i] === 'Crossing';
  for (let i = 1; i < line.pts.length - 1; i++) {
    const s = line.at[i];
    if (kindOf(line.types[i - 1]) !== kindOf(line.types[i])) {
      const before = kindOf(line.types[i - 1]);
      breaks.push({ s, kind: { indoor: 'enter', stairs: 'stairs', shuttle: 'board', outdoor: before === 'indoor' ? 'exit' : before === 'shuttle' ? 'alight' : 'outdoor' }[kindOf(line.types[i])] });
      continue;
    }
    if (kindOf(line.types[i]) === 'shuttle') continue; // no turns while riding
    if (crossing(i) && !crossing(i - 1)) { breaks.push({ s, kind: 'cross', crossing: line.info[i] || {} }); continue; }
    if (!crossing(i) && crossing(i - 1)) { breaks.push({ s, kind: 'outdoor', afterCrossing: true }); continue; }
    if (crossing(i)) continue; // a crossing is one step, whatever its shape
    const turn = turnAt(line, s);
    if (Math.abs(turn) >= TURN_MIN_DEG) breaks.push({ s, kind: 'turn', turn });
  }

  // Turns within MERGE_UNDER_M of each other are one manoeuvre (a jog across a junction, or the same
  // turn seen at two vertices a few centimetres apart): measured once, from the direction before the
  // first to the direction after the last.
  const merged = [];
  for (const b of breaks) {
    const last = merged.at(-1);
    if (last && b.kind === 'turn' && last.kind === 'turn' && b.s - last.s < MERGE_UNDER_M) {
      last.turn = normalise(headingAt(line, b.s) - headingBefore(line, last.s));
      continue;
    }
    merged.push({ ...b });
  }
  let kept = merged.filter((b) => b.kind !== 'turn' || Math.abs(b.turn) >= TURN_MIN_DEG);
  // A turn just before a crossing is part of crossing; a turn just after one is where you go next
  kept = kept.filter((b) => b.kind !== 'turn' || !kept.some((c) => c.kind === 'cross' && c.s - b.s >= 0 && c.s - b.s < MERGE_UNDER_M));
  for (const after of kept.filter((b) => b.afterCrossing)) {
    const turn = kept.find((b) => b.kind === 'turn' && b.s - after.s >= 0 && b.s - after.s < MERGE_UNDER_M);
    if (!turn) continue;
    Object.assign(after, { kind: 'turn', turn: turn.turn });
    kept = kept.filter((b) => b !== turn);
  }

  // Stops: a step of their own, which also stands in for any turn right at the stop (e.g. back out of a door).
  for (const stop of route.stops || []) {
    const s = line.nodeAt.get(stop.index);
    if (s === undefined || s <= 0 || s >= line.length) continue;
    kept = kept.filter((b) => b.kind !== 'turn' || Math.abs(b.s - s) > MERGE_UNDER_M);
    kept.push({ s, kind: 'stop', label: stop.label });
  }
  kept.sort((a, b) => a.s - b.s);

  const steps = kept.map((b, k) => {
    const end = k + 1 < kept.length ? kept[k + 1].s : line.length;
    const startPt = pointAt(line, b.s);
    const heading = headingAt(line, b.s);
    const coordinates = [startPt, ...line.pts.filter((_, i) => line.at[i] > b.s && line.at[i] < end), pointAt(line, end)].map(unproj);
    const segIndex = Math.max(0, line.at.findIndex((a) => a > b.s) - 1);
    const type = kindOf(line.types[Math.min(segIndex, line.types.length - 1)]);
    const step = { kind: b.kind, turn: b.turn, label: b.label, length: end - b.s, heading, start: unproj(startPt), coordinates, type };
    if (b.kind === 'cross') step.crossing = b.crossing;
    // Boarding a shuttle: the route, the stop to get off at, how many stops, and the ride time
    if (b.kind === 'board') {
      const rides = [];
      for (let i = segIndex; i < line.types.length && kindOf(line.types[i]) === 'shuttle'; i++) if (line.info[i] && !rides.includes(line.info[i])) rides.push(line.info[i]);
      const first = rides[0] || {};
      step.shuttle = { route: first.route, every: first.every, from: first.from, to: rides.at(-1)?.to, stops: rides.length };
    }
    if (b.kind === 'alight') step.stop = line.info[Math.max(0, segIndex - 1)]?.to;
    // Off campus there are no BC buildings to steer by: the street you're walking along instead
    const street = line.info[Math.min(segIndex, line.info.length - 1)]?.name;
    if (street && b.kind !== 'cross') step.street = street;
    if (type === 'indoor' || b.kind === 'exit') {
      const inside = nearestBuildingPoint(graph.buildings, pointAt(line, (b.s + end) / 2));
      const before = nearestBuildingPoint(graph.buildings, pointAt(line, Math.max(0, b.s - 2)));
      step.building = type === 'indoor' ? inside.name : before.name;
      step.elevator = !!step.building && graph.elevatorBuildings.has(step.building);
    }
    if (b.kind !== 'enter' && b.kind !== 'exit' && b.kind !== 'board') {
      const near = nearestBuildingPoint(graph.buildings, pointAt(line, b.s + Math.min(15, (end - b.s) / 2)));
      if (near.d <= LANDMARK_MAX_M && type !== 'indoor') step.landmark = { name: near.name, side: sideOf(startPt, heading, near.point) };
    }
    return step;
  });

  // Arrival: which side the destination entrance is on.
  const endPt = line.pts.at(-1), lastHeading = headingAt(line, Math.max(0, line.length - HEADING_WINDOW_M));
  const target = nearestBuildingPoint(graph.buildings, endPt);
  steps.push({ kind: 'arrive', length: 0, heading: lastHeading, start: unproj(endPt), coordinates: [unproj(endPt)], type: 'outdoor',
    side: target.d < 25 && target.d > 0.5 ? sideOf(pointAt(line, line.length - 5), lastHeading, target.point) : null });

  steps.forEach((step, k) => { step.text = stepText(step, k, { from, to, fromBuilding, toIsPlace }); });
  return steps;
}

// Plain-language instruction for a step.
export function stepText(step, index, { from, to, fromBuilding, toIsPlace }) {
  const distance = step.length ? ` for ${formatDistance(step.length)}` : '';
  const landmark = step.landmark ? `, with ${step.landmark.name} on your ${step.landmark.side}` : step.street ? ` along ${step.street}` : '';
  const elevator = step.elevator ? ` ${step.building} has an elevator.` : '';
  switch (step.kind) {
    case 'depart': {
      const start = fromBuilding ? `Leave ${from} by its accessible entrance and head ${compass(step.heading)}` : `Head ${compass(step.heading)}`;
      return step.type === 'indoor' ? `${start} through ${step.building || 'the building'}${distance}.${elevator}` : `${start}${distance}${landmark}.`;
    }
    case 'turn':
      return `${turnWord(step.turn)}${step.type === 'indoor' ? ` inside ${step.building || 'the building'}` : ''} and continue${distance}${landmark}.`;
    case 'enter':
      return `Go into ${step.building || 'the building'} and follow the indoor accessible route${distance}.${elevator}`;
    case 'exit':
      return `Leave ${step.building || 'the building'} and continue outside${distance}${landmark}.`;
    case 'cross': {
      const c = step.crossing || {};
      const where = c.crossing === 'traffic_signals' ? ' at the traffic lights'
        : ['marked', 'zebra', 'uncontrolled'].includes(c.crossing) ? ' at the crosswalk'
        : c.crossing === 'unmarked' ? ', where there’s no marked crosswalk' : '';
      const curbs = { lowered: ' There are curb ramps on both sides.', flush: ' The curbs are level with the street.', raised: ' Careful: there’s a raised curb, so this crossing isn’t step-free.' }[c.kerb]
        || ' Curb ramps aren’t confirmed here.';
      return `Cross ${c.name || 'the street'}${where}.${curbs}`;
    }
    case 'stairs':
      return `Take the stairs${distance}.`;
    case 'board': {
      const ride = step.shuttle || {};
      const stops = ride.stops ? ` (${ride.stops} ${ride.stops === 1 ? 'stop' : 'stops'})` : '';
      return `At the ${ride.from || 'shuttle'} stop, take the ${ride.route || 'BC'} shuttle to ${ride.to || 'your stop'}${stops}. Shuttles come about every ${ride.every || 15} minutes.`;
    }
    case 'alight':
      return `Get off at ${step.stop || 'your stop'} and continue${distance}${landmark}.`;
    case 'outdoor':
      return `Continue outside${distance}${landmark}.`;
    case 'stop':
      return `Stop at ${step.label}. When you're ready, continue${distance}${landmark}.`;
    case 'arrive':
      if (toIsPlace) return `Arrive at ${to}${step.side ? `, on your ${step.side}` : ''}.`;
      return `Arrive at the accessible entrance of ${to}${step.side ? `. It's on your ${step.side}` : ''}.`;
    default:
      return `Continue${distance}.`;
  }
}
