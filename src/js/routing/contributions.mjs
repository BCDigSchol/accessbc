// Volunteers' contributions (from the contributions Sheet, see scripts/contributions/Code.gs) as map data. Plain ES
// module, shared by the site, the city graph worker, the contribute page, scripts/import-contributions.mjs, and tests.
//
// An entry is {id, kind, status, building, geometry, properties, note}. Only entries in use are turned into data:
// unverified (a volunteer's, not yet checked) and verified (checked, not yet imported into the data files).
//   path      → a path, Type 'Contributed' while unverified (routes treat it as not checked) or 'Exterior' once verified
//   entrance  → an accessible entrance (only if marked step-free), with its details
//   building  → a note about a building, shown in its information
// Reports from the public (status 'suggestion') are for the admin to review, and never become data here.

export const IN_USE = new Set(['unverified', 'verified']);

const yesNo = (v) => (v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : undefined);

export function contributionData(entries = []) {
  const paths = [], entrances = [], notes = [];
  for (const e of entries) {
    if (!IN_USE.has(e.status) || !e.geometry && e.kind !== 'building') continue;
    const verified = e.status === 'verified';
    const p = e.properties || {};
    const credit = { Contribution: e.id, Verified: verified, Comment: e.note || '' };
    // Paths and entrances join routes only if marked step-free (or not marked otherwise)
    if (e.kind === 'path' && e.geometry?.type === 'LineString' && yesNo(p.stepFree) !== 'no') {
      paths.push({ type: 'Feature', geometry: e.geometry, properties: {
        Type: verified ? 'Exterior' : 'Contributed', FID: `contrib-${e.id}`, ...credit,
        ...(p.surface && { Surface: p.surface }), ...(p.width && { Width: p.width }), ...(yesNo(p.curbRamps) && { CurbRamps: yesNo(p.curbRamps) }),
      } });
    }
    if (e.kind === 'entrance' && e.geometry?.type === 'Point' && yesNo(p.stepFree) !== 'no') {
      entrances.push({ type: 'Feature', geometry: e.geometry, properties: {
        OBJECTID: `contrib-${e.id}`, Building: e.building || '', Status: 'Working', ...credit,
        ...(yesNo(p.automaticDoor) && { AutomaticDoor: yesNo(p.automaticDoor) }), ...(p.button && { DoorButton: p.button }),
      } });
    }
    if (e.kind === 'building' && e.building) notes.push({ building: e.building, note: e.note || '', verified, id: e.id });
  }
  return { paths, entrances, notes };
}

// A volunteer's entry is checked before it's sent (the Sheet's script checks again)
export function entryProblem(entry) {
  const g = entry.geometry;
  if (entry.kind === 'entrance' && (!g || g.type !== 'Point')) return 'Choose where the entrance is on the map, or use your location.';
  if (entry.kind === 'entrance' && !entry.building) return 'Choose which building the entrance is for.';
  if (entry.kind === 'path' && (!g || g.type !== 'LineString' || g.coordinates.length < 2)) return 'Draw the path: at least two points.';
  if (entry.kind === 'building' && (!entry.building || !(entry.note || '').trim())) return 'Choose the building and write the note.';
  return '';
}
