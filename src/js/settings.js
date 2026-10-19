// Accessibility settings, remembered per browser (nothing breaks if storage is unavailable).
// 'auto' for reduceMotion and highContrast means "follow the operating system setting".

const SETTINGS_KEY = 'accessbc.settings';
const SETTINGS_DEFAULTS = {
  readAloud: true,       // speak walking directions; the Mute button while walking turns this off, and it stays off
  screenReader: false,   // the student uses a screen reader: never speak as well, so nothing is heard twice
  autoReroute: true,     // find a new route when you leave it while your location is followed
  soundCues: true,       // short tones for a new step, a turn coming up, leaving the route, arriving
  speechRate: 1,
  clockFace: true,       // directions as clock positions, from the phone's compass (when it has one)
  headingUp: true,       // in step-by-step mode, turn the map to face the direction of travel
  guidance3D: true,      // in step-by-step mode, tilt the map so buildings stand up
  vibrate: true,         // vibrate on each new step (Android; iPhones don't support it)
  highContrast: 'auto',
  darkMode: false,       // dark map and panels ('auto' follows the device)
  largerText: false,
  largeSymbols: false,   // bigger map symbols and thicker paths and routes
  bigSteps: false,       // step-by-step directions fill the screen, with big text and buttons
  reduceMotion: 'auto',
  pace: 'gentle',        // walking or wheeling pace, for time estimates and whether a shuttle is worth it
};

// Metres a second for each pace (a gentle walk is about 2.7 mph; wheelchair and cane users vary widely)
const PACES = { slower: 0.8, gentle: 1.2, brisk: 1.4 };
const walkSpeed = () => PACES[settings.pace] || PACES.gentle;

// Saved settings carry a version, so a changed default can be applied once to settings saved before it.
// Version 2: reading aloud became on by default (with Mute while walking), after being off by default.
const SETTINGS_VERSION = 2;

const settings = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if ((saved.version || 1) < 2) delete saved.readAloud;
    return { ...SETTINGS_DEFAULTS, ...saved, version: SETTINGS_VERSION };
  } catch {
    return { ...SETTINGS_DEFAULTS, version: SETTINGS_VERSION };
  }
})();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable */ }
  applySettings();
}

const systemPrefers = (query) => window.matchMedia && window.matchMedia(query).matches;

function reducedMotion() {
  return settings.reduceMotion === 'auto' ? systemPrefers('(prefers-reduced-motion: reduce)') : !!settings.reduceMotion;
}

function highContrast() {
  return settings.highContrast === 'auto' ? systemPrefers('(prefers-contrast: more)') : !!settings.highContrast;
}

function darkMode() {
  return settings.darkMode === 'auto' ? systemPrefers('(prefers-color-scheme: dark)') : !!settings.darkMode;
}

// A short status message for screen readers ("Route found…"), through the page's polite live region.
// Cleared first so the same message twice is still announced.
function announce(text) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

// Move the map, without animation when motion should be reduced.
function moveMap(map, method, options) {
  if (reducedMotion()) {
    if (method === 'fitBounds') return map.fitBounds(options.bounds, { ...options, animate: false });
    return map.jumpTo(options);
  }
  if (method === 'fitBounds') return map.fitBounds(options.bounds, options);
  return map[method](options);
}

// Page-wide classes for the CSS, plus map styling that depends on settings.
const settingsListeners = [];
function applySettings() {
  document.documentElement.classList.toggle('high-contrast', highContrast());
  document.documentElement.classList.toggle('larger-text', !!settings.largerText);
  document.documentElement.classList.toggle('dark', darkMode());
  document.documentElement.classList.toggle('big-steps', !!settings.bigSteps);
  settingsListeners.forEach((fn) => fn(settings));
}
function onSettingsChange(fn) {
  settingsListeners.push(fn);
}

document.addEventListener('DOMContentLoaded', applySettings);
// "Match my device" settings follow the device when it changes (e.g. dark mode at sunset)
for (const query of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']) {
  window.matchMedia?.(query).addEventListener?.('change', applySettings);
}

// Keeps keyboard focus inside an open dialog: Tab from the last control goes to the first, Shift+Tab from the
// first to the last. Call from the dialog's keydown handler. Only visible, enabled controls count.
function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const focusable = [...container.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}

// ---- Settings dialog --------------------------------------------------------------------------------

// Opens the settings dialog (from the menu, or More in walk mode). Closing it returns focus to whatever opened it.
let openSettings = () => {};

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('settings-dialog');
  let returnFocus = null;
  const checkboxes = ['screenReader', 'readAloud', 'autoReroute', 'soundCues', 'clockFace', 'headingUp', 'guidance3D', 'vibrate', 'largerText', 'largeSymbols', 'bigSteps'];
  const selects = ['speechRate', 'highContrast', 'darkMode', 'reduceMotion', 'pace'];
  const toSetting = (v) => (v === 'true' ? true : v === 'false' ? false : v);

  const speech = 'speechSynthesis' in window;
  // Reading aloud is off while "I use a screen reader" is on (the screen reader already reads everything)
  const syncReadAloud = () => {
    document.getElementById('set-readAloud').disabled = !speech || !!settings.screenReader;
  };
  const fill = () => {
    checkboxes.forEach((k) => { document.getElementById(`set-${k}`).checked = !!settings[k]; });
    selects.forEach((k) => { document.getElementById(`set-${k}`).value = String(settings[k]); });
    syncReadAloud();
  };
  checkboxes.forEach((k) => document.getElementById(`set-${k}`).addEventListener('change', (e) => {
    settings[k] = e.target.checked;
    saveSettings();
    syncReadAloud();
  }));
  selects.forEach((k) => document.getElementById(`set-${k}`).addEventListener('change', (e) => {
    settings[k] = k === 'speechRate' ? Number(e.target.value) : toSetting(e.target.value);
    saveSettings();
  }));
  document.getElementById('set-testVoice').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('Turn left and continue for 120 feet, with Gasson Hall on your right.');
    u.rate = Number(settings.speechRate) || 1;
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  });

  const close = () => {
    dialog.hidden = true;
    const back = returnFocus && document.contains(returnFocus) && returnFocus.offsetParent !== null ? returnFocus : document.getElementById('menu-toggle');
    back.focus();
  };
  openSettings = () => {
    returnFocus = document.activeElement;
    fill();
    dialog.hidden = false;
    document.getElementById('settings-close').focus();
  };
  document.getElementById('settings-close').addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    trapFocus(dialog, e);
  });
  if (!speech) document.getElementById('set-testVoice').disabled = true;
});
