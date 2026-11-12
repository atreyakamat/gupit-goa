# Runbook

How to stand the project up, run it, and operate it. Do the steps in order the first time.

## 1. Backend (Supabase)

Use separate projects for development and production.

1. Create a Supabase project (region: Mumbai is closest to Goa).
2. Install the CLI and link:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
3. Apply the schema:
   ```bash
   npx supabase db push
   ```
   Do **not** run `supabase/seed.sql` or `supabase/tests/bootstrap.sql` on a hosted project. The seed is placeholder data for local development; the bootstrap is a test-only shim.
4. Confirm the lock-down in the SQL editor:
   ```sql
   set role anon;
   select * from public.spots limit 1;          -- must fail: permission denied
   select count(*) from public.list_categories(); -- must work
   reset role;
   ```
5. Create the first reviewer. In the dashboard: Authentication -> Users -> Add user (email + password, auto-confirm). Then, in the SQL editor:
   ```sql
   insert into public.admins (user_id, display_name)
   select id, 'Your Name' from auth.users where email = 'you@example.com';
   ```
   Being a reviewer is decided only by the `public.admins` list, never by having an account.
6. Optional accounts (backing up saved places). Guests never need one. To switch the feature on:
   - Authentication -> Providers -> Email: keep "Allow new users to sign up" **on** and "Confirm email" on.
   - Authentication -> Emails -> Templates: in both **Magic Link** and **Confirm signup**, show the code. A minimal body is: `Your Gupit Goa code is {{ .Token }}`. The app asks for this code; it does not use links.
   - Authentication -> Emails -> SMTP: add your own SMTP provider before launch. The built-in sender is for testing and only sends a few emails per hour.
   - To switch accounts off instead, disable "Allow new users to sign up". The app keeps working for guests; the Account screen will simply fail to send a code.
7. Load the first research leads into the review queue (nothing is published by this):
   paste `supabase/research/candidates-2026-11.sql` into the SQL editor and run it. The 36 places then appear under Review and admin -> Candidates, each with its sources. A reviewer must place the pin, add access and safety notes, and approve before a place goes live.
8. Optional, recommended: schedule maintenance (Database -> Extensions -> enable `pg_cron`, then):
   ```sql
   select cron.schedule('gupit-mark-stale', '15 2 * * *', $$select private.mark_stale_listings()$$);
   select cron.schedule('gupit-purge-crowd', '45 2 * * *', $$select private.purge_old_crowd_reports()$$);
   ```

Local stack instead of a hosted project: `npx supabase start` then `npx supabase db reset` (applies migrations and the placeholder seed; needs Docker).

## 2. Map tiles

