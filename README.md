# access-bc

This repository contains the script for the [AccessBC](https://bcdigschol.github.io/accessbc/) interactive webmap application of the Boston College Campuses.

This project is a collaborative project between the [BC Digital Scholarship Group](https://ds.bc.edu/), colleagues in Facilities, and feedback from BC's Council for Students with Disabilites. The purpose of this webmap is to make resources around the BC campuses more visible and findable as well as try to help users navigate campus.

## Running locally

The site is plain static files with no build step and no external services. From the repository root, run:

```bash
python3 scripts/serve.py
```

Then open http://localhost:8000. Use this script rather than `python3 -m http.server`, which can't serve the
`.pmtiles` basemap and terrain files (they need HTTP Range requests).

## Accessibility features

**The interface** works like other map apps: one **Where to?** box (buildings, things in them, or kinds of
thing like single-stall restrooms, with quick buttons and a **More…** list under it), a route preview from your
location with one **Start** button, and walking directions with **Mute**, **Repeat**, **More**, and **End**. Trip
details (start, stops, route options) are under **Edit trip**; settings, the map key, and help are in the ☰ menu.
On computers it's a column down the left; on phones a search bar at the top and a sheet at the bottom.

- **Directions** between buildings on mapped accessible paths, with slope and climb, written steps, up to five
  stops, and options to allow stairs, prefer or avoid indoor routes, and limit the steepest slope.
- **Find nearby**: the nearest vending machine, restroom, seating, blue-light phone and so on, by walking distance
  from you, your starting building, or along your route.
- **Step-by-step mode**: one instruction at a time with turns and landmarks; the map follows, facing the direction
  of travel in 3D. **Follow my location** advances steps by GPS, warns before turns, says which way the route is
  when you leave it, and (by default) finds a new route from where you are, keeping stops not yet reached. The
  trip, including the current step, is kept in the page address (`?from=…&stop=…&to=…&step=…&follow=1`), so a reload
  doesn't lose it and a link shares it. Steps mention curb ramps, stairs that branch off, and seating.
- **Start** begins walking directions read aloud and following your location; **Preview the steps one by one**
  goes through them without following.
- **Hands free**: the screen stays on during step-by-step mode (Screen Wake Lock), short sounds mark a new step
  (from the side of the turn), a turn coming up, leaving the route, and arriving, and vibration patterns tell left
  from right (Android). An **I use a screen reader** setting stops Access BC speaking over the screen reader.
- **Orientation without the map** ([src/js/orientation.js](src/js/orientation.js)): directions as clock positions
  from the phone's compass ("at your 2 o'clock"), **Face the right way** (a tone in the ear on the side to turn
  toward), **Where am I?** (nearest building, progress on the route, and what's around you), and each building's
  entrances, elevators, and nearby facilities in its information dialog.
- **Accessibility settings** (saved per device): read directions aloud, speaking speed, heading-up map, 3D in
  step-by-step mode, vibration, high contrast, larger text, reduce motion (both follow the device setting by default).
- Keyboard and screen reader support throughout: real buttons, labelled controls, dialogs that manage focus, live
  announcements of results and steps, a skip link, headings and landmarks, and building information reachable from
  search without the map.
- **Low vision**: dark mode (a dark basemap flavor plus dark panels), bigger map symbols and thicker lines, a
  large step-by-step view that fills the screen, and layouts that work at 200-400% zoom without sideways scrolling.
- **Help**: [help.html](help.html) is the user guide, including screen reader tips, with Listen buttons that
  read each section (or the whole guide) aloud. Keep it up to date when
  features change.

**Testing.** Automated accessibility checks run on every push to `dev` and every pull request into `main`
([.github/workflows/accessibility.yml](.github/workflows/accessibility.yml); run them locally with
`cd tests/accessibility && npm ci && npx playwright install chromium && npm run check`). Testing with
students and an orientation and mobility instructor is planned in
[docs/usability-testing/](docs/usability-testing/).

[docs/data-collection/](docs/data-collection/) has spreadsheets for collecting what the data doesn't yet record
(automatic doors, intercom-only entrances, elevator details).

## Project layout

| Path | Contents |
|---|---|
| `index.html`, `src/js/`, `src/input.css` | The app |
| `help.html`, `src/help.css` | The user guide |
| `sw.js`, `src/js/offline.js`, `src/manifest.webmanifest` | Working offline (the service worker, at the site root to cover it all) and the home screen app |
| `src/geojson/` | Campus data layers ([README](src/geojson/README.md)) |
| `src/basemap/` | Self-hosted basemap, terrain, fonts, and icons |
| `src/vendor/` | MapLibre GL JS and PMTiles ([README](src/vendor/README.md)) |
| `src/js/routing/` | Routing graph, route finder, slopes, shuttle rides, and step-by-step instructions, shared with `scripts/routing/` ([README](scripts/routing/README.md)) |
| `scripts/` | Local preview server and data/basemap tooling. Not deployed. |
| `tests/accessibility/` | Automated accessibility checks (axe-core and Playwright, used by CI only). Not deployed. |
| `docs/` | Data collection sheets and the usability testing plan |

See [updatingdata.md](updatingdata.md) for editing map data. See [ROADMAP.md](ROADMAP.md) for what's planned next.

## Deployment

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which publishes `index.html`,
`help.html`, and `src/` to GitHub Pages.

---

Scripts written by
[Lester E. Carver](mailto:carverle@bc.edu)
Data Services Specialist
O'Neill Library
[Boston College](https://bc.edu). 

Significant data collection and processing contributions were made by interns under the [Institute for the Liberal Arts](https://www.bc.edu/content/bc-web/academics/sites/ila.html)' Boston College Summer Internship for PhD Students program. Many thanks to:
- Mehdi Hoseini
- Sean Henninger
- Jeehyun Lee
- Yinan Xu
- Duygun Ruben

---