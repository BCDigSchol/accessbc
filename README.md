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

- **Directions** between buildings on mapped accessible paths, with slope and climb, written steps, up to five
  stops, and options to allow stairs, prefer or avoid indoor routes, and limit the steepest slope.
- **Find nearby**: the nearest vending machine, restroom, seating, blue-light phone and so on, by walking distance
  from you, your starting building, or along your route.
- **Step-by-step mode**: one instruction at a time with turns and landmarks; the map follows, facing the direction
  of travel in 3D. **Follow my location** advances steps by GPS, warns before turns, says which way the route is
  when you leave it, and offers to re-route. Steps mention curb ramps, stairs that branch off, and seating.
- **Audio guidance**: one button to start step-by-step mode read aloud and following your location.
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
- **Help**: [help.html](help.html) is the user guide, including screen reader tips. Keep it up to date when
  features change.

[docs/data-collection/](docs/data-collection/) has spreadsheets for collecting what the data doesn't yet record
(automatic doors, intercom-only entrances, elevator details).

## Project layout

| Path | Contents |
|---|---|
| `index.html`, `src/js/`, `src/input.css` | The app |
| `help.html`, `src/help.css` | The user guide |
| `src/geojson/` | Campus data layers ([README](src/geojson/README.md)) |
| `src/basemap/` | Self-hosted basemap, terrain, fonts, and icons |
| `src/vendor/` | MapLibre GL JS and PMTiles ([README](src/vendor/README.md)) |
| `src/js/routing/` | Routing graph, route finder, slopes, and step-by-step instructions, shared with `scripts/routing/` ([README](scripts/routing/README.md)) |
| `scripts/` | Local preview server and data/basemap tooling. Not deployed. |

See [updatingdata.md](updatingdata.md) for editing map data.

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