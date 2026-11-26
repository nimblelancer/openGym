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

## Phase 5 initial CI review and lifecycle/client continuation — 2026-11-26
Reviewed [45857925985](https://github.com/nimblelancer/openGym/actions/runs/45857925985) on 512cfed2: FAILURE, 6/7 jobs pass, 4m24s. POC 6/6 executions; storage 6/6; auth 9/9 including virtual passkey/manual harness virtual smoke; upstream API 1084/1084; frontend 10110/10110 (898 files); mobile contract 2/2 all four Phase 4 markers; web-media 3/4 (local Worker startup failed, no integration assertions executed); total 11220/11221 executions. All six ZIP artifacts downloaded, opened and CRC checked. Lockfile Git blob 0cde099db0392a2583158df6911b3180d20698be matches unchanged lockfile; asset manifest 13345 assets, 13109 media, 242979940 bytes, largest 2091275 bytes, oversized empty. Local wall/user/system seconds, peak RSS KiB, exit: storage 19.26/7.76/1.62/305820/0; auth 57.30/26.73/5.07/317756/0; mobile 9.83/7.40/1.51/574380/0; web-media 4.19/4.48/1.28/549260/1. Not hosted performance.
Startup redacted diagnostic d1db3fb4/24551449, run 45859495449, identified workerd entrypoint error: exported string CSP is not function or ExportedHandler. Fixed d2415ebc by keeping CSP module-private, no policy change. Intermediate run 45859661877 reached old expected account-delete 503 assertion (actual 200 after newly enabled lifecycle); replaced only obsolete disabled-feature assertion with reset/grace and failure/recovery acceptance, not a weakened runtime guard. 
P5-D lifecycle 65c41678/412a5b13/dee0e4d0: private owner GC marks in SQLite, committed readable state reference walk, mark first observation, 14-day grace from mark and upload, reset mark on re-reference or upload, bounded sweep 32, revalidate state/session/ETag, verify deleted object absent. State PUT and media requests share admission guard. Explicit reset sweep conservatively retains recent objects (deviation from upstream zero-grace, owner/contract decision REQUIRED). Missing/corrupt state refuses sweep. No autonomous GC. Account delete records durable authorized intent and disables/revokes owner in same transaction, then removes owner-prefix R2 objects and verifies absence before finalizing SQLite deletion. Failure retains intent, blocks access, health request retries only preauthorized intent; no success before finalization. This is resumable cross-store protocol, not an atomic R2+SQLite transaction. 25867877/b726e324 extend tests: simulated R2 delete failure and mark recovery, reference reintroduction and corrupt-state guard; real Worker reset retention, verified media round trip/restart/revocation, offline SQLite trigger aborts finalization after R2 cleanup, pending intent and state verified, restart recovery completes deletion and clears account/state/intent rows. [45859786305](https://github.com/nimblelancer/openGym/actions/runs/45859786305) web-media job SUCCESS 5/5, all five PHASE5 markers PASS; this is intermediate scoped evidence, not full seven-job acceptance.
P5-E 4739a62b actual upstream createMediaSync/createMediaStore/api/apiUpload/apiBlob using disposable Worker and R2, real loopback HTTP with synthetic XHR/OS adapter, offline pending/retry, dedup, binary SHA download, stale-account 409, paired bearer download; authored, not yet executed in reviewed evidence. 48ba1908 workflow copies fixture only in disposable frontend checkout and runs it after Node tests, extra client profile in phase5 artifact. Final candidate [45859897210](https://github.com/nimblelancer/openGym/actions/runs/45859897210) queued at inspection; all seven jobs required. No further upstream frontend, Phase 4 mobile source/tests, dependency or Docker changes from frozen 85755081; local runner diagnostic opt-in only, existing regressions preserved.
| ID | Updated scoped evidence / status |
|---|---|
| P5-01 | DOCUMENTED initial inventory |
| P5-02 | PASS build/assets initial run |
| P5-03 | PASS intermediate HTTP same-origin/SPA/API |
| P5-04 | PASS intermediate CSP/cache/catalogue notice |
| P5-05 | PASS scoped HTTP private R2 and mock ownership |
| P5-06 | PASS scoped CSRF, expected-account, bearer/revocation |
| P5-07 | PASS scoped caps/hash/sniff/duration; full video/audio parity OPEN |
| P5-08 | PASS scoped dedup/missing/usage/quota; real concurrent admission fault test OPEN |
| P5-09 | PASS scoped range/headers/restart |
| P5-10 | PASS scoped mock failure and finalization/restart recovery; interrupted real upload OPEN |
| P5-11 | PASS ref walker; actual frontend media-sync integration CI REQUIRED |
| P5-12 | PASS scoped lifecycle fault/recovery on b726e324; upstream zero-grace parity/owner decision, broader concurrency, partial R2 deletion and hosted bounded operation qualification OPEN |
| P5-13 | OPEN mounted UI and installed mobile |
| P5-14 | Initial CI FAIL; intermediate web-media 5/5 PASS; latest seven-job CI pending |
| P5-15 | Deferred hosted/free-tier and off-provider restore, not waived |
| P5-16 | OPEN |
Remaining limits: local buffering 8 MiB cap and no audio; no automatic GC, grace policy requires approval, no global atomic transaction; post-intent account is disabled until cleanup succeeds, response lost after finalization may require health verification; R2 inventory/operation budget for large account and physical/hosted concurrency not certified; synthetic XHR not a mounted browser or official native app. Phase 5 remains OPEN, do not start Phase 6. Phase 4 frozen/OPEN and all P3/P4 safety gates retained. No native rebuild, upstream publication, production, main merge, remote Cloudflare resources, actual personal data or Learning Hub changes.
