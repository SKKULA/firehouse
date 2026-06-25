# Firehouse — Build Guide (clean-room rebuild)

A complete, self-contained guide to rebuild this app **from scratch** — architecture, decisions,
step-by-step phases, the important code, and every gotcha we hit. Contains **no data and no
secrets** (all keys are placeholders). Drop this into a fresh project and you can recreate the
whole thing.

> What it is: a time-&-effort tracker for support/CS teams. Agents sign in with Google, run a
> timer (or log time manually) against an **activity type** + **customer**; a manager-only
> **rollup** aggregates everyone's time by agent / customer / activity.

---

## 0. Tech stack & why

| Layer | Choice | Why |
|------|--------|-----|
| Frontend | Single static `index.html` (vanilla HTML/CSS/JS) | No build step, no framework, instant to ship and host free. |
| Backend | Supabase (hosted Postgres + Auth) | Free tier, gives Google OAuth + a SQL DB + row-level security with almost no server code. |
| Auth | Supabase Google OAuth | Restrict to one email domain; no password management. |
| Hosting | GitHub Pages | Free static hosting, auto-deploys on push. |
| Extension | Chrome MV3 (dropdown popup) | Pin to toolbar; reuses same Supabase backend. |
| Landing | Static page + Supabase `waitlist` table | Validate demand before building SaaS. |

**Guiding principle:** isolate everything that talks to the backend behind a tiny data layer
(`loadEntries / refreshEntries / addEntry / delEntryRemote`). That made swapping localStorage →
Supabase a contained change, and makes a future multi-tenant swap easy too.

---

## 1. Phase 1 — MVP as a single file (localStorage)

Start with zero backend. One `index.html` with three "views" toggled by a `hidden` class:
`loginView` (enter name), `appView`, and tabs **Track / History / Rollup**.

Core pieces:
- A `TYPES` map of activity types: `{ key: {label, cls} }`. Each gets a CSS "pill" colour.
- **Timer**: `startTimer` records `startTs = Date.now()`, `setInterval` ticks every 1s,
  `stopTimer` computes `seconds` and saves an entry. Lock the inputs while running.
- **Manual entry**: a form with date + amount + unit (minutes/hours) → converts to `seconds`,
  anchored at noon of the chosen day (`new Date(\`${date}T12:00\`)`).
- **Entry shape**: `{ id, user, name, type, customer, note, start, end, seconds, manual }`.
- **Data layer** (swap target later):
  ```js
  function loadEntries(){ return JSON.parse(localStorage.getItem(KEY)||'[]'); }
  function saveEntries(l){ localStorage.setItem(KEY, JSON.stringify(l)); }
  ```
- **History**: group entries by day (`dayKey(ts)` = `YYYY-MM-DD`), sum per day, draw a progress
  bar vs a **daily target**.
- **Daily target**: `const SHIFT_HOURS=9, BREAK_HOURS=1; TARGET_SECONDS=(SHIFT_HOURS-BREAK_HOURS)*3600;`
  (i.e. an 8h target). Keep these as named constants — you'll tweak them.
- **Rollup**: `rollupTable(entries, key, header)` groups by a field and renders count + total +
  a proportional bar (`width = seconds/max*100%`).
- **CSV export**: build rows, `Blob`, `URL.createObjectURL`, click a temp `<a download>`.

Ship this first. It works offline and proves the UX before any backend.

---

## 2. Phase 2 — Supabase backend

### 2a. Create the project
1. supabase.com → New project. Copy **Project URL** and the **publishable / anon** key
   (Settings → API). **Never** use the `service_role`/secret key in the client.

