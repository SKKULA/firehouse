# Firehouse — setup

A time-tracker for the support team. Google sign-in (kula.ai only), shared data, and a
Manager rollup visible only to the admin.

Live page: https://skkula.github.io/support-time-tracker/

## What you need to do once (≈15 min)

### 1. Create a Supabase project (free)
1. Go to https://supabase.com → sign in → **New project**.
2. Name it `firehouse`, set a database password, pick a region near you, create.
3. When it's ready, open **Project Settings → API** and copy:
   - **Project URL** → goes into `SUPABASE_URL`
   - **anon public** key → goes into `SUPABASE_ANON_KEY`

### 2. Create the table + access rules
In Supabase, open **SQL Editor → New query**, paste this, and run it:

```sql
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_name  text,
  type       text not null,
  customer   text not null,
  note       text,
  start_ts   bigint not null,
  end_ts     bigint not null,
  seconds    integer not null,
  manual     boolean default false,
  created_at timestamptz default now()
);

alter table public.entries enable row level security;

-- helper: is the signed-in user an admin?
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select lower(auth.jwt() ->> 'email') in ('saikausik@kula.ai')
$$;

-- agents insert their own rows
create policy "insert own" on public.entries for insert
  with check ( lower(auth.jwt() ->> 'email') = lower(user_email) );

-- agents see their own rows; admin sees all
create policy "select own or admin" on public.entries for select
  using ( lower(auth.jwt() ->> 'email') = lower(user_email) or public.is_admin() );

-- agents delete their own rows; admin can delete any
create policy "delete own or admin" on public.entries for delete
  using ( lower(auth.jwt() ->> 'email') = lower(user_email) or public.is_admin() );
```

To add more admins later, edit the email list inside `is_admin()`.

### 3. Turn on Google sign-in
1. **Google Cloud Console** (https://console.cloud.google.com) → APIs & Services →
   **Credentials → Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs** add the callback Supabase shows you in the next step
   (looks like `https://<your-project>.supabase.co/auth/v1/callback`).
3. Copy the **Client ID** and **Client secret**.
4. In Supabase: **Authentication → Providers → Google** → enable, paste the Client ID + secret, save.
5. In Supabase: **Authentication → URL Configuration** → set **Site URL** to
   `https://skkula.github.io/support-time-tracker/` and add it under **Redirect URLs** too.

> The app already passes `hd=kula.ai` and also re-checks the email domain after login, so only
> kula.ai accounts get in. For an extra lock, restrict the OAuth consent screen to Internal
> (kula.ai Workspace).

### 4. Put the keys in the app
Open `index.html`, find the CONFIG block near the bottom, and fill in:

```js
const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
const ALLOWED_DOMAIN    = 'kula.ai';
const ADMIN_EMAILS      = ['saikausik@kula.ai'];
```

Commit + push and GitHub Pages redeploys automatically.

## Notes
- The `anon` key is **safe to expose** in the page — it only allows what the row-level
  security policies above permit. Never paste the `service_role` key here.
- Manager rollup tab only appears for emails in `ADMIN_EMAILS`, and the database also blocks
  non-admins from reading others' rows — so it's enforced on both sides.
