/**
 * Access BC contributions: a Google Apps Script web app on a Google Sheet. Volunteers' additions (entrances, paths,
 * notes about buildings) and the public's reports go into the Sheet; the site reads them back; an admin verifies or
 * rejects them; scripts/import-contributions.mjs makes verified ones permanent in the site's data.
 *
 * Setup: docs/data-collection/contributions-setup.md. In short: in the Sheet, Extensions > Apps Script, paste this
 * file, set the two passcodes in Project Settings > Script properties (VOLUNTEER_PASSCODE, ADMIN_PASSCODE), and
 * deploy as a web app (execute as you; access: anyone).
 *
 * Statuses: suggestion (a public report: shown to the admin, not used in routes), unverified (a volunteer's: used in
 * routes, marked unverified), verified (checked by the admin), rejected, imported (now in the site's data files).
 */

const SHEET_NAME = 'Contributions';
const COLUMNS = ['id', 'created', 'kind', 'status', 'source', 'contributor', 'email', 'building', 'geometry', 'properties', 'note', 'reviewed_by', 'reviewed_at'];
const KINDS = ['entrance', 'path', 'building', 'report'];
const BOUNDS = { west: -71.215, south: 42.305, east: -71.135, north: 42.360 }; // the area the site covers
const MAX_POINTS = 500, MAX_TEXT = 1000;

function sheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let s = book.getSheetByName(SHEET_NAME);
  if (!s) {
    s = book.insertSheet(SHEET_NAME);
    s.appendRow(COLUMNS);
    s.setFrozenRows(1);
  }
  return s;
}

function passcode(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Every row as an object
function rows() {
  const values = sheet().getDataRange().getValues();
  const header = values.shift();
  return values.map((row, i) => {
    const entry = { row: i + 2 };
    header.forEach((key, k) => { entry[key] = row[k]; });
    return entry;
  });
}

// What the site shows: entries in use (unverified and verified), without who added them
function publicEntry(e) {
  return {
    id: e.id, created: e.created, kind: e.kind, status: e.status, building: e.building,
    geometry: e.geometry ? JSON.parse(e.geometry) : null, properties: e.properties ? JSON.parse(e.properties) : {}, note: e.note,
  };
}

// GET: the entries the site uses (?all=1 with the admin passcode as ?key= is not offered: admin lists use POST)
function doGet() {
  const entries = rows().filter((e) => e.status === 'unverified' || e.status === 'verified').map(publicEntry);
  return json({ entries, updated: new Date().toISOString() });
}

function inBounds([lon, lat]) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= BOUNDS.west && lon <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north;
}

// An entry's problem, or '' if it's fine
function invalid(entry) {
  if (!entry || KINDS.indexOf(entry.kind) < 0) return 'unknown kind';
  const g = entry.geometry;
  if (entry.kind === 'entrance' && (!g || g.type !== 'Point' || !inBounds(g.coordinates))) return 'a point on campus is needed';
  // A report may come without a location (one about a building): then it needs the building or a note
  if (entry.kind === 'report') {
    if (g && (g.type !== 'Point' || !inBounds(g.coordinates))) return 'a point on campus is needed';
    if (!g && !entry.building && !entry.note) return 'say what the report is about';
  }
  if (entry.kind === 'path') {
    if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2 || g.coordinates.length > MAX_POINTS) return 'a line of 2 or more points is needed';
    if (!g.coordinates.every(inBounds)) return 'the path must be on campus';
  }
  if (entry.kind === 'building' && !entry.building) return 'a building is needed';
  if (String(entry.note || '').length > MAX_TEXT || JSON.stringify(entry.properties || {}).length > MAX_TEXT) return 'too long';
  return '';
}

// POST, with a text/plain JSON body: {action, ...}
//   add:      {entry, passcode?}   with the volunteer passcode: unverified; without, only a report: suggestion
//   list:     {adminPasscode}      every entry, for reviewing
//   review:   {adminPasscode, id, status: 'verified' | 'rejected', by}
//   imported: {adminPasscode, ids} marks entries now in the site's data files
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ error: 'not JSON' }); }
  const admin = body.adminPasscode && body.adminPasscode === passcode('ADMIN_PASSCODE');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'add') {
      const entry = body.entry || {};
      const volunteer = body.passcode && body.passcode === passcode('VOLUNTEER_PASSCODE');
      if (!volunteer && entry.kind !== 'report') return json({ error: 'The volunteer passcode is needed to add map data.' });
      // Everyone shares the passcode, so volunteers give their email: who added what
      const email = String(entry.email || '').trim().slice(0, 120);
      if (volunteer && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Your email is needed, so the team knows who added this.' });
      const problem = invalid(entry);
      if (problem) return json({ error: problem });
      const id = Utilities.getUuid().slice(0, 8);
      const row = {
        id, created: new Date().toISOString(), kind: entry.kind, status: volunteer ? 'unverified' : 'suggestion',
        source: volunteer ? 'volunteer' : 'public', contributor: String(entry.contributor || '').slice(0, 80), email,
        building: String(entry.building || '').slice(0, 120), geometry: entry.geometry ? JSON.stringify(entry.geometry) : '',
        properties: JSON.stringify(entry.properties || {}), note: String(entry.note || '').slice(0, MAX_TEXT), reviewed_by: '', reviewed_at: '',
      };
      sheet().appendRow(COLUMNS.map((c) => row[c]));
      return json({ ok: true, id, status: row.status });
    }
    if (!admin) return json({ error: 'The admin passcode is needed.' });
    if (body.action === 'list') return json({ entries: rows().map((r) => Object.assign(publicEntry(r), { source: r.source, contributor: r.contributor, email: r.email, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at })) });
    if (body.action === 'review' || body.action === 'imported') {
      const ids = body.action === 'review' ? [body.id] : body.ids || [];
      const status = body.action === 'review' ? body.status : 'imported';
      if (['verified', 'rejected', 'imported'].indexOf(status) < 0) return json({ error: 'unknown status' });
      const s = sheet(), statusCol = COLUMNS.indexOf('status') + 1;
      let changed = 0;
      for (const r of rows()) {
        if (ids.indexOf(r.id) < 0) continue;
        s.getRange(r.row, statusCol).setValue(status);
        if (body.action === 'review') {
          s.getRange(r.row, COLUMNS.indexOf('reviewed_by') + 1).setValue(String(body.by || '').slice(0, 80));
          s.getRange(r.row, COLUMNS.indexOf('reviewed_at') + 1).setValue(new Date().toISOString());
        }
        changed++;
      }
      return json({ ok: true, changed });
    }
    return json({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
