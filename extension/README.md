# Firehouse — Chrome extension (launcher)

Pin this and click it to open Firehouse in a focused popup window. It reuses the hosted app
(https://skkula.github.io/firehouse/) and its Google login — nothing to configure.

## Install (load unpacked)
1. Open Chrome → `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the puzzle-piece icon in the toolbar → **pin** Firehouse so the flame icon stays visible.

## Use
- Click the pinned flame icon → Firehouse opens in a compact 440×720 window.
- Click it again while open → it just focuses the existing window (no duplicates).
- Close the window when done; the next click opens a fresh one.

## Sharing with the team
Anyone can install it the same way (Load unpacked). To distribute without Developer mode,
the folder can be published to the Chrome Web Store (one-time $5 developer registration) — ask
if you want that set up.

## Notes
- This is a *launcher*: the app itself still runs from the hosted URL, so any update you push to
  the site is picked up automatically — the extension never needs re-publishing for app changes.
- Login and data are identical to the website; signing in once in the popup keeps you signed in.
