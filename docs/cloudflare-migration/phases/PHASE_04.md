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
