# openGym Cloudflare migration — master plan

Date: 2026-11-25. Baseline: e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 (v1.4.5). Branch: feat/cloudflare-migration.
Status: Phase 1 CLOSED local functional POC; Phase 2 CLOSED local storage migration (final CI 45651255730 SUCCESS, 17/17 scoped acceptance). Local aggregate CPU/RSS collected; hosted/per-request qualification still open. Phase 3 core API implemented; final automated local CI 45657223798 SUCCESS (19/21 scoped criteria with passing evidence), physical passkey and owner acceptance deferred, OPEN; conditional local Phase 4 engineering authorized. No production approval.

## Goals
- Run a private, single-owner openGym deployment within the Cloudflare Free plan and the account's remaining quotas.
- Keep the installed official mobile app and existing web frontend compatible, with no native rebuild as a release requirement.
- Preserve workout, routines, body data, settings, offline edits, backup/export and personal media. Never acknowledge a write before durable commit.
- Keep upstream Docker deployment, official website failover and all Learning Hub resources unchanged.
- Retain AGPL notices and the separate Gym visual media license. Do not extract or repurpose the media.

## Scope
First milestone: web authentication using passkeys, owner-only registration, mobile pairing, session lifecycle, revision-safe sync and persistence, core frontend. Second milestone: private R2 media and backup/restore, including progress photos and exercise uploads. Release blockers include data safety and official app pairing. Native-local features (health, timers, watch features) must not regress through contract changes. Server push, watch relay, password login, AI Coach, MCP/OAuth, OIDC, trainers, community sharing and external integrations are deferred pending explicit compatibility and cost tests. Capability flags must accurately reflect availability; unsupported routes must not return fake success or SPA HTML. Confirm deferred functionality with user before production.

## Phases and gates
| Phase | Deliverables | Exit gate |
|---|---|---|
| 0 Audit | repository audit, architecture decision proposal, plan, validation matrix | Static review recorded; user accepts MVP and risk; no runtime claims |
| 1 Local feasibility | isolated Workers/DO skeleton, local bindings, baseline tests, CI, node:http adapter spike vs Fetch-native handler, crypto/passkey spike, 5 MiB synthetic state CPU/memory spike, asset manifest | Runtime bundle starts; actual DO persistence across restart; auth/CPU measurements; if no safe path, STOP |
| 2 Storage | async interfaces, SQLite DO schema and transaction tests, metadata-only revision poll, data migration/import fixtures | atomic compare-and-write, concurrency, failure rollback and restart tests pass; original Docker tests remain green |
| 3 Auth & core API | passkey, cookies, bearer sessions, challenges, pairing, security guards, config, health, account deletion | negative tests, replay and revocation tests, request/response differential tests pass |
| 4 Mobile | actual official app pairing, sync, conflict/deletion/rewind, offline and reconnect, health data where supported | user acceptance with disposable data; no lost edits; no rebuild required |
| 5 Web & media | original frontend build, same origin, SPA/assets, private R2 upload/download, exercise-media manifest and license | media content validation, range/ownership, cap, no public personal media, asset sizes pass |
| 6 Privacy & recovery | backup/restore, quota ledger, restrictive registration, secrets, failure paths | verified restore and backup off provider, abuse/quota tests pass |
| 7 Integrated validation | regression, contract inventory, real Free-tier staging metrics and rollback rehearsal | all mandatory checks pass; remaining account quota verified; user signs off |
| 8 Production | separate resources, production deployment, smoke test, maintenance docs | explicit approval, backup, smoke and billing checks; no Learning Hub impact |

Each phase: plan, small commits, test evidence, review, user acceptance where applicable. No main merge, production deployment, remote resource creation, or destructive migration before explicit approval. Use synthetic data only until staging accepted. Use a dedicated CI job; preserve upstream CI. No secrets in source or logs. Pin dependencies and upstream baseline. Track unsupported paths and test results in VALIDATION_MATRIX.md; maintain PROGRESS.md after each phase.

## Stop conditions
No safe atomic persistence, official app incompatible, free-tier CPU or asset limits fail, media licensing or quota unresolved, or tests cannot prove no loss: stop and present alternatives (local Docker + Tailscale, VM, or narrower scope). No weaker authentication or silent data truncation to meet cost limits. 

## Phase 2 plan
See [PHASE_02.md](phases/PHASE_02.md). Begin only after Phase 1 closure and explicit implementation approval. Actual hosted CPU/memory and quota remain Phase 7 staging gates; local wall time is not CPU profiling.

## Phase 1 scope closure
The final local functional gate is satisfied on run 45648776762. The original CPU/memory measurement requirement has not been fully satisfied: only wall-clock latency was measured; dedicated local CPU/peak-memory profiling is carried forward to Phase 2 P2-16, hosted CPU/memory/quota qualification remains Phase 7. This scoped closure is not production feasibility approval. See phases/PHASE_01.md and VALIDATION_MATRIX.md for exact evidence.

