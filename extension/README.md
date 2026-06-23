# Firehouse — Chrome extension (dropdown popup)

Pin it and click the flame to get the full tracker as a **dropdown panel** hanging off the
toolbar icon — no separate window, no tab. Same Supabase data as the website.

## One-time setup

### 1. Load the extension
1. Open Chrome → `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the puzzle-piece icon → **pin** Firehouse so the flame stays in the toolbar.
5. On the Firehouse card, note the **ID** (a long string like `abcd…`). You'll need it next.

### 2. Allow the extension's login redirect in Supabase
Google sign-in in an extension returns to a special URL. Add it to Supabase once:

1. Your extension's redirect URL is:
   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
   Replace `<EXTENSION_ID>` with the ID from step 1.5. (Tip: in the popup's devtools console you
   can run `chrome.identity.getRedirectURL()` to get the exact value.)
2. In Supabase → **Authentication → URL Configuration → Redirect URLs** → **Add URL** → paste
   that `https://<EXTENSION_ID>.chromiumapp.org/` value → **Save**.

That's the only extra setting. Google Cloud needs no changes — login still goes through
Supabase's existing Google provider.

## Use
- Click the pinned flame → the tracker drops down right under the icon.
- First time: click **Sign in with Google**. A Google window opens; finish signing in, then
  click the flame again — you'll be logged in (the popup closes during Google's flow, which is
  normal for extensions).
- After that, clicking the flame opens you straight into the tracker.

## How it works
- The app UI lives in `popup.html` / `popup.js`; styling in `popup.css`.
- `lib/supabase.js` is the Supabase client bundled locally (extension pages can't load remote
  scripts).
- `background.js` runs Google sign-in via `chrome.identity` and stores the session in
  `chrome.storage`, so it survives the popup closing. The popup reads that session on open.
- Data, access rules, and the admin-only rollup are identical to the website — it's the same
  Supabase backend.

## Sharing with a teammate
The manifest pins a fixed extension ID, so everyone who loads this folder gets the **same** ID
(`hpamfknefnmpjjafpeoacdkkpoofomkb`) and the same login redirect — no per-person Supabase setup.

Send your teammate the `extension` folder (e.g. a Drive zip). They:
1. Download and **unzip** it to a stable location (e.g. `~/firehouse-extension`). Keep the folder
   around — deleting it removes the extension.
2. Open `chrome://extensions` → turn on **Developer mode** (top-right).
3. Click **Load unpacked** → select the unzipped `extension` folder.
4. Pin the flame (puzzle-piece icon → pin).
5. Click it → **Sign in with Google** with their **@kula.ai** account.

The Supabase redirect URL `https://hpamfknefnmpjjafpeoacdkkpoofomkb.chromiumapp.org/` is already
allow-listed, so their login works immediately — they only see their own time; the rollup stays
admin-only.

## Notes
- Unlike the website, this popup is fully self-contained, so **app changes must be re-loaded**
  here (push to git isn't enough): edit files, then hit the **↻ reload** on the extension card.
  Teammates re-download the folder and reload to get updates.
- To distribute without Developer mode, publish to the Chrome Web Store (one-time $5 dev
  registration) — ask if you want that set up. The Web Store assigns its own ID, so you'd add
  that new redirect URL to Supabase too.
