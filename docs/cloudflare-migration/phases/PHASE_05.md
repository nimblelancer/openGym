# Phase 5 — Web & Media Migration
Status: OPEN — local engineering authorized 2026-11-26. Baseline Phase 4 Hotfix 004.1 85755081, CI 45854636040. All prior safety/release gates retained.
## Work packages
- P5-A: audit actual upstream media routes, client refs, MIME sniffers, capabilities and licensed catalogue assets.
- P5-B: isolated same-origin Worker + Assets binding, API-first routing, SPA navigation fallback, cache and security headers.
- P5-C: private per-owner R2 content-addressed upload/download/missing; authentication, CSRF, expected account, byte cap, hash, MIME and duration, bounded operations, quota and deduplication.
- P5-D: conservative reference-based retention, reset/sweep/account deletion, failure handling; no deletion based on unreadable state. Cross-store atomicity/recovery is a mandatory Phase 5/6 gate.
- P5-E: local HTTP/browser and actual client integration, fault injection, build/license manifest, profiling; run existing six jobs plus dedicated web-media job.
- P5-F: review matrix, document limitations and obtain acceptance.
## Acceptance
| ID | Requirement | Status |
|---|---|---|
| P5-01 | Route/caller/capability and media reference inventory | IN PROGRESS |
| P5-02 | Existing web frontend build and licensed asset staging unchanged | Historical PASS; rerun |
| P5-03 | Actual built SPA same origin; API and missing assets never return SPA HTML | CI REQUIRED |
| P5-04 | Static cache/security headers and catalogue notice | CI REQUIRED |
| P5-05 | Authenticated private R2 owner isolation; no public personal media | CI REQUIRED |
| P5-06 | Cookie CSRF, bearer, stale account, revocation | CI REQUIRED |
| P5-07 | Byte cap, SHA256, content sniff/type/duration checks | CI REQUIRED |
| P5-08 | Dedup, missing/usage response, quota/concurrent upload bound | CI REQUIRED |
| P5-09 | GET, byte range, correct headers, restart | CI REQUIRED |
| P5-10 | Failed upload/storage/revocation no false acknowledgement | CI REQUIRED |
| P5-11 | All reference shapes, posters, local-only video, client sync | CI REQUIRED |
| P5-12 | Safe sweep/reset/delete, corrupt state, interrupted cleanup | OPEN |
| P5-13 | Real frontend/physical mobile capability and media UI behavior | OPEN |
| P5-14 | Full integrated CI and profiling/assets/license evidence | CI REQUIRED |
| P5-15 | Hosted quotas/CPU/security, off-provider backup/restore | Deferred to Phase 6/7, not waived |
| P5-16 | Owner acceptance | OPEN |
## Contract inventory
Pinned api/server.js mediaRoutes: PUT /api/media/{hash} raw bytes, 201 created / 200 existed with ok/hash/mime/size/existed; GET same hash private bytes; POST /api/media/missing up to 1000 lowercase SHA256, missing and usage; POST /api/media/sweep zero-grace reset, never delete on unreadable state. X-OpenGym-Account mismatch on upload/missing returns 409 account-mismatch. Frontend media-sync uses these routes and apiUpload/apiBlob; GET /api/config media controls feature availability. frontend/src/lib/media-refs.js walks customEx, workout media, set media, dayPhotos, sounds, exMedia, avatar and posters; active workout and local-only set media stay device-side. Reuse pure sniff/ref modules; no modification to upstream client or Docker server. Catalogue built by existing stage-media script; keep notice and license intact.
## Local candidate boundaries
Separate wrangler.web-media.jsonc, loopback only, no remote or public bucket. Bounded buffered upload initially max 8 MiB (image 2, GIF 8, video 8, audio 2 when validated); not upstream 100 MiB cap or hosted CPU claim. Explicit experimental media enable only in dedicated config; old auth/mobile config remains media-off. No silent success for sweep or deletion not implemented; preserve data and report unavailable. Do not enable for production until complete retention, cross-store cleanup, actual client contract, quota and recovery gates pass. Actual app delivery and earlier P3/P4 gates remain open. No Learning Hub change.

