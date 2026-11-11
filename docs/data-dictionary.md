# Data dictionary

Postgres, schema `public` unless noted. UUID keys, UTC timestamps. RLS is enabled on every table: guests have no table access; reviewers can read; all writes go through RPCs. Full definitions are in `supabase/migrations`.

## Catalogue

| Table                  | Purpose                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`           | What a place is. Two levels (group -> subcategory). | `requires_strict_verification` marks nature, water and trail types. Seeded in a migration.                                                                                                                                                                                                                                                                                                           |
| `category_equivalents` | Approved "close enough" pairs for Try instead.      | Read in both directions.                                                                                                                                                                                                                                                                                                                                                                             |
| `spots`                | The canonical place record.                         | `verification_status`: draft, review, published, stale, suspended, withdrawn. `availability_status`: open, temporarily_unavailable, permanently_closed. `safety_blocked` hides it everywhere. `location` is `geography(Point, 4326)` with a GiST index. `discovery_labels` (iconic, popular, lesser_known, local_favourite) are separate from category. `internal_notes` never leaves the admin API. |
| `spot_media`           | Listing photos.                                     | Only `rights_status` of owned, licensed, permission_granted or public_domain is ever shown publicly.                                                                                                                                                                                                                                                                                                 |
| `spot_sources`         | Evidence for a candidate and/or a place.            | Short excerpt only. `is_public` + `verified` controls what appears under "How we know".                                                                                                                                                                                                                                                                                                              |
| `partners`             | Commercial relationships.                           | Active when status is pilot or active and now is within `starts_at`..`ends_at`. Never an input to ranking or crowd data.                                                                                                                                                                                                                                                                             |
| `partner_devices`      | Hashed installations of partner staff.              | Their crowd reports on the partner's own place are rejected.                                                                                                                                                                                                                                                                                                                                         |

## Research

| Table                   | Purpose                                  | Notes                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spot_candidates`       | Worker or manual output awaiting review. | `review_status`: new (low confidence), needs_more_evidence, ready_for_review, blocked, approved, rejected, merged. `risk_flags` is a JSON list; an unresolved `block` flag prevents approval. `dedupe_key` makes upserts idempotent. |
| `research_jobs`         | Queue.                                   | queued, running, completed, failed, paused. Unique `idempotency_key`.                                                                                                                                                                |
| `research_adapters`     | Per-adapter kill switch.                 | A disabled adapter's jobs are not handed out.                                                                                                                                                                                        |
| `research_domain_rules` | allow, lead_only or block per domain.    | See `docs/source-policy.md`.                                                                                                                                                                                                         |
| `research_events`       | Worker log visible to reviewers.         | Policy skips, extraction issues, provider errors.                                                                                                                                                                                    |
| `worker_heartbeats`     | Last check-in per worker.                |                                                                                                                                                                                                                                      |

## Crowd, reports, analytics

| Table                | Purpose                             | Privacy notes                                                                                                                                               |
| -------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crowd_reports`      | One row per report attempt.         | No coordinates are stored. `installation_hash` is an HMAC of a random installation token with a key that exists only in the database. Purged after 30 days. |
| `crowd_hourly_stats` | Totals per place, weekday and hour. | No installation data. Kept long term for the "usually busy" guide.                                                                                          |
| `user_reports`       | Problem reports from users.         | Optional free text; no contact details requested.                                                                                                           |
| `analytics_events`   | First-party product events.         | Coordinates, search text and message text are stripped by the server. `session_id` is random per app launch.                                                |
| `partner_enquiries`  | WhatsApp button taps.               | Intent only. No message content.                                                                                                                            |
| `admin_audit_logs`   | Every reviewer action.              | Written inside the same transaction as the change.                                                                                                          |
| `admins`             | Reviewer allowlist.                 | Rows are added by hand.                                                                                                                                     |

## Private schema

| Object                                                                                           | Purpose                                                                                |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `private.app_secrets`                                                                            | Holds `installation_hmac_key`, generated at migration time. Never readable by clients. |
| `private.live_crowd` (view)                                                                      | Current live crowd state per place.                                                    |
| `private.is_public_spot`, `private.spot_cards`, `private.crowd_for`, `private.publish_checklist` | Shared building blocks for the RPCs.                                                   |
| `private.mark_stale_listings`, `private.purge_old_crowd_reports`                                 | Scheduled maintenance (see the runbook).                                               |

## RPC surface

**Guest** (`anon`, `authenticated`): `list_categories`, `nearby_spots`, `spots_in_bbox`, `search_spots`, `get_spot_detail`, `get_crowd_status`, `submit_crowd_report`, `get_spot_alternatives`, `submit_spot_problem`, `track_events`, `track_partner_enquiry`, `link_partner_device`.

**Reviewer** (`authenticated` + allowlist): `am_i_admin`, `admin_dashboard`, `admin_analytics_summary`, `admin_get_spot`, `admin_save_spot`, `admin_set_spot_status`, `admin_save_media`, `admin_delete_media`, `admin_reorder_media`, `admin_save_source`, `admin_delete_source`, `admin_get_candidate`, `admin_save_candidate`, `admin_add_lead`, `admin_flag_candidate`, `admin_decide_candidate`, `admin_save_partner`, `admin_issue_partner_claim_code`, `admin_resolve_user_report`, `admin_set_research_adapter`, `admin_set_domain_rule`, `admin_enqueue_research_job`.

**Worker** (`service_role`): `worker_get_config`, `worker_enqueue_jobs`, `worker_claim_job`, `worker_finish_job`, `worker_upsert_candidate`, `worker_log_event`, `worker_heartbeat`.

New functions are not callable by app roles until a migration grants them explicitly.

## Filters payload

`nearby_spots`, `spots_in_bbox` and `search_spots` accept the same JSON object. All keys are optional and combine with AND:

```json
{
  "category_slugs": ["cafe", "eat-drink"],
  "regions": ["north"],
  "labels": ["iconic", "lesser_known"],
  "crowd": ["quiet", "unavailable"],
  "price_bands": ["budget"],
  "attributes": ["family_suitable"],
  "partner_only": false
}
```

A group slug in `category_slugs` matches every subcategory in it.
