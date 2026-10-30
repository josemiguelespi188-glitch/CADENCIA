# Cadencia

Training log for Juan and José — calendar, dashboard, templates, and a
per-athlete Strava sync. Next.js + Supabase + Vercel.

See `CLAUDE.md` for the data model, the Strava integration's design
decisions, and the manual setup steps (Supabase project, Strava API app,
env vars) required before this runs for real — none of that is provisioned
yet in this repo.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the values described in CLAUDE.md
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Deploy on [Vercel](https://vercel.com/new) and set the same env vars from
`.env.example` in the project's settings.
