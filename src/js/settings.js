// Accessibility settings, remembered per browser (nothing breaks if storage is unavailable).
// 'auto' for reduceMotion and highContrast means "follow the operating system setting".

const SETTINGS_KEY = 'accessbc.settings';
const SETTINGS_DEFAULTS = {
  readAloud: false,      // speak directions (off: screen reader users already hear them)
  speechRate: 1,
  headingUp: true,       // in step-by-step mode, turn the map to face the direction of travel
  guidance3D: true,      // in step-by-step mode, tilt the map so buildings stand up
  vibrate: true,         // vibrate on each new step (Android; iPhones don't support it)
  highContrast: 'auto',
  largerText: false,
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
  settingsListeners.forEach((fn) => fn(settings));
}
function onSettingsChange(fn) {
  settingsListeners.push(fn);
}

document.addEventListener('DOMContentLoaded', applySettings);

// ---- Settings dialog --------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('settings-dialog');
  const opener = document.getElementById('settings-toggle');
  const checkboxes = ['readAloud', 'headingUp', 'guidance3D', 'vibrate', 'largerText'];
  const selects = ['speechRate', 'highContrast', 'reduceMotion'];
  const toSetting = (v) => (v === 'true' ? true : v === 'false' ? false : v);

  const fill = () => {
    checkboxes.forEach((k) => { document.getElementById(`set-${k}`).checked = !!settings[k]; });
    selects.forEach((k) => { document.getElementById(`set-${k}`).value = String(settings[k]); });
  };
  checkboxes.forEach((k) => document.getElementById(`set-${k}`).addEventListener('change', (e) => {
    settings[k] = e.target.checked;
    saveSettings();
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
      const focusable = [...dialog.querySelectorAll('button, input, select')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  if (!('speechSynthesis' in window)) {
    document.getElementById('set-readAloud').disabled = true;
    document.getElementById('set-testVoice').disabled = true;
  }
});
