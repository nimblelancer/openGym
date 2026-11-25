# Progress
## 2026-11-25 — Phase 0
- Read main at e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 and inspected core server, API spec, media, auth, sync, mobile docs, existing failover and CI.
- Static feasibility: conditional GO for Phase 1 local POC, not production; full migration uncertain.
- Created documentation only on feature branch. No application code changes, CI workflow edits, secrets or Cloudflare resource changes. No local or remote automated tests executed.
- Next: owner review of proposed MVP and deferred modules; Phase 1 local runtime/DO/passkey/sync-size spikes and CI baseline. Stop if hard free-tier or compatibility gates fail.

## 2026-11-25 — Phase 1 implementation
- Added isolated local-only Worker/DO POC, Node HTTP adapter and Fetch routes, synthetic WebAuthn verification, atomic chunk storage/restart/rollback tests, near-5 MiB test, asset manifest script and dedicated CI.
- Runtime and upstream tests pending: authoring environment cannot resolve GitHub/npm registry. CI outcome must be inspected before declaring Phase 1 PASS. No real cloud resources, deployment, credentials, production API or Learning Hub changes. See phases/PHASE_01.md.

- Review follow-up: isolated HTTP adapter runtime and added CI lockfile/manifest artifacts. CI execution still unverified; no run returned at inspection time.

## Phase 1 CI review / Hotfix 001
- Run 45646783644: combined POC passed, API/frontend cancelled. Replacement run 45647012258: upstream API 1084/1084 passed; Fetch/DO and state tests passed, isolated HTTP adapter failed startup with Address already in use (socket direct:1:default). Frontend still running at inspection.
- Serialize test files via --test-concurrency=1, use commit-specific CI concurrency, and add temporary public lockfile log handoff (validated npm registry only, SHA-256 + chunks). Existing lock artifact downloaded and inspected; actual commit pending. New run must verify fix; no deploy or upstream code changes.

## Hotfix 001 review — 2026-11-25
- Run 45647870333 (39bfda40): SUCCESS, 3/3 jobs. POC 4/4 tests (plus initial 2/2 unit precheck), isolated Node adapter now passes. API 1084/1084, frontend 10101/10101 across 898 files, native localizations, build, media staging and manifest all pass. Previous run 45647012258 also passed API/frontend/assets; only isolated adapter startup failed there.
- Manifest artifact 15039481107 inspected: 13345 assets, 242978231 bytes, 13109 media entries (6554 stills, 6554 animations, notice); largest 2091275 bytes; oversized empty. Under 20000 files/version and 25 MiB/file. No actual cloud asset upload verified.
- Lock artifact 15039231096 inspected independently against earlier artifact 15038810793; both SHA-256 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc, 79766 bytes, lockfile v3, 156 package records. Reconstructed CI log bytes matched artifact SHA-256; exact lockfile committed. Direct versions Wrangler 4.168.0 and SimpleWebAuthn 13.3.3. CI now uses npm ci, temporary handoff removed.
- Local timing (not CPU): registration 2 ms, login 3 ms, near-5 MiB write 63 ms, read 21 ms, read after restart 28 ms, revision ~0 ms. Hosted Free-tier CPU/memory and account quota not verified. Real passkey/browser/mobile acceptance, production data and media security not tested.
- Phase 1 remains open until the locked-install commit's CI is verified. No production deployment or remote Cloudflare resources; no changes to upstream app code or Learning Hub.