Nothing to set up. The app defaults to [OpenFreeMap](https://openfreemap.org)'s public instance (`https://tiles.openfreemap.org/styles/liberty`): OpenStreetMap vector tiles with no API key, no sign-up and no usage cap, and commercial use is allowed. Attribution is shown on the map and under More.

The public instance is offered as-is with no uptime guarantee. Before a large launch, either self-host OpenFreeMap (it is open source) or set `EXPO_PUBLIC_MAP_STYLE_URL` to a provider with an SLA (for example MapTiler, Stadia Maps or Protomaps) and rebuild. Do not use `tile.openstreetmap.org`; the app refuses it. Offline map downloads are not built and must not be added unless the provider licenses them. Consider donating to OpenFreeMap if the app relies on it.

## 3. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (leave both empty for preview mode)
cd apps/mobile
npx expo run:android        # needs Android Studio + a device or emulator
npx expo run:ios            # needs a Mac with Xcode
```

Or build in the cloud with EAS (`eas.json` has development, preview and production profiles):

```bash
npm install -g eas-cli && eas login
eas init                    # creates the project and sets EAS_PROJECT_ID
eas env:create              # add the two EXPO_PUBLIC_SUPABASE_ values per environment
eas build --profile development --platform android
```

Expo Go cannot run this app (MapLibre is a native module).

Before a store build, change `ios.bundleIdentifier` and `android.package` in `apps/mobile/app.config.ts` if `app.gupitgoa.mobile` is not the ID you will register, and replace the placeholder icons in `apps/mobile/assets`.

The quickest way to get an APK is [`apk.md`](../apk.md) in the repository root: CI builds one on every pull request, and the guide covers a local build step by step.

## 4. First content

1. Sign in on the device: More -> Team sign-in.
2. Review and admin -> Places -> New place, or Review queue -> Add a lead or tip.
3. In the place editor: fill in the facts you have verified, set the pin and mark it checked, add at least one photo and set its rights, record a source (a team visit counts), tick the safety review, choose how it was verified, tap "I rechecked this today", then Publish. The checklist shows what is missing.
4. Optional: under **Instagram posts**, paste links to creators' posts or reels about the place, with their handle and a one-line note in your own words. They appear as tagged cards that open Instagram. To use a creator's actual photo, get their permission first, upload it under Photos, set its rights to "Permission given" and credit them as `@handle`.
5. Target 20 published places before a private beta and 50 for the first public catalogue, spread across categories and regions. Do not publish weak entries to hit a number.

## 5. Research worker

Runs on any server or scheduled runner with Node 22. It needs the **service-role** key, so never run it from a laptop you share or commit its `.env`.

```bash
cp .env.example .env        # fill in; see comments in the file
npm run worker -- plan --dry-run
npm run worker -- plan
npm run worker -- run --max-jobs 5
```

- Schedule `plan` weekly and `run` a few times a day. Each run is bounded and exits.
- With `stub` providers nothing is produced. For real output set `SEARCH_PROVIDER=brave` and `LLM_PROVIDER=anthropic` with keys and `LLM_MODEL`.
- Watch Review and admin -> Research worker in the app for health, failures and policy skips.
- To stop a source at once: Research worker -> Stop this adapter (give a reason). To stop one site: add a `block` rule.

Read `docs/source-policy.md` before raising volume or adding a source.

## 6. Day-to-day operations

| Situation                           | Action                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Credible safety report              | Open the place -> Suspend now (reason). Investigate after.                                                                                     |
| Place closed for the season         | Mark temporarily unavailable.                                                                                                                  |
| Facts might be out of date          | Mark details as needing a recheck; after checking, "I rechecked this today".                                                                   |
| Partner trial ends                  | Set the end date or status Paused/Ended. The label and WhatsApp button disappear.                                                              |
| Partner staff want to report crowds | Issue a claim code on the partner screen; they enter it under More -> Link partner device. Their phone is then excluded for their own listing. |
| Something looks wrong in the data   | Audit log shows who changed what and why.                                                                                                      |

Business hours, phone numbers, fees and seasonal access change often: recheck them, and leave a field empty when unsure. The app shows "Not verified" for empty facts.

## 7. Tests

```bash
npm run lint && npm run typecheck && npm test
npm run db:local && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres npm run test:db
node scripts/check-mobile-secrets.mjs
cd apps/mobile && npx expo export --platform android --platform ios --output-dir dist && npx expo-doctor
```

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

### Manual device matrix (not automated)

Run before each release and record results:

- A low or mid-range Android phone, a recent Android phone, an iPhone simulator and, where possible, a physical iPhone.
- Slow network and airplane mode: saved places open; crowd levels are hidden; the offline banner shows.
- Location precise, approximate and denied: Explore, filters and search all still work when denied.
- Small screen and the largest system text size.
- Screen reader pass (TalkBack / VoiceOver) through Explore, a place page, the crowd sheet and Save.
- Crowd report from within 300 m (accepted), from far away (rejected with a clear message), and twice within an hour (refused).
- Deep link: `gupitgoa://spot/<slug>` opens the place.

## 8. Before a public release

- [ ] Rotate to production Supabase and map keys; confirm sign-ups are disabled.
- [ ] Have Indian counsel review the privacy notice (`apps/mobile/src/app/privacy.tsx`) against the DPDP Act and Rules in force at release; add the grievance contact and publish the same text on the store listing. This repository is not legal advice.
- [ ] Complete Play Data safety and App Store privacy labels: approximate/precise location (used, not stored, not linked), app activity (anonymous analytics), no account.
- [ ] Wire a crash reporter (`setCrashReporter` in `apps/mobile/src/lib/logger.ts`) and confirm payloads carry no coordinates.
- [ ] Replace placeholder icons and splash; confirm brand name, handles and domain.
- [ ] Run the manual device matrix on release builds.
- [ ] Confirm every published place meets the checklist and has a current verification date.