### 2b. Schema + Row-Level Security (run in SQL Editor)
```sql
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_name  text,
  type       text not null,
  customer   text not null,
  note       text,
  start_ts   bigint not null,   -- epoch ms
  end_ts     bigint not null,
  seconds    integer not null,
  manual     boolean default false,
  created_at timestamptz default now()
);

alter table public.entries enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select lower(auth.jwt() ->> 'email') in ('admin@yourcompany.com')
$$;

create policy "insert own" on public.entries for insert
  with check ( lower(auth.jwt() ->> 'email') = lower(user_email) );

create policy "select own or admin" on public.entries for select
  using ( lower(auth.jwt() ->> 'email') = lower(user_email) or public.is_admin() );

create policy "delete own or admin" on public.entries for delete
  using ( lower(auth.jwt() ->> 'email') = lower(user_email) or public.is_admin() );
```
**Key idea:** the manager rollup is private *because the database refuses to return other
people's rows to a non-admin* — enforced in SQL, not just the UI.

### 2c. Swap the data layer to Supabase
Load `@supabase/supabase-js@2`, then:
```js
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let entriesCache = [];
function loadEntries(){ return entriesCache; }
async function refreshEntries(){
  const { data } = await sb.from('entries').select('*').order('start_ts',{ascending:false});
  entriesCache = data.map(mapRowToEntry);
}
async function addEntry(e){ await sb.from('entries').insert(rowFromEntry(e)); await refreshEntries(); }
async function delEntryRemote(id){ await sb.from('entries').delete().eq('id', id); await refreshEntries(); }
```
Render functions keep reading the synchronous `loadEntries()` cache; only writes are async.

---

## 3. Phase 3 — Google sign-in (website)

```js
const ALLOWED_DOMAIN = 'yourcompany.com';
const ADMIN_EMAILS   = ['admin@yourcompany.com'];

async function signIn(){
  await sb.auth.signInWithOAuth({ provider:'google', options:{
    queryParams:{ hd: ALLOWED_DOMAIN, prompt:'select_account' },
    redirectTo: location.origin + location.pathname
  }});
}
```
On every auth state change, re-check the domain client-side and sign out non-matching emails:
```js
sb.auth.onAuthStateChange((_e, session)=>handleSession(session));
sb.auth.getSession().then(({data})=>handleSession(data.session));
```
In `handleSession`: reject `!email.endsWith('@'+ALLOWED_DOMAIN)`, set `isAdmin =
ADMIN_EMAILS.includes(email)`, show/hide the admin tab, then **show the app first and load data
in the background** (with a try/catch + a boot timeout) so a slow fetch can never trap you on a
"Loading…" screen. *(This was a real bug — see Gotchas.)*

### Supabase + Google console setup
1. Google Cloud Console → Credentials → **OAuth client ID → Web application**.
2. Authorized redirect URI = `https://<project>.supabase.co/auth/v1/callback` (Supabase shows it).
3. Paste Client ID + Secret into Supabase → Authentication → Providers → **Google**.
4. Supabase → Authentication → **URL Configuration**: set Site URL + add it to Redirect URLs.
5. For a hard lock, set the OAuth consent screen to **Internal** (your Workspace only).

---

## 4. Phase 4 — Deploy (GitHub Pages)

```bash
git init && git add -A && git commit -m "init"
gh repo create <name> --public --source=. --push
gh api -X POST repos/<user>/<name>/pages -f 'source[branch]=main' -f 'source[path]=/'
# live at https://<user>.github.io/<name>/  (rebuilds ~1 min after each push)
```
Browser caches the page hard — always **hard-reload** (Shift+Cmd+R) or append `?v=N` to see
changes. Pages takes 1–2 min to rebuild after a push.

---

## 5. Phase 5 — Chrome extension (the hard part)

Goal: a pinned toolbar **dropdown** (not a tab) showing the same tracker.

### Constraints that shape everything
- **MV3 blocks remote scripts and inline JS/`onclick`.** So: bundle supabase-js locally into
  `lib/supabase.js`, put markup in `popup.html`, all logic in `popup.js`, wire events with
  `addEventListener` (no inline handlers).