## Final locked-dependency review — 2026-11-25
- Reviewed run [45648776762](https://github.com/nimblelancer/openGym/actions/runs/45648776762), attempt 1, head 17404f1ad3bd8edfa914e93a7de6f12ba4f339e0. POC job 139327108055 SUCCESS: npm ci succeeded, 2/2 precheck and 4/4 POC tests (including isolated Node adapter and local Fetch/DO restart, atomic conflict, rollback, synthetic WebAuthn, near-5 MiB state and 413). API job 139327108536 SUCCESS, 1084/1084 passed, zero failures/cancellations/skips.
- Downloaded actual artifact 15038203367 and opened ZIP in Python; package-lock.json SHA-256 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc, 79766 bytes, version 3, 156 package records, Wrangler 4.168.0, SimpleWebAuthn 13.3.3. Matches previously verified committed lockfile. Locked installation reproducibility PASS.
- Latest local timings (wall time only): WebAuthn registration 1 ms, login 2 ms; near-5 MiB write 50 ms, read 17 ms, read after restart 22 ms, revision ~0 ms. No separate CPU/peak memory profiling or hosted Free-tier measurements performed. Keep these limitations explicit; no production feasibility claim.
- At inspection, frontend-and-assets job 139327108315 still IN_PROGRESS, npm ci succeeded, npm test running; build/manifest not yet executed in this run. Prior successful run 45647870333 remains valid evidence for unchanged upstream frontend and assets, but does not satisfy the agreed final all-jobs gate. Overall run in progress. Phase 1 OPEN (final validation pending), Phase 2 plan only, implementation not authorized. No runtime/code/workflow changes in this documentation commit. No remote resources or deployment.

## Final acceptance — 2026-11-25
**Status: CLOSED — LOCAL FUNCTIONAL POC ONLY. Performance qualification remains open. Phase 2 implementation NOT STARTED.**

Final run [45648776762](https://github.com/nimblelancer/openGym/actions/runs/45648776762), attempt 1, tested commit `17404f1ad3bd8edfa914e93a7de6f12ba4f339e0`: completed SUCCESS, all 3 jobs successful. Subsequent commit 48dbfd37 changed documentation only; closure changes documentation only as well.

| Job / validation | Evidence | Result |
|---|---|---|
| POC | [139327108055](https://github.com/nimblelancer/openGym/actions/runs/45648776762/job/139327108055); npm ci; 4/4 tests and repeated 2/2 precheck | PASS |
| API baseline | [139327108536](https://github.com/nimblelancer/openGym/actions/runs/45648776762/job/139327108536); 1084/1084 | PASS |
| Frontend baseline | [139327108315](https://github.com/nimblelancer/openGym/actions/runs/45648776762/job/139327108315); 10101/10101 across 898 files | PASS |
| Native localizations / Vite build / media staging / manifest | Same job, all steps successful; Vite 2.62 s | PASS |
| Lockfile integrity | Artifact 15038203367: exact ZIP member SHA-256 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc, Git blob SHA-1 0cde099db0392a2583158df6911b3180d20698be matches HEAD file; 79766 bytes, lock v3, 156 records, Wrangler 4.168.0, SimpleWebAuthn 13.3.3 | PASS |
| Asset manifest | Artifact 15039272373: assets.json SHA-256 f7924cac4ae9a010184994febf7360d5e4f3dda98cba7bf57a75d064ef86b4f2; 13345 files / 20000; 242978231 bytes total; largest 2091275 bytes / 25 MiB; 13109 media entries (6554 stills, 6554 animations plus notice); zero oversized | PASS |
| Local DO functional tests | Fetch routing, atomic conflict, rollback, restart, UTF-8 chunks, near-5 MiB state roundtrip, oversized rejection, synthetic signed WebAuthn and replay rejection; separate Node HTTP echo adapter | PASS |
| Local latency measurements | Registration 1 ms; login 2 ms; large write 50 ms; read 17 ms; restart read 22 ms; revision ~0 ms (wall-clock only) | PASS for observed local latency |
| Dedicated local CPU and peak-memory profiling | Not performed; original master-plan CPU/memory spike not fully measured. Carry forward to Phase 2 P2-16 (profile where supported, explicitly document evidence and any tooling limits); not a PASS or waived production requirement | OPEN |
| Hosted Free-tier CPU/memory/DO duration/rows, real traffic and shared account quotas | No hosted resources created; must verify with approved staging in Phase 7, before production. R2 costs/remaining allowance, actual asset upload and real-device auth/sync also unverified | DEFERRED / NOT VERIFIED |

Total main suites: 11189 passed (4+1084+10101), excluding repeated 2-test precheck. No test skips or failures reported in POC/API; frontend all 898 files and 10101 tests passed.

Decision: the specifically agreed final local functional POC gate (all jobs green, locked install, manifest and synthetic runtime behavior) is satisfied, so close that scope only. The original broader CPU/memory performance requirement is not fully satisfied; retain explicit outstanding qualification and staging gates, not an unconditional full feasibility or production approval. No claim that local wall time equals CPU time or that the Free plan will always cost $0. No production/mobile API, real-device acceptance, remote deploy, Cloudflare resource creation, main merge or Learning Hub changes. Phase 2 detailed plan is ready; start only on separate explicit user approval. 

## Phase 2 implementation — 2026-11-25
- Added isolated storage-worker and local Wrangler configuration, pure upstream-compatible state transition, SHA-256 chunk codec, versioned SQLite profile storage, async store methods, synchronous transaction compare/write, corruption quarantine, metadata-only poll, synthetic snapshot seed/dry-run/idempotency. Existing profile restore intentionally refused (409); full live restore deferred Phase 6, no rewind.
- Added unit tests, actual Node backend differential fixtures with fixed clock and mapped random write ids, local DO runtime including upstream client merge, fault injection/restart/corruption, import fixtures, and dedicated storage CI job with GNU time process CPU/RSS evidence. Existing Phase 1 tests retained; upstream API/frontend/asset jobs unchanged. No dependency changes.
- Intentional differences: known corrupt state revision is 503, output storage cap 8 MiB (reject, never truncate), explicit seed only, no production auth/routes. Metadata polling cannot discover unseen chunk corruption without full read; detected corruption is quarantined persistently. Local profile metrics are aggregate SQL cursor counts and attempted writes, not hosted billing; GNU time is aggregate child process evidence, not per-request CPU/memory. 
- All new tests authored, not yet executed/verified; user acceptance pending. No production deployment, main merge, actual personal data or Cloudflare resources. P2-01–P2-16 pending CI and review; P2-17 pending safety review/user acceptance. Do not advance to Phase 3.

- Pre-CI review follow-up: corrected upstream stampChange fixture to use mutated state and returned timestamp, made schema rejection check exact error outside nested transaction, added explicit legacy response-vs-stored revision divergence, deep nesting and post-stamping storage-cap tests, logged SQL metrics before restart, retained profiling output on failed tests. Runtime evidence pending.

- Added fixture-only snapshot export with SHA-256, exact export/import roundtrip and missing/corrupt export rejection; runtime oversized post-stamping write verifies 413 without changing the previous revision or data. Import only seeds an empty trusted fixture or returns idempotent success for identical data; differing seed returns 409, unsupported restore mode returns 400. Full restore of existing profiles is deliberately deferred to Phase 6. Added source inventory/contract notes. No real credentials or data. All new acceptance tests await CI evidence.
