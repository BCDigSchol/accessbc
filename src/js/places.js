// Your places: destinations you've saved ("Home", "My dorm"), and the last few you've had directions to. Shown as
// buttons under Where to? and in its suggestions, so a regular trip is one press. Kept on this device only.

const PLACES_KEY = 'accessbc.places';
const MAX_SAVED = 8, MAX_RECENT = 5, CHIPS_SHOWN = 4;

// {saved: [{key, name, dest}], recent: [{key, dest}]}; dest is {building} or {label, lonlat, phrase}
let myPlaces = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACES_KEY) || '{}');
    return { saved: saved.saved || [], recent: saved.recent || [] };
  } catch {
    return { saved: [], recent: [] };
  }
})();

function savePlaces() {
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(myPlaces)); } catch { /* storage unavailable */ }
  renderPlaces();
}

const placeKey = (dest) => (dest.building ? `b:${dest.building}` : `p:${dest.lonlat.map((n) => n.toFixed(5)).join(',')}`);
const destLabel = (dest) => dest.building || dest.label;

// The current route's destination, or null for your location (which isn't a place to save)
function currentDestination() {
  const to = document.getElementById('route-to').value;
  if (to === PLACE && routing.place) return { label: routing.place.label, lonlat: routing.place.lonlat, phrase: routing.place.phrase };
  if (to && to !== MY_LOCATION) return { building: to };
  return null;
}

// Called when a route is found: it becomes the most recent place (not emergency trips)
function rememberDestination() {
  const dest = currentDestination();
  if (!dest || routing.place?.emergency) return;
  const key = placeKey(dest);
  myPlaces.recent = [{ key, dest }, ...myPlaces.recent.filter((p) => p.key !== key)].slice(0, MAX_RECENT);
  savePlaces();
}

const savedPlace = (key) => myPlaces.saved.find((p) => p.key === key);

function toggleSavedDestination() {
  const dest = currentDestination();
  if (!dest) return;
  const key = placeKey(dest);
  if (savedPlace(key)) {
    myPlaces.saved = myPlaces.saved.filter((p) => p.key !== key);
    announce(`${destLabel(dest)} removed from your places.`);
  } else {
    if (myPlaces.saved.length >= MAX_SAVED) return announce(`You can save up to ${MAX_SAVED} places. Remove one first, under Edit in your places.`);
    myPlaces.saved.push({ key, name: destLabel(dest), dest });
    announce(`${destLabel(dest)} saved to your places. To rename it, choose Edit under Where to.`);
  }
  savePlaces();
  syncSaveButton();
}

function syncSaveButton() {
  const button = document.querySelector('#route-result .save-place');
  const dest = currentDestination();
  if (!button || !dest) return;
  const saved = !!savedPlace(placeKey(dest));
  button.setAttribute('aria-pressed', String(saved));
  button.innerHTML = `<span aria-hidden="true">${saved ? '★' : '☆'} </span>${saved ? 'Saved' : 'Save'}`;
}

// Directions to one of your places, from your location (as with Where to?)
function goToPlace(dest) {
  if (!routing) return;
  clearWhereTo();
  document.getElementById('where-to').value = destLabel(dest);
  document.getElementById('where-to-clear').hidden = false;
  if (dest.building) {
    routing.place = null;
    document.getElementById('route-to').value = dest.building;
  } else {
    setPlaceDestination({ label: dest.label, phrase: dest.phrase || placePhrase(dest.label), lonlat: dest.lonlat });
  }
  updateRoute(window.map);
  document.getElementById('route-title').focus();
}

// Saved places first, then recent ones not saved; for the buttons and the search suggestions
function placeList() {
  const saved = myPlaces.saved.map((p) => ({ ...p, kind: 'Saved' }));
  const recent = myPlaces.recent.filter((p) => !savedPlace(p.key)).map((p) => ({ ...p, name: destLabel(p.dest), kind: 'Recent' }));
  return [...saved, ...recent];
}