- **The popup closes when it loses focus** — so OAuth can't complete inside it. Run sign-in in
  the **background service worker** via `chrome.identity`, store the session in `chrome.storage`,
  and have the popup read it on next open.

### Files
- `manifest.json` (MV3): `action.default_popup = popup.html`; permissions `["identity","storage"]`;
  `host_permissions` for the Supabase URL; a background `service_worker`.
- `background.js`: `importScripts("lib/supabase.js")`; create a client with a **chrome.storage
  storage adapter** and `autoRefreshToken:false` (a refresh timer throws "No SW" when the worker
  sleeps); handle a `signin` message:
  ```js
  const redirectTo = chrome.identity.getRedirectURL();            // https://<id>.chromiumapp.org/
  const { data } = await sb.auth.signInWithOAuth({ provider:'google',
    options:{ skipBrowserRedirect:true, redirectTo, queryParams:{ hd:DOMAIN }}});
  const url = await chrome.identity.launchWebAuthFlow({ url:data.url, interactive:true });
  const code = new URL(url).searchParams.get('code');
  await sb.auth.exchangeCodeForSession(code);
  ```
- `popup.js`: same app logic, but client uses the **same chrome.storage adapter**
  (`flowType:'pkce', detectSessionInUrl:false`) so it sees the session the worker saved.
  Sign-in button → `chrome.runtime.sendMessage({type:'signin'})` then `location.reload()`.
- Add the extension redirect URL `https://<id>.chromiumapp.org/` to Supabase **Redirect URLs**.

