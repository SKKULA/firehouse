# Firehouse — technical documentation

Time-tracking app for the support team. Agents sign in with their **@kula.ai** Google
account, run a timer (or log time manually) against an activity type and a customer, and a
**Manager rollup** — visible only to the admin — aggregates everyone's time.

- **Live app:** https://skkula.github.io/firehouse/
- **Repo:** https://github.com/SKKULA/firehouse
- **Hosting:** GitHub Pages (static, free)
- **Backend:** Supabase (Postgres + Google OAuth, free tier)

---

## 1. How it works (plain English)

1. Agent opens the live URL and clicks **Sign in with Google**. Only `@kula.ai` accounts are
   accepted — anyone else is signed straight back out with a message.
2. On the **Track** tab they pick an activity type (Issue / Customer call / Offline work /
   Project / Demo or implementation call), type the **customer**, and either:
   - press **Start** to run a live timer, then **Stop & log**, or
   - expand **Log time manually** and enter a duration in minutes or hours.
3. Each saved entry is written to one shared Supabase table.
4. **My history** groups an agent's entries by day, totals each day, and compares it to the
   daily target of **9h** (10h shift − 1h break).
5. **Manager rollup** (only the admin sees this tab) totals all agents' time, sliced by agent,
   by customer, and by activity type, with date-range filters and CSV export.

Access is enforced in two places: the UI hides the admin tab from non-admins, **and** the
database's row-level security stops non-admins from reading anyone else's rows. So it can't be
bypassed by tampering with the page.

---

## 2. Architecture

```
Browser (index.html)  ──HTTPS──>  Supabase
  - HTML/CSS/JS (no build)            - Auth (Google OAuth, kula.ai)
  - supabase-js v2 via CDN            - Postgres table `entries`
  - GitHub Pages serves the file      - Row-Level Security policies
```

There is no server of our own and no build step — `index.html` is a single self-contained file.
All dynamic behaviour is client-side JavaScript talking directly to Supabase with the
**publishable (anon)** key. That key is safe to ship publicly because every read/write is gated
by the RLS policies in the database.

### Files
| File | Purpose |
|------|---------|
| `index.html` | The entire app — markup, styles, and logic. |
| `SETUP.md` | One-time setup checklist (Supabase project, SQL, Google OAuth, keys). |
| `DOCS.md` | This document. |
| `.gitignore` | Ignores `.DS_Store`. |

---

## 3. Configuration

Near the bottom of `index.html`:

```js
const SUPABASE_URL      = 'https://vicfnkbsrcmemhffuqyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';   // publishable / anon key — safe to commit
const ALLOWED_DOMAIN    = 'kula.ai';              // only this email domain may sign in
const ADMIN_EMAILS      = ['saikausik@kula.ai'];  // who sees the Manager rollup
const SHIFT_HOURS = 10, BREAK_HOURS = 1;          // daily target = (10 − 1) = 9h
```

- **Add an agent?** Nothing to do — any `@kula.ai` Google account works on first sign-in.
- **Add an admin?** Add the email to `ADMIN_EMAILS` *and* to the `is_admin()` function in the
  database (see SETUP.md), then commit/push.
- **Change the target or break?** Edit `SHIFT_HOURS` / `BREAK_HOURS`.
- **Never** put the Supabase `service_role` / secret key in this file.

---

## 4. Data model

Supabase table `public.entries`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | primary key, auto |
| `user_email` | text | the agent's email (identity) |
| `user_name` | text | display name from Google |
| `type` | text | one of `issue`, `call`, `offline`, `project`, `demo` |
| `customer` | text | free-text customer name |
| `note` | text | optional |
| `start_ts` | bigint | start time, epoch ms |
| `end_ts` | bigint | end time, epoch ms |
| `seconds` | integer | duration in seconds (the value totals are built on) |
| `manual` | boolean | true if entered via the manual form |
| `created_at` | timestamptz | auto |

For manual entries there is no real clock time, so the entry is anchored at noon on the chosen
day and `seconds` carries the real duration; history shows "Manual" instead of a time range.

### Row-Level Security (the access rules)
- **Insert:** an agent may only insert rows where `user_email` = their own email.
- **Select:** an agent sees only their own rows; an **admin** (per `is_admin()`) sees all rows.
- **Delete:** an agent may delete their own rows; an admin may delete any.

