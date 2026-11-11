# Architecture

```text
          ANDROID APP                  iOS APP
               |                          |
               +------------+-------------+
                            |
              React Native + Expo Router (apps/mobile)
              TanStack Query, zustand, SQLite on device
                            |
               Supabase client, anon key only
                            |
        +-------------------+--------------------+
        |                   |                    |
   Supabase Auth     Postgres + PostGIS     Supabase Storage
 (reviewers only)   RLS + SECURITY DEFINER   (listing photos)
        |                 RPCs                   |
        +-------------------+--------------------+
                            |
                 worker_* RPCs (service role)
                            |
              Research worker (services/research-worker)
               /        |         |         \
          Search     Pages     Model     Geocoder
                            |
             Candidates + evidence -> review queue
                            |
             Human review in the native admin screens
                            |
                    Published places
```

## Trust boundaries

| Actor                                            | Can do                                                                                           | Cannot do                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Guest (anon key)                                 | Call the public RPCs: browse, search, read a place, submit a crowd or problem report, log events | Read or write any table directly; see drafts, candidates, internal notes or audit logs |
| Reviewer (signed in + on the `admins` allowlist) | Read tables through RLS; change data only through `admin_*` RPCs, each audited                   | Write tables directly; skip the publish checklist                                      |
| Research worker (service role)                   | Call `worker_*` RPCs: claim jobs, store candidates and evidence, log, heartbeat                  | Create, edit or publish a place. No such function exists for it                        |

The app bundle is assumed to be readable by anyone. Nothing privileged lives in it.

## Why SQL functions instead of Edge Functions

The spec allows either. Every privileged workflow is a `SECURITY DEFINER` function in `supabase/migrations`:

- Validation sits next to the data and runs in one transaction (for example: the proximity check, rate limit, insert and hourly aggregate for a crowd report).
- `npm run test:db` runs the real code against real Postgres + PostGIS.
- The installation-token hash key lives only inside the database (`private.app_secrets`).

`supabase/functions/` is intentionally empty; its README says when to add one.

## Public read path

Clients never select from tables. `private.spot_cards(...)` is one query builder used by `nearby_spots`, `spots_in_bbox` and `search_spots`, so filters behave identically everywhere, and it always applies `private.is_public_spot()`:

```
verification_status in ('published', 'stale')
and not safety_blocked
and availability_status <> 'permanently_closed'
and location is not null
```

Ordering is text relevance, then distance, then publish date. Partner status is not an input.

## Crowd

- `submit_crowd_report` validates level, coordinates and the installation token, checks `ST_DWithin(spot, point, 300)`, applies the limits, stores the report **without** coordinates and updates an anonymous hourly aggregate.
- `private.live_crowd` (view): valid reports from the last 2 hours, one vote per installation (its latest), at least 3 installations, median level. An even split or a quiet/busy clash with no majority is `mixed`, never a guess.
- `private.crowd_for` returns, in order: live, mixed, a history guide (8+ reports for this weekday and hour), an editorial guide (inside a reviewer-entered busy window), or `unavailable`.
- The app additionally expires a live label at `valid_until`, so a cached page never shows a stale level (`describeCrowd` in `packages/shared`).

## Try instead

`get_spot_alternatives`: same category or an approved equivalent (`category_equivalents`), within 15 km by default, public, open, with confirmed public access. If the origin has a live level, places with reliable evidence of being as busy or busier are dropped and reliably quieter ones rank first. Without live data the result is labelled as neutral, and the app says it cannot claim they are quieter.

## On-device data

SQLite (`apps/mobile/src/lib/db`), versioned with `PRAGMA user_version`:

- `saved_lists`, `saved_spots`: guest lists. Never uploaded.
- `spot_cache`: full snapshots of saved places and the 40 most recently viewed, for offline reading.
- `kv`: small settings (onboarding flag).
- `event_queue`: analytics events waiting to be sent (max 300).

The user's position lives in memory only (`store/app.ts`).

## Research pipeline

`plan` builds a bounded, idempotent query matrix (regions x localities x topics). `run` claims jobs with `FOR UPDATE SKIP LOCKED` and, per job: search -> policy check -> robots.txt -> fetch -> model extraction -> schema validation -> deterministic safety screen -> optional geocoding -> explainable readiness score -> `worker_upsert_candidate` (which also links likely duplicates). Details and the source rules are in `docs/source-policy.md`.
