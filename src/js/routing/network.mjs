// Builds a routable graph from the accessible path GeoJSON, and finds shortest routes on it.
// Plain ES module with no dependencies, shared by the browser and the Node scripts in scripts/routing/.
//
// The path data was digitized without enforced topology, so the graph builder repairs it:
// - vertices within SAME_POINT_M are merged into one node
// - a dangling path end within JOIN_GAP_M of another path is joined to it
// - exterior paths that cross without a shared vertex get a junction node (interior crossings are
//   left alone, since interior paths on different floors can cross in plan view)
// - a vertex snapped onto the middle of another path becomes a junction
// - each entrance is linked to the nearest outdoor path and the nearest indoor path of its own
//   building, each within ENTRANCE_LINK_M

export const SAME_POINT_M = 0.25;
export const JOIN_GAP_M = 2;
export const REVIEW_GAP_M = 10;
export const ENTRANCE_LINK_M = 15;

// ---- Geometry: flat projection to metres around the campus (error well under 1% across all campuses)

const LON0 = -71.175, LAT0 = 42.335;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540;
export const proj = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const unproj = ([x, y]) => [+(x / KX + LON0).toFixed(7), +(y / KY + LAT0).toFixed(7)];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const parts = (g) => (g.type.startsWith('Multi') ? g.coordinates : [g.coordinates]);

export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const point = [a[0] + t * dx, a[1] + t * dy];
  return { point, t, d: dist(p, point) };
}

// Interior intersection of segments p1-p2 and p3-p4, or null (touching at endpoints doesn't count).
function segmentIntersection(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (!d) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { point: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])], t, u };
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function projectBuildings(buildingFeatures) {
  return buildingFeatures.map((b) => ({
    name: b.properties.NAME,
    rings: (b.geometry.type === 'MultiPolygon' ? b.geometry.coordinates.flat(1) : b.geometry.coordinates).map((r) => r.map(proj)),
  }));
}

// The building containing p (distance 0), else the one with the nearest outline.
export function nearestBuilding(buildings, p) {
  let best = { d: Infinity };
  for (const b of buildings) {
    if (b.rings.some((r) => pointInRing(p, r))) return { name: b.name, d: 0 };
    for (const ring of b.rings)
      for (let i = 1; i < ring.length; i++) {
        const r = nearestOnSegment(p, ring[i - 1], ring[i]);
        if (r.d < best.d) best = { name: b.name, d: r.d };
      }
  }
  return best;
}

// ---- Raw network: the paths exactly as drawn -------------------------------------------------