function renderPlaces({ editor = true } = {}) {
  const box = document.getElementById('my-places');
  if (!box) return;
  const editing = !document.getElementById('places-edit').hidden;
  const list = placeList();
  box.hidden = !list.length;
  box.innerHTML = list.slice(0, CHIPS_SHOWN).map((p, i) => {
    const icon = p.kind === 'Saved' ? '★' : '↺';
    const where = p.name !== destLabel(p.dest) ? ` (${destLabel(p.dest)})` : '';
    return `<button type="button" class="chip place-chip" data-place-index="${i}" aria-label="${escapeHtml(`Directions to ${p.name}${where}, ${p.kind.toLowerCase()}`)}"><span aria-hidden="true">${icon} </span>${escapeHtml(p.name)}</button>`;
  }).join('') + `<button type="button" class="chip" id="places-edit-toggle" aria-expanded="${editing}" aria-controls="places-edit">Edit</button>`;
  if (editor) renderPlacesEditor();
}

// Edit your places: rename or remove saved places, remove recent ones
function renderPlacesEditor() {
  const editor = document.getElementById('places-edit');
  const saved = myPlaces.saved, recent = myPlaces.recent.filter((p) => !savedPlace(p.key));
  editor.innerHTML = `
    ${saved.length ? `<h2 class="places-heading">Saved</h2><ul class="places-list">${saved.map((p, i) => `
      <li>
        <label for="place-name-${i}" class="visually-hidden">Name for ${escapeHtml(destLabel(p.dest))}</label>
        <input type="text" id="place-name-${i}" data-place-rename="${i}" value="${escapeHtml(p.name)}" autocomplete="off">
        <span class="places-where">${p.name !== destLabel(p.dest) ? escapeHtml(destLabel(p.dest)) : ''}</span>
        <button type="button" data-place-remove="${i}" aria-label="Remove ${escapeHtml(p.name)} from saved places">Remove</button>
      </li>`).join('')}</ul>` : '<p class="route-note">To save a place, get directions to it and choose <strong>Save</strong>.</p>'}
    ${recent.length ? `<h2 class="places-heading">Recent</h2><ul class="places-list">${recent.map((p) => `
      <li><span>${escapeHtml(destLabel(p.dest))}</span>
        <button type="button" data-recent-remove="${escapeHtml(p.key)}" aria-label="Remove ${escapeHtml(destLabel(p.dest))} from recent places">Remove</button></li>`).join('')}</ul>` : ''}
    <button type="button" id="places-edit-done">Done</button>`;
}

function setPlacesEditorOpen(open) {
  const editor = document.getElementById('places-edit'), toggle = document.getElementById('places-edit-toggle');
  editor.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
  if (open) (editor.querySelector('input, button'))?.focus();
  else toggle?.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  renderPlaces();
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-place-index]');
    if (chip) return goToPlace(placeList()[Number(chip.dataset.placeIndex)].dest);
    if (e.target.closest('.save-place')) return toggleSavedDestination();
    if (e.target.id === 'places-edit-toggle') return setPlacesEditorOpen(document.getElementById('places-edit').hidden);
    if (e.target.id === 'places-edit-done') return setPlacesEditorOpen(false);
    const remove = e.target.dataset?.placeRemove, recent = e.target.dataset?.recentRemove;
    if (remove !== undefined) {
      const [gone] = myPlaces.saved.splice(Number(remove), 1);
      savePlaces();
      announce(`${gone.name} removed.`);
      document.getElementById('places-edit').hidden = false;
      document.getElementById('places-edit').querySelector('input, button')?.focus();
    } else if (recent !== undefined) {
      myPlaces.recent = myPlaces.recent.filter((p) => p.key !== recent);
      savePlaces();
      document.getElementById('places-edit').hidden = false;
      document.getElementById('places-edit').querySelector('input, button')?.focus();
    }
  });
  // Renaming: saved as you leave the field
  document.addEventListener('change', (e) => {
    const i = e.target.dataset?.placeRename;
    if (i === undefined) return;
    const place = myPlaces.saved[Number(i)];
    place.name = e.target.value.trim() || destLabel(place.dest);
    try { localStorage.setItem(PLACES_KEY, JSON.stringify(myPlaces)); } catch { /* storage unavailable */ }
    renderPlaces({ editor: false }); // the buttons only, so focus stays where it is in the editor
    announce(`Renamed to ${place.name}.`);
  });
  document.getElementById('places-edit').addEventListener('keydown', (e) => { if (e.key === 'Escape') setPlacesEditorOpen(false); });
});
