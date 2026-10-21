// Makes verified contributions permanent: reads the contributions Sheet (scripts/contributions/Code.gs), writes the
// verified entries into the site's data files, and marks them imported in the Sheet (so they're not added twice, and
// the site stops adding them from the Sheet). Then commit the changed data files as usual.
//
//   verified paths      → src/geojson/accessiblepaths.geojson (Type Exterior, with who checked them and when)
//   verified entrances  → src/geojson/entrances.geojson (the next free OBJECTID)
//   verified notes      → src/geojson/building-notes.json (shown in building information)
//
// Usage: ACCESSBC_CONTRIBUTIONS_URL=… ACCESSBC_ADMIN_PASSCODE=… node scripts/import-contributions.mjs [--dry-run]
// (the URL is the one in src/js/config.js; the passcode is the Sheet's ADMIN_PASSCODE, kept out of the repo)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const url = process.env.ACCESSBC_CONTRIBUTIONS_URL, adminPasscode = process.env.ACCESSBC_ADMIN_PASSCODE;
const dryRun = process.argv.includes('--dry-run');
if (!url || !adminPasscode) {
  console.error('Set ACCESSBC_CONTRIBUTIONS_URL and ACCESSBC_ADMIN_PASSCODE (see docs/data-collection/contributions-setup.md).');
  process.exit(1);
}

const post = async (body) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json();
// The data folder (ACCESSBC_DATA_DIR lets the tests import into a copy)
const DATA_DIR = process.env.ACCESSBC_DATA_DIR || path.join(ROOT, 'src/geojson');
const geojsonPath = (name) => path.join(DATA_DIR, name);
const readGeojson = (name) => JSON.parse(fs.readFileSync(geojsonPath(name), 'utf8'));
// The data files keep one feature per line (smaller diffs)
const writeGeojson = (name, features) => fs.writeFileSync(geojsonPath(name), `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`);
const credit = (e) => ({ Source: 'volunteer', Contribution: e.id, VerifiedBy: e.reviewed_by || '', VerifiedAt: String(e.reviewed_at || '').slice(0, 10), Comment: e.note || ' ' });

const { entries, error } = await post({ action: 'list', adminPasscode });
if (error) { console.error(error); process.exit(1); }
const verified = entries.filter((e) => e.status === 'verified');
if (!verified.length) { console.log('Nothing verified to import.'); process.exit(0); }

const paths = readGeojson('accessiblepaths.geojson'), entrances = readGeojson('entrances.geojson');
const notesFile = geojsonPath('building-notes.json');
const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : { notes: [] };
let nextFid = Math.max(...paths.features.map((f) => Number(f.properties.FID) || 0)) + 1;
let nextId = Math.max(...entrances.features.map((f) => Number(f.properties.OBJECTID) || 0)) + 1;
const imported = [], skipped = [];
for (const e of verified) {
  const p = e.properties || {};
  if (e.kind === 'path' && e.geometry?.type === 'LineString' && p.stepFree !== 'no') {
    paths.features.push({ type: 'Feature', properties: { FID: nextFid++, Type: 'Exterior', Status: 'Existing', ...(p.surface && { Surface: p.surface }), ...credit(e) }, geometry: e.geometry });
  } else if (e.kind === 'entrance' && e.geometry?.type === 'Point' && p.stepFree !== 'no') {
    entrances.features.push({ type: 'Feature', properties: { OBJECTID: nextId++, Building: e.building, Status: 'Working', ...(p.automaticDoor && { AutomaticDoor: p.automaticDoor }), ...(p.button && { DoorButton: p.button }), ...credit(e) }, geometry: e.geometry });
  } else if (e.kind === 'building' && e.building && e.note) {
    notes.notes.push({ building: e.building, note: e.note, contribution: e.id, verifiedBy: e.reviewed_by || '', verifiedAt: String(e.reviewed_at || '').slice(0, 10) });
  } else {
    skipped.push(e); // a report, or not step-free: nothing to add to the routing data (it stays in the Sheet)
    continue;
  }
  imported.push(e);
  console.log(`  ${e.kind}: ${e.building || ''} ${e.note ? `(“${e.note.slice(0, 60)}”)` : ''} [${e.id}]`);
}
if (dryRun) { console.log(`Dry run: would import ${imported.length}, skip ${skipped.length}. Nothing written.`); process.exit(0); }
writeGeojson('accessiblepaths.geojson', paths.features);
writeGeojson('entrances.geojson', entrances.features);
fs.writeFileSync(notesFile, JSON.stringify(notes, null, 1) + '\n');
const marked = await post({ action: 'imported', adminPasscode, ids: imported.map((e) => e.id) });
console.log(`Imported ${imported.length} (${marked.changed} marked imported in the Sheet); left ${skipped.length} that aren't map data.`);
console.log('Next: node scripts/link-entrances.mjs && node scripts/make-data-collection-sheets.mjs, check a few routes, and commit.');
