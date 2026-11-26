# Phase 4 — Official mobile client compatibility (local-first)
Date: 2026-11-26. Pinned upstream e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 v1.4.5. Phase 3 tested ab4e3782, CI 45657223798 success. Owner explicitly deferred physical passkey manual test; Phase 3 OPEN (P3-04/P3-21). Local Phase 4 work may proceed conditionally; no native rebuild as a release requirement. No hosted resources, LAN exposure, tunnel, main merge, production deployment or personal data. Actual installed app acceptance remains required.
## Source contract
- docs/MOBILE.md: default local-only mode, pairing code from authenticated browser (5 min, one-shot), phone bearer instead of cookie; no WebAuthn in WebView; token renewal via /api/me, revoked phone remains paired with owed data, same-account re-pair merges and different-account stash, disconnect refuses unsent changes unless explicitly stashed. Android native HTTP fallback, iOS/Android app origins and optional Access service token. Native notifications/health remain local; nudge-check is a small bearer-authenticated request. Media sync intentionally Phase 5.
- frontend/src/lib/api.js: pairRedeem, api(), remoteAuth, setRemoteAuth, setAccessHeaders, 20s GET/60s PUT, error status and parsed conflict body, reject HTML 200, no relative calls when not paired, Android native transport fallback. frontend/src/lib/remote.js: normalizeServerUrl, connect, loadRemote, renewToken, forgetRemote. frontend/src/lib/mobile.js: nativeLoad/nativeSave, remote file separate from synced data; Android Data and iOS LibraryNoCloud. frontend/src/store/useStore.js: boot, pushState/pullState, connectToServer/afterConnect, disconnectServer, signOutAll, adoption/stash. sync-merge.js and sync-changes.js preserve stamps and fingerprint; nudge-check.js native plan/cancel.
- Existing upstream tests use mocked fetch and Capacitor plugins (e.g. useStore.mobile-remote.test.jsx, api.mobile.test.js, api.pair-http.test.js, mobile.remote-file.test.js, ServerSync.leave.test.jsx, health-sync tests). Preserve those regression tests. Add migration integration tests that use actual pinned client modules and actual local Worker HTTP responses; OS plugin and file mock boundaries clearly labelled. Do not claim a simulated client is an installed APK/IPA.
## Work packages
P4-A: inventory mobile route, status, response/header, origin, native transport and version matrix; identify deferred routes and required native-local features; source-pinned client tests.
P4-B: real Worker pairing, native CORS preflight, one-time/replayed/invalid code, bearer requests, /me renewal, revoked/expired token and same-account re-pair; no real Access token or Cloudflare Access dependency.
P4-C: real client store and local Worker sync: initial adoption, two clients, stale rev/wid conflict, offline edits, reconnect, durable file mirror, failed writes, reset/deletion/rewind, retries/no false confirmation. Fault/restart tests with disposable data. Different-account stashing tested using isolated fixture servers, never create multiple owners in one server.
P4-D: local mode/connection UX and disconnect/stash; confirm API HTML/503/413/401/409 behavior and no credential/state leakage. Unsupported capabilities explicit. Native HTTP fallback, origin-specific Access headers and nudge-check, health/local reminders regression; no media implementation until Phase 5.
P4-E: automated integration CI using pinned frontend modules, baseline regression, documented profiling and local-only setup; plan owner-installed Android/iOS manual checklist. Do not start native rebuild or expose local-only Worker to LAN as a workaround.
P4-F: review test evidence, compatibility gaps and documentation; leave installed-app manual and Phase 3 physical checks pending until owner can perform consolidated acceptance. Later Phase 5/6 work may proceed locally if automated contracts pass and no stop condition found; no closure without required evidence.
## Acceptance matrix (initial)
| ID | Criterion | Status |
|---|---|---|
| P4-01 | Pinned client route/version/capability matrix and explicit unsupported scope | STARTED |
| P4-02 | Real pinned pairRedeem/connect against local API, invalid/replay handling | TEST ADDED / CI PENDING |
| P4-03 | Native origins/preflight and bearer headers without cookie, no relative fallback | TEST ADDED / CI PENDING |
| P4-04 | Connection persistence, /me renewal and revoked token/re-pair | TEST ADDED / CI PENDING |
| P4-05 | Client store initial adoption and real server sync, rev/wid contract | OPEN |
| P4-06 | Concurrent edits and actual client merge with 409 | TEST ADDED / CI PENDING (module-level) |
| P4-07 | Offline edits, reconnect, durable mirror, retry with no data loss | TEST ADDED / CI PENDING (module-level) |
| P4-08 | Deletion/reset/rewind through actual client store | OPEN |
| P4-09 | Disconnect guard/stash, same/different account isolation, file failure | OPEN |
| P4-10 | Malformed/HTML/timeout/error response handling, no false success | TEST ADDED / CI PENDING (module-level) |
| P4-11 | Native reminder/nudge-check and health data behavior | TEST ADDED / CI PENDING (nudge module only) |
| P4-12 | Android/iOS native fallback, service-token origin isolation and no leaked secrets | OPEN |
| P4-13 | Deferred feature capabilities and no mandatory client dependency on unsupported routes | OPEN |
| P4-14 | Latest integrated CI all jobs plus mobile contract test, assets/locked deps, local profiling | OPEN |
| P4-15 | Actual official installed app Android/iOS as applicable, no rebuild, disposable data, offline/re-pair | MANUAL PENDING |
| P4-16 | Scope isolation and owner acceptance, Phase 3 deferred checks tracked | OPEN |
Initial module integration tests are not store-level or physical acceptance. No test result claimed until CI. Full release blocks: physical passkey and installed app acceptance, supported capabilities, hosted resource quotas, recovery/privacy.

