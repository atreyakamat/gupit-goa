# Implementation report

Date: 12 November 2026 (updated after the Android build and emulator run). Built from the Gupit Goa native app build specification (v1.0).

The short version: the backend, the research worker and the app are implemented and tested. **The Android app now builds into an APK in CI and runs on an Android emulator**, where an automated smoke test walks the main guest screens in preview mode. It has not yet been run on a physical phone, the iOS binary has not been built, and nothing has been connected to a live Supabase project, search API or model.

## What was actually run

Everything below was executed in the build environment (Linux, Node 22.23, Postgres 16.15 + PostGIS 3.4) on the final code.

| Check                                                     | Command                                         | Result                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Formatting                                                | `npm run format:check`                          | Pass                                                                                                                               |
| Lint, including native-only and no-secrets rules          | `npm run lint`                                  | Pass, 0 warnings                                                                                                                   |
| Types (strict) for app, shared package and worker         | `npm run typecheck`                             | Pass                                                                                                                               |
| Unit tests                                                | `npm test`                                      | 67 passed: shared 19, research worker 34, app logic 14                                                                             |
| Database integration tests on real Postgres + PostGIS     | `npm run test:db`                               | 44 passed                                                                                                                          |
| Secrets and platform check on source and exported bundles | `node scripts/check-mobile-secrets.mjs`         | Pass                                                                                                                               |
| App JavaScript bundles                                    | `expo export --platform android --platform ios` | Both bundles produced (Hermes, about 5.1 MB each)                                                                                  |
| Expo project health                                       | `npx expo-doctor`                               | 20/20                                                                                                                              |
| Native project generation                                 | `expo prebuild --platform all`                  | Android and iOS projects generated; permissions inspected                                                                          |
| Android release APK                                       | GitHub Actions, `gradlew assembleRelease`       | Built (about 17 minutes, 47 MB for three ABIs), uploaded as an artifact on every PR                                                |
| App running on an Android 14 emulator                     | Maestro flow `.maestro/smoke.yaml` in CI        | Pass: welcome, Explore list and map, place page, Try instead, filters, search, Saved, More. Screenshots are uploaded with each run |

Two real defects were found and fixed by these checks: Try-instead silently dropped places with no crowd data when the origin had a live level (SQL null handling), and two copies of React were being installed (now pinned to one).

## What was not run, and why

| Not done                                                                 | Why                                                           | What it means                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS build (IPA)                                                          | Needs a Mac with Xcode or EAS, and an Apple developer account | The iOS JavaScript bundle and native project generate; the binary is unbuilt                                                                                                       |
| A Play Store build (signed AAB)                                          | Needs your upload keystore                                    | CI builds a debug-signed release APK, which is right for testing and sharing directly                                                                                              |
| Running on a physical phone                                              | No device here                                                | Verified on an emulator only. GPS, real networks, low-end performance and the admin screens are unverified on hardware                                                             |
| Migrations on an actual Supabase project                                 | No project was created (it needs your account and approval)   | Tests ran on plain Postgres with a small shim for Supabase's roles, `auth.uid()` and storage tables (`supabase/tests/bootstrap.sql`). Storage policies and Auth were not exercised |
| Live search, model and geocoder calls                                    | No API keys                                                   | The Brave, Anthropic and Nominatim adapters are written against their documented APIs but have never made a real request                                                           |
| Admin-screen and backend-connected end-to-end tests, screen-reader tests | Need a backend and a device                                   | The emulator smoke test covers guest screens in preview mode only                                                                                                                  |
| Any deployment                                                           | Not authorised                                                | Nothing was deployed anywhere                                                                                                                                                      |

## Added in the second pull request

- **`apk.md`**: an agent-ready guide to download or build the APK, connect a backend, install and smoke-test.
- **Preview mode**: with no backend configured the app opens on bundled, clearly labelled sample places and example crowd levels, and sends nothing anywhere. Well-known landmarks carry approximate pins and no practical facts; invented businesses are named "Sample".
- **Keyless map**: OpenFreeMap by default (no API key or account).
- **Creator posts**: reviewers link Instagram posts or reels to a place; the app shows a tagged card that opens Instagram, and `@handles` in photo credits are tappable. Nothing is scraped or copied.
- **Category artwork** for places without a rights-cleared photo.

## What is built

**Database** (`supabase/migrations`, 8 files): PostGIS in the `extensions` schema; catalogue, research, crowd, reports, analytics, partners and audit tables; RLS on every table with no guest table access; guest, reviewer and worker RPCs; taxonomy seed (7 groups, 47 subcategories); listing-photo bucket and policies; scheduled-maintenance functions.

**App** (`apps/mobile`): welcome; Explore with map and list, category chips, near me; combined filters; search; place page with gallery, facts, safety and respect notes, crowd card and report sheet, Try instead, save, share, directions, partner WhatsApp button, sources and verification date; problem report; saved lists stored on the device with offline place snapshots; privacy and about screens; partner device linking; reviewer sign-in and admin area (dashboard, review queue, candidate detail, place editor with checklist, photos and sources, partners, problem reports, research worker controls, audit log).

**Research worker** (`services/research-worker`): query planner; source policy and robots handling; page fetcher; structured extraction with schema validation; duplicate detection; deterministic safety screen; explainable readiness score; bounded job runner with retries and kill switches; CLI.

## Decisions that differ from the letter of the spec

