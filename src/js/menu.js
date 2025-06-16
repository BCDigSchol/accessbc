// HANDLE BUTTON CLICKS

function handleAboutClick() {
  const popup = document.createElement('div');
  popup.id = 'about-popup';

  const intro = document.createElement('p');
  intro.innerHTML = 'Welcome to the AccessBC webmap! If you want to provide feedback or report an issue, please use our <a href="https://forms.gle/EqSt5qz31ub9eB5x7" style="color: #fff; font-weight: bold;">Google Form</a>.';
  popup.appendChild(intro);

  // Dashed line break
  const hr1 = document.createElement('hr');
  popup.appendChild(hr1);

  const instructionHeader = document.createElement('h3');
  instructionHeader.textContent = 'How to Explore';
  popup.appendChild(instructionHeader);

  const instruction = document.createElement('p');
  instruction.textContent = 'To explore the different Boston College campuses, select the campus you wish to view on the top menu. Use the legend to turn on/off different layers.';
  popup.appendChild(instruction);

  // Dashed line break
  const hr2 = document.createElement('hr');
  popup.appendChild(hr2);

  const noteHeader = document.createElement('h3');
  noteHeader.textContent = 'Note on Elevation';
  popup.appendChild(noteHeader);

  const note = document.createElement('p');
  note.textContent = 'If you are trying to view elevation changes, please ensure that your geolocation is on (you may need to refresh the page if you are on a mobile device).';
  popup.appendChild(note);

const closeButton = document.createElement('div');
  closeButton.className = 'close';
  closeButton.textContent = '×';
  closeButton.style.marginTop = '10px';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(popup);
  });
  popup.appendChild(closeButton);

  document.body.appendChild(popup);
}



function setLayerVisibility(layers, visibility) {
  layers.forEach(layerId => {
    map.setLayoutProperty(layerId, 'visibility', visibility);
  });
}

function handleChestnutClick() {
  map.flyTo({
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
  map.flyTo({
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
  map.flyTo({
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
  map.flyTo({
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
const topNav = document.querySelector(".topnav");

// Check if the "responsive" class is already applied
if (topNav.classList.contains("responsive")) {
    // Remove the responsive class to hide expanded menu
    topNav.classList.remove("responsive");
} else {
    // Add the responsive class to expand the menu
    topNav.classList.add("responsive");
}
}