## Phase 5 initial implementation checkpoint (2026-11-26)
Candidate 512cfed2; CI [45857925985](https://github.com/nimblelancer/openGym/actions/runs/45857925985), seven jobs (six prior jobs unchanged plus web-media). Execution results pending; intermediate Contents API commits also trigger push CI, only final candidate qualifies. Reviewed diff from frozen 85755081: no frontend, upstream API/Docker, mobile source, Phase 4 fixtures, dependencies, or Learning Hub changes. Phase 3 auth coordinator changed only for opt-in media routing and Range CORS; must rerun auth/mobile regressions.
P5-A: documented upstream contracts and refs. P5-B: web-worker.js serves actual frontend/dist on same loopback origin with worker-first API, explicit 404 for unknown API/unsupported MCP and well-known, navigation-only SPA fallback, upstream CSP and hashed/static cache policy, no cache of private media. P5-C: media.js implements owner-derived private/v1/UID/hash R2 keys, authenticated/CSRF/expected account gates, bounded bytes and idle timeout, SHA256 and R2 checksum, header/category/dimension/duration checks, existing-object deduplication, missing/usage, single in-flight media request admission, 200 MiB/500-object local quota, GET/HEAD single byte-range, no-store and sandbox headers. Rechecks session after async operations. Experimental flag only in wrangler.web-media.jsonc, separate local R2 and ASSETS, old harnesses remain media-off. Audio intentionally disabled; strict 8 MiB video cap, known duration/dimensions required, 2 MiB still and 8 MiB GIF. This is bounded buffering and metadata validation, not full decode or production streaming/free-tier qualification. P5-D: sweep returns explicit 503 and account delete with media returns 503, preserves data pending cross-store recovery; no automatic GC or orphan deletion. P5-E: web-media.test.mjs has four authored tests: bounded validation, mocked R2 failure/quota/revocation/isolation, upstream reference shapes/local-only video, real local Worker built SPA/private R2 cookie+bearer/hash+range+restart+revocation. Tests not yet accepted. Existing six jobs preserved; extra GNU time artifact. No physical or mounted browser media UI claims. P5-F open.
| ID | Candidate evidence/status |
|---|---|
| P5-01 | DOCUMENTED initial inventory |
| P5-02 | Historical build PASS; latest CI required |
| P5-03 | Authored actual asset/SPA/API HTTP test; CI REQUIRED |
| P5-04 | Authored CSP/cache/notice exact content and catalogue HEAD tests; CI REQUIRED |
| P5-05 | Authored private namespace and owner isolation tests; CI REQUIRED |
| P5-06 | Authored CSRF, expected account, bearer/CORS and revocation tests; CI REQUIRED |
| P5-07 | Authored byte/hash/sniff/duration tests; CI REQUIRED; full format parity and audio open |
| P5-08 | Authored dedup/missing/usage/quota; CI REQUIRED; concurrency fault test outstanding |
| P5-09 | Authored GET/range/headers/restart; CI REQUIRED |
| P5-10 | Authored mock R2 failure/no-commit/revoke; CI REQUIRED; real interrupted upload and recovery open |
| P5-11 | Authored ref walker/local-only test; CI REQUIRED; actual frontend media-sync integration open |
| P5-12 | BLOCKED/OPEN: cross-store sweep/reset/account deletion and corrupt-state recovery |
| P5-13 | OPEN: mounted web client and installed app |
| P5-14 | Seven-job CI pending |
| P5-15 | Hosted and recovery gates deferred, not waived |
| P5-16 | OPEN |
Local only, do not deploy any wrangler fixture. Next review final CI logs and artifacts, correct confirmed failures, then complete safe cross-store cleanup and actual client integration before accepting Phase 5. Preserve Phase 4 freeze and all previously deferred gates; no native rebuild, upstream publication, production, main merge, remote Cloudflare resources, real data or Learning Hub changes.
