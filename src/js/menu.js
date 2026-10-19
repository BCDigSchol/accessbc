//Handles about menu button click: an accessible dialog (focus moves in and stays in, Escape closes it,
//focus returns to the About button)
function handleAboutClick() {
  if (document.getElementById('about-popup')) return;
  const opener = document.activeElement;
  const popup = document.createElement('div');
  popup.id = 'about-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-labelledby', 'about-title');

  const title = document.createElement('h2');
  title.id = 'about-title';
  title.textContent = 'About Access BC';
  popup.appendChild(title);

  const intro = document.createElement('p');
  intro.innerHTML = 'Welcome to the AccessBC webmap! If you want to provide feedback or report an issue, please use our <a href="https://forms.gle/EqSt5qz31ub9eB5x7" style="color: #fff; font-weight: bold;">Google Form</a>.';
  popup.appendChild(intro);

  const caution = document.createElement('p');
  caution.innerHTML = '<strong>Please note:</strong> live, step-by-step directions are still in development and aren’t yet meant to be relied on as an assistive device. Use them alongside your usual mobility skills, and proceed with caution.';
  popup.appendChild(caution);

  const hr1 = document.createElement('hr');
  popup.appendChild(hr1);

  const instructionHeader = document.createElement('h3');
  instructionHeader.textContent = 'How to Explore';
  popup.appendChild(instructionHeader);

  const instruction = document.createElement('p');
  instruction.textContent = 'To explore the different Boston College campuses, select the campus you wish to view on the top menu. Use the legend to turn on/off different layers. Use Directions to find an accessible route between buildings, or click a building and choose "Directions from here" or "Directions to here". Start step-by-step directions to be guided one instruction at a time. The Accessibility button has settings for reading directions aloud, high contrast, larger text, and reduced motion.';
  popup.appendChild(instruction);

  const help = document.createElement('p');
  help.innerHTML = 'New here, or using a screen reader? Read <a href="help.html" style="color: #fff; font-weight: bold;">how to use Access BC</a>.';
  popup.appendChild(help);

  const hr2 = document.createElement('hr');
  popup.appendChild(hr2);

  const noteHeader = document.createElement('h3');
  noteHeader.textContent = 'Note on Elevation';
  popup.appendChild(noteHeader);

  const note = document.createElement('p');
  note.textContent = 'If you are trying to view elevation changes, please ensure that your geolocation is on (you may need to refresh the page if you are on a mobile device).';
  popup.appendChild(note);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close');
  const close = () => {
    popup.remove();
    if (opener && document.contains(opener)) opener.focus();
  };
  closeButton.addEventListener('click', close);
  popup.appendChild(closeButton);

  popup.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    trapFocus(popup, e);
  });

  document.body.appendChild(popup);
  closeButton.focus();
}

// Handles selectiont different campuses to adjust map view
function handleChestnutClick() {
  moveMap(map, 'flyTo', {
    center: [-71.170820, 42.336190],
    speed: 1.25,
    curve: 1,
    zoom: 15
  });

  document.getElementById('chestnut-hill').style.backgroundColor = '#b29d6c';

  document.querySelectorAll('.menu-button').forEach(button => {
    if (button.id !== 'chestnut-hill') {
      button.addEventListener('click', () => {
        document.getElementById('chestnut-hill').style.backgroundColor = '';
      });
    }
  });
}

function handleBrightonClick() {
  moveMap(map, 'flyTo', {
    center: [-71.163387, 42.343167],
    speed: 1.25,
    curve: 1,
    zoom: 15.5
  });

  document.getElementById('brighton').style.backgroundColor = '#b29d6c';

  document.querySelectorAll('.menu-button').forEach(button => {
    if (button.id !== 'brighton') {
      button.addEventListener('click', () => {
        document.getElementById('brighton').style.backgroundColor = '';
      });
    }
  });
}

function handleNewtonClick() {
  moveMap(map, 'flyTo', {
    center: [-71.196944, 42.344074],
    speed: 1.25,
    curve: 1,
    zoom: 15
  });

  document.getElementById('newton').style.backgroundColor = '#b29d6c';

  document.querySelectorAll('.menu-button').forEach(button => {
    if (button.id !== 'newton') {
      button.addEventListener('click', () => {
        document.getElementById('newton').style.backgroundColor = '';
      });
    }
  });
}

function handleBrooklineClick() {
  moveMap(map, 'flyTo', {
    center: [-71.157244, 42.320203],
    speed: 1.25,
    curve: 1,
    zoom: 15.5
  });

  document.getElementById('brookline').style.backgroundColor = '#b29d6c';

  document.querySelectorAll('.menu-button').forEach(button => {
    if (button.id !== 'brookline') {
      button.addEventListener('click', () => {
        document.getElementById('brookline').style.backgroundColor = '';
      });
    }
  });
}

// The menu drawer (☰): Accessibility settings, Map layers, Help, About, and the campuses. Focus moves into it
// when it opens, Escape closes it, and focus goes back to the menu button.
function setMenuOpen(open) {
  const menu = document.getElementById('app-menu');
  const toggle = document.getElementById('menu-toggle');
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button, a').focus();
  else toggle.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const menu = document.getElementById('app-menu');
  document.getElementById('menu-toggle').addEventListener('click', () => setMenuOpen(menu.hidden));
  document.getElementById('menu-close').addEventListener('click', () => setMenuOpen(false));
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenuOpen(false);
  });
  // Clicking outside the open menu closes it
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#menu-toggle')) setMenuOpen(false);
  });

  // Each item closes the menu first, so the dialog it opens hands focus back to the menu button afterwards
  const item = (id, action) => document.getElementById(id).addEventListener('click', () => { setMenuOpen(false); action(); });
  item('settings-toggle', () => openSettings());
  item('about', handleAboutClick);
  item('menu-layers', () => setLegendOpen(true));
  item('chestnut-hill', handleChestnutClick);
  item('brighton', handleBrightonClick);
  item('newton', handleNewtonClick);
  item('brookline', handleBrooklineClick);

  // "Add Access BC to your home screen": offered in the menu when the browser can install it (Android and desktop
  // Chrome and Edge). On an iPhone it's Share, then Add to Home Screen (the help page says so).
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    document.getElementById('menu-install-item').hidden = false;
  });
  window.addEventListener('appinstalled', () => { document.getElementById('menu-install-item').hidden = true; });
  item('menu-install', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.getElementById('menu-install-item').hidden = true;
  });
});