| Spec                                    | Built                                                                              | Reason                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Edge Functions for privileged workflows | Transactional `SECURITY DEFINER` SQL functions; no Edge Functions                  | The spec allows either. This keeps validation atomic and lets the tests run the real code                                 |
| Server-side image resizing              | Resized on the reviewer's phone before upload (1600 px + 400 px thumbnail)         | Only reviewers upload; avoids an untested Edge Function                                                                   |
| `pnpm` workspace, `apps/mobile/app/`    | npm workspaces, `apps/mobile/src/app/`                                             | Lowest-friction setup with Expo SDK 58; the spec leaves the tool open                                                     |
| Repository `gupit-goa-mobile`           | `atreyakamat/gupit-goa`                                                            | As instructed                                                                                                             |
| `docs/product-spec.md` in the repo      | Not committed                                                                      | **The repository is public** and the spec contains pricing hypotheses and business rules. Add it once the repo is private |
| Approval publishes the place            | Approval creates a draft place; publishing is a second step gated by the checklist | A candidate rarely has photos, a checked pin and a safety review at approval time                                         |
| Cursor pagination                       | Offset cursor in the API; the app loads the first 50 results                       | Enough for a 50-place launch catalogue. Add paging in the list before the catalogue grows                                 |

Versions follow the current stable Expo SDK at build time: Expo 58, React Native 0.88, React 19.3, MapLibre React Native 11.5, TypeScript 6.0. All are pinned in `package-lock.json`.

## Release acceptance checklist (spec section 19.3)

| Item                                                    | Status                    | Evidence or gap                                                                                            |
| ------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Android development/release build succeeds              | Done (debug-signed)       | Release APK built in CI and run on an emulator. A store-signed build is still to do                        |
| iOS development/release build succeeds                  | **Not verified**          | Same                                                                                                       |
| No public web/PWA implementation                        | Done                      | No web target or web dependency; lint rule and CI script enforce it                                        |
| Guest can browse without an account                     | Built, untested on device | No auth on any guest path; guests have RPC access only                                                     |
| Explore map/list and filters functional                 | Built, untested on device | Filter and geospatial behaviour covered by 44 DB tests                                                     |
| Place pages display only verified facts                 | Built                     | Unverified hours and uncleared photos are withheld by the server (tested); empty facts show "Not verified" |
| Location is foreground-only and optional                | Done                      | Config inspected in generated projects: no background permission on either platform                        |
| Crowd reports server-validated, expire after two hours  | Done                      | DB tests: too far, expiry, duplicates, partner device, rate cap                                            |
| Live label requires three valid distinct reports        | Done                      | DB tests, including "mixed" for conflicting reports                                                        |
| Try-instead returns only safe, eligible alternatives    | Done                      | DB tests exclude blocked, draft, restricted, unavailable, distant and unrelated places                     |
| Local saves work offline                                | Built, logic tested       | 14 unit tests on the store; not exercised on a device                                                      |
| Partner listings clearly labelled                       | Built                     | Label on cards, map selection card, place page and partner section                                         |
| WhatsApp enquiry events without message content         | Done                      | DB test; only a tap is recorded                                                                            |
| Research worker stores evidence, never publishes        | Done                      | Unit and contract tests; the worker role has no function that touches a place                              |
| Admin review, approval and audit logging                | Built; server side tested | Full review-to-publish flow covered in DB tests; screens untested on device                                |
| RLS and secrets checks pass                             | Done                      | Access-control DB tests; secrets script on source and bundles                                              |
| Source/platform access rules documented and implemented | Done                      | `docs/source-policy.md`; policy tests                                                                      |
| Privacy notice and store disclosures ready              | **Partial**               | In-app notice written; needs counsel review and a contact. Store labels not filled in                      |
| Crash logging, error states and basic analytics         | **Partial**               | Error boundary, error states and analytics are built. Crash reporting is a stub interface with no provider |
| Seed listings meet the publication checklist            | **Not started**           | There are no real places. Each needs human verification. The local seed is placeholder data only           |

## Known gaps and limitations

- **No real catalogue.** 20 verified places are needed before a beta. That is fieldwork.
- The busy time windows of an editorial crowd guide can only be set in SQL; the editor edits the note.
- Secondary categories and photo reordering are supported by the database but have no editor UI.
- "Open now" filtering is omitted on purpose until opening hours are widely verified.
- Search has no per-client rate limit beyond Supabase's gateway limits. Writes are rate-limited per installation.
- The worker handles discovery jobs only. Freshness is handled by a scheduled SQL function that labels places not verified in 180 days.
- English only. No Hindi or Konkani yet.
- Accessibility labels, roles, text scaling and non-colour status cues are in the code but untested with TalkBack or VoiceOver.
- Icons and splash are simple placeholders.
- The DPDP notes in the privacy screen are not legal advice.

## Environment variables still required

App (`apps/mobile/.env`, public values only): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_MAP_STYLE_URL`.

Worker (root `.env`, server only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEARCH_CONTACT`, and for real output `SEARCH_PROVIDER` + `SEARCH_PROVIDER_API_KEY`, `LLM_PROVIDER` + `LLM_PROVIDER_API_KEY` + `LLM_MODEL`, optionally `GEOCODER`.

No real secret was written to any file in this repository.

## Suggested next steps

1. Make the repository private.
2. Create a development Supabase project, run `supabase db push`, add yourself to `admins`.
3. Pick a map tile provider and build a development client on a real Android phone.
4. Walk the manual device matrix in `docs/runbook.md` and fix what the first run shows.
5. Publish the first 20 verified places through the app.
