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

## Phase 2 CI review / Hotfix 001
- Run 45650324821 (db160d94): original Phase 1 POC PASS, differential test PASS; storage runtime merge fixture failed (400/400 instead of 200/409 because stampChange returns a timestamp). Corrected in 1e48fea4.
- Run 45650418247 (1e48fea4): Phase 1 POC PASS; storage 5/6 passed, actual upstream differential PASS (response rev 9, stored rev 10), local DO/client merge/restart/rollback/import/corruption/schema PASS. SQL evidence before restart: 19 metaQueries, 17 chunkQueries, 49 rowsRead, 49 rowsWritten, 5242180 bytesWritten (attempted writes, not billing). Unit deep-state test failed: Node 26 JSON.stringify accepted 20k nested levels, so relying on RangeError alone is unsafe.
- Hotfix 001 adds explicit max object nesting depth 256, checked before state transition/import. This is an intentional safety deviation from upstream and documented, not an exact parity claim. Test verifies deep write returns 400 and prior data unchanged. No test disabled. New snapshot export and expanded-size tests also pending final CI. Phase 2 remains OPEN; no remote deployment.

## Phase 2 validation snapshot — 2026-11-25
Run [45650542950](https://github.com/nimblelancer/openGym/actions/runs/45650542950), code 8ac737ea: actual Node differential PASS, response revision 9 / stored 10, local DO integration PASS including export/import roundtrip and post-stamping expansion 413 (old revision and data unchanged). Storage suite 5/6 passed, failed deep state test addressed by 367425b2. GNU time log for this failed suite: user CPU 4.23s, system CPU 0.83s, elapsed 15.61s, max RSS 310536 KiB, 32% CPU, exit 1. These are process/child measurements, not per-request workerd CPU or hosted billing. SQL sample before restart: 19 meta queries, 17 chunk queries, 49 rows read, 49 rows written and 5242180 bytes written (attempts, not billing). Latest code commit 367425b2, run [45650632284](https://github.com/nimblelancer/openGym/actions/runs/45650632284) queued/in progress at inspection. No final green claim. Prior Phase 1 POC regression passed on db160d94 and 1e48fea4; API regression passed on db160d94. Await latest all 4 jobs and profiling artifact.

| ID | Prior execution evidence | Final code status |
|---|---|---|
| P2-01 | schema boot/restart/reject PASS | RETEST |
| P2-02 | missing/corrupt/fault PASS | RETEST |
| P2-03 | chunk codec, 5 MiB, expansion 413 PASS | RETEST |
| P2-04 | metadata-only query assertion PASS | RETEST |
| P2-05 | actual client merge concurrent writes PASS | RETEST |
| P2-06 | differential legacy/wid PASS | RETEST |
| P2-07 | response 9/stored 10, wid/ts PASS | RETEST |
| P2-08 | basic invalid inputs PASS, deep input FAIL | HOTFIX RETEST |
| P2-09 | reset/unknown/bookkeeping differential PASS; complete deletion-case review pending | PARTIAL |
| P2-10 | chunk/metadata fault rollback PASS | RETEST |
| P2-11 | restart/shrink/corruption PASS | RETEST |
| P2-12 | fixture profile separation PASS; no production auth | RETEST |
| P2-13 | seed/export/dry-run/idempotency/fault PASS; live restore explicitly deferred | RETEST |
| P2-14 | actual upstream Node differential PASS | RETEST |
| P2-15 | latest 4-job CI | PENDING |
| P2-16 | prior process CPU/RSS, wall/SQL counters recorded; final run and per-request profiling limits pending | PARTIAL |
| P2-17 | no remote operations/upstream app changes; final user acceptance pending | OPEN |

Phase 2 remains OPEN. Do not begin Phase 3 until final CI passes, any remaining explicit coverage gaps are reviewed, and owner accepts. This is a documentation-only commit; code validation is tied to 367425b2. No deployment.

## Hotfix 001 review and deletion/reset coverage — 2026-11-25
- Run 45650632284 (367425b2): storage 6/6, POC 4/4 (2 repeated precheck), upstream API 1084/1084 pass. Frontend pending at initial inspection. Storage job 139333847026: differential rev 9/10, deep-state reject and prior preservation PASS; all storage tests passed, none skipped/cancelled.
- Downloaded and independently opened profiling artifact 15040076423: exit 0, user CPU 6.63s, system CPU 1.35s, elapsed 17.77s, max RSS 313904 KiB, 44% CPU. Matches log. GNU time command/children measures, not isolate per-request CPU or Cloudflare billing. SQL sample before restart: 20 metadata queries, 18 chunk queries, 51 rows read, 49 rows written, 5242180 attempted bytes written; after final restart 3 metadata, 1 chunk query, 4 rows read, 0 writes. P2-16 local evidence collected; actual hosted CPU, memory, DO usage and remaining account quota stay Phase 7 gates.
- Prior runs: 45650324821 POC/API/frontend/assets PASS, storage FAIL fixture; 45650418247 and 45650542950 POC/API PASS, storage 5/6 (deep nesting failure addressed in Hotfix 001); frontend jobs pending at inspection. 
- Expanded actual pinned Node differential test using real frontend mergeStates/stampChange/resetIdsOf: deletion of workout/routine/weigh-in/measurement/favourite, stale concurrent write and conflict merge preserving an independent new workout/setting, intentional add-back, named reset with backdated new workout, legacy missing reset marker, newer reset, restart and full stored/wire parity. No source logic change. New coverage pending CI; P2-09 not yet accepted. Full final 4-job CI and user acceptance P2-17 pending. No Phase 3/deploy.

## Hotfix 001 final review / expanded coverage validation — 2026-11-25

- [45650632284](https://github.com/nimblelancer/openGym/actions/runs/45650632284), 367425b2: completed SUCCESS, 4/4 jobs. POC 4/4, storage 6/6, API 1084/1084, frontend 10101/10101 (898 files), 11195 main-suite passes, plus repeated 2-test precheck. Build 2.11s, native localization, media staging and asset validation pass. Artifact 15040221578 downloaded and checked: 13345 files, 242978231 bytes, 13109 media entries, largest 2091275 bytes, zero oversized, manifest SHA-256 f7924cac4ae9a010184994febf7360d5e4f3dda98cba7bf57a75d064ef86b4f2 matches Phase 1.
- All three prior Phase 2 runs 45650324821, 45650418247 and 45650542950 are now completed FAILURE due only to the storage test job; POC/API/frontend-and-assets all succeeded in each. Fixture error corrected, depth guard verified in Hotfix 001.
- [45651255730](https://github.com/nimblelancer/openGym/actions/runs/45651255730), 51c7b63a: expanded deletion/reset differential suite SUCCESS, 6/6 storage tests, log PHASE2_DELETION_RESET_PARITY PASS. POC job completed SUCCESS. API and frontend-and-assets still IN_PROGRESS at last inspection. Same source implementation as 367425b2; test-only addition + documentation. No additional application hotfix required based on observed results.
- Expanded parity coverage verifies actual Node server vs Worker wire/full stored document at each write, positive deletion stamps for workout/routine/bodyweight/measurement/favourite, stale write 409, upstream merge preserves independent new workout and setting without resurrecting removed records, negative add-back stamps survive stale delete, named reset wipes only recorded entries and retains a new backdated workout, legacy omitted marker preserved, newer reset wins and restart retains full document. P2-09 PASS for this exercised scope.
- Profiling artifact 15040311639 downloaded and ZIP member read: user CPU 5.95s, system CPU 1.24s, wall 18.02s, maximum RSS 310408 KiB, CPU 39%, exit 0. Matches successful expanded storage run. Earlier successful artifact 15040076423: user 6.63s/system 1.35s/wall 17.77s/max RSS 313904 KiB/44%/exit 0. No controlled benchmark comparison. SQL counters on expanded run match Hotfix 001: 20 meta queries, 18 chunk queries, 51 rows read, 49 rows written, 5242180 attempted bytes before restart; 3 meta queries/1 chunk query/4 rows read/0 writes after final restart. Hotfix 001 DO wall time sample: small writes 0–3ms, rev 0–1ms, near-5MiB write 62ms, read 18ms, read after restart 29ms, post-stamping oversize rejection 99ms.
- Local resource design budget: 512 KiB chunk and 8 MiB serialized state cap imply at most 16 data chunks, plus one metadata record per profile; 5 MiB request cap; depth 256. Revision path performs two indexed SELECTs (quarantine flag and metadata), no chunk reads; full write replaces up to 16 prior chunks with up to 16 chunks and one metadata record, before accounting for index/engine overhead. This is a logical operation bound, not billing row counts or a guaranteed latency/CPU budget. No per-request isolate CPU/heap profiling established; aggregate GNU time and wall/SQL evidence satisfy local measurement scope only. Hosted Workers/DO CPU, memory, duration, row usage, storage and shared account quota/cost must be tested before production (Phase 7 staging gate).
- No original backend/frontend/Docker/failover changes, no production API or real data, no remote Cloudflare resources/deploy, no main merge. Owner acceptance required; do not start Phase 3.

### Current P2 acceptance matrix
| ID | Evidence | Status |
|---|---|---|
| P2-01 | local schema boot/restart/unsupported version rejection | PASS |
| P2-02 | missing vs corrupt/unavailable; fault returns 503 | PASS |
| P2-03 | UTF-8 codec, chunk bounds, near-5MiB, expansion 413 preserves data | PASS |
| P2-04 | revision/wid parity and no chunk query on poll | PASS |
| P2-05 | concurrent 200/409 and actual upstream client merge | PASS |
| P2-06 | wrong wid at same rev, optional/null legacy baseRev | PASS |
| P2-07 | response rev 9/stored 10, wid shape/history, ts parity | PASS |
| P2-08 | wire parser unit coverage, runtime malformed/empty/array/depth rejection and preservation | PASS |
| P2-09 | expanded deletion/reset parity marker PASS, hidden bookkeeping and active exclusion, unknown fields | PASS |
| P2-10 | fault after chunk or metadata write, rollback preserves prior state | PASS |
| P2-11 | restart equality, shrink, corruption and persistent quarantine | PASS |
| P2-12 | fixture profiles isolated, unknown and production routes rejected; not production auth | PASS |
| P2-13 | synthetic seed/dry-run/export, checksum, mismatch, idempotency, injected failure, no overwrite/rewind | PASS |
| P2-14 | actual upstream differential and reused sync algorithms; documented intentional bounds/deviations | PASS |
| P2-15 | latest test commit 51c7b63a: storage/POC PASS, API/frontend pending | OPEN |
| P2-16 | successful local CPU/RSS artifact, wall/SQL measurements, logical row/size budget; hosted gate retained | PASS (LOCAL SCOPE) |
| P2-17 | isolation/scope verified; owner acceptance pending | OPEN |

Phase 2 remains OPEN; 15/17 criteria have local evidence, 2 open. Do not propose closure until latest complete CI and explicit owner acceptance. Documentation-only update, runtime code unchanged. 

## Final Phase 2 acceptance — 2026-11-25
**CLOSED — LOCAL STORAGE MIGRATION ONLY.** Owner explicitly accepted local storage conditionally on full CI passing and no outstanding local blocker in the current request. Conditions met for the documented local scope. Phase 3 plan only; implementation not started or authorized.

Final run [45651255730](https://github.com/nimblelancer/openGym/actions/runs/45651255730), attempt 1, tested commit 51c7b63a4b07c8073a3936099c0809fff0556f99: completed SUCCESS, 4/4 jobs and all recorded steps SUCCESS. Subsequent e64a0ea6 and this closure are documentation-only.
| Job | Evidence | Result |
|---|---|---|
| POC | [139336050905](https://github.com/nimblelancer/openGym/actions/runs/45651255730/job/139336050905): 4/4 plus repeated 2/2 precheck | PASS |
| Storage | [139336050131](https://github.com/nimblelancer/openGym/actions/runs/45651255730/job/139336050131): 6/6, PHASE2_DIFFERENTIAL_REV 9 10, PHASE2_DELETION_RESET_PARITY PASS | PASS |
| API baseline | [139336050692](https://github.com/nimblelancer/openGym/actions/runs/45651255730/job/139336050692): 1084/1084 | PASS |
| Frontend/assets | [139336050605](https://github.com/nimblelancer/openGym/actions/runs/45651255730/job/139336050605): 10101/10101 across 898 files, build 2.05s, media staging and manifest pass | PASS |

Total 11195 main-suite tests, excluding repeated precheck. No failures, skips or cancellations reported in POC/storage/API, frontend 898/898 files and 10101/10101 tests. All three final ZIP artifacts downloaded and independently read in Python:
- Asset manifest 15041566100: assets.json SHA-256 f7924cac4ae9a010184994febf7360d5e4f3dda98cba7bf57a75d064ef86b4f2; 13345 files, 242978231 bytes, 13109 media entries (6554 stills, 6554 animations, notice), max 2091275 bytes, zero oversized. Identical to Phase 1; no real asset upload.
- Lockfile 15041480653: package-lock.json SHA-256 3bf5809d991c8c036e1001c4ec7af25bcfecbf0aa9ede2e320591996f2b4fddc; 79766 bytes, lock v3, 156 records, Wrangler 4.168.0, SimpleWebAuthn 13.3.3; computed Git blob SHA-1 0cde099db0392a2583158df6911b3180d20698be matches feature-branch file. All npm ci steps succeeded.
- Profiling 15040311639: storage-process-profile.txt SHA-256 10d895b569fab82b06095c0fd4bbc4a3e5a2034c6a5fe8bd2a4e16ecf2946bcb; user CPU 5.95s, system 1.24s, wall 18.02s, max RSS 310408 KiB, CPU 39%, exit 0. Matches logs; aggregate process/child measurement, not per-request isolate CPU or billing. Before restart SQL sample 20 meta/18 chunk queries, 51 rows read/49 rows written, 5242180 attempted bytes. Logical resource budget in PHASE_02_STORAGE_CONTRACT.md. 
- Compared main e4a68a9 to feature HEAD e64a0ea6 via GitHub compare: all 34 changed paths limited to cloudflare-poc/, docs/cloudflare-migration/ and dedicated .github/workflows/cloudflare-poc.yml; no changes to original backend, frontend, Docker, upstream failover or main. No remote Cloudflare operations, actual account data or Learning Hub changes performed.

### Final local acceptance matrix
| ID | Evidence | Result |
|---|---|---|
| P2-01 | SQLite schema init/restart/unknown version rejection | PASS |
| P2-02 | missing/corrupt/unavailable outcomes; 503 | PASS |
| P2-03 | Unicode codec/512 KiB chunks/near-5 MiB/8 MiB cap rejection | PASS |
| P2-04 | stored rev/wid parity; metadata-only polling | PASS |
| P2-05 | concurrent writes 200/409, actual client merge keeps both edits | PASS |
| P2-06 | optional/null legacy baseRev and mismatched write ID | PASS |
| P2-07 | response revision 9 vs persisted 10, wid shape/history, ts | PASS |
| P2-08 | parser and invalid state/depth protection, no overwrite | PASS |
| P2-09 | deletion/reset differential marker, add-back, offline clock skew, bookkeeping/unknown fields | PASS |
| P2-10 | injected chunk/metadata failures roll back | PASS |
| P2-11 | restart, shrink, corruption/quarantine | PASS |
| P2-12 | synthetic profile isolation, fixture routes only | PASS |
| P2-13 | synthetic seed/export/dry-run/idempotency/checksum/no live overwrite | PASS |
| P2-14 | actual upstream Node differential, reused stamp/merge, documented deviations | PASS |
| P2-15 | final 4/4 jobs SUCCESS, locked deps, assets and baseline regression | PASS |
| P2-16 | verified aggregate CPU/RSS artifact, wall/SQL counters and resource bounds | PASS (LOCAL SCOPE) |
| P2-17 | branch scope checked, owner conditional acceptance now effective | PASS |

17/17 scoped local criteria passed. This supersedes historical pending tables above. Not a full API/security parity or production qualification claim. Phase 1 outstanding local aggregate CPU/RSS evidence has now been collected; per-request workerd CPU/heap remains unmeasured. Hosted CPU/memory/DO duration/row billing/shared quota/R2/asset upload are unresolved Phase 7 release gates. Real browser passkeys and mobile compatibility, account authentication/authorization, live recovery and media remain later phases. Known design deviations: explicit nesting cap 256 and stored-state cap 8 MiB, known corruption 503, no live restore; no truncation. No deploy, production authorization, main merge, or Phase 3 implementation. See PHASE_03.md for proposed plan; separate explicit implementation approval required.

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

19/21 scoped criteria have passing automated/local evidence; P3-04 and P3-21 remain open. This is not Phase 3 closure or production readiness. Owner may now run [manual physical passkey checklist](phases/PHASE_03_MANUAL_PASSKEY.md) (M3-01..09) on the tested code ab4e3782, or documentation-only successor. Use separate local clone/profile, fresh synthetic data and actual UV-capable authenticator; never share setup code, tokens or credential material. Official installed mobile app acceptance remains Phase 4. Hosted HTTPS, per-request/hosted resource usage and shared quota, trusted-source abuse policy, deferred routes/client capability handling, full backup/recovery and exact diagnostic differences remain release gates. No Phase 4 implementation or deployment authorized.

## Owner-authorized sequencing adjustment — 2026-11-26
The owner requested to defer manual physical passkey testing and continue the remaining phases if safe. **Deferred, not waived:** P3-04 physical passkey acceptance M3-01..09 and P3-21 owner acceptance remain OPEN; Phase 3 is not closed (19/21 scoped local criteria passed on CI 45657223798). Automated Phase 3 baseline ab4e3782 stays the validated starting point. Local/synthetic implementation and CI for Phases 4–6, and preparation for Phase 7, may proceed conditionally; no phase may be marked accepted for unexecuted tests. This supersedes earlier sequential "do not start Phase 4" instructions only for local engineering and validation, not a release or closure waiver. If a later change touches authentication/security, rerun Phase 3 regression and any relevant manual checks on the final integrated candidate. Official installed-app acceptance (Phase 4) can also be queued for a consolidated owner testing session, but cannot be replaced by a simulated client. Complete all deferred manual evidence and owner acceptance before Phase 7 integrated acceptance and any production decision. No remote resources, tunnels, hosted staging, actual personal data, main merge or deployment without separate explicit approval. Stop if required mobile compatibility, safe sync or authentication fails; do not weaken security to get green CI. Learning Hub remains out of scope.

## Phase 4 initial engineering checkpoint
Created PHASE_04.md with P4-A..F and P4-01..16, and added a dedicated mobile-contract CI job exercising pinned upstream api/remote/mobile/merge/nudge modules against real local HTTP Worker, with disposable synthetic OS file mock and transport adapter. Tests cover pairing, replay, origin preflight, offline conflict/merge, file mirror, renewal/revocation/re-pair, HTML failure and nudge response. Native OS and WebView not executed, full client-store integration pending. No PASS claims until CI. Existing frontend source and test suite unchanged; CI copies the new fixture into the disposable checkout and removes it afterward. Existing five jobs retained. No Phase 5 implementation, remote resources or deploy.

## Phase 4 engineering follow-up — 2026-11-26
Reviewed 49157bdb and pinned sources. GitHub branch and exact-head run query returned no run for 49157bdb at inspection; latest visible completed CI remains Phase 3 45657223798, not Phase 4 evidence. Added actual upstream store integration fixture using real local Worker, simulated native filesystem and network errors, conflict/dirty tracking, revoked pairing, disconnect guard and stash, separate sequential owner databases, same-account re-pair and deletion/reset/restart. Expanded module fixture with all native origins, real oversized request and mocked CapacitorHttp bridge invoking actual upstream nativeFetch. Added mobile contract/manual checklist document and included both tests serially in mobile-contract CI. These tests are unexecuted; no Phase 4 acceptance claims. Rewind, file write failure integration, timeout, Access isolation, capability UI, actual native health and installed app remain open. No source changes to upstream frontend/backend, no remote resources, no deploy or phase closure.

- Follow-up: added disposable offline SQLite rewind of valid profile rows (integrity hash recomputed, auth untouched), actual store pull recovery, both stash writes failing (must refuse forced disconnect), native-file-only cold boot, origin-scoped synthetic Access headers, disabled-route JSON checks. These are newly authored tests, not executed evidence. Actual installed-app and OS health behavior remain manual. Hosted Access not configured. No production runtime change.
