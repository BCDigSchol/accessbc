// Writes the fill-in spreadsheets in docs/data-collection/: one row per entrance and per elevator on the map,
// with ID, building, and coordinates filled in and blank columns for Facilities to answer; and the buildings that
// can't be routed to yet (no accessible entrance linked to the paths), most important first.
//
// Usage: node scripts/make-data-collection-sheets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, load, nearestBuilding, projectBuildings, proj, buildGraph, campusOf } from './routing/lib.mjs';

const OUT = path.join(ROOT, 'docs/data-collection');
const buildings = projectBuildings(load('buildings.geojson'));
const nameOf = (f) => (f.properties.Building || '').trim() || nearestBuilding(buildings, proj(f.geometry.coordinates)).name;
const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const write = (file, header, features) => {
  const rows = features.map((f) => [f.properties.OBJECTID, nameOf(f), f.geometry.coordinates[1].toFixed(6), f.geometry.coordinates[0].toFixed(6), ...header.slice(4).map(() => '')]);
  fs.writeFileSync(path.join(OUT, file), [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
};

fs.mkdirSync(OUT, { recursive: true });
write('entrances.csv', ['OBJECTID', 'building', 'latitude', 'longitude', 'automatic_door (yes/push-button/no)', 'level_or_ramped_entry (yes/no)',
  'intercom_or_buzzer_only (yes/no)', 'locked_after_hours (yes/no; hours)', 'detectable_warning_surface (yes/no)', 'still_accessible_today (yes/no)', 'notes'],
load('entrances.geojson'));
write('elevators.csv', ['OBJECTID', 'building', 'latitude', 'longitude', 'floors_served', 'hours_available', 'key_or_card_required (yes/no)',
  'audible_floor_announcements (yes/no)', 'braille_and_raised_buttons (yes/no)', 'notes'],
load('elevators.geojson'));

// Buildings with no accessible entrance linked to the paths, so directions can't go to them. Most important first:
// buildings with resources, restrooms, food, or other things people search for; then those with a name and a
// description; then the rest (garages, sheds and houses, mostly).
const AMENITIES = { Single_res: 'single-stall restroom', Lactation: 'lactation room', Food_dinin: 'dining hall', Food_cafe: 'café',
  Food_vend: 'vending', Printing: 'printing', Seating_in: 'indoor seating', Seating_gr: 'group seating' };
const raw = load('buildings.geojson');
const links = load('entrance-links.geojson'); // drawn by scripts/link-entrances.mjs: these buildings can be routed to
const graph = buildGraph({ paths: [...load('accessiblepaths.geojson'), ...links], entrances: load('entrances.geojson'), buildings: raw, elevators: load('elevators.geojson') });
const linked = new Set(graph.entrances.map((e) => e.building));
const withEntrance = new Set(load('entrances.geojson').map(nameOf)); // on the map, but maybe not near a path
const centre = (f) => {
  const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
  return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
};
const rows = raw.map((f) => {
  const name = (f.properties.NAME || '').trim();
  if (!name || linked.has(name)) return null;
  const has = Object.entries(AMENITIES).filter(([k]) => f.properties[k] === 'Yes').map(([, label]) => label);
  const resources = (f.properties.Descriptio || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith(':'));
  const priority = has.length ? 1 : resources.length ? 2 : 3;
  const why = [has.join(', '), resources.length ? `${resources.length} listed ${resources.length === 1 ? 'resource' : 'resources'} (e.g. ${resources[0]})` : ''].filter(Boolean).join('; ');
  const [lon, lat] = centre(f);
  return { priority, name, campus: campusOf([lon, lat]), why, lat, lon, onMap: withEntrance.has(name) };
}).filter(Boolean).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
// "entrance mapped, not connected": an entrance is on the map but more than 15 m from any path, so a path to it is
// what's missing (a data fix), not a survey of the building
const header = ['priority (1 = most needed)', 'building', 'campus', 'why it matters', 'what is missing', 'latitude', 'longitude',
  'accessible_entrance_location (which side, or a pin)', 'automatic_door (yes/push-button/no)', 'level_or_ramped_entry (yes/no)', 'no_accessible_entrance (yes/no)', 'notes'];
fs.writeFileSync(path.join(OUT, 'buildings-without-accessible-entrance.csv'),
  [header, ...rows.map((r) => [r.priority, r.name, r.campus, r.why, r.onMap ? 'entrance mapped, not connected to a path' : 'no accessible entrance mapped', r.lat.toFixed(6), r.lon.toFixed(6), '', '', '', '', ''])].map((r) => r.map(cell).join(',')).join('\n') + '\n');
console.log(`buildings-without-accessible-entrance.csv: ${rows.length} rows, ${rows.filter((r) => r.onMap).length} with an entrance mapped but not connected (${rows.filter((r) => r.priority === 1).length} with restrooms, food or other amenities; ${rows.filter((r) => r.priority === 2).length} with listed resources)`);

// The links drawn automatically to entrances that weren't connected to a path: to check on the ground, longest first
// (or replace with real paths in accessiblepaths.geojson, then re-run scripts/link-entrances.mjs)
const linkHeader = ['building', 'campus', 'entrance OBJECTID', 'link length (m)', 'goes to', 'check first', 'entrance latitude', 'entrance longitude',
  'link_is_accessible (yes/no)', 'surface (paved/brick/grass/…)', 'obstacles (steps, curb, narrow, …)', 'notes'];
const linkRows = [...links].sort((a, b) => b.properties.Length_m - a.properties.Length_m).map(({ properties: p, geometry: g }) =>
  [p.Building, p.Campus, p.Entrance, p.Length_m, p.To, p.Check || '', g.coordinates[0][1].toFixed(6), g.coordinates[0][0].toFixed(6), '', '', '', '']);
fs.writeFileSync(path.join(OUT, 'entrance-links-to-check.csv'), [linkHeader, ...linkRows].map((r) => r.map(cell).join(',')).join('\n') + '\n');
console.log(`entrance-links-to-check.csv: ${linkRows.length} rows`);
