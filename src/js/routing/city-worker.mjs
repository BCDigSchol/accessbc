// Builds the routing graph with city sidewalks (campus paths plus sidewalks.geojson) in a background thread, so the
// page doesn't freeze for the second or so it takes on a phone. Loads the data itself; only the finished graph is
// sent back. Used by cityGraph() in src/js/directions.js, which builds it on the page instead if this fails.
import { buildGraph } from './network.mjs';

self.onmessage = async ({ data: { base, stairs, contrib = { paths: [], entrances: [] } } }) => {
  try {
    const load = async (name) => (await (await fetch(`${base}geojson/${name}.geojson`)).json()).features;
    const names = ['accessiblepaths', 'entrance-links', 'entrances', 'buildings', 'elevators', 'paths', 'sidewalks'];
    const [paths, links, entrances, buildings, elevators, footpaths, sidewalks] = await Promise.all(names.map(load));
    // Avoiding stairs: no steps, rough surfaces, raised curbs, or ways tagged as not wheelchair accessible
    const usable = stairs ? sidewalks
      : sidewalks.filter(({ properties: p }) => p.Type !== 'Stairs' && !p.rough && p.kerb !== 'raised' && p.wheelchair !== 'no');
    // With volunteers' paths and entrances (sent by the page, which has read them from the contributions Sheet)
    const graph = buildGraph({ paths: [...paths, ...links, ...contrib.paths], entrances: [...entrances, ...contrib.entrances], buildings, elevators, footpaths: stairs ? footpaths : [], sidewalks: usable });
    self.postMessage({ graph });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
