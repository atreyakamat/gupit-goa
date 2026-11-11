# Gupit Goa

A native Android and iOS app for deciding where to go in Goa: iconic stops and lesser-known local finds side by side, with practical details, honest crowd levels and a similar, quieter place nearby when somewhere is busy.

There is no website, PWA or web admin in this release. Reviewers work in protected screens inside the same app.

> Working name. Check the Konkani meaning with local speakers, and domain, handle and trademark availability, before any public launch.

## What is in this repository

| Path                       | What it is                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `apps/mobile`              | The app. Expo (development builds), React Native, TypeScript, Expo Router, MapLibre.    |
| `packages/shared`          | Types, response schemas, product rules and pure logic shared by the app and the worker. |
| `services/research-worker` | Server-side worker that finds candidate places from permitted sources for human review. |
| `supabase`                 | Postgres + PostGIS schema, Row Level Security, RPCs, seed and database tests.           |
| `docs`                     | Architecture, data dictionary, source policy, runbook and the implementation report.    |

## Rules that must not drift

- **Native only.** No web target, no `react-dom`, no browser code. CI enforces this.
- **No forced sign-up.** Guests browse, save (on the device) and share with no account.
- **Location is foreground-only and optional.** One reading when the user asks. Never stored.
- **Crowd levels are evidence, not guesses.** Reports are checked server-side to be within about 300 m. A live level needs 3 different installations in the last 2 hours, one report per installation per place per hour. Views and taps are never crowd data.
- **A candidate is not a listing.** The research worker can only create candidates. A person approves, completes the checklist and publishes. Every such action is audited.
- **No scraping of Instagram or similar platforms.** Such links can only be saved by a reviewer as a lead. See `docs/source-policy.md`.
- **Partner money does not buy placement.** Partner listings are labelled and never affect ranking, crowd data or safety notes.
- **Secrets stay on the server.** Only `EXPO_PUBLIC_*` values are compiled into the app.

## Quick start

Requirements: Node 22+, npm 10+. For device builds: Android Studio and/or Xcode, or an [EAS](https://docs.expo.dev/build/introduction/) account.

```bash
npm install

# Everything that runs without a device or a backend
npm run lint
npm run typecheck
npm test

# Database tests need Postgres 16 + PostGIS (Docker, or local binaries)
npm run db:local          # starts a throwaway server and prints DATABASE_URL
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres npm run test:db
```

To run the app you need a Supabase project and a map style URL. The step-by-step setup, including creating the first reviewer account, is in [`docs/runbook.md`](docs/runbook.md).

```bash
cp apps/mobile/.env.example apps/mobile/.env   # fill in the three public values
cd apps/mobile
npx expo run:android      # or: npx expo run:ios
```

The map uses a native module, so Expo Go is not enough: use a development build.

## Research worker

```bash
cp .env.example .env                           # server-side values; never in the app
npm run worker -- plan --dry-run               # show this week's planned searches
npm run worker -- plan                         # queue them (safe to re-run)
npm run worker -- run --max-jobs 5             # process a bounded batch, then exit
```

With the default `stub` providers the worker runs end to end and produces nothing. That is deliberate: it never invents places.

## Status

See [`docs/implementation-report.md`](docs/implementation-report.md) for what is built, what was actually run and verified, and what still needs an account, a device or a decision.
