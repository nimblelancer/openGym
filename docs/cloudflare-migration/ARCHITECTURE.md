# Proposed architecture — ADR-001 (pending Phase 1 proof)

## Design
Official mobile app and existing web frontend -> HTTPS on dedicated openGym hostname -> thin Worker router and Static Assets -> SQLite-backed Durable Object(s) for authentication and revision-safe profile writes; private R2 for personal media. No public media bucket. Browser and API share origin; native bearer requests use original paths and headers. Prefer one instance coordinator for single-owner MVP (identity/challenge/pairing/session and profile state), with separation into per-profile objects only if needed and consistency maintained. DO transaction must recheck baseRev/baseWid inside transaction and commit state + revision metadata together; no external awaits inside synchronous SQL transaction. Preserve upstream sync-stamps pure functions; keep original client merge. Store secret as separate Wrangler secret; never use generated per-request signing key. Persistent TTL records for challenge/code and auth throttles; atomic consume, session-version revocation. Replace timers with lazy expiry/alarms as needed, not always-on intervals.

## Alternatives and decision
- D1-only: viable with carefully designed conditional transactions and chunking, but row cap of 2,000,000 bytes makes single-row 5 MiB request compatibility unsafe. Worker CPU is a major risk. Not first choice.
- DO SQLite: preferred POC due to transaction coordination, recent 8 MB row limit and 30s default DO CPU according to docs. Verify actual Free plan enforcement, including contradictory legacy per-object storage documentation; conservatively budget <=1 GB/object; keep state size under existing 5 MiB request cap, test max serialized state with metadata; consider chunking if limits fail. Do not assume a larger CPU budget until real staging measurements.
- R2-only or KV-only: no atomic revision compare-and-swap across metadata/body by default; reject naive last-write-wins. R2 is for private binary blobs, with transactional metadata/reservations in DO, idempotent upload, orphan cleanup, and no acknowledged state before persistence.
- Existing Node HTTP adapter: spike httpServerHandler with selected pure handlers; if importing server.js starts unsupported filesystem/timers/process APIs, use Fetch-native entrypoint with extracted helpers. No blanket fs shim.
- Containers: not target on Workers Free. Docker/Tailscale remains fallback.

## Free tier (verified 2026-11-25)
Workers 100k requests/day account-wide, 10ms CPU/request, 128MB memory, 20k assets/version and 25 MiB/file; Free zone request body 100 MB. DO SQLite free 100k requests/day, 13k GB-s/day, 5GB account storage, 5M rows read/day, 100k rows written/day. D1 5GB total and 5M read/100k written rows/day, 2 MB row. R2 Standard 10GB-month, 1M Class A and 10M Class B operations per month, free egress; overages are billable. Actual account usage not inspected. Quotas and costs can change. 
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/

## Isolation and cost
Separate opengym Worker, DO namespace and private opengym-media bucket (names provisional; verify availability). Do not reuse Learning Hub bindings or upstream failover config. Account quotas are shared; inspect remaining quota before remote deploy. At 30-second polls, two devices active four hours each are ~960 revision polls/day (example only). Avoid parsing full state for polls. Proposed media cap 1 GB to start, subject to actual account headroom; reserve bytes atomically and enforce operation limits including concurrent requests. No absolute zero bill guarantee for R2; verify remaining allowance and set safeguards; if strict zero spend and no headroom, defer R2 or stop. No paid-plan upgrade. Limit anonymous traffic and log without secrets/personal state.