### Pin a fixed extension ID (so a team can share one folder)
Unpacked installs get random IDs → each would need its own redirect URL. Fix the ID:
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out key.pem
openssl rsa -in key.pem -pubout -outform DER -out pub.der
base64 pub.der   # → put this string as "key" in manifest.json
```
Compute the resulting ID = first 32 hex chars of `sha256(pub.der)`, each hex digit mapped `0→a … f→p`.
Now everyone who loads the folder gets the same ID and the same redirect URL works for all.

### Background timer
Persist the running timer to `chrome.storage` (`{startTs,type,customer,note}`) on start, clear on
stop. On popup open, restore it. The timer is tracked by **timestamp**, so it keeps "running"
even though Chrome closes the popup when you click away.

---

## 6. Phase 6 — Feature polish (all small, additive)

- **Activity types**: edit the `TYPES` map + both `<select>`s (timer *and* manual) + a pill CSS
  class. *(Gotcha: the two selects had different indentation — a global replace missed one.)*
- **Manual entry as minutes/hours**: number input + a unit `<select>`; `seconds = amount *
  (unit==='hours'?3600:60)`.
- **Per-day history**: group by `dayKey`, day total vs `TARGET_SECONDS`, coloured progress bar,
  "X short of Nh" / "target met".
- **Rollup date filter**: All / Today / This week (Mon-based) / Custom range.
- **Rollup agent filter**: a `<select>` populated from distinct names; filter before aggregating.
- **Collapsible sections**: clickable section headers toggle a `hidden` class with a ▾/▸ caret.
- **UI theme**: ember/amber gradient accents, Inter font, flame logo (an SVG path), gradient
  pills, mobile-responsive (stack two-col grids under 640px).

---

## 7. Phase 7 — Landing page + waitlist (demand validation)

- Static `landing/index.html`: hero + email capture, "why generic trackers don't fit support",
  feature cards, who-it's-for, indicative pricing, second waitlist form.
- Waitlist table:
  ```sql
  create table public.waitlist (
    id uuid primary key default gen_random_uuid(),
    email text not null unique, company text, source text,
    created_at timestamptz default now()
  );
  alter table public.waitlist enable row level security;
  create policy "anon can join" on public.waitlist for insert to anon with check (true);
  -- no select policy → emails stay private; owner reads them in the dashboard
  ```
- Form inserts `{email, company}`; treat unique-violation `23505` as "already on the list".

---

## 8. Phase 8 — Evolving to a real multi-tenant SaaS

The current app is **single-tenant** (one company). To sell it, the big change is **orgs**:
- Add an `organizations` table and an `org_id` foreign key on `entries` (and a `memberships`
  table mapping user → org → role).
- Rewrite RLS to scope every row to the caller's org: `org_id = auth_org()` where a helper reads
  the user's org from their membership. **Never** filter by org in client code alone.
- Replace the hard-coded `ALLOWED_DOMAIN` / `ADMIN_EMAILS` with per-org settings + roles.
- Self-serve onboarding (create org, invite teammates) instead of manual Supabase steps.
- Billing: Stripe subscriptions, seat counting, trials.
- Per-org settings: shift/break hours, custom activity types.
- Legal: privacy policy, terms, data-deletion (GDPR), audit.

---

## 9. Gotchas we actually hit (save yourself the time)

1. **Stuck on "Loading…" forever** — the boot `await`-ed the data fetch before showing the app,
   so any stall trapped the user. Fix: show the app on auth, load data in background, add a
   try/catch + a `setTimeout` fallback to the login screen.
2. **GitHub Pages caching** — changes look "not deployed." Pages rebuilds in 1–2 min *and* the
   browser caches; hard-reload or `?v=N`.
3. **Two dropdowns, one missed** — adding an activity type via global replace only updated one
   `<select>` because indentation differed. Update both explicitly.
4. **MV3 CSP** — no remote scripts, no inline JS/`onclick` in extension pages. Bundle the lib;
   external `popup.js`; `addEventListener` only.
5. **OAuth in a popup** — the popup closes on focus loss, killing the flow. Use the background
   worker + `chrome.identity.launchWebAuthFlow`; store session in `chrome.storage`.
6. **"No SW" errors** — Supabase's auth auto-refresh timer fires after the service worker sleeps.
   Set `autoRefreshToken:false` in the worker client; let the popup (a real page) refresh.
7. **"Tracker opens in the Google window"** — the extension's `chromiumapp.org` redirect URL
   wasn't in Supabase, so Supabase fell back to the Site URL. Add the exact redirect URL.
8. **Different ID per teammate** — unpacked installs get random IDs. Pin a `key` in the manifest.
9. **Timezone date shifts** — manual entries anchored at noon; to bulk-shift dates use a SQL
   `UPDATE` computing whole-day offsets in the user's timezone (`at time zone 'Asia/Kolkata'`).
   (Note: day-grouping uses each viewer's *local* date. A single fixed business timezone can't
   keep both an IST-daytime and a PT-daytime shift on one day — they're ~12h apart; the real fix
   for mixed shifts is a **per-user work timezone**, not one global one.)

---

## 10. File manifest

```
index.html              # the web app (markup + CSS + JS in one file)
SETUP.md                # one-time backend setup (Supabase, Google, keys)
DOCS.md                 # architecture & code reference
extension/
  manifest.json         # MV3 + pinned "key" + permissions
  background.js         # chrome.identity Google sign-in, chrome.storage session
  popup.html            # dropdown markup (no inline JS)
  popup.css             # ember theme, compact popup sizing
  popup.js              # app logic + event wiring + background timer
  lib/supabase.js       # bundled supabase-js (MV3 can't load remote scripts)
  icons/                # flame PNGs (16/32/48/128)
  README.md             # install + team-sharing steps
landing/
  index.html            # marketing page + waitlist
  PITCH.md              # one-page pitch
  WAITLIST_SETUP.md     # waitlist table SQL
```

**Rebuild order:** Phase 1 (offline MVP) → 2 (Supabase) → 3 (Google) → 4 (deploy) → 6 (features)
→ 5 (extension) → 7 (landing) → 8 (SaaS). Build, deploy, and test each phase before the next.

---

*No customer/employee data is included here by design — start a SaaS build with a fresh, empty
database and brand-new accounts.*