## Phase 4 engineering follow-up — 2026-11-26
Reviewed 49157bdb and pinned sources. GitHub branch and exact-head run query returned no run for 49157bdb at inspection; latest visible completed CI remains Phase 3 45657223798, not Phase 4 evidence. Added actual upstream store integration fixture using real local Worker, simulated native filesystem and network errors, conflict/dirty tracking, revoked pairing, disconnect guard and stash, separate sequential owner databases, same-account re-pair and deletion/reset/restart. Expanded module fixture with all native origins, real oversized request and mocked CapacitorHttp bridge invoking actual upstream nativeFetch. Added mobile contract/manual checklist document and included both tests serially in mobile-contract CI. These tests are unexecuted; no Phase 4 acceptance claims. Rewind, file write failure integration, timeout, Access isolation, capability UI, actual native health and installed app remain open. No source changes to upstream frontend/backend, no remote resources, no deploy or phase closure.

- Follow-up: added disposable offline SQLite rewind of valid profile rows (integrity hash recomputed, auth untouched), actual store pull recovery, both stash writes failing (must refuse forced disconnect), native-file-only cold boot, origin-scoped synthetic Access headers, disabled-route JSON checks. These are newly authored tests, not executed evidence. Actual installed-app and OS health behavior remain manual. Hosted Access not configured. No production runtime change.

