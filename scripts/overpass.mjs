// Queries OpenStreetMap's public Overpass API, shared by the data scripts. The public servers are often busy: each
// is tried in turn, waiting longer each round. Returns the result's elements.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export async function overpass(query) {
  let wait = 5;
  for (let round = 1; round <= 5; round++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': 'AccessBC/1.0 (Boston College accessibility map)', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (res.ok) return (await res.json()).elements;
        console.log(`  ${new URL(endpoint).host}: ${res.status}`);
      } catch (err) {
        console.log(`  ${new URL(endpoint).host}: ${err.message}`);
      }
    }
    console.log(`  busy; trying again in ${wait} s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    wait *= 2;
  }
  throw new Error('Overpass servers are busy. Try again later.');
}
