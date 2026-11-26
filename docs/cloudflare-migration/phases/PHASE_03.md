# Phase 3 — Backend & Authentication (detailed plan only)

Date: 2026-11-25. Upstream pinned e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 (v1.4.5).
Phase 2 tested code baseline 51c7b63a4b07c8073a3936099c0809fff0556f99; CI 45651255730 SUCCESS. Branch feat/cloudflare-migration.
Status: OPEN — AUTOMATED LOCAL VALIDATION PASSED; READY FOR MANUAL PHYSICAL PASSKEY ACCEPTANCE. Phase 2 local acceptance closed; owner authorized Phase 3 local implementation. No remote resources, actual data, production deploy or main merge.

## 1. Objective and scope
Implement an isolated Fetch-native local API that authenticates a private single owner, supports WebAuthn browser login and official mobile pairing protocol, and protects the Phase 2 storage layer with verified identity. Match upstream HTTP method, path, payload, status, stable error codes and relevant headers for the supported route subset. Actual installed mobile app end-to-end acceptance is Phase 4. Do not import the monolithic Node server, expose Phase 1/2 synthetic/fault/inspect routes, or modify original api/, frontend/, Docker, cloudflare/ failover, Learning Hub or lockfile without documented necessity.
Non-goals: live cloud deployment or staging, production data migration, live backup/restore, R2/media, password/scrypt login, AI Coach, watch relay, MCP/OAuth/OIDC, external integrations, trainer/community/admin multi-user functionality. Unsupported capability flags absent or false as upstream expects; no fake success. Device-link/passkey account lifecycle included if required for safe recovery and current client flows; implement core listed routes before broader coverage. No assumption of 170-operation parity.

## 2. Source anchors and contract inventory
Pinned api/server.js: 710–833 session signing/version/kind/cookies; 850–915 CSRF; 920 onward 5-minute challenge and pairing; 1528–1580 proveOwner; 1581 onward account removal; 1990–2125 passkey/device-link lifecycle; 2546–2896 core config, auth, logout, deletion and mobile pairing; 3133–3230 state/rev/nudge; 3336 activity; 3677 onward CORS/router. Use api/openapi.yaml, frontend/src/lib/api.js (register {name,code} -> {cid,options}, verify {cid,credential} -> {user}, passkeyAssertion, pairRedeem, remote bearer), frontend/src/lib/remote.js, frontend/src/store/useStore.js, Settings account call sites, docs/MOBILE.md and docs/SELF_HOSTING.md. Before coding, enumerate all 170 operations with supported/deferred/not applicable and actual client callers; confirm exact passkeyStepUp and publicUser shapes, passkey limits and APP_ORIGINS from pinned source. Treat this plan as partial route inventory, not proof of parity.

