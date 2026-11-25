# openGym Cloudflare migration — master plan

Date: 2026-11-25. Baseline: e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 (v1.4.5). Branch: feat/cloudflare-migration.
Status: Phase 1 CLOSED local functional POC; Phase 2 CLOSED local storage migration (final CI 45651255730 SUCCESS, 17/17 scoped acceptance). Local aggregate CPU/RSS collected; hosted/per-request qualification still open. Phase 3 detailed plan ready, implementation NOT STARTED. No production approval.

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
