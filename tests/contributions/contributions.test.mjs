// Tests for volunteers' contributions: the Sheet's web app (the real scripts/contributions/Code.gs, run with stand-ins
// for Google's services), turning entries into map data (src/js/routing/contributions.mjs) and routes, and making
// verified entries permanent (scripts/import-contributions.mjs, run against a copy of the data files).
//
// Usage: node --test tests/contributions/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fakeAppsScript, serveFake } from './fake-apps-script.mjs';
import { contributionData, entryProblem } from '../../src/js/routing/contributions.mjs';
import { buildGraph, routeBetweenBuildings } from '../../src/js/routing/network.mjs';
import { ROOT, load } from '../../scripts/routing/lib.mjs';

// Modular Housing Unit 3 has no accessible entrance in the data; its outline is 4 m from a mapped path here
const HOUSING_DOOR = [-71.1667219, 42.3372526];
const entrance = (extra = {}) => ({ kind: 'entrance', building: 'Modular Housing Unit  3', geometry: { type: 'Point', coordinates: HOUSING_DOOR }, properties: { stepFree: 'yes', automaticDoor: 'yes', button: 'left of the door' }, note: 'Ramp from the path', contributor: 'Sam', email: 'sam@bc.edu', ...extra });

test('the Sheet: volunteers need the passcode; the public can only send reports, as suggestions', () => {
  const sheet = fakeAppsScript();
  assert.match(sheet.post({ action: 'add', entry: entrance() }).error, /passcode/);
  assert.match(sheet.post({ action: 'add', passcode: 'wrong', entry: entrance() }).error, /passcode/);
  assert.match(sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: entrance({ email: '' }) }).error, /email/, 'volunteers give their email');
  const added = sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: entrance() });
  assert.equal(added.status, 'unverified');
  const report = sheet.post({ action: 'add', entry: { kind: 'report', geometry: { type: 'Point', coordinates: HOUSING_DOOR }, note: 'Door is on the east side' } });
  assert.equal(report.status, 'suggestion');
  assert.match(sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: entrance({ geometry: { type: 'Point', coordinates: [-70, 42] } }) }).error, /campus/, 'off the map area: refused');
  assert.match(sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: { kind: 'path', email: 'sam@bc.edu', geometry: { type: 'LineString', coordinates: [HOUSING_DOOR] } } }).error, /2 or more/);
});

test('the Sheet: the site sees entries in use, without names; the admin sees everything, and verifies or rejects', () => {
  const sheet = fakeAppsScript();
  const a = sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: entrance() }).id;
  const b = sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry: entrance({ note: 'second' }) }).id;
  sheet.post({ action: 'add', entry: { kind: 'report', note: 'a suggestion' } });
  const seen = sheet.get().entries;
  assert.deepEqual(seen.map((e) => e.id).sort(), [a, b].sort(), 'the site sees the two in use, not the suggestion');
  assert.ok(seen.every((e) => !('contributor' in e) && !('email' in e)), 'no names or emails in what the site sees');
  assert.match(sheet.post({ action: 'list', adminPasscode: 'nope' }).error, /admin/);
  const all = sheet.post({ action: 'list', adminPasscode: sheet.passcodes.admin }).entries;
  assert.equal(all.length, 3);
  assert.equal(all.find((e) => e.id === a).email, 'sam@bc.edu', 'the admin sees who added it');
  assert.equal(sheet.post({ action: 'review', adminPasscode: sheet.passcodes.admin, id: a, status: 'verified', by: 'Dana' }).changed, 1);
  sheet.post({ action: 'review', adminPasscode: sheet.passcodes.admin, id: b, status: 'rejected', by: 'Dana' });
  const now = sheet.get().entries;
  assert.deepEqual(now.map((e) => [e.id, e.status]), [[a, 'verified']], 'rejected entries are no longer used');
});

