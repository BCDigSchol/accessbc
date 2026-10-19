// Slope and climb along outdoor routes, from the Terrarium-encoded terrain tiles in
// src/basemap/terrain.pmtiles (about 3.5 m per pixel at zoom 15).
//
// The terrain data is bare earth: under a building it's interpolated, and buildings are often cut
// into slopes, so elevation pixels whose centre falls inside a building footprint are ignored and the
// ground around them is used instead. Grades are measured
// over WINDOW_M so single-pixel noise doesn't show up as a steep spot. The results are estimates:
// they can't see curbs, short ramps, or anything smaller than a few metres. They also can't see
// bridges: a footbridge reads as a cliff down to the ground beneath it. Grades steeper than
// UNRELIABLE_GRADE, which no accessible path has, are treated as such a data problem and left out.

import { proj, dist, insideBuilding } from './network.mjs';

// ADA guidance: an accessible walkway should be no steeper than 1:20; a ramp no steeper than 1:12.
export const STEEP_GRADE = 1 / 20;
export const VERY_STEEP_GRADE = 1 / 12;
// Steeper than this along a mapped accessible path almost certainly means a bridge, a passage between
// buildings, or stairs, rather than a real slope.
export const UNRELIABLE_GRADE = 0.2;

const ZOOM = 15;
const TILE = 256;
const WORLD = TILE * 2 ** ZOOM;
const SAMPLE_M = 3;
const WINDOW_M = 15;

// Pixel coordinates (pixel centres at integers) of a [lon, lat] at ZOOM, and back.
const toPixel = ([lon, lat]) => {
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * WORLD - 0.5, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD - 0.5];
};
const fromPixel = (gx, gy) => [
  ((gx + 0.5) / WORLD) * 360 - 180,
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * (gy + 0.5)) / WORLD))) * 180) / Math.PI,
];

// Terrain sampler. loadTile(z, x, y) resolves to the tile's RGBA pixels (256×256) or null.
export function createTerrain(loadTile, buildings) {
  const tiles = new Map(); // "x,y" -> Float32Array of elevations, or null if missing
  const onBuilding = new Map(); // "gx,gy" -> whether that pixel's centre is inside a building

  async function ensureTiles(lonlats) {
    const keys = new Set();
    for (const c of lonlats) {
      const [gx, gy] = toPixel(c);
      for (const dx of [-1, 2]) for (const dy of [-1, 2]) keys.add(`${Math.floor((gx + dx) / TILE)},${Math.floor((gy + dy) / TILE)}`);
    }
    await Promise.all([...keys].filter((k) => !tiles.has(k)).map(async (key) => {
      const [x, y] = key.split(',').map(Number);
      const rgba = await loadTile(ZOOM, x, y);
      if (!rgba) return tiles.set(key, null);
      const elevations = new Float32Array(TILE * TILE);
      for (let i = 0; i < elevations.length; i++) elevations[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
      tiles.set(key, elevations);
    }));
  }

  // Ground elevation of one pixel, or null if it's on a building or outside the terrain data.
  function groundPixel(gx, gy) {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const tile = tiles.get(`${tx},${ty}`);
    if (!tile) return null;
    const key = `${gx},${gy}`;
    if (!onBuilding.has(key)) onBuilding.set(key, insideBuilding(buildings, proj(fromPixel(gx, gy))));
    if (onBuilding.get(key)) return null;
    return tile[(gy - ty * TILE) * TILE + (gx - tx * TILE)];
  }

  // Bilinear ground elevation at [lon, lat], skipping building pixels; null if there's no ground nearby.
  function elevation(c) {
    const [fx, fy] = toPixel(c);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    let sum = 0, weight = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
      const e = groundPixel(x0 + dx, y0 + dy);
      if (e !== null && w > 0) { sum += e * w; weight += w; }
    }
    return weight > 0 ? sum / weight : null;
  }

  return { ensureTiles, elevation };
}

// Points every SAMPLE_M along a [lon, lat] polyline, with their distance from the start.
function resample(coordinates) {
  const out = [{ c: coordinates[0], at: 0 }];
  let travelled = 0, nextAt = SAMPLE_M;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const len = dist(proj(a), proj(b));
    while (nextAt <= travelled + len) {
      const t = (nextAt - travelled) / len;
      out.push({ c: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], at: nextAt });
      nextAt += SAMPLE_M;
    }
    travelled += len;
  }
  if (travelled - out.at(-1).at > 0.5) out.push({ c: coordinates.at(-1), at: travelled });
  return out;
}

export const gradeClass = (grade) => {
  const g = Math.abs(grade);
  return g > UNRELIABLE_GRADE ? 'unreliable' : g > VERY_STEEP_GRADE ? 'very-steep' : g > STEEP_GRADE ? 'steep' : 'gentle';
};

