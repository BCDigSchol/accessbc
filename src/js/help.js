// The help page: listen to the guide, a section at a time or all of it, with the paragraph being read
// highlighted. Uses the speaking speed, dark mode, and larger text from the map's Accessibility settings.

const helpSettings = (() => {
  try {
    return JSON.parse(localStorage.getItem('accessbc.settings') || '{}');
  } catch {
    return {};
  }
})();

// Dark mode and larger text, as chosen in the map's settings ('auto' or unset follows the device)
if (helpSettings.darkMode === true) document.documentElement.dataset.theme = 'dark';
if (helpSettings.darkMode === false) document.documentElement.dataset.theme = 'light';
if (helpSettings.largerText) document.documentElement.classList.add('larger-text');

const reading = { queue: [], index: 0, current: null, paused: false, button: null };

// The text of a block, leaving out nested lists (their items are read separately) and Listen buttons
function blockText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('ul, ol, .listen').forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function blocksOf(root) {
  return [...root.querySelectorAll('h2, h3, p, li')].filter((el) => !el.closest('nav') && blockText(el));
}

function highlight(el) {
  document.querySelectorAll('.speaking').forEach((n) => n.classList.remove('speaking'));
  if (!el) return;
  el.classList.add('speaking');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || helpSettings.reduceMotion === true;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

function setStatus(text) {
  document.getElementById('listen-status').textContent = text;
}

function updateButtons() {
  const playing = reading.queue.length > 0;
  document.getElementById('listen-pause').hidden = !playing;
  document.getElementById('listen-stop').hidden = !playing;
  document.getElementById('listen-pause').textContent = reading.paused ? 'Resume' : 'Pause';
  document.querySelectorAll('.listen').forEach((b) => b.setAttribute('aria-pressed', String(b === reading.button && playing)));
}

function readNext() {
  if (reading.index >= reading.queue.length) return stopReading('Finished.');
  const el = reading.queue[reading.index];
  highlight(el);
  const utterance = new SpeechSynthesisUtterance(blockText(el));
  utterance.rate = Number(helpSettings.speechRate) || 1;
  utterance.lang = 'en-US';
  utterance.onend = () => {
    if (reading.current !== utterance) return; // stopped or restarted
    reading.index++;
    readNext();
  };
  reading.current = utterance;
  speechSynthesis.speak(utterance);
}

// Read blocks aloud, one utterance each (long utterances get cut off in some browsers)
function startReading(blocks, button, label) {
  speechSynthesis.cancel();
  reading.queue = blocks;
  reading.index = 0;
  reading.paused = false;
  reading.button = button;
  setStatus(`Reading ${label}.`);
  updateButtons();
  readNext();
}

function stopReading(message = 'Stopped.') {
  reading.current = null;
  reading.queue = [];
  reading.paused = false;
  speechSynthesis.cancel();
  highlight(null);
  setStatus(message);
  updateButtons();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!('speechSynthesis' in window)) {
    document.getElementById('listen-controls').hidden = true;
    return;
  }
  // A Listen button beside each section heading
  document.querySelectorAll('main section').forEach((section) => {
    const heading = section.querySelector('h2');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'listen';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span aria-hidden="true">🔊 </span>Listen<span class="visually-hidden"> to “${heading.textContent}”</span>`;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return stopReading();
      startReading(blocksOf(section), button, `“${heading.textContent}”`);
    });
    heading.after(button);
  });

  document.getElementById('listen-all').addEventListener('click', (e) => {
    startReading(blocksOf(document.querySelector('main')), e.currentTarget, 'the whole guide');
  });
  document.getElementById('listen-pause').addEventListener('click', () => {
    if (reading.paused) speechSynthesis.resume();
    else speechSynthesis.pause();
    reading.paused = !reading.paused;
    setStatus(reading.paused ? 'Paused.' : 'Reading.');
    updateButtons();
  });
  document.getElementById('listen-stop').addEventListener('click', () => stopReading());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && reading.queue.length) stopReading();
  });
  window.addEventListener('pagehide', () => speechSynthesis.cancel());
});