// Vertices clustered into nodes and consecutive vertices joined by segments. No repairs.
export function buildNetwork(pathFeatures) {
  const nodes = []; // {xy, lines: Set}
  const byCell = new Map(); // 1 m grid cell -> node ids, so clustering only checks neighbours
  const nodeAt = (xy) => {
    const cx = Math.floor(xy[0]), cy = Math.floor(xy[1]);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of byCell.get(`${cx + dx},${cy + dy}`) || []) if (dist(nodes[i].xy, xy) < SAME_POINT_M) return i;
    nodes.push({ xy, lines: new Set() });
    const key = `${cx},${cy}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(nodes.length - 1);
    return nodes.length - 1;
  };
  const segments = []; // {a, b, line, type}
  const lines = []; // {fid, type, comment, length}
  for (const f of pathFeatures) {
    for (const coords of parts(f.geometry)) {
      const line = lines.length;
      const ids = coords.map((c) => nodeAt(proj(c)));
      let length = 0;
      for (let i = 1; i < ids.length; i++) {
        if (ids[i] === ids[i - 1]) continue;
        segments.push({ a: ids[i - 1], b: ids[i], line, type: f.properties.Type });
        length += dist(nodes[ids[i - 1]].xy, nodes[ids[i]].xy);
      }
      ids.forEach((n) => nodes[n].lines.add(line));
      lines.push({ fid: f.properties.FID, type: f.properties.Type, comment: (f.properties.Comment || '').trim(), length });
    }
  }
  const degree = new Array(nodes.length).fill(0);
  segments.forEach((s) => { degree[s.a]++; degree[s.b]++; });
  return { nodes, segments, lines, degree, near: segmentGrid(nodes, segments) };
}

// Uniform grid over segment bounding boxes. near(p, r) returns the segments whose bounding box
// comes within r of p, so bounded searches don't have to scan every segment.
const CELL_M = 25;
function segmentGrid(nodes, segments) {
  const cells = new Map();
  const range = (lo, hi) => [Math.floor(lo / CELL_M), Math.floor(hi / CELL_M)];
  segments.forEach((s, i) => {
    const [ax, ay] = nodes[s.a].xy, [bx, by] = nodes[s.b].xy;
    const [x0, x1] = range(Math.min(ax, bx), Math.max(ax, bx)), [y0, y1] = range(Math.min(ay, by), Math.max(ay, by));
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
  });
  return ([x, y], r) => {
    const found = new Set();
    const [x0, x1] = range(x - r, x + r), [y0, y1] = range(y - r, y + r);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const i of cells.get(`${cx},${cy}`) || []) found.add(i);
    return [...found].map((i) => segments[i]);
  };
}

// For each dangling (degree-1) endpoint, the nearest segment that isn't part of its own line,
// searching only within maxDistance when one is given.
export function danglingGaps({ nodes, segments, degree, near }, maxDistance = Infinity) {
  return nodes.map((_, i) => i).filter((i) => degree[i] === 1).map((i) => {
    const p = nodes[i].xy;
    let best = { d: Infinity };
    for (const s of Number.isFinite(maxDistance) ? near(p, maxDistance) : segments) {
      if (s.a === i || s.b === i || nodes[i].lines.has(s.line)) continue;
      const r = nearestOnSegment(p, nodes[s.a].xy, nodes[s.b].xy);
      if (r.d < best.d) best = { ...r, seg: s };
    }
    return { node: i, ...best };
  });
}

// Pairs of segments from different lines that cross without sharing a node.
export function findCrossings({ nodes, segments, lines, near }) {
  const out = [];
  const index = new Map(segments.map((s, i) => [s, i]));
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const [ax, ay] = nodes[s.a].xy, [bx, by] = nodes[s.b].xy;
    const centre = [(ax + bx) / 2, (ay + by) / 2], radius = Math.hypot(bx - ax, by - ay) / 2;
    for (const t of near(centre, radius)) {
      if (index.get(t) <= i) continue;
      if (s.line === t.line || s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
      const x = segmentIntersection(nodes[s.a].xy, nodes[s.b].xy, nodes[t.a].xy, nodes[t.b].xy);
      if (x) out.push({ ...x, segs: [s, t], types: [s.type, t.type].sort().join('/'), fids: [lines[s.line].fid, lines[t.line].fid] });
    }
  }
  return out;
}

// Nearest segment to p, optionally only of one path Type ('Exterior' or 'Interior') and only
// within maxDistance.
export function nearestSegment({ nodes, segments, near }, p, type, maxDistance = Infinity) {
  let best = { d: Infinity };
  for (const s of Number.isFinite(maxDistance) ? near(p, maxDistance) : segments) {
    if (type && s.type !== type) continue;
    const r = nearestOnSegment(p, nodes[s.a].xy, nodes[s.b].xy);
    if (r.d < best.d) best = { ...r, seg: s };
  }
  return best;
}

// ---- Routable graph ------------------------------------------------------------------------

// Returns {nodes: [[lon, lat]], adjacency: [[{to, length, type}]], entrances: [{id, building, node, linkMeters}]}.
export function buildGraph({ paths, entrances, buildings }) {
  const net = buildNetwork(paths);
  const { nodes, segments } = net;
  const projectedBuildings = projectBuildings(buildings);
  const xy = nodes.map((n) => n.xy);
  const extraEdges = []; // [a, b, type]
  const splits = new Map(); // segment -> [{t, node}]

  // A node at parameter t along seg: reuse an end if it's within SAME_POINT_M, else split the segment.
  const nodeOnSegment = (seg, t, point) => {
    if (dist(point, xy[seg.a]) < SAME_POINT_M) return seg.a;
    if (dist(point, xy[seg.b]) < SAME_POINT_M) return seg.b;
    const node = xy.push(point) - 1;
    if (!splits.has(seg)) splits.set(seg, []);
    splits.get(seg).push({ t, node });
    return node;
  };

  for (const g of danglingGaps(net, JOIN_GAP_M)) {
    if (g.d <= JOIN_GAP_M) extraEdges.push([g.node, nodeOnSegment(g.seg, g.t, g.point), g.seg.type]);
  }
  for (const c of findCrossings(net)) {
    if (c.types !== 'Exterior/Exterior') continue;
    const [s, u] = c.segs;
    const node = nodeOnSegment(s, c.t, c.point);
    const other = nodeOnSegment(u, c.u, c.point);
    if (other !== node) extraEdges.push([node, other, 'Exterior']);
  }
  // A vertex lying on another line (not at its end) was snapped there when the data was drawn: a junction.
  // (Dangling ends are already handled by the gap joins above.)
  for (let i = 0; i < nodes.length; i++) {
    if (net.degree[i] < 2) continue;
    for (const s of net.near(nodes[i].xy, SAME_POINT_M)) {
      if (s.a === i || s.b === i || nodes[i].lines.has(s.line)) continue;
      const r = nearestOnSegment(nodes[i].xy, xy[s.a], xy[s.b]);
      if (r.d < SAME_POINT_M) extraEdges.push([i, nodeOnSegment(s, r.t, r.point), s.type]);
    }
  }
  // An entrance is where inside meets outside, so link it to the nearest outdoor path and to the
  // nearest indoor path of its own building (never into a neighbouring building's corridor).
  const linkedEntrances = [];
  for (const e of entrances) {
    const p = proj(e.geometry.coordinates);
    const building = (e.properties.Building || '').trim() || nearestBuilding(projectedBuildings, p).name;
    const links = [];
    const outdoor = nearestSegment(net, p, 'Exterior', ENTRANCE_LINK_M);
    if (outdoor.d <= ENTRANCE_LINK_M) links.push(outdoor);
    const indoor = nearestSegment(net, p, 'Interior', ENTRANCE_LINK_M);
    if (indoor.d <= ENTRANCE_LINK_M && nearestBuilding(projectedBuildings, indoor.point).name === building) links.push(indoor);
    if (!links.length) continue;
    const node = xy.push(p) - 1;
    for (const link of links) extraEdges.push([node, nodeOnSegment(link.seg, link.t, link.point), 'Entrance']);
    linkedEntrances.push({ id: e.properties.OBJECTID, building, node, linkMeters: +Math.min(...links.map((l) => l.d)).toFixed(1) });
  }

  const adjacency = xy.map(() => []);
  const addEdge = (a, b, type) => {
    if (a === b) return;
    const length = dist(xy[a], xy[b]);
    adjacency[a].push({ to: b, length, type });
    adjacency[b].push({ to: a, length, type });
  };
  for (const s of segments) {
    const chain = [s.a, ...(splits.get(s) || []).sort((p, q) => p.t - q.t).map((x) => x.node), s.b];
    for (let i = 1; i < chain.length; i++) addEdge(chain[i - 1], chain[i], s.type);
  }
  extraEdges.forEach(([a, b, type]) => addEdge(a, b, type));

  return { nodes: xy.map(unproj), adjacency, entrances: linkedEntrances, buildings: projectedBuildings };
}

// Campus centres, matching the campus buttons in the top menu. Paths on different campuses don't connect.
export const CAMPUSES = {
  'Chestnut Hill': [-71.1708, 42.3362],
  Brighton: [-71.1634, 42.3432],
  Newton: [-71.1969, 42.3441],
  Brookline: [-71.1572, 42.3202],
};
export function campusOf(lonlat) {
  const p = proj(lonlat);
  return Object.entries(CAMPUSES).sort((a, b) => dist(proj(a[1]), p) - dist(proj(b[1]), p))[0][0];
}

// The graph node nearest to a [lon, lat], e.g. the user's location.
export function nearestNode(graph, lonlat) {
  const p = proj(lonlat);
  let best = { node: -1, d: Infinity };
  graph.nodes.forEach((n, i) => {
    if (!graph.adjacency[i].length) return;
    const d = dist(proj(n), p);
    if (d < best.d) best = { node: i, d };
  });
  return best;
}

// Splits a route into outdoor and indoor stretches for drawing and for written steps.
// Indoor stretches are named after the building most of their nodes fall in.
export function describeRoute(graph, route) {
  const steps = [];
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1], b = route.nodes[i];
    const edge = graph.adjacency[a].find((e) => e.to === b);
    const type = edge.type === 'Interior' ? 'indoor' : 'outdoor';
    let step = steps.at(-1);
    if (!step || step.type !== type) {
      step = { type, length: 0, coordinates: [graph.nodes[a]], nodes: [a] };
      steps.push(step);
    }
    step.length += edge.length;
    step.coordinates.push(graph.nodes[b]);
    step.nodes.push(b);
  }
  for (const step of steps) {
    if (step.type !== 'indoor') continue;
    const votes = {};
    for (const n of step.nodes) {
      const near = nearestBuilding(graph.buildings, proj(graph.nodes[n]));
      if (near.d <= 5) votes[near.name] = (votes[near.name] || 0) + 1;
    }
    step.building = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]?.[0];
  }
  return {
    length: route.length,
    indoorLength: steps.filter((s) => s.type === 'indoor').reduce((sum, s) => sum + s.length, 0),
    steps: steps.map(({ nodes, ...s }) => s),
  };
}

// Dijkstra from any of `sources` to the nearest of `targets`. Returns {length, nodes} or null.
export function shortestRoute(graph, sources, targets) {
  const n = graph.nodes.length;
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const goal = new Set(targets);
  const heap = []; // binary min-heap of [cost, node]
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of sources) { best[s] = 0; push([0, s]); }
  while (heap.length) {
    const [cost, node] = pop();
    if (cost > best[node]) continue;
    if (goal.has(node)) {
      const route = [];
      for (let v = node; v !== -1; v = prev[v]) route.push(v);
      return { length: cost, nodes: route.reverse() };
    }
    for (const { to, length } of graph.adjacency[node]) {
      if (cost + length < best[to]) {
        best[to] = cost + length;
        prev[to] = node;
        push([best[to], to]);
      }
    }
  }
  return null;
}

// Route between two buildings, using any accessible entrance of each.
export function routeBetweenBuildings(graph, fromBuilding, toBuilding) {
  const doors = (name) => graph.entrances.filter((e) => e.building === name).map((e) => e.node);
  const from = doors(fromBuilding), to = doors(toBuilding);
  if (!from.length || !to.length) return null;
  return shortestRoute(graph, from, to);
}
