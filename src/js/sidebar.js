function addSidebarHandlers(map) {
  // Click event for building features
  map.on('click', 'buildings', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['buildings']
    });

    if (!features.length) {
      return;
    }

    const feature = features[0];
    const buildingName = feature.properties.NAME || 'Unknown Building';
    const description = feature.properties.Description || '';
    
    // Split description by line breaks into an array of lines
    const descriptionLines = description.split('\n');
    
// Map through each line of the description and create a list of paragraphs
const descriptionHtml = descriptionLines.map(line => {
  // Check for specific texts and wrap them in <strong> tags
  if (line.trim() === 'Academic Programs:' || line.trim() === 'Dining Options:' || line.trim() === 'Student Resources:') {
    return `<p><strong>${line.trim()}</strong></p>`;
    }
    return `<p>${line.trim()}</p>`;
}).join('');

    // Build the sidebar content
    const buildingInfo = `
      <h2>${buildingName}</h2>
      ${descriptionHtml} <!-- Inject the description with line breaks handled -->
    `;

    // Update the sidebar content
    document.getElementById('building-info').innerHTML = buildingInfo;

    // Show the sidebar
    document.getElementById('sidebar').classList.add('visible');
  });

  // Hide sidebar when user clicks away from the buildings
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['buildings']
    });

    if (!features.length) {
      document.getElementById('sidebar').classList.remove('visible');
    }
  });

  // Change the cursor to a pointer when the mouse is over the buildings layer
  map.on('mouseenter', 'buildings', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  // Change it back to the default cursor when it leaves the buildings layer
  map.on('mouseleave', 'buildings', () => {
    map.getCanvas().style.cursor = '';
  });
}
