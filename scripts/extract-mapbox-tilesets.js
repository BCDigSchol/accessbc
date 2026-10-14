// Rebuild source GeoJSON from Mapbox vector tilesets by fetching every tile at the
// tileset's maxzoom, clipping each feature to its tile's exact bounds (removing the
// tile buffer overlap), then stitching/unioning the pieces back into whole features.
// One-time recovery tool. It only works while the Mapbox tilesets still exist.
// Setup: npm i @mapbox/vector-tile@1.3.1 pbf@3.2.1 @turf/turf@6.5.0
// Usage: node extract-mapbox-tilesets.js <mapbox public token> <outdir>
const fs = require('fs');
const path = require('path');
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');
const turf = require('@turf/turf');

const [token, outdir] = process.argv.slice(2);
const OWNER = 'bcdsg-lec';
const TILESETS = {
  accessiblepaths: 'ctxmzxxp',
  paths: '6wha4sxm',
  entrances: 'cf8ep7jl',
  elevators: '9zp1t3fm',
  curbcuts: '1bsbmi40',
  buildings: 'acj06c4q',
  shuttlestops: 'b0eg11k3',
  bluelights: '438a3ike',
  bikeracks: '35wuf8yc',
};

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const tileBbox = (x, y, z) => [x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)];
const round = (c) => (typeof c[0] === 'number' ? c.map((v) => Math.round(v * 1e7) / 1e7) : c.map(round));

async function fetchTile(id, z, x, y) {
  const url = `https://api.mapbox.com/v4/${OWNER}.${id}/${z}/${x}/${y}.vector.pbf?access_token=${token}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`failed ${url}`);
}

// Join line parts whose endpoints meet (within tol metres) on a tile edge.
function stitch(parts, edgesX, edgesY) {
  const tol = 0.5;
  const onEdge = (p) =>
    edgesX.some((e) => Math.abs(p[0] - e) < 1e-6) || edgesY.some((e) => Math.abs(p[1] - e) < 1e-6);
  const close = (a, b) => turf.distance(a, b, { units: 'meters' }) < tol;
  parts = parts.filter((p) => p.length >= 2);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue;
        const a = parts[i], b = parts[j];
        let joined = null;
        const aEnd = a[a.length - 1], bEnd = b[b.length - 1];
        if (onEdge(aEnd) && close(aEnd, b[0])) joined = a.concat(b.slice(1));
        else if (onEdge(aEnd) && close(aEnd, bEnd)) joined = a.concat(b.slice().reverse().slice(1));
        else if (onEdge(a[0]) && close(a[0], bEnd)) joined = b.concat(a.slice(1));
        else if (onEdge(a[0]) && close(a[0], b[0])) joined = b.slice().reverse().concat(a.slice(1));
        if (joined) {
          parts[i] = joined;
          parts.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return parts;
}

async function extract(name, id) {
  const meta = await (await fetch(`https://api.mapbox.com/v4/${OWNER}.${id}.json?access_token=${token}`)).json();
  const z = meta.maxzoom;
  const layerName = meta.vector_layers[0].id;
  const [w, s, e, n] = meta.bounds;
  const tiles = [];
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++)
    for (let y = lat2y(n, z); y <= lat2y(s, z); y++) tiles.push([x, y]);

  const groups = new Map(); // key -> {properties, type, parts}
  const edgesX = new Set(), edgesY = new Set();
  let i = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (i < tiles.length) {
        const [x, y] = tiles[i++];
        const buf = await fetchTile(id, z, x, y);
        if (!buf) continue;
        const layer = new VectorTile(new Pbf(buf)).layers[layerName];
        if (!layer) continue;
        const bbox = tileBbox(x, y, z);
        edgesX.add(bbox[0]); edgesX.add(bbox[2]); edgesY.add(bbox[1]); edgesY.add(bbox[3]);
        for (let k = 0; k < layer.length; k++) {
          const f = layer.feature(k).toGeoJSON(x, y, z);
          const key = JSON.stringify(f.properties);
          const g = f.geometry;
          if (!groups.has(key)) groups.set(key, { id: f.id, properties: f.properties, type: g.type.replace('Multi', ''), parts: [] });
          const grp = groups.get(key);
          if (grp.type === 'Point') {
            const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
            pts.filter((p) => turf.booleanPointInPolygon(p, turf.bboxPolygon(bbox))).forEach((p) => grp.parts.push(p));
          } else {
            const clipped = turf.bboxClip(f, bbox).geometry;
            if (!clipped || !clipped.coordinates.length) continue;
            const list = clipped.type.startsWith('Multi') ? clipped.coordinates : [clipped.coordinates];
            list.forEach((c) => grp.parts.push(c));
          }
        }
      }
    })
  );

  const ex = [...edgesX], ey = [...edgesY];
  const features = [];
  for (const grp of groups.values()) {
    let geometry;
    if (grp.type === 'Point') {
      const uniq = [...new Map(grp.parts.map((p) => [round(p).join(','), round(p)])).values()];
      if (!uniq.length) continue;
      geometry = uniq.length === 1 ? { type: 'Point', coordinates: uniq[0] } : { type: 'MultiPoint', coordinates: uniq };
    } else if (grp.type === 'LineString') {
      const parts = stitch(grp.parts, ex, ey).map(round);
      if (!parts.length) continue;
      geometry = parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
    } else {
      const polys = grp.parts.filter((r) => r.length && r[0].length >= 4).map((r) => turf.polygon(r));
      if (!polys.length) continue;
      let u = polys[0];
      for (const p of polys.slice(1)) u = turf.union(u, p) || u;
      geometry = { type: u.geometry.type, coordinates: round(u.geometry.coordinates) };
    }
    features.push({ type: 'Feature', properties: grp.properties, geometry });
  }
  fs.writeFileSync(path.join(outdir, `${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`${name}: z${z}, ${tiles.length} tiles, ${features.length} features`);
}

(async () => {
  fs.mkdirSync(outdir, { recursive: true });
  for (const [name, id] of Object.entries(TILESETS)) await extract(name, id);
})();
