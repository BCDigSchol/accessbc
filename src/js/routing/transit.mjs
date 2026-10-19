// BC shuttle rides in the routing graph (shuttles.json, see scripts/shuttles.mjs). Plain ES module with no
// dependencies, shared by the browser and Node scripts.
//
// Each stop gets a node, linked to the nearest walkable path. Each route gets a node at each of its stops, so a
// shuttle can be ridden through stops: boarding costs the average wait (half the time between shuttles), riding
// costs the ride time, and getting off is free. Ride edges go one way, in the route's order. Costs are in metres
// of walking at WALK_SPEED, so rides and walks compare directly.
import { proj, dist, nearestNode } from './network.mjs';

export const WALK_SPEED = 1.2; // metres a second: a gentle walking pace (wheelchair and cane users vary)
const STOP_LINK_M = 60;        // a stop more than this far from any path isn't used
const BOARDING_PENALTY_S = 60; // getting on and off, so a ride is only chosen when it saves real time
const TIME_ZONE = 'America/New_York';

const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Day of the week (0 = Sunday) and minutes since midnight in Boston, for a Date
export function bostonTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// The service a route is running at a time ({every, …}), or null. Service past midnight belongs to the day before.
export function runningService(route, date = new Date()) {
  const { day, minutes } = bostonTime(date);
  for (const s of route.service) {
    const from = minutesOf(s.from), to = minutesOf(s.to);
    if (s.days.includes(day) && minutes >= from && minutes < to) return s;
    if (to > 1440 && s.days.includes((day + 6) % 7) && minutes + 1440 >= from && minutes + 1440 < to) return s;
  }
  return null;
}

// When a route next runs, from a time: {minutes (from now), from ("HH:MM"), dayOffset}, or null within a week
export function nextService(route, date = new Date()) {
  const { day, minutes } = bostonTime(date);
  if (runningService(route, date)) return { minutes: 0, dayOffset: 0 };
  let best = null;
  for (let offset = 0; offset <= 7; offset++) {
    for (const s of route.service) {
      if (!s.days.includes((day + offset) % 7)) continue;
      const wait = offset * 1440 + minutesOf(s.from) - minutes;
      if (wait > 0 && (!best || wait < best.minutes)) best = { minutes: wait, from: s.from, dayOffset: offset };
    }
  }
  return best;
}

// Whether a route stops at both stops, in that order (a loop can go round)
export function serves(route, from, to) {
  const i = route.stops.findIndex((s) => s.name === from), j = route.stops.findIndex((s, k) => s.name === to && (route.loop || k > i));
  return i >= 0 && j >= 0 && i !== j;
}

// When a route next runs (from nextService(route, date)), in words: "today at 5 p.m.", "tomorrow at 7 a.m.",
// "on Sunday at 11 a.m.". Today and tomorrow are the real ones, also for a trip planned for another day.
export function nextServiceWords(next, date = new Date()) {
  const dayOf = (d) => d.toLocaleDateString('en-US', { timeZone: TIME_ZONE });
  const when = new Date(date.getTime() + next.dayOffset * 864e5), now = new Date();
  const day = dayOf(when) === dayOf(now) ? 'today' : dayOf(when) === dayOf(new Date(now.getTime() + 864e5)) ? 'tomorrow'
    : `on ${when.toLocaleDateString('en-US', { weekday: 'long', timeZone: TIME_ZONE })}`;
  return `${day} at ${clockTime(next.from)}`;
}