test('entries as map data: a volunteer’s entrance makes a building routable, marked unverified until verified', () => {
  const data = { paths: load('accessiblepaths.geojson'), entrances: load('entrances.geojson'), buildings: load('buildings.geojson') };
  assert.ok(!buildGraph(data).entrances.some((e) => e.building === 'Modular Housing Unit  3'), 'no way into Modular Housing Unit 3 without it');
  for (const status of ['unverified', 'verified']) {
    const c = contributionData([{ id: 'x1', status, ...entrance() }]);
    const door = buildGraph({ ...data, entrances: [...data.entrances, ...c.entrances] }).entrances.find((e) => e.building === 'Modular Housing Unit  3');
    assert.ok(door, `${status}: Modular Housing Unit 3 has a linked entrance`);
    assert.ok(routeBetweenBuildings(buildGraph({ ...data, entrances: [...data.entrances, ...c.entrances] }), 'Gasson Hall', 'Modular Housing Unit  3'), `${status}: a route from Gasson Hall`);
    assert.equal(!!door.unverified, status === 'unverified', `${status}: marked ${status === 'unverified' ? '' : 'not '}unverified`);
  }
  const notStepFree = contributionData([{ id: 'x2', status: 'unverified', ...entrance({ properties: { stepFree: 'no' } }) }]);
  assert.equal(notStepFree.entrances.length, 0, 'an entrance that isn’t step-free isn’t added as accessible');
  assert.equal(contributionData([{ id: 'x3', status: 'suggestion', ...entrance() }]).entrances.length, 0, 'suggestions aren’t map data');
  const path = contributionData([{ id: 'p1', status: 'unverified', kind: 'path', geometry: { type: 'LineString', coordinates: [[-71.17, 42.335], [-71.1701, 42.335]] }, properties: { stepFree: 'yes' } }]);
  assert.equal(path.paths[0].properties.Type, 'Contributed', 'an unverified path is a Contributed (not checked) path');
  assert.equal(entryProblem({ kind: 'entrance', building: 'Modular Housing Unit  3' }), 'Choose where the entrance is on the map, or use your location.');
});

test('importing: verified entries go into copies of the data files, and are marked imported', async () => {
  const sheet = fakeAppsScript();
  const v = (entry) => sheet.post({ action: 'add', passcode: sheet.passcodes.volunteer, entry }).id;
  const door = v(entrance());
  const note = v({ kind: 'building', building: 'Modular Housing Unit  3', email: 'sam@bc.edu', note: 'The accessible entrance is at the back, from the path.' });
  const notVerified = v(entrance({ note: 'still to check' }));
  for (const id of [door, note]) sheet.post({ action: 'review', adminPasscode: sheet.passcodes.admin, id, status: 'verified', by: 'Dana' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accessbc-import-'));
  for (const f of ['accessiblepaths.geojson', 'entrances.geojson', 'building-notes.json']) fs.copyFileSync(path.join(ROOT, 'src/geojson', f), path.join(dir, f));
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'entrances.geojson'), 'utf8')).features.length;
  const server = await serveFake(sheet, 0);
  const url = `http://localhost:${server.address().port}/`;
  const run = () => promisify(execFile)('node', [path.join(ROOT, 'scripts/import-contributions.mjs')],
    { env: { ...process.env, ACCESSBC_CONTRIBUTIONS_URL: url, ACCESSBC_ADMIN_PASSCODE: sheet.passcodes.admin, ACCESSBC_DATA_DIR: dir } });
  try {
    const { stdout } = await run();
    assert.match(stdout, /Imported 2 \(2 marked imported/);
    const entrances = JSON.parse(fs.readFileSync(path.join(dir, 'entrances.geojson'), 'utf8')).features;
    assert.equal(entrances.length, before + 1);
    assert.deepEqual([entrances.at(-1).properties.Building, entrances.at(-1).properties.VerifiedBy, entrances.at(-1).properties.Source], ['Modular Housing Unit  3', 'Dana', 'volunteer']);
    assert.ok(Number.isInteger(entrances.at(-1).properties.OBJECTID), 'a numeric id, like the others');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'building-notes.json'), 'utf8')).notes[0].building, 'Modular Housing Unit  3');
    const statuses = Object.fromEntries(sheet.post({ action: 'list', adminPasscode: sheet.passcodes.admin }).entries.map((e) => [e.id, e.status]));
    assert.deepEqual([statuses[door], statuses[note], statuses[notVerified]], ['imported', 'imported', 'unverified']);
    assert.match((await run()).stdout, /Nothing verified to import/, 'running it again adds nothing twice');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
  }
});
