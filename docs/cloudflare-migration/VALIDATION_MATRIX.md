# Validation matrix
Phase 0: STATIC = source inspected; NOT RUN = execution pending. No automated tests or deployment executed in Phase 0.

| Check | Evidence / pass criterion | Status |
|---|---|---|
| Baseline pinned | main SHA e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 | STATIC |
| OpenAPI inventory | 157 paths / 170 operations; classify all against actual client calls | STATIC / classification pending |
| Node runtime spike | isolated bundle boots; no unsupported global side effects | NOT RUN |
| DO persistence | restart/evict/redeploy then identical document & credentials | NOT RUN |
| CPU/memory | measure auth, conflict/merge, 5 MiB envelope and media at actual Free plan; no runtime limits breached | NOT RUN |
| Sync contract | rev/wid, baseRev/baseWid, stamps, legacy, 409 body, no active field persistence | NOT RUN |
| Concurrency | two writers same base -> one success, one 409; merge both; no lost writes | NOT RUN |
| Failure | injected storage failures yield no false 200; stale/empty/invalid doc does not erase state | NOT RUN |
| Auth | real browser passkey register/login; invalid challenge/origin, expired/replayed codes, session revoke, private bootstrap | NOT RUN |
| Mobile | installed official app pairs via HTTPS; restart, renewal, offline edits, reconnect, two-device conflicts | NOT RUN |
| Health/native | local health and timers remain functional; relevant sync/nudge endpoints work | NOT RUN |
| Media | private ownership, hash, sniff, valid limits, partial/range download, GC, quota, no cross-account leak | NOT RUN |
| Build | actual asset count <=20k, each <=25 MiB, proper routes/headers, licensed assets only | NOT RUN |
| Regression | original frontend/API tests, sync-stamps parity, OpenAPI checks, mobile remote/rewind tests | NOT RUN |
| Backup/restore | synthetic snapshot + media + metadata; restore into separate local instance and compare; restore does not silently rewind live data | NOT RUN |
| Cost | actual account free quota and R2 headroom confirmed, load and abuse budget, no paid upgrade | NOT RUN |
| Release | user signs off, rollback rehearsal, no existing Learning Hub modifications | NOT RUN |

Use targeted Worker integration tests (Wrangler/Miniflare or official Workers Vitest integration) plus upstream tests and differential API fixtures. Local tests do not establish actual hosted CPU/billing; staging after explicit approval is required.

## Phase 1 evidence status
POC code/test implementation added; all execution checks remain NOT RUN in authoring environment. CI workflow cloudflare-poc.yml is the execution path. Local synthetic auth is not actual browser authentication; local wall timing is not hosted CPU. Require CI evidence, lockfile and review before Phase 2.

## Phase 1 CI review — 2026-11-25
| Evidence | Result |
|---|---|
| Run 45646783644, 6ebfbe86 | POC PASS (3 tests, plus 2 initial unit tests); upstream API/frontend cancelled during test; asset build skipped |
| Run 45647012258, ac3274a2 | POC 3 pass/1 fail; isolated Node adapter startup collision, socket direct:1:default; Fetch/DO runtime test and unit tests pass |
| Upstream API regression (run 45647012258) | PASS, 1084/1084 tests, no failures/cancellations/skips |
| Fetch/DO runtime | PASS local synthetic: restart, persistence, concurrency, rollback, valid/invalid/replayed WebAuthn, near-5 MiB and 413 |
| Latest local timing, run 45647012258 | registration/login verify ~2 ms wall; large write 49 ms, read 17–23 ms, rev ~0 ms; not hosted CPU |
| Frontend/build/assets | Pending at review time; do not claim pass |
| Dependency lock | Artifact 15038810793 downloaded and inspected; lockfile v3, 156 package records, direct versions match. Not yet tracked |
| Hotfix 001 | Serialize node:test files to avoid concurrent Wrangler internal listener conflict; unique CI concurrency group per commit to avoid interrupting earlier baseline runs; verification pending |
| Hosted Free-tier CPU/memory, real browser passkey, account quota | NOT VERIFIED |

Phase 1 remains gated. Do not proceed to Phase 2 until latest hotfix CI and asset manifest pass, lockfile is committed, and limitations are accepted.
