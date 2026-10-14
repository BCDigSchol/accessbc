// Node-side helpers for the routing scripts. The network and graph code itself lives in
// src/js/routing/network.mjs so the browser and these scripts share one implementation.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/geojson', name))).features;
export * from '../../src/js/routing/network.mjs';
