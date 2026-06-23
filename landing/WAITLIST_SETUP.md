# Waitlist setup

The landing page saves signups to a `waitlist` table in the same Supabase project. Run this once
in **Supabase → SQL Editor**:

```sql
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  company text,
  source text,
  created_at timestamptz default now()
);

alter table public.waitlist enable row level security;

-- Anyone (anonymous visitor) may JOIN the waitlist (insert only).
create policy "anon can join waitlist"
  on public.waitlist for insert to anon
  with check (true);

-- No public read: emails are NOT exposed to visitors. You view signups in the
-- Supabase Table Editor / SQL Editor as the project owner.
```

## Where the landing page lives
- File: `landing/index.html`
- Live (GitHub Pages): https://skkula.github.io/firehouse/landing/

## Viewing signups
Supabase → **Table Editor → waitlist**, or run:
```sql
select email, company, source, created_at from public.waitlist order by created_at desc;
```

## Notes
- The `unique` constraint on email means a repeat signup returns error code `23505`; the page
  treats that as "you're already on the list."
- Only `insert` is allowed for visitors — they can't read the list, so emails stay private.
- Uses the same public anon key as the app; safe to expose (RLS limits it to inserts).
