# Setting up contributions (volunteers' additions and public reports)

Access BC can take additions to its map from volunteers (accessible entrances, paths, and notes about buildings) and
reports from anyone, through a Google Sheet. They show in Access BC straight away, marked **not verified yet**, until
you check them; then you make them permanent in the site's data. This sets it up, once. Allow 15 minutes.

**How it works:**
- Volunteers use the **contribute page** (`contribute.html`) with a shared **volunteer passcode** and their own
  **email** (required, since everyone shares the passcode: it records who added what). What they add goes into the
  Sheet as *unverified* and is used in routes straight away, marked as not checked.
- Reports from the public ("Tell us where its accessible entrance is", "Report a problem… To Access BC") go into the
  Sheet as *suggestions*: you see them, but they don't change the map.
- You review entries on the contribute page's **Review** tab with an **admin passcode**: *Verify* or *Reject*.
  Verified entries are used as checked straight away.
- `scripts/import-contributions.mjs` writes verified entries into the data files, permanently, and marks them
  *imported* in the Sheet. You commit those files as usual.

## 1. The Sheet and its script

1. In Google Drive (with a BC account, so the data stays with BC), create a Google Sheet, for example **Access BC
   contributions**. Share it only with the Access BC team.
2. In the Sheet: **Extensions > Apps Script**. Delete what's in `Code.gs`, paste in the whole of
   [scripts/contributions/Code.gs](../../scripts/contributions/Code.gs), and save.
3. Still in Apps Script: **Project Settings** (the gear) **> Script properties > Add script property**, twice:
   - `VOLUNTEER_PASSCODE`: the passcode you'll give volunteers, for example three random words
   - `ADMIN_PASSCODE`: a different, longer one, for you (and anyone else who verifies)

   The passcodes stay in the script; they're never in the website's code or the repository.
4. **Deploy > New deployment**. Type: **Web app**. *Execute as*: **Me**. *Who has access*: **Anyone**. Deploy, and
   allow the access Google asks for (the script reads and writes this Sheet only).
5. Copy the **Web app URL** (it ends in `/exec`).

"Anyone" lets the site read the entries in use (without contributors' names) and send reports without a sign-in.
Adding map data needs the volunteer passcode, and seeing everything, verifying, and importing need the admin one.

## 2. The site

Put the web app URL in [src/js/config.js](../../src/js/config.js):

```js
const CONTRIBUTIONS_URL = 'https://script.google.com/macros/s/…/exec';
```

Commit and deploy. Then open `contribute.html` on the site, add a test entry with the volunteer passcode, and check
that it appears in the Sheet and on the map (dashed orange). Reject it on the Review tab when you're done.

## 3. Verifying and making it permanent

- **Verify or reject** on the contribute page's Review tab (admin passcode), or by changing the `status` column in
  the Sheet to `verified` or `rejected`.
- **Make verified entries permanent**, from the repository:

  ```bash
  ACCESSBC_CONTRIBUTIONS_URL='https://script.google.com/macros/s/…/exec' ACCESSBC_ADMIN_PASSCODE='…' node scripts/import-contributions.mjs
  ```

  Add `--dry-run` first to see what it would do. Paths go into `src/geojson/accessiblepaths.geojson`, entrances
  into `entrances.geojson`, and building notes into `building-notes.json`, each with who verified it and when. Then
  run `node scripts/link-entrances.mjs` and `node scripts/make-data-collection-sheets.mjs`, check a few routes, and
  commit.

## Looking after it

- **Changing a passcode:** edit the script property. Volunteers enter the new one next time.
- **Updating the script** (after a change to `Code.gs` here): paste it in again, then **Deploy > Manage deployments >
  Edit > New version**. The URL stays the same.
- **Unwanted entries:** reject them; they disappear from the map. If the volunteer passcode gets around, change it.
- **Who did what:** each volunteer entry has their email (and name, if given) in the Sheet and on the Review tab.
  To see everything one person added, filter the Sheet's `email` column; to undo it, reject those rows.
- **Privacy:** emails and names are only in the Sheet and the admin list, never on the public site or in the data
  files (imported entries keep the entry's id, which leads back to its row). Public reports can include a location;
  don't publish the Sheet.
