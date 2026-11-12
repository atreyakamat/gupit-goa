# Source policy for research

This is the rulebook the research worker and reviewers follow. It is enforced in code where possible; the file and test that enforce each rule are named.

## What the worker may do

- Call a search API it has a key for.
- Fetch a public web page **only** when the domain is not blocked or lead-only, `robots.txt` allows it, and the server returns the page without a login or an access wall.
- Send the visible text to a language model to extract structured candidates.
- Store, per candidate: the source URL, title, publisher, author, date, a short excerpt (max 500 characters) and which facts the source supports.

## What the worker never does

| Rule                                                                                                                                                                        | Where it is enforced                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| No requests to Instagram, Facebook, Threads, TikTok, YouTube, X, LinkedIn, Pinterest or Reddit. Admin settings cannot lower this floor.                                     | `policy/domains.ts` (`BUILT_IN_RULES`), tested in `worker.test.ts` ("never allows fetching Instagram...", "makes no network request at all...") |
| No logins, cookies, sessions, fake accounts, proxies or rate-limit evasion. A 401, 403 or 429 means stop.                                                                   | `adapters/pageFetcher.ts` (`credentials: 'omit'`, `access_restricted`)                                                                          |
| Obey `robots.txt`. A site that hides `robots.txt` behind an auth wall is treated as disallowing everything.                                                                 | `policy/robots.ts`, `adapters/pageFetcher.ts`                                                                                                   |
| A redirect onto a restricted domain is refused.                                                                                                                             | `adapters/pageFetcher.ts`                                                                                                                       |
| Identify honestly (`RESEARCH_CONTACT` in the User-Agent) and wait at least 2.5 s between requests to a host.                                                                | `config.ts`, `adapters/pageFetcher.ts`                                                                                                          |
| Never store a full article or download media. Page text is used in memory for extraction and discarded.                                                                     | `jobs/processDiscovery.ts` (only `evidence_excerpt` is kept), DB check `char_length(evidence_excerpt) <= 500`                                   |
| Never publish. The worker's database role has no function that creates or edits a place.                                                                                    | `types.ts` (`Repository`), `supabase/migrations/..._security.sql`, tested in `db.test.ts` and `worker-pipeline.test.ts`                         |
| Never guess facts. Unknown fields are null; coordinates are only those a source states or a geocoder returns, and are always "approximate" until a reviewer checks the pin. | `extraction/prompt.ts`, `extraction/sanitize.ts`                                                                                                |

## Instagram and other social links

There is no automated Instagram collection in this codebase, and none should be added without Meta's written permission and an approved API scope for the account types involved.

What is supported:

1. A reviewer sees a post and adds a **lead** in the app (Review queue -> Add a lead or tip): the place name, the link and a note in their own words.
2. The link is stored as `source_type = social_lead` with a rights note. Nothing is fetched.
3. The reviewer verifies the place through independent permitted sources or a visit before it can be approved.
4. Creator photos and videos are not downloaded or reused unless permission is documented on the media record (`rights_status`, `rights_evidence_url`).

If Meta API access is granted later, add it as a new adapter with its own kill switch, and record the permission scope here.

## Domain rules

`research_domain_rules` (editable in the app under Research worker):

- `allow`: may be fetched, subject to everything above.
- `lead_only`: a link may be saved as a lead; the page is never fetched.
- `block`: never used. Seeded for Google (Places and Maps data has storage and display restrictions), TripAdvisor and Zomato (their terms prohibit automated access).

Unknown domains default to `allow`. Review this list, and each site's terms, before raising volume. To stop a source immediately, disable its adapter (the kill switch) or add a `block` rule; both take effect on the worker's next job.

## Sensitive places

Never publish, and block on sight:

- Turtle nesting beaches and other fragile habitats.
- Private property, private homes, residential lanes, unauthorised access routes.
- Restricted, defence or permit-only areas presented as open.
- Unsafe cliff edges, swimming holes, quarries and trails.
- Anywhere residents have asked not to be promoted, or that a source presents as a "secret".

`safety/rules.ts` screens every candidate for these with deterministic patterns. A match adds a blocking flag. Only a human reviewer can resolve it, with a written note that goes to the audit log; a later worker run cannot clear it. When in doubt, do not publish.

## Before a place goes public

One of:

- the team visited and checked it; or
- two independent, reliable local sources confirm the identity and public access, and the reviewer checked the pin and the safety and access notes.

Nature, water, trail and remote places need a team visit, or an authority source plus a second check. The publish checklist in the app enforces this (`private.publish_checklist`).

An Instagram post, a blog mention or a search result is never, on its own, proof of public access or safety.