// "8:15 a.m." from "08:15" (or "26:00")
export function clockTime(hhmm) {
  const m = minutesOf(hhmm) % 1440, h = Math.floor(m / 60), min = m % 60;
  return `${h % 12 || 12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

// When a route runs, in words: "weekdays 7 a.m. – 5 p.m."
export function serviceHours(route) {
  const dayWords = (days) => {
    const key = [...days].sort().join('');
    return { 12345: 'weekdays', '06': 'weekends', '0123456': 'every day', '01234': 'Sunday to Thursday', 56: 'Friday and Saturday', 6: 'Saturdays', 0: 'Sundays' }[key]
      || days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
  };
  return route.service.map((s) => `${dayWords(s.days)} ${clockTime(s.from)} – ${clockTime(s.to)}`).join('; ');
}

// A copy of a walking graph with shuttle and train rides added, for the given routes ([{route, every}]: every in
// minutes). The walking graph's nodes keep their indexes, and graph.base is the walking graph (for snapping
// locations). With stepFree, a stop marked wheelchair: 'no' (a T station without step-free access) can't be got on
// or off at, though rides still pass through it.
export function addShuttles(base, routes, { stepFree = false } = {}) {
  const nodes = base.nodes.slice();
  const adjacency = base.adjacency.map((edges) => edges.slice());
  const addNode = (lonlat) => { nodes.push(lonlat); adjacency.push([]); return nodes.length - 1; };
  const link = (a, b, length, extra = {}) => { adjacency[a].push({ to: b, length, type: 'Link', seg: -1, ...extra }); adjacency[b].push({ to: a, length, type: 'Link', seg: -1, ...extra }); };

  // One node per stop place (stops on different routes within 25 m with the same name are one place)
  const places = [];
  const placeFor = (stop) => {
    let place = places.find((p) => p.name === stop.name && dist(proj(p.lonlat), proj(stop.lonlat)) < 25);
    if (place) return place;
    const near = nearestNode(base, stop.lonlat);
    if (near.d > STOP_LINK_M) return null;
    place = { name: stop.name, lonlat: stop.lonlat, node: addNode(stop.lonlat) };
    link(place.node, near.node, near.d);
    places.push(place);
    return place;
  };

  for (const { route, every } of routes) {
    const boardable = (stop) => !(stepFree && stop.wheelchair === 'no');
    const stops = route.stops.map((stop) => ({ stop, place: boardable(stop) ? placeFor(stop) : null }));
    // A ride node at every stop, so a ride can carry on through stops it can't be got on or off at
    const rideNodes = stops.map(({ stop }) => addNode(stop.lonlat));
    const mode = route.mode || 'shuttle';
    stops.forEach(({ stop, place }, k) => {
      if (!place) return;
      const shuttle = { route: route.name, stop: stop.name, every, mode, toward: route.toward };
      adjacency[place.node].push({ to: rideNodes[k], length: 0, type: 'Board', seg: -1, wait: (every * 60) / 2 + BOARDING_PENALTY_S, shuttle });
      adjacency[rideNodes[k]].push({ to: place.node, length: 0, type: 'Alight', seg: -1, shuttle });
    });
    const last = route.loop ? stops.length : stops.length - 1;
    for (let k = 0; k < last; k++) {
      const n = (k + 1) % stops.length;
      const a = route.stops[k], b = route.stops[n];
      const coords = n > k ? route.line.slice(a.at, b.at + 1) : [...route.line.slice(a.at), ...route.line.slice(0, b.at + 1)];
      const line = coords.length >= 2 ? coords : [a.lonlat, b.lonlat];
      let length = 0;
      for (let i = 1; i < line.length; i++) length += dist(proj(line[i - 1]), proj(line[i]));
      adjacency[rideNodes[k]].push({
        to: rideNodes[n], length, type: 'Ride', seg: -1, seconds: (a.rideToNext || length / 6) + (b.dwell || 0),
        coords: [a.lonlat, ...line, b.lonlat], shuttle: { route: route.name, from: a.name, to: b.name, every, mode, toward: route.toward },
      });
    }
  }
  return { ...base, nodes, adjacency, base: base.base || base };
}

// The cost of a shuttle edge in metres of walking at a speed (metres a second), or null for other edges
export function shuttleCost(e, speed = WALK_SPEED) {
  if (e.type === 'Board') return e.wait * speed;
  if (e.type === 'Ride') return e.seconds * speed;
  if (e.type === 'Alight') return 0;
  return null;
}