## Phase 2 review status
Hotfix 001 all 4 jobs SUCCESS; expanded deletion/reset differential storage tests PASS on 51c7b63a. Phase 2 remains open for final full CI and owner acceptance; local aggregate profiling collected, hosted qualification remains Phase 7. No Phase 3 or deployment authorization.

## Phase 2 closure and Phase 3 plan
Final CI 45651255730 SUCCESS (4/4 jobs), verified assets, locked dependencies and profiling artifacts; conditional owner acceptance fulfilled. Phase 2 closed for local scope only; see phases/PHASE_02.md for final matrix. Aggregate local profiling is not hosted CPU/heap measurement. [PHASE_03.md](phases/PHASE_03.md) is a plan only; obtain separate explicit approval before implementation. Hosted resource and real-device qualification remain release gates.

## Phase 3 implementation initial checkpoint
Added 170-operation inventory, isolated local API config, auth session primitives, SQLite auth schema/one-shot challenges and codes, private bootstrap, signed passkey verification, session/step-up, pairing, device-link/passkey management, authenticated state/revision, nudge, logout and atomic account deletion. State mutation composes Phase 2 current/transition/save within the same synchronous transaction as session-version recheck. No remote operations. Candidate implementation only; tests, browser evidence, exact differential and full caller audit pending. P3-01–P3-21 NOT ACCEPTED. Explicitly deferred activity, exact error mapping and per-source rate limits pending review. No Phase 4.

## Phase 3 implementation review
Core auth candidate and dedicated CI implemented. Hotfix 001 6/6 auth tests, activity follow-up 7/7 PASS; final expanded differential run 45653658471 in progress. See phases/PHASE_03.md for outstanding acceptance. No Phase 4 or deployment authorization.

## Phase 3 review update
Hotfix 002 CI 45656055740 all 5 jobs PASS. Further affirmative-origin security hardening and bounds passed core/differential/fault tests on b0272f38, but manual browser harness had readiness fixture failure; fixed on ab4e3782 pending CI. Manual physical passkey guide created. Phase 3 remains OPEN for latest integrated CI and physical/owner acceptance, no Phase 4 or deployment.

## Phase 3 final automated review
Final CI 45657223798 on ab4e3782 SUCCESS, all five jobs, auth 9/9, 11204 main-suite tests. Manual harness virtual smoke PASS and all four artifacts verified. Phase 3 OPEN, ready for manual physical passkey acceptance M3-01..09; P3-04 and P3-21 remain open. No Phase 4 implementation or production approval. See [PHASE_03.md](phases/PHASE_03.md) and [manual guide](phases/PHASE_03_MANUAL_PASSKEY.md).

## Owner-authorized sequencing adjustment — 2026-11-26
The owner requested to defer manual physical passkey testing and continue the remaining phases if safe. **Deferred, not waived:** P3-04 physical passkey acceptance M3-01..09 and P3-21 owner acceptance remain OPEN; Phase 3 is not closed (19/21 scoped local criteria passed on CI 45657223798). Automated Phase 3 baseline ab4e3782 stays the validated starting point. Local/synthetic implementation and CI for Phases 4–6, and preparation for Phase 7, may proceed conditionally; no phase may be marked accepted for unexecuted tests. This supersedes earlier sequential "do not start Phase 4" instructions only for local engineering and validation, not a release or closure waiver. If a later change touches authentication/security, rerun Phase 3 regression and any relevant manual checks on the final integrated candidate. Official installed-app acceptance (Phase 4) can also be queued for a consolidated owner testing session, but cannot be replaced by a simulated client. Complete all deferred manual evidence and owner acceptance before Phase 7 integrated acceptance and any production decision. No remote resources, tunnels, hosted staging, actual personal data, main merge or deployment without separate explicit approval. Stop if required mobile compatibility, safe sync or authentication fails; do not weaken security to get green CI. Learning Hub remains out of scope.

## Phase 4 initial engineering checkpoint
Created PHASE_04.md with P4-A..F and P4-01..16, and added a dedicated mobile-contract CI job exercising pinned upstream api/remote/mobile/merge/nudge modules against real local HTTP Worker, with disposable synthetic OS file mock and transport adapter. Tests cover pairing, replay, origin preflight, offline conflict/merge, file mirror, renewal/revocation/re-pair, HTML failure and nudge response. Native OS and WebView not executed, full client-store integration pending. No PASS claims until CI. Existing frontend source and test suite unchanged; CI copies the new fixture into the disposable checkout and removes it afterward. Existing five jobs retained. No Phase 5 implementation, remote resources or deploy.

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
