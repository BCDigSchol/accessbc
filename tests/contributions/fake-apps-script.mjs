// Runs the real contributions web app (scripts/contributions/Code.gs) outside Google: in a sandbox with stand-ins for
// the Google services it uses (a Sheet in memory, script properties, ContentService, LockService, Utilities). Lets the
// tests and the browser checks use the actual script logic (passcodes, statuses, validation) without a Google account.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const CODE = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../scripts/contributions/Code.gs'), 'utf8');

export function fakeAppsScript({ volunteer = 'walk-the-campus', admin = 'check-it' } = {}) {
  const sheets = new Map();
  const makeSheet = () => {
    const values = [];
    return {
      values,
      appendRow: (row) => values.push([...row]),
      setFrozenRows: () => {},
      getDataRange: () => ({ getValues: () => values.map((r) => [...r]) }),
      getRange: (row, col) => ({ setValue: (v) => { values[row - 1][col - 1] = v; } }),
    };
  };
  const book = {
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => { const s = makeSheet(); sheets.set(name, s); return s; },
  };
  const properties = { VOLUNTEER_PASSCODE: volunteer, ADMIN_PASSCODE: admin };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] ?? null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    JSON, Date, String, Number, Object, Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  return {
    get: () => JSON.parse(sandbox.doGet({}).text),
    post: (body) => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text),
    rows: () => sheets.get('Contributions')?.values || [],
    passcodes: { volunteer, admin },
  };
}

// The same, over HTTP on localhost (for the import script), answering GET and POST like the deployed web app
export function serveFake(fake, port) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = req.method === 'POST' ? fake.post(body) : fake.get();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