## Phase 4 checkpoint — authored coverage, CI evidence unavailable (2026-11-26)
Baseline: Phase 3 45657223798 SUCCESS, all five jobs. GitHub branch listing and exact head queries returned no Actions run associated with 49157bdb, 518468ec or 74f3d223 at inspection; latest visible run remains the Phase 3 run. The new workflow has a branch-scoped push trigger with cloudflare-poc and workflow path filters and workflow_dispatch; current connector does not expose a workflow-dispatch write action. Do not rerun an old SHA as proof of new code. The owner can select the feature branch in the GitHub Actions UI and run the existing workflow if automatic push execution remains absent. No test execution, latest profile or new asset artifact is asserted. No application hotfix justified without execution evidence.
| ID | Authored scope / evidence | Status |
|---|---|---|
| P4-01 | pinned source route/status/caller and deferred capability matrix; actual installed release version unknown | DOCUMENTED / device pending |
| P4-02 | actual client connect/pairRedeem, invalid/replay; real Worker | CI REQUIRED |
| P4-03 | native preflight for three origins, bearer/no cookie, no relative fallback | CI REQUIRED |
| P4-04 | pairing file persistence, renewal/revocation and re-pair | CI REQUIRED |
| P4-05 | actual useStore boot/connect/adoption/push/pull, rev/wid | CI REQUIRED |
| P4-06 | offline phone edit, separate server-side edit, actual store 409 merge/retry | CI REQUIRED |
| P4-07 | offline pending edit, native mirror/cold boot, failed acknowledgements and reconnect | CI REQUIRED |
| P4-08 | deletion/reset, offline valid SQLite rewind and restart, store pull preserves edits | CI REQUIRED |
| P4-09 | refuse disconnect, both stash targets failing, forced stash, isolated second server, native-file stash re-pair | CI REQUIRED |
| P4-10 | actual 413, simulated transport HTML/503/offline/timeout, no false acknowledgement | CI REQUIRED |
| P4-11 | real nudge API plus native cancellation logic; existing upstream native-local health/reminder tests; actual permissions/OS execution manual | CI + MANUAL REQUIRED |
| P4-12 | upstream nativeFetch with simulated CapacitorHttp bridge real HTTP, Access fake header origin binding; actual WebView/TLS/OS networking not tested | CI + MANUAL REQUIRED |
| P4-13 | unsupported core optional route checks and config capability review; exhaustive mandatory UI/deferred module review outstanding, media Phase 5 | PARTIAL |
| P4-14 | new mobile-contract job with serial pinned module/store tests and GNU time artifact; all six jobs/asset and lockfile verification pending | BLOCKED: no visible run |
| P4-15 | official installed mobile app checklist M4-01..10; no rebuild or actual device test | DEFERRED, NOT WAIVED |
| P4-16 | feature branch scope, no main/deploy/remote resources; owner acceptance remains open, P3-04/P3-21 deferred | OPEN |
Work packages P4-A documented, B/C/D authored test implementation (not yet validated; P4-13 and OS-specific evidence incomplete), E CI configured + manual plan, F checkpoint only. Phase 4 remains OPEN, not ready to enter Phase 5 under the agreed local validation gate. Physical owner acceptance deferred to consolidated session before Phase 7 closure, but automated run availability is a separate blocker. No Cloudflare resources or Learning Hub changes.

## Phase 4 capability follow-up (2026-11-26)
Re-reviewed initial 49157bdb and feature head e652ab1b. Branch Actions listing and exact head queries for both returned no Phase 4 run; latest visible run remains 45657223798 (Phase 3). P4-13: focused source audit and additional actual upstream gate/relay assertions against real local Worker; core store fixture asserts local boot, config and no observed deferred route responses during sync and stash. See PHASE_04_MOBILE_CONTRACT.md. P4-13 remains PARTIAL / CI REQUIRED (mounted UI, native device and media deferred); P4-14 remains BLOCKED pending a new run on feature head. P4-A/F documentation advanced; B/C/D/E authored tests remain unverified. No PASS promoted, no Phase 5 started, no main merge or deploy.

## Hotfix 001 review and Hotfix 002 (2026-11-26)
CI 45844043558 on d5968eaf: five regression jobs PASS; pinned mobile module fixture PASS; store fixture failed at Worker startup (Happy DOM preflight 403). Hotfix 001 5e6233b8 installs the loopback transport before health probe. CI 45845542661 on 5e6233b8: five regression jobs PASS, pinned mobile module fixture PASS; actual store fixture advances through initial adoption, offline mirror, 409 conflict merge, rewind, 503/HTML failure, revoked token and nonforced disconnect guard, then fails at forced disconnect with both stash targets intended to fail (expected stashed:false, got true). No later assertions executed. Suspected Happy DOM Storage proxy bypass of prototype spy, not established application bug. Hotfix 002 f6a24944 replaces prototype spy with explicit global Storage wrapper and verifies both injected failures via counters and absence of stash copies. Retains the original no-data-loss assertions. No runtime/security changes.
| ID | Evidence from 45845542661 | Status |
|---|---|---|
| P4-01 | pinned source audit | DOCUMENTED / device pending |
| P4-02 | actual module pairing/replay | PASS (local module scope) |
| P4-03 | three origins/preflight, bearer/no-cookie | PASS (local module scope; real WebView deferred) |
| P4-04 | persistence, renewal, revocation, module re-pair | PASS (local module scope) |
| P4-05 | store initial adoption and sync | ASSERTIONS PASSED before later failure |
| P4-06 | actual store 409 and merged server copy | ASSERTIONS PASSED before later failure |
| P4-07 | offline mirror, owed tracking/reconnect; cold boot not reached | PARTIAL |
| P4-08 | rewind passed; deletion/reset/restart not reached | PARTIAL |
| P4-09 | nonforced guard passed; dual storage failure assertion failed; account isolation/re-pair not reached | FAIL / INVESTIGATING |
| P4-10 | module timeout/413 and store 503/HTML acknowledgement | PASS (scoped assertions) |
| P4-11 | nudge module passed; actual native health/reminders not accepted | PARTIAL / MANUAL |
| P4-12 | module native bridge simulation and Access origin binding | PASS (simulated transport only; manual pending) |
| P4-13 | actual config predicates/404 relay behavior passed; final store deferred-route assertion not reached, UI not mounted | PARTIAL |
| P4-14 | 5/6 jobs, 5 uploaded artifacts (metadata checked); mobile profile exit 1 | FAIL |
| P4-15 | physical official app | DEFERRED, NOT WAIVED |
| P4-16 | scope preserved; owner acceptance pending | OPEN |
P4-A documented; P4-B local module evidence passed; P4-C/D partial and data-preservation blocker; P4-E CI available but failing; P4-F review only. Phase 4 OPEN, do not enter Phase 5 until integrated local validation passes and data-preservation gate is resolved. P3-04/P3-21 and M4 manual remain deferred to consolidated acceptance before Phase 7 closure.

