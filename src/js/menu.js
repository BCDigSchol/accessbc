// HANDLE BUTTON CLICKS

function handleAboutClick() {
  const popup = document.createElement('div');
  popup.id = 'about-popup';

  const text = document.createElement('p');
  text.textContent = 'This is the About section. More information will be added here.';
  popup.appendChild(text);

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
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
    center: [-71.168819, 42.336193],
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
    center: [-71.161387, 42.343167],
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
    center: [-71.194044, 42.344074],
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
    center: [-71.156244, 42.320203],
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