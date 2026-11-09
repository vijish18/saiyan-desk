# Saiyan Desk

A study and gym tracker that runs as a Google Apps Script web app, with a Google Sheet as its database. It has a dark trading-desk dashboard and an anime power-up theme: your "form" rises as you finish the day's planned training and study, with a particle ki aura and a cinematic transformation.

## What it does

- **Desk**: today's form, mission completion, schedule (office hours blocked out), weekly Dragon Balls, live ticker and KPIs.
- **Gym**: today's exercises from a weekly split, reps per RPE band saved to the tracker tab, stamina/cardio log.
- **Study**: day plan with tick-offs, courses in priority order, and "plan by priority from today", which lays every section from the Study list into your learning slots around office hours.
- **Analytics**: power curve, form states, an animated transformation state machine, weekly study hours and workouts, program reps by body part.
- **Character art**: embedded base Goku and Super Saiyan PNGs, with the existing ki aura and transformation crossfade. Custom uploads (Ctrl+V, drag and drop, or upload) and image links still take priority.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Server side: reads and writes the sheet, study planning, tracker rebuild, settings, art storage |
| `Index.html` | The whole web app (HTML, CSS, JS) |
| `appsscript.json` | Manifest: V8 runtime, web app runs as the deploying user, access limited to that user |

## Sheet it expects

Tabs used: `Daily-Power-lifting tracker`, `Exercise list`, `stamina tracker`, `Study plan`, and (created by the app) `App settings`, `App art`, `Study list`. Column layouts follow the original tracker this was built for; see the readers at the top of `Code.gs`.

## Set up your own copy

1. Create a Google Sheet with the tabs above, and attach a script to it (Extensions → Apps Script).
2. Replace `SPREADSHEET_ID` at the top of `Code.gs` with your sheet's ID.
3. Copy in `Code.gs`, `Index.html` and `appsscript.json` (or use [clasp](https://github.com/google/clasp): `clasp create --type sheets`, then `clasp push`).
4. Deploy → New deployment → Web app. Open the link and approve access once.

Settings (office hours, routine, workout split, art links) live in the `App settings` tab and can be edited in the app.

## Included Goku artwork

`Index.html` embeds the same two transparent PNGs used on the Restart site, so they load without external image requests or uploads to your sheet. Base form uses base Goku; powered-up tiers use Super Saiyan unless you supply custom artwork for those forms. Higher tiers keep their existing progress labels and aura effects; the included images only depict base Goku and Super Saiyan. Removing custom images and links restores the defaults.

Original artwork: Bandai Namco’s Dragon Ball FighterZ character pages ([base Goku](https://dba.bn-ent.net/character/images/goku/portrait.png), [Super Saiyan](https://dba.bn-ent.net/character/images/goku-SS/portrait.png)). Dragon Ball characters and artwork belong to their respective rights holders; this is a personal fan project.

### Update an existing Apps Script deployment

1. Replace the Apps Script project's `Index.html` with this repository's updated `Index.html` and save. No backend or sheet changes are needed for the artwork.
2. Choose **Deploy → Manage deployments → Edit (pencil)**.
3. Under **Version**, choose **New version**, then **Deploy**. This keeps your existing `/exec` link.
4. Reload the app. If you previously supplied custom art, use **Change art → Remove** for those slots to reveal the included images.

A GitHub change alone does not update the live Apps Script deployment.

## Cinematic effects and audio

The Desk now has a layered 3D-style stage: cursor-responsive depth, orbiting energy rings, a glowing floor portal, rim lighting, floating debris and rising streaks. Transformations add expanding shockwave rings and phase captions. This uses the existing 2D character images with CSS perspective, not a rotatable 3D character model.

Open **Effects & audio** to select cinematic or calm effects, enable sound effects and English battle lines separately, and set volume. Sound and speech start off. Device speech is an English coach voice, not an imitation of a Goku voice actor. For Goku audio, add your own MP3/WAV clip (up to 2 MB and 12 seconds); it plays during transformations. Clips and audio preferences are saved in this browser, not uploaded to the sheet or GitHub.

The app respects the system reduced-motion setting, pauses hero particles offscreen, stops audio and transformations when the tab is hidden, and supports keyboard skipping with focus restoration. Mobile scenes use a smaller particle budget. Visual effects and previews do not award progress or write training data.

To install this update, follow **Update an existing Apps Script deployment** above. Only `Index.html` changes in Apps Script; the backend and sheet schema stay the same.

### Browser verification

With Node.js and Playwright available, run `node tests/cinematic-browser.cjs`. Set `CHROMIUM_PATH` to use an installed Chromium executable, or install Playwright's Chromium. `PLAYWRIGHT_MODULE` can point to an existing Playwright module. The test uses mocked Apps Script reads and synthetic audio; it never accesses your live sheet. It covers character rendering, depth interaction, transformation cleanup, keyboard focus, audio opt-in/volume, clip validation/removal, preference persistence, responsive layouts and reduced motion. Actual device speech quality depends on the browser and installed voices.