## Hotfix 002 review and additional data-preservation gate (2026-11-26)
CI 45846900403 on f6a24944 SUCCESS, all six jobs. POC 6/6, storage 6/6, auth 9/9 (virtual passkey and manual harness virtual smoke PASS), upstream API 1084/1084, frontend 10101/10101, mobile 2/2; 11208 tests total. Both PHASE4_REAL_STORE_STASH_CONFLICT_RESET and PHASE4_PINNED_MOBILE_MODULES PASS. Dual fault injection verified both writes actually failed and disconnect refused when no previous stash existed. All five ZIP artifacts downloaded, CRC and contents checked: lockfile blob equals repository 0cde099db0392a2583158df6911b3180d20698be; asset manifest 13345 assets, 13109 media, 242978231 bytes, largest 2091275 bytes, no oversized assets. Local process profiles (wall/user/system seconds, peak RSS KiB): storage 21.90/7.69/1.17/311436, auth 42.32/18.12/3.19/312960, mobile 12.50/9.85/1.84/537476; exit 0. Not hosted metrics. e67cb71 differs from tested commit only in PHASE_04.md.
Source review found an additional data-loss risk: upstream useStore.js writeStashes() accepts a native readback with equal key count even if the content remains stale after failed writes. Existing passing test starts without a prior stash. Added a real-store synthetic regression on b23efe10 that preloads a stale native stash for the same server/account, rejects both writes, verifies fault counters and unchanged stale file, and requires disconnect to refuse and keep newer unsynced data. This is a source-supported risk, not a newly observed CI failure until the new run reports. Do not weaken the assertion or patch the Worker to fake success. If confirmed, determine an official-client-compatible mitigation; installed app cannot be assumed to contain a frontend source fix. No runtime change in this checkpoint.
| ID | Hotfix 002 evidence / remaining gate |
|---|---|
| P4-01 | DOCUMENTED; installed version check manual |
| P4-02 | PASS local pairing/replay |
| P4-03 | PASS local native-origin headers/bearer; physical WebView deferred |
| P4-04 | PASS local persistence/renewal/revocation/re-pair |
| P4-05 | PASS actual store adoption and sync |
| P4-06 | PASS actual store conflict |
| P4-07 | PASS offline mirror, reconnect/cold boot |
| P4-08 | PASS deletion/reset/rewind/restart |
| P4-09 | PASS authored scenarios on f6a24944; additional stale-stash safety regression PENDING on b23efe10; gate OPEN |
| P4-10 | PASS timeout and error handling |
| P4-11 | PASS local nudge contract; native health/notification permissions manual |
| P4-12 | PASS simulated native bridge and Access origin binding; physical networking deferred |
| P4-13 | PASS scoped predicates/relay/core route assertions; mounted UI and media gates remain |
| P4-14 | PASS integrated CI and all five artifacts on f6a24944; new regression CI pending |
| P4-15 | DEFERRED M4-01..10, not waived |
| P4-16 | OPEN owner acceptance |
P4-A documented; B local pass; C/D baseline pass, expanded data-preservation gate open; E baseline CI/artifacts pass, new regression pending; F review recorded, acceptance open. Phase 4 OPEN. Phase 5 not started pending stale-stash safety result. P3-04/P3-21 and M4 manual remain deferred to consolidated session before Phase 7 closure. No remote resources, main merge, production deployment or Learning Hub changes.