This is why the Manager rollup is genuinely private — the database itself refuses to return
other people's rows to a non-admin. Full SQL is in `SETUP.md`.

---

## 5. Code walkthrough (`index.html`)

The `<script>` block is organised into labelled sections:

- **CONFIG** — the constants above.
- **Data layer (Supabase)** — `loadEntries()` returns an in-memory cache;
  `refreshEntries()` fetches rows from Supabase into that cache; `addEntry()` inserts a row then
  refreshes; `delEntryRemote()` deletes then refreshes. *This is the only section that touches
  the backend* — swapping storage later means changing just these functions.
- **Auth** — `signIn()` calls `supabase.auth.signInWithOAuth({provider:'google', hd:'kula.ai'})`;
  `handleSession()` runs on every auth state change: it rejects non-`kula.ai` emails, sets
  `currentUser` / `currentName` / `isAdmin`, shows or hides the admin tab, loads data, and shows
  the app. `signOut()` ends the session.
- **Timer** — `startTimer` / `tick` / `stopTimer` / `cancelTimer` / `resetTimer` manage the live
  stopwatch; on stop it calls `addEntry`.
- **Manual entry** — `toggleManual` / `saveManual`; converts minutes/hours into `seconds`.
- **Formatting** — small helpers (`fmt`, `fmtDur`, `fmtHM`, `dayKey`, `isToday`, …).
- **Tabs** — `showTab` switches Track / My history / Manager rollup and renders the active one.
- **Today** — `renderToday` shows today's totals on the Track tab.
- **History** — `renderHistory` groups the agent's own entries by day, totals each day, draws the
  progress bar vs the 9h target.
- **Admin rollup** — `renderAdmin` (guarded by `isAdmin`), `rangeFilter` (today / this week /
  custom), and `rollupTable` (by agent / customer / type).
- **Export** — `exportCSV('mine' | 'all')`.
- **Boot** — wires events, then reads the current Supabase session and subscribes to auth changes.

---

## 6. Setup & deploy process

### First-time setup
Follow `SETUP.md`: create the Supabase project, run the SQL (table + RLS), enable Google OAuth,
and paste the Project URL + publishable key into `index.html`. Google OAuth specifics:
- **Authorized redirect URI** (in Google Cloud) = `https://vicfnkbsrcmemhffuqyq.supabase.co/auth/v1/callback`
- **Authorized JavaScript origin** (in Google Cloud) = `https://skkula.github.io`
- **Supabase → Authentication → URL Configuration** Site URL **and** Redirect URL =
  `https://skkula.github.io/firehouse/`

### Making a change
1. Edit `index.html` locally.
2. (Optional) double-click it to test in a browser.
3. Commit and push:
   ```bash
   git add -A
   git commit -m "…"
   git push origin main
   ```
4. GitHub Pages redeploys automatically in ~1 minute at https://skkula.github.io/firehouse/.

---

## 7. Operating notes & troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Sign-in loops back to the login screen | Supabase **Site URL / Redirect URL** must exactly equal `https://skkula.github.io/firehouse/` (trailing slash included). |
| "Invalid characters" on Client ID in Supabase | The Client ID has a `http://` prefix or trailing `/`; it must be the bare `…apps.googleusercontent.com` string. |
| Signed in but entries won't save | The `entries` table / RLS SQL hasn't been run, or `insert own` policy mismatch. |
| Non-admin can't see Manager rollup | Working as intended — the tab and the data are both admin-only. |
| Someone outside kula.ai tried to sign in | Blocked client-side after OAuth; for a hard lock, set the Google OAuth consent screen to **Internal** (kula.ai Workspace). |

### Security posture
- Public repo, but it contains **no secrets** — only the publishable key, which is safe by design.
- Tracking data lives in Supabase, not in the repo.
- Never commit the Supabase `service_role`/secret key.

---

## 8. Possible next steps
- Per-agent target-vs-actual on the Manager rollup (who hit 9h each day).
- Edit an existing entry (currently delete + re-add).
- Track break time as its own activity rather than only excluding it from the target.
- Lock the OAuth consent screen to Internal for a hard kula.ai-only guarantee.
