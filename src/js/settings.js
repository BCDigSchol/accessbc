// Accessibility settings, remembered per browser (nothing breaks if storage is unavailable).
// 'auto' for reduceMotion and highContrast means "follow the operating system setting".

const SETTINGS_KEY = 'accessbc.settings';
const SETTINGS_DEFAULTS = {
  readAloud: false,      // speak directions (off: screen reader users already hear them)
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
};

const settings = (() => {
  try {
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...SETTINGS_DEFAULTS };
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

// ---- Settings dialog --------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('settings-dialog');
  const opener = document.getElementById('settings-toggle');
  const checkboxes = ['screenReader', 'readAloud', 'autoReroute', 'soundCues', 'clockFace', 'headingUp', 'guidance3D', 'vibrate', 'largerText', 'largeSymbols', 'bigSteps'];
  const selects = ['speechRate', 'highContrast', 'darkMode', 'reduceMotion'];
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
    opener.focus();
  };
  opener.addEventListener('click', () => {
    fill();
    dialog.hidden = false;
    document.querySelector('.topnav').classList.remove('responsive');
    document.getElementById('settings-close').focus();
  });
  document.getElementById('settings-close').addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      // keep keyboard focus inside the dialog while it's open
      const focusable = [...dialog.querySelectorAll('button, input, select, a[href]')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  if (!speech) document.getElementById('set-testVoice').disabled = true;
});
