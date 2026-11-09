# Saiyan Desk

A study and gym tracker that runs as a Google Apps Script web app, with a Google Sheet as its database. It has a dark trading-desk dashboard and an anime power-up theme: your "form" rises as you finish the day's planned training and study, with a particle ki aura and a cinematic transformation.

## What it does

- **Desk**: today's form, mission completion, schedule (office hours blocked out), weekly Dragon Balls, live ticker and KPIs.
- **Gym**: today's exercises from a weekly split, reps per RPE band saved to the tracker tab, stamina/cardio log.
- **Study**: day plan with tick-offs, courses in priority order, and "plan by priority from today", which lays every section from the Study list into your learning slots around office hours.
- **Analytics**: power curve, form states, an animated transformation state machine, weekly study hours and workouts, program reps by body part.
- **Character art**: a built-in original fighter, or any picture you upload (Ctrl+V, drag and drop, or upload).

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