// Elevation profile of an outdoor stretch, or null if there's no terrain data under it:
// {climb, descent, maxGrade, unreliableLength, pieces: [{grade, class, coordinates}]}.
// Climb, descent, and maxGrade leave out stretches whose grade is unreliable.
export async function profile(terrain, coordinates) {
  const samples = resample(coordinates);
  await terrain.ensureTiles(samples.map((s) => s.c));
  const raw = samples.map((s) => terrain.elevation(s.c));
  const known = raw.map((e, i) => (e === null ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return null;

  // Fill gaps (e.g. under a building overhang) by interpolating between the nearest known samples.
  const ele = raw.map((e, i) => {
    if (e !== null) return e;
    const before = known.filter((k) => k < i).at(-1), after = known.find((k) => k > i);
    if (before === undefined) return raw[after];
    if (after === undefined) return raw[before];
    const t = (samples[i].at - samples[before].at) / (samples[after].at - samples[before].at);
    return raw[before] + t * (raw[after] - raw[before]);
  });

  // Smooth over the grade window, then measure climb and grade on the smoothed profile.
  const half = Math.max(1, Math.round(WINDOW_M / SAMPLE_M / 2));
  const smooth = ele.map((_, i) => {
    const w = ele.slice(Math.max(0, i - half), i + half + 1);
    return w.reduce((s, v) => s + v, 0) / w.length;
  });
  const grades = smooth.map((_, i) => {
    const a = Math.max(0, i - half), b = Math.min(smooth.length - 1, i + half);
    const run = samples[b].at - samples[a].at;
    return run > 0 ? (smooth[b] - smooth[a]) / run : 0;
  });
  const reliable = grades.map((g) => Math.abs(g) <= UNRELIABLE_GRADE);
  let climb = 0, descent = 0, unreliableLength = 0;
  for (let i = 1; i < smooth.length; i++) {
    if (!reliable[i - 1] || !reliable[i]) {
      unreliableLength += samples[i].at - samples[i - 1].at;
      continue;
    }
    const d = smooth[i] - smooth[i - 1];
    if (d > 0) climb += d; else descent -= d;
  }

  // Consecutive samples with the same grade class become one piece of the drawn route.
  const pieces = [];
  for (let i = 1; i < samples.length; i++) {
    const g = (grades[i - 1] + grades[i]) / 2;
    const cls = gradeClass(g);
    const last = pieces.at(-1);
    if (last && last.class === cls) {
      last.coordinates.push(samples[i].c);
      if (Math.abs(g) > Math.abs(last.grade)) last.grade = g;
    } else {
      pieces.push({ class: cls, grade: g, coordinates: [samples[i - 1].c, samples[i].c] });
    }
  }
  const maxGrade = grades.filter((_, i) => reliable[i]).reduce((m, g) => (Math.abs(g) > Math.abs(m) ? g : m), 0);
  const points = samples.map((sample, i) => ({ at: sample.at, grade: grades[i], reliable: reliable[i] }));
  return { climb, descent, maxGrade, unreliableLength, pieces, points };
}

// Steepest reliable grade (absolute) of every outdoor segment in a routing graph, for slope-limited
// routing. Each path line is profiled as a whole so grades near segment ends have context. Returns a
// Float32Array indexed like graph.segments, NaN where unknown (indoors, stairs, no data, unreliable).
// grades.up and grades.down hold the steepest climb and descent going the way the path was drawn (from a to b).
export async function segmentGrades(terrain, graph) {
  const grades = new Float32Array(graph.segments.length).fill(NaN);
  grades.up = new Float32Array(graph.segments.length).fill(NaN);
  grades.down = new Float32Array(graph.segments.length).fill(NaN);
  const byLine = new Map();
  graph.segments.forEach((seg, i) => {
    if (!byLine.has(seg.line)) byLine.set(seg.line, []);
    byLine.get(seg.line).push(i);
  });
  const outdoorLines = [...byLine.keys()].filter((l) => ['Exterior', 'Connector', 'Footpath', 'Sidewalk', 'Crossing', 'Street'].includes(graph.lines[l].type));
  await terrain.ensureTiles(outdoorLines.flatMap((l) => graph.lines[l].coordinates));
  for (const line of outdoorLines) {
    const p = await profile(terrain, graph.lines[line].coordinates);
    if (!p) continue;
    for (const i of byLine.get(line)) {
      const { from, to } = graph.segments[i];
      const mid = (from + to) / 2;
      // Samples on the segment, or the nearest one if it's shorter than the sample spacing.
      let inside = p.points.filter((pt) => pt.at >= from - SAMPLE_M / 2 && pt.at <= to + SAMPLE_M / 2);
      if (!inside.length) inside = [p.points.reduce((b, pt) => (Math.abs(pt.at - mid) < Math.abs(b.at - mid) ? pt : b))];
      const reliable = inside.filter((pt) => pt.reliable);
      if (reliable.length) {
        grades[i] = Math.max(...reliable.map((pt) => Math.abs(pt.grade)));
        grades.up[i] = Math.max(0, ...reliable.map((pt) => pt.grade));
        grades.down[i] = Math.max(0, ...reliable.map((pt) => -pt.grade));
      }
    }
  }
  return grades;
}
