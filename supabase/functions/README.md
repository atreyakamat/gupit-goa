# Edge Functions

None are deployed in this release, on purpose.

Every privileged workflow in the spec (crowd-report validation, candidate decisions, publish and
unpublish, audit logging) is implemented as a transactional `SECURITY DEFINER` SQL function in
`supabase/migrations/`. That keeps validation next to the data, makes each workflow atomic, and lets
`npm run test:db` exercise the real code.

Add an Edge Function only for work that Postgres cannot do well, for example server-side image
resizing or calling a third-party API with a secret. Secrets stay in Supabase function secrets.
