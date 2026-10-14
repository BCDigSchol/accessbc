// Writes the fill-in spreadsheets in docs/data-collection/: one row per entrance and per elevator on the map,
// with ID, building, and coordinates filled in and blank columns for Facilities to answer.
//
// Usage: node scripts/make-data-collection-sheets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, load, nearestBuilding, projectBuildings, proj } from './routing/lib.mjs';

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
