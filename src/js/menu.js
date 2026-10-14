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

  const hr1 = document.createElement('hr');
  popup.appendChild(hr1);

  const instructionHeader = document.createElement('h3');
  instructionHeader.textContent = 'How to Explore';
  popup.appendChild(instructionHeader);

  const instruction = document.createElement('p');
  instruction.textContent = 'To explore the different Boston College campuses, select the campus you wish to view on the top menu. Use the legend to turn on/off different layers. Use Directions to find an accessible route between buildings, or click a building and choose "Directions from here" or "Directions to here". Start step-by-step directions to be guided one instruction at a time. The Accessibility button has settings for reading directions aloud, high contrast, larger text, and reduced motion.';
  popup.appendChild(instruction);

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
    if (e.key === 'Tab') {
      // keep keyboard focus inside the dialog while it's open
      const focusable = popup.querySelectorAll('a[href], button');
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
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

// Attach event listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('about').addEventListener('click', handleAboutClick);
  document.getElementById('newton').addEventListener('click', handleNewtonClick);
  document.getElementById('brighton').addEventListener('click', handleBrightonClick);
  document.getElementById('chestnut-hill').addEventListener('click', handleChestnutClick);
  document.getElementById('brookline').addEventListener('click', handleBrooklineClick);
});

function toggleMenu() {
  // Collapse/Expand menu for different screen sizes
  const open = document.querySelector('.topnav').classList.toggle('responsive');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', String(open));
}