| Route group | Contract/required behaviors |
|---|---|
| GET /api/health | JSON ok/writable/users; true storage readiness, 503 on failure, no fake success or internal diagnostics |
| GET /api/config | invite_only=true, allow_guest=false proposed single-owner config; signed_in from validated session; omit disabled feature flags, coach:null for signed-in if upstream contract requires; verify exact response and mobile/UI expectations |
| POST /api/register/options, /api/register/verify | {name,code}, {cid,options}, {cid,credential}, {user} plus cookie; private one-time bootstrap invite; atomically recheck owner absence/invite at verification; refuse concurrent/replayed/second registration |
| POST /api/login/options, /api/login/verify | discoverable passkey options, challenge and credential verification, {user}, cookies, stable challenge-expired/unknown-credential/origin-mismatch errors; never issue token on invalid or disabled user |
| GET /api/me | {user}, optionally renewed token for valid paired bearer past half life; 401 invalid; no browser-cookie-to-renewable-bearer upgrade |
| POST /api/logout, /api/logout/all | clear correct cookies; ordinary logout matches upstream local sign-out semantics (not global server revocation); logout/all bumps session version and cancels pending pair/device links, invalidates both session types |
| GET /api/account/passkeys; POST /api/account/passkeys/options, /verify, /rename; DELETE /api/account/passkeys | owner-bound credential list/add/rename/remove, step-up when upstream requires, count cap, last-way-in guard, challenge bound to uid/session version; no public key/counter leak in response beyond intended contract |
| POST /api/account/device-link, /api/device-link/options, /api/device-link/verify | same one-shot owner-proven passkey enrollment flow if required by client/owner recovery; verify exact upstream route shapes, TTL and revocation rules before implementation |
| POST /api/pair/create | authenticated owner + valid step-up; {code}, one live code/profile, 5 minutes; recheck session after proof |
| POST /api/pair/redeem | normalized one-shot code, {token,user}; 400 pair-invalid on expired/invalid/revoked/disabled; no cookie dependence; parallel redemption yields only one success |
| GET /api/data, /api/data/rev; PUT /api/data | authenticated identity only; preserve Phase 2 responses and sync semantics; 401 unauthorized, 409 conflict, 503 corrupt, 413 size; guard mutations atomically with session version |
| POST /api/account/delete | exact name confirmation and fresh owner proof; paired bearer exception only for genuine kind b with upstream device-lock flow; cookie replay as bearer cannot delete; atomic deletion/revocation of local identity, credentials and state; later media cleanup remains release gate |
| GET /api/nudge-check?date=... | authenticated date validation and actual upstream done/excused/nudge semantics; never fabricate result, document safe error on unavailable state |
| POST /api/activity | verify client dependency; implement bounded authenticated presence with honest behavior if required; otherwise document disabled response and assess Phase 4 implications |
| OPTIONS /api/* and unknown/disabled paths | correct preflight, JSON errors, no credentials allowed cross-origin, no SPA HTML, method/path normalization tests |

## 3. Architecture and consistency
Create a new separate local-only API entry/config (e.g. cloudflare-poc/src/api-worker.js, wrangler.api.jsonc; names provisional), keeping POC and storage fixture configs untouched. Thin Worker validates request routing/size boundary and forwards to one SQLite DO coordinator for single-owner MVP; reuse StateStore codec/transition. Persist users (uid, display name, session version, status), credentials (unique id, owner uid, public key, counter, transports, name/timestamps), challenges (kind, random cid, challenge, uid, sv, expiry), bootstrap/invite consumption and pairing records (owner, code digest, expiry, sv), throttling and minimal audit events. No real signing key or private key in repo/SQL/logs. Use injected ephemeral synthetic test secret and stable configured RP_ID/ORIGIN; production secret setup only later. Fail closed if secret missing or weak, never regenerate every request; test rotation/restart.
Use one DO transaction boundary for auth and state mutation where needed. StateStore transactionSync currently owns its transaction; refactor a reusable transaction-internal primitive or explicit transaction composition, never nest blindly or perform read-check/write across independent awaits. Verify token signature outside transaction if necessary, then recheck user identity, disabled status and sv in the same transaction as state update, credential commit, redemption or deletion. For WebAuthn crypto async verification, consume challenge atomically first, verify outside synchronous transaction, then re-read credential counter/owner/sv/registration eligibility and commit atomically; fail or retry safely on concurrent mutation. No 200 before durable commit. A logout racing a write may linearize before or after the write, but no write commits using a session already revoked at its transaction boundary. Deletion must leave no usable token or data route and must not leave a partially deleted state if transaction fails. No externally accessible profile selector. No use of fixture inspect/fault/metrics as public routes; test-only fault injection kept outside integrated public routing.

## 4. Security policy decisions to validate
- Passkeys: use SimpleWebAuthn 13.3.3, pinned library, verify exact RP_ID/origin/challenge/signature/counter and ownership. Upstream uses userVerification preferred and requireUserVerification false. Proposed stricter UV required for private owner and step-up, explicitly document deviation and test real browser/authenticator compatibility; do not silently downgrade if unsupported. Browser localhost secure context for local test; synthetic P-256 and browser virtual authenticator tests, physical passkey manual acceptance recorded separately. Production HTTPS hostname not chosen here.
- HMAC sessions: upstream signed payload uid:expiry:sv:kind[:at], timing-safe MAC, default 90 days, renew genuine b bearer past half life. Do not accept malformed/expired tokens, unknown kinds or legacy kindless tokens by default on fresh deployment (document deliberate deviation); no migration of old session secrets. Cookie kind c replayed as bearer cannot renew or satisfy device-only deletion. Host-only __Host-gymsid Secure HttpOnly Path=/ SameSite=Lax/Strict on HTTPS; local HTTP localhost gymsid per upstream. No Domain. Reject conflicting duplicate cookies rather than silently choosing; preserve compatible cookie precedence or document safer rejection for ambiguous cookie+bearer. No tokens in query, logs or cache.
- Bootstrap: invite-only owner creation; high-entropy setup code supplied via local test config/secret, stored only as digest; verify and consume atomically; persistent closed flag after first owner. Account deletion does not automatically reopen public signup; owner recovery/rebootstrap must be explicit, documented and tested. Plan at least two passkeys and last-way-in guard; no recovery bypass.
- Challenge/pairing: 5-minute challenge and mobile code TTL, one-shot consumption (even failed verification as upstream), expiry at boundary, bounded records and lazy cleanup; one live pair code per profile, random format matches app, keyed digest at rest for short codes, persistent attempt limits per trusted source/account/global, no reliance on spoofable headers, no plaintext code/token logging. Rate-limit budgets propose and document with synthetic tests; no paid services. Passkey step-up uses actual upstream assertion envelope and consumes challenge with owner checks, not just session possession.
- CSRF/CORS: browser cookie mutations require trusted same-origin evidence; valid bearer alone may bypass only where it is the acting credential; sign-in/step-up cannot be bypassed by unrelated bearer. Same-site sibling, hostile Origin, mixed credentials and duplicate-cookie cases negative-tested. CORS preflight permits required native headers/methods from documented origins; never Access-Control-Allow-Credentials cross-origin, vary Origin; exact APP_ORIGINS and PNA rules from upstream, allowlist vs upstream reflection a proposed documented compatibility decision to test in Phase 4. Reject malformed routes and normalization bypasses; Workers may normalize before handler, document limits and test reachable paths. API JSON no-store; no permissive wildcard credentials.
- Bound request sizes, persistent throttles and challenge counts; safe error mapping, secret-free audit/logs, no raw credential/token/challenge/code dumps; genuine storage readiness, 503 on failure, never silently reset. No remote resources or auth-proxy setup.

## 5. Work packages
P3-A Contract inventory and security design: read pinned source and actual client paths, record route matrix, threat model, supported/deferred flags and intentional differences, exact cookies/errors/request envelopes. Add negative test fixtures before logic. Select transaction composition and owner bootstrap/recovery policy.
P3-B Auth persistence and session primitives: versioned auth schema, stable secret/config validation, HMAC token/expiry/kind parsing, cookie parsing/security flags, persistent TTL/challenge/pair/rate-limit state, restart and revocation tests, safe transaction adapter around Phase 2 state.
P3-C Passkey lifecycle and bootstrap: register/login, actual WebAuthn synthetic signatures, browser virtual authenticator localhost where supported, concurrent registration, step-up, credential management and last-way-in, device link if required. No auth bypass. Test disabled user, duplicate key/counter races, challenge expiry/replay/wrong purpose/wrong origin/RP/signature.
P3-D Pairing and session lifecycle: owner proof, one live 5-minute code, rate limits, race redemption, bearer issuance, /me renewal, cookie logout, all-session revocation and cancellation of pending links/codes. Test stale cookie/bearer, kind confusion, expired/replayed tokens and restart. Keep mobile protocol exact; installed app acceptance Phase 4.
P3-E Core authenticated API: integrate config/health, GET/PUT state/rev, nudge-check and necessary activity, account deletion, capability flags, JSON routing and CORS/CSRF. Verify authenticated profile identity in transaction, no cross-profile access or caller override, fault rollback and revoke/delete races. No production media, live import/restore or synthetic debug route.
P3-F Differential, security and CI: actual pinned Node server comparisons for supported wire/status/body/header/side-effect contracts, normalize only random IDs/times and documented deliberate differences. Extend local-only CI with auth-core test job using npm ci, preserve existing four jobs and sequential Wrangler runs. Record test counts, auth/state timings and resource measurement scope, failures/hotfixes, artifacts, coverage matrix and user acceptance. Browser physical passkey test may require user's local machine; do not mark PASS from synthetic only. No Phase 4 implementation without separate approval.

## 6. Proposed acceptance matrix
| ID | Required evidence |
|---|---|
| P3-01 | all operation inventory and supported/deferred client-call matrix, intentional deviations documented |
| P3-02 | separate API entry/config local-only, no fixture/debug/production deploy path, missing secret fail closed |
| P3-03 | auth schema version/restart, one-time bootstrap, race exactly one owner, no open signup |
| P3-04 | valid passkey register/login response/cookies, genuine signed fixture and browser ceremony test |
| P3-05 | invalid challenge, wrong kind/uid, expired/replay, wrong origin/RP/signature/UV rejected |
| P3-06 | credential uniqueness/counter recheck across concurrent verify, no session on failure |
| P3-07 | cookie flags, duplicate/mixed credentials, token tampering/expiry/kind/disabled rejected |
| P3-08 | passkey list/add/rename/remove with proof and last-way-in, device-link handling required by client |
| P3-09 | pairing requires step-up, one-live-code TTL/replay/parallel redemption, bounded throttles |
| P3-10 | mobile bearer /me renewal, cookie kind cannot renew or device-delete; revocation/restart |
| P3-11 | logout/all invalidates all session types and pending pairs/links; ordinary logout correct |
| P3-12 | CSRF/CORS negative matrix, no cross-origin credential sharing, native preflight and method/path checks |
| P3-13 | health/config truthfulness and auth flags, disabled/unknown routes JSON not HTML |
| P3-14 | authenticated state/rev API preserves Phase 2 semantics; identity not client-controlled |
| P3-15 | auth/state mutation races linearizable; failure rollback, no acknowledged write after revocation |
| P3-16 | account delete confirmation, proof, token-kind distinction, atomic cleanup and no automatic signup reopen |
| P3-17 | nudge-check actual data semantics and activity dependency verified; no fake success |
| P3-18 | upstream differential on supported routes, stable errors/headers, documented safety deviations |
| P3-19 | bounded inputs, throttles, no sensitive logs, local profiling with explicit measurement limitations |
| P3-20 | final latest code all local CI jobs green (POC/storage/API/frontend/assets/auth), locked deps |
| P3-21 | safety/branch isolation and owner acceptance; physical browser/official app limitations recorded, Phase 4 not started |

All P3 checks NOT RUN. Real physical passkey compatibility is distinct from virtual/synthetic verification; obtain local manual evidence before declaring physical browser support. Official mobile app actual pairing/acceptance Phase 4. Hosted resource and quota gates Phase 7. 
## 7. Stop and rollback
Stop on auth bypass, session escalation, replay, race-created duplicate owner, cross-profile read/write, unsafe account deletion, false success, loss of acknowledged state or incompatibility with required client wire contracts. Fix with tests; do not disable auth checks or weaken crypto for Free plan. Revert local feature commits if needed; never rewind live state. No real data, remote deploy, main merge or Learning Hub changes.
## 8. Deliverables
Route inventory/threat model, versioned auth storage and session modules, passkey/pairing/core API local code, local test configuration, synthetic and browser verification fixtures, differential/security/transaction tests, dedicated CI evidence, validation matrix and progress report. This document is only a proposal and authorizes no implementation.

## Phase 3 implementation initial checkpoint
Added 170-operation inventory, isolated local API config, auth session primitives, SQLite auth schema/one-shot challenges and codes, private bootstrap, signed passkey verification, session/step-up, pairing, device-link/passkey management, authenticated state/revision, nudge, logout and atomic account deletion. State mutation composes Phase 2 current/transition/save within the same synchronous transaction as session-version recheck. No remote operations. Candidate implementation only; tests, browser evidence, exact differential and full caller audit pending. P3-01–P3-21 NOT ACCEPTED. Explicitly deferred activity, exact error mapping and per-source rate limits pending review. No Phase 4.

- Added local runner options for ephemeral synthetic secrets, no auth runner binding-log dump, configurable synthetic authenticator RP/origin/UV, session primitive checks, runtime bootstrap race, one-shot/replay, passkey management, device links, pairing, bearer renewal, CORS/CSRF, auth state/revocation and deletion scenarios. Dedicated auth-core CI job with aggregate GNU time artifact. Browser virtual, true upstream differential, expiry/rate/failure coverage remain open; no physical passkey evidence. Existing four jobs retained. No test results yet.

- Added separate Chrome CDP virtual authenticator browser test (requires runner Chrome, physical passkey remains untested), actual upstream Node HTTP differential for core auth/state/pairing/logout/deletion, signed wrong-origin/RP/UV/signature tests, offline disposable SQLite fault/expiry/disabled-account/rate-limit/deletion verification without public debug endpoints. These are test implementations, not PASS claims. Exact route/caller inventory beyond supported core and actual physical browser/mobile acceptance remain open. No Phase 4 or deployment.

## Hotfix 001 — revoked bearer status
Run 45652711692 auth-core job 139341166727: 2/3 passed, signed end-to-end test reached logout/all and then revoked mobile PUT returned 403 rather than expected 401. Protected API now resolves authenticated session and returns 401 before CSRF check when no session acts; authenticated cookie requests still require CSRF checks. Anonymous sign-in routes still require origin checks. This ordering is a deliberate mobile-friendly deviation from upstream's possible 403 on revoked cross-origin bearer. No authentication check weakened. Retest pending. Earlier Phase 1 POC and storage jobs passed on 41509513; previous d1382609 baseline API passed. No production changes.

- Review follow-up: added POST /api/activity using bounded ephemeral single-owner presence (70s heartbeat expiry, 45s hidden grace, clear on navigate/revoke/delete); verified actual Workout.jsx call sites. Added presence unit and authenticated runtime/differential tests, exact upstream CSRF origin error payload, account-delete throttle, bootstrap challenge bound to current setup digest. 25/170 API operations are candidates, 145 deferred. CI not yet verified for these additions; no production routes beyond listed core and no Phase 4.

## Hotfix 001 and parity follow-up
Run 45653122116 (2986f262) auth-core 139342589675 SUCCESS 6/6, including PHASE3_AUTH_CORE, PHASE3_BROWSER_VIRTUAL_PASSKEY, PHASE3_UPSTREAM_AUTH_DIFFERENTIAL, PHASE3_AUTH_FAULT_ROLLBACK. GNU time log user 17.85s/system 3.32s/wall 53.34s/max RSS 312360 KiB/39%/exit 0. Local aggregate only. POC and storage jobs passed; latest full CI still pending. Added safe stable origin-mismatch code and expected origin using upstream isMisconfigured (generic error avoids reflecting arbitrary credential details), unhealthy health JSON on missing secret, expanded actual Node differential for passkey list/add/rename/remove and device-link options/verify. Exact full payload parity is not claimed for random fields/times and documented safety deviations. Retest pending; no physical passkey, hosted or Phase 4 evidence.

## Phase 3 implementation validation snapshot — 2026-11-25

Status: IMPLEMENTED CANDIDATE / OPEN FOR VALIDATION. Do not start Phase 4.
- Initial code d1382609, run 45652581816 completed SUCCESS for the four existing jobs only (no auth job in that commit).
- 41509513 run 45652711692 auth-core 2/3, failure was revoked cross-origin native PUT 403 vs expected 401; POC/storage/API passed. a902d747 run 45653016329 auth-core 5/6, browser virtual, upstream HTTP differential, SQLite fault tests all passed; same pre-hotfix 403/401 failure.
- 2986f262 Hotfix 001 run 45653122116 auth-core 6/6 PASS; log markers PHASE3_AUTH_CORE, PHASE3_BROWSER_VIRTUAL_PASSKEY, PHASE3_UPSTREAM_AUTH_DIFFERENTIAL, PHASE3_AUTH_FAULT_ROLLBACK PASS. POC/storage/API passed. Artifact 15042145310 independently unzipped and read: SHA-256 d1b59ba954ad408e6530a7566ab36e9f72acd478c18ef906fccf50d32bd6bfbd; user CPU 17.85s, system 3.32s, elapsed 53.34s, max RSS 312360 KiB, CPU 39%, exit 0.
- eb674d32 (activity, stricter bootstrap/CSRF) run 45653369301 auth-core 139343464290 SUCCESS 7/7, all four markers PASS, zero failures/skips/cancellations. POC/storage/API SUCCESS, frontend still running at inspection. Artifact 15040059139 independently unzipped and read: SHA-256 05000c3a9c7cf6ae33b836ad23689b193936ae1dc5c3ee8c14755bac48c40b1e; user CPU 13.87s, system 2.79s, elapsed 55.13s, max RSS 315564 KiB, CPU 30%, exit 0. Measures command/children including Chrome, not per-request workerd CPU or hosted memory/billing. No controlled performance comparison.
- Latest code edac5325 expands actual upstream differential for passkey list/add/rename/remove/device link and safe stable origin-mismatch errors. Run [45653658471](https://github.com/nimblelancer/openGym/actions/runs/45653658471) POC/storage PASS, auth-core/API/frontend still running at inspection. No final green claim. No further code changes in this documentation commit.
- Existing 170-operation OpenAPI inventory, 25 core candidates, 145 deferred. Actual core client call-site mapping recorded; individual deferred module callers/compatibility to review before release. Auth coordinator local-only, no fixture/debug routes, no remote bindings or deployment. Single-owner one-shot setup remains closed after deletion; exact recovery/rebootstrap procedure intentionally not yet implemented (Phase 6), add second passkey/device-link while signed in. Local global/owner fixed rate buckets, no reliable remote source IP in loopback; hosted abuse/IP policy still open. Deliberate deviations from upstream: required UV, strict duplicate/mixed cookie handling, reject legacy kindless sessions, strict local/native CORS allowlist, 401 before CSRF on unauthenticated protected routes, sanitized crypto error messages, explicit depth/size bounds, no live restore. No weaker crypto or fake success.

| ID | Prior evidence and remaining gate | Status at snapshot |
|---|---|---|
| P3-01 | 170 route inventory and core callers documented; deferred module individual callers not fully reviewed | PARTIAL |
| P3-02 | isolated local API, no fixture routes, missing secret 503 | PRIOR PASS, final retest |
| P3-03 | bootstrap race exactly one owner, restart, closed after delete; explicit unsupported auth schema/rotation integration test still open | PARTIAL |
| P3-04 | signed synthetic and actual Chrome virtual registration/login/cookie PASS; physical passkey manual acceptance open | LOCAL VIRTUAL PASS / MANUAL OPEN |
| P3-05 | expiry/replay/wrong origin/RP/UV/signature tested, wrong-purpose route cross-use needs explicit coverage; stable error retest | PARTIAL |
| P3-06 | concurrent nonzero counter assertions exactly one success; bootstrap uniqueness | PRIOR PASS |
| P3-07 | HMAC/tampering/expiry/kind, duplicate/mixed, disabled, HTTPS flags unit tested; no hosted HTTPS | PRIOR PASS LOCAL |
| P3-08 | add/list/rename/remove, last-way-in, device-link single-use local PASS; expanded upstream differential pending | PRIOR PASS |
| P3-09 | step-up, one-live pair, expiration, racing redeem, global throttle tested; hosted source limits not verified | PRIOR PASS LOCAL |
| P3-10 | aged synthetic signed bearer renewal, kind c cannot renew/delete, restart | PRIOR PASS |
| P3-11 | ordinary logout browser, logout/all revocation and pending link/pair cancellation | PRIOR PASS |
| P3-12 | hostile origin/sibling cookie, native preflight, no credential CORS; encoded/normalized path cases need explicit expansion | PARTIAL |
| P3-13 | health/config/unknown/disabled/fixture paths checked; new unhealthy health JSON retest pending | PRIOR PASS |
| P3-14 | protected data/rev, 409, identity ignores client profile selector, restart | PRIOR PASS |
| P3-15 | race logout vs state write, post-revoke 401, offline SQLite trigger failure rollback | PRIOR PASS |
| P3-16 | delete confirmation/proof/kind, rollback, offline row verification and closed bootstrap | PRIOR PASS |
| P3-17 | nudge actual upstream functions, activity heartbeat/hidden/expiry unit and runtime, actual caller verified | PRIOR PASS |
| P3-18 | actual upstream Node differential core subset passes, expanded passkey lifecycle parity latest pending | PARTIAL |
| P3-19 | local limits, code-only audit, aggregate profiling artifact verified; hosted/per-request/source policy open | LOCAL EVIDENCE / PARTIAL |
| P3-20 | latest all 5 jobs not completed | OPEN |
| P3-21 | no production or main merge, owner acceptance and physical browser evidence open | OPEN |

All PRIOR PASS entries require final-code review. No Phase 3 closure, no Phase 4, no Cloudflare remote resources, no real personal data or Learning Hub changes. Future manual physical passkey test must use disposable local profile and separate authenticator entry; official installed mobile app end-to-end remains Phase 4.

### Latest auth CI evidence
Run 45653658471, tested code edac5325: auth-core job 139344472303 SUCCESS 7/7, no failures/skips, all four PHASE3 markers PASS including extended passkey/device-link differential and origin/RP mismatch checks. POC/storage SUCCESS; API/frontend still running at latest inspection. P3-08 and P3-18 now have expanded differential evidence on latest code; P3-18 remains subject to exact supported-route error/header review and documented deviations. P3-05 origin/RP stable-code negative cases PASS, wrong-purpose coverage open. P3-13 unhealthy JSON/missing secret PASS. P3-20 and P3-21 remain open. Physical passkey and additional explicit negative cases are not waived. No code changes or deployment in this update.

## Phase 3 Hotfix 001 review / security hardening — 2026-11-25
Status: OPEN; physical passkey and final latest-code integrated CI remain gates.
- All six initial runs reviewed. 45652581816 four baseline jobs SUCCESS (auth absent); 45652711692 and 45653016329 failed auth only (revoked bearer 403 vs 401); 45653122116, 45653369301 and 45653658471 completed SUCCESS all five jobs.
- Run [45653658471](https://github.com/nimblelancer/openGym/actions/runs/45653658471), edac5325: POC 4/4 (+2 repeated precheck), storage 6/6, auth 7/7, upstream API 1084/1084, frontend 10101/10101 (898 files), Vite 2.00s. Total 11202 main-suite tests. Four artifacts downloaded and ZIP members independently read:
  - 15042510967 asset manifest SHA-256 f7924cac4ae9a010184994febf7360d5e4f3dda98cba7bf57a75d064ef86b4f2; 13345 files, 242978231 bytes, largest 2091275 bytes, same as Phase 2.
  - 15040243978 lockfile SHA-256 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc; Git blob 0cde099db0392a2583158df6911b3180d20698be, v3/156 records, Wrangler 4.168.0, SimpleWebAuthn 13.3.3; unchanged.
  - 15041927584 storage profile SHA-256 86274d842cc59f644c0467796d3c4139e7724e73fbc3a09de0d523a022c39c59; user 6.29s, system 1.17s, elapsed 17.95s, max RSS 305908 KiB, exit 0.
  - 15041018992 auth profile SHA-256 dfde72450ce84278ba2551e64a844e6a42859d287b1bff639fa2d9c8e8e5d821; user 18.38s, system 3.49s, elapsed 53.34s, max RSS 314036 KiB, exit 0.
- Hotfix 002 62d58496: key fingerprint epoch (domain-separated HMAC) atomically bumps session version and drops pending challenges/codes on rotation, preserves credentials and state; login challenge bound to owner/session version; wrong-purpose, normalized/encoded route and unsupported schema tests; suppress private Wrangler logs on startup failure. [45656055740](https://github.com/nimblelancer/openGym/actions/runs/45656055740) SUCCESS 5/5 jobs, auth 8/8, PHASE3_AUTH_ROTATION_SCHEMA PASS. Artifact 15044000175 independently read: SHA-256 792204ffb1e64e22dddc04a32619d471a312263ad9bd4d7d1f5a37b15312ca7e; user 15.78s/system 3.09s/wall 41.29s/max RSS 318916 KiB/45%/exit 0. Log scan found zero full session-token-shaped strings or manual setup-code print line; not proof of every possible leak. Aggregate GNU time includes browser/runner/children, not per-request or hosted CPU/heap. No controlled benchmark.
- 0b1f61db: deferred module caller audit, JSON/no-store/header assertions, 64 KiB bound, manual localhost UI/proxy/guide. Run 45656416258 auth 8/8, POC/storage/API SUCCESS, frontend pending at review. No core runtime change in this commit.
- a4cd8599: manual UI browser smoke fixture added; run 45656532011 auth failure from duplicate launchError declaration; remaining seven tests passed.
- bdf9a64c: require affirmative same-origin Origin or same-origin Fetch Metadata for browser cookie/sign-in mutations; valid acting kind-b bearer and pair redemption remain exempt; reject contradictory site metadata. Deliberate deviation from upstream non-browser fallback. Added 256 pending-challenge cap test and audit metadata schema/bounds check. Run 45656701583 auth 6/8: duplicate fixture declaration and offline SQLite database lock. Core CSRF and upstream differential passed. 
- b0272f38: corrected duplicate variable and canonical Origin headers, CI syntax check. Run 45656865169 auth 8/9: core, direct Chrome virtual, differential, rollback and rotation all PASS including new CSRF and limits tests. Manual UI readiness probe failed 403 because fetch Host override did not match localhost guard.
- 13c104fa: bounded 5s SQLite busy timeout and close probe handles even on error, no assertion retry or suppression; run 45657121938 in progress.
- ab4e3782: use localhost authority directly for manual smoke readiness, retain Host guard. Latest code/test commit; integrated CI not yet verified. No production code changes since bdf9a64c.
- Manual helper is a separate loopback Node proxy/UI; no new integrated Worker routes, random synthetic local secrets and temporary persistence, no remote resources. Manual physical owner evidence NOT RUN; wait for browser smoke PASS before asking owner to execute. See PHASE_03_MANUAL_PASSKEY.md. User acceptance not requested until latest CI green and checklist complete.
- Scope review: all 170 operations enumerated, 25 supported candidates, 145 explicit deferred. Core caller sources and representative deferred family callers inspected; individual deferred operation call graph and actual mobile/client handling remain release gates. Upstream admin/owner UI may expose unavailable routes; explicitly handle in Phase 5. Local source-IP rate limit unavailable; fixed global/owner buckets only, hosted abuse policy remains open. Exact byte-for-byte error/header parity not claimed, documented stable status/codes and security deviations. No auth bypass, no skip of failed tests, no Phase 4 or production deployment.

### Current P3 matrix (latest runtime evidence b0272f38 / prior completed integrated 62d58496; final retest required)
| ID | Evidence | Status |
|---|---|---|
| P3-01 | 170 operations + core caller mapping + representative deferred families; exhaustive deferred call graph release gate | LOCAL PASS / release gate |
| P3-02 | isolated API, no fixture routes, invalid secret 503 | PRIOR PASS |
| P3-03 | concurrent bootstrap, schema reject/recover, rotation/restart and closed signup | PRIOR PASS |
| P3-04 | genuine synthetic + direct Chrome virtual PASS; manual physical not run | VIRTUAL PASS / MANUAL OPEN |
| P3-05 | wrong purpose/expiry/replay/origin/RP/UV/signature, invalidated pending proof after revoke/rotation | PRIOR PASS |
| P3-06 | duplicate registration and same nonzero counter race | PRIOR PASS |
| P3-07 | cookie flags unit, HMAC tampering/expiry/kind/disabled and duplicate/mixed credentials | PRIOR PASS LOCAL |
| P3-08 | add/list/rename/remove, last way in, device-link differential | PRIOR PASS |
| P3-09 | single-use/TTL/parallel redeem, step-up, bounded local rates, source limits deferred | PRIOR PASS LOCAL |
| P3-10 | aged bearer renewal, no kind-c upgrade/delete, rotation/restart | PRIOR PASS |
| P3-11 | browser logout and global revoke, pending proof/pair/link cancellation | PRIOR PASS |
| P3-12 | affirmative origin/missing/conflicting metadata and encoded/normalized path authorization | PRIOR PASS |
| P3-13 | health/config/unknown/disabled JSON, safe failure | PRIOR PASS |
| P3-14 | identity protected data/rev and conflict | PRIOR PASS |
| P3-15 | revoke/write race, offline trigger rollback | PRIOR PASS |
| P3-16 | proof/kind/confirmation, atomic delete and closed signup | PRIOR PASS |
| P3-17 | nudge/ephemeral activity and upstream differential | PRIOR PASS |
| P3-18 | actual Node core differential including passkey/device-link lifecycle and selected JSON/header checks; documented deviations, not exhaustive byte parity | LOCAL PASS / release gate |
| P3-19 | 64KiB auth body, 256 challenge bound, fixed buckets, metadata-only bounded audit, aggregate profiling and limited log scan; hosted/per-request limits open | PRIOR PASS LOCAL |
| P3-20 | latest commit ab4e3782 integrated CI pending | OPEN |
| P3-21 | owner physical passkey checklist, final branch/safety and acceptance | OPEN |

No closure. Eighteen scoped local criteria have prior passing evidence (not final-code acceptance); P3-04, P3-20 and P3-21 are open. Final CI, manual smoke and physical verification required. Phase 4 not implemented.

## Final security CI review — 2026-11-26
**OPEN — AUTOMATED LOCAL VALIDATION PASSED; READY FOR MANUAL PHYSICAL PASSKEY ACCEPTANCE.** Do not close Phase 3 or start Phase 4.
- Run [45657223798](https://github.com/nimblelancer/openGym/actions/runs/45657223798), attempt 1, tested ab4e37829ddb18c74267460e821644c0b5743d18, completed SUCCESS 2026-11-25 16:51:27 UTC. Five jobs and every recorded step SUCCESS.
- POC [139357055446](https://github.com/nimblelancer/openGym/actions/runs/45657223798/job/139357055446) 4/4 (+2 repeated precheck); storage [139357055619](https://github.com/nimblelancer/openGym/actions/runs/45657223798/job/139357055619) 6/6; auth-core [139357055440](https://github.com/nimblelancer/openGym/actions/runs/45657223798/job/139357055440) 9/9, 0 failed/cancelled/skipped; upstream API [139357055565](https://github.com/nimblelancer/openGym/actions/runs/45657223798/job/139357055565) 1084/1084; frontend/assets [139357055206](https://github.com/nimblelancer/openGym/actions/runs/45657223798/job/139357055206) 10101/10101 in 898 files, Vite build 2.70s, media staging and manifest SUCCESS. Total 11204 main-suite passes excluding repeated precheck. All npm ci and syntax-check steps passed.
- Auth log markers: PHASE3_BROWSER_VIRTUAL_PASSKEY PASS, PHASE3_MANUAL_HARNESS_VIRTUAL_SMOKE PASS, PHASE3_AUTH_CORE PASS, PHASE3_UPSTREAM_AUTH_DIFFERENTIAL PASS, PHASE3_AUTH_FAULT_ROLLBACK PASS, PHASE3_AUTH_ROTATION_SCHEMA PASS. Manual proxy/UI smoke covers registration, authenticated session/HttpOnly, synthetic state write/read, logout/login and logout/all using Chrome virtual authenticator. Does not prove physical authenticator or cancellation/manual checklist acceptance.
- Related runs confirmed completed: 45653658471, 45653986809, 45656055740, 45656416258 all five jobs SUCCESS. 45656532011, 45656701583, 45656865169, 45657121938 failed auth only; remaining four jobs SUCCESS. Historical fixture duplicate declaration, offline SQLite lock, localhost readiness Host probe failures resolved in final run; no new application hotfix required based on observed CI evidence.
- All four final ZIP artifacts downloaded, archive CRC checked and members independently read; SHA-256 refers to member content, not ZIP:
  - 15044256330 auth-process-profile.txt: 1031c7141c6b8746644a9eaf33ece53ec8099f6d3c7bb98be707b121c5f546b5; user CPU 15.09s, system 3.38s, wall 48.90s, peak RSS 317580 KiB, CPU 37%, exit 0.
  - 15042337700 storage-process-profile.txt: 8a5ea83dff5277fc32642c409411a533eb8b4dc393086f8b1cfe629020f6f348; user CPU 7.50s, system 1.21s, wall 18.73s, peak RSS 312248 KiB, CPU 46%, exit 0.
  - 15042572548 package-lock.json: 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc; 79766 bytes, v3, 156 package records, Wrangler 4.168.0, SimpleWebAuthn 13.3.3. Computed Git blob 0cde099db0392a2583158df6911b3180d20698be matches feature branch file. Same checksum as Phase 2.
  - 15042304302 assets.json: f7924cac4ae9a010184994febf7360d5e4f3dda98cba7bf57a75d064ef86b4f2; 13345 files, 242978231 bytes, 13109 media entries, largest 2091275 bytes, oversized empty. Same manifest checksum as Phase 2, not a content hash of every individual asset nor evidence of hosted upload.
- GNU time measurements cover command/process children including Wrangler/workerd/Chrome, not per-request isolate CPU/heap or billed usage. Storage SQL counters before restart 20 meta queries/18 chunk queries/51 rows read/49 rows written/5242180 attempted bytes; final restart 3/1/4/0/0. All five job logs scanned for full session-token-shaped strings: zero matches; limited scan, not comprehensive secret-leak proof.
- GitHub Compare tested ab4e3782 to current HEAD 66b74986 shows only five migration documentation changes. Compare main e4a68a9 to HEAD: 51 changed paths all confined to cloudflare-poc/, docs/cloudflare-migration/, .github/workflows/cloudflare-poc.yml. Main unchanged. This update is documentation-only, no new runtime/test changes. No remote resources, production deployment, main merge or Learning Hub actions performed.

### Current Phase 3 acceptance matrix (supersedes earlier pending snapshots)
| ID | Evidence | Status |
|---|---|---|
| P3-01 | 170 operations classified, 25 core candidates, core and representative deferred callers; exhaustive deferred call graph/client gates remain | LOCAL PASS / release gate |
| P3-02 | isolated local API, missing secret 503, no fixture endpoints | PASS |
| P3-03 | one owner bootstrap, restart, closed signup, schema reject/recover, secret rotation | PASS |
| P3-04 | signed synthetic and actual Chrome virtual registration/login, manual harness smoke PASS; physical UV/manual checklist NOT RUN | VIRTUAL PASS / MANUAL OPEN |
| P3-05 | challenge cross-purpose, expiry/replay, invalid origin/RP/UV/signature, revoke and rotation invalidation | PASS |
| P3-06 | bootstrap and credential counter races | PASS |
| P3-07 | HMAC, expiry, tampering, kind, duplicate/mixed, disabled, HTTPS cookie flags unit | LOCAL PASS |
| P3-08 | passkey list/add/rename/remove, last-way-in, device link, differential | PASS |
| P3-09 | owner proof, one live code, TTL/replay/racing redeem, local bounded rates | LOCAL PASS |
| P3-10 | bearer renewal, kind-c restrictions, revocation/restart | PASS |
| P3-11 | ordinary logout/global revoke, pending proof/pair/link cancellation | PASS |
| P3-12 | affirmative same-origin evidence, conflicting/missing metadata, native preflight, encoded/normalized authorization | PASS |
| P3-13 | health/config, unknown/disabled/fixture routes, safe failure JSON | PASS |
| P3-14 | authenticated data/rev, identity not client controlled, conflict/restart | PASS |
| P3-15 | revocation/write race, offline SQLite trigger rollback | PASS |
| P3-16 | delete confirmation/proof/kind, atomic cleanup, closed bootstrap | PASS |
| P3-17 | nudge/activity actual upstream behavior and caller review | PASS |
| P3-18 | supported-core actual upstream differential, selected errors/headers and documented deviations; not full 170-operation parity | LOCAL PASS / release gate |
| P3-19 | body/challenge/rate/audit bounds, limited safe-log scan, verified local profiling | LOCAL PASS |
| P3-20 | latest code CI 45657223798 all five jobs PASS, 11204 main-suite tests, all artifacts verified | PASS |
| P3-21 | branch/safety scope verified; physical evidence and explicit owner acceptance still required | OPEN |

19/21 scoped criteria have passing automated/local evidence; P3-04 and P3-21 remain open. This is not Phase 3 closure or production readiness. Owner may now run [manual physical passkey checklist](PHASE_03_MANUAL_PASSKEY.md) (M3-01..09) on the tested code ab4e3782, or documentation-only successor. Use separate local clone/profile, fresh synthetic data and actual UV-capable authenticator; never share setup code, tokens or credential material. Official installed mobile app acceptance remains Phase 4. Hosted HTTPS, per-request/hosted resource usage and shared quota, trusted-source abuse policy, deferred routes/client capability handling, full backup/recovery and exact diagnostic differences remain release gates. No Phase 4 implementation or deployment authorized.
