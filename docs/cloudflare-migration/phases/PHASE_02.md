# Phase 2 — Storage Migration (detailed plan only)

Date: 2026-11-25. Upstream baseline: e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 (v1.4.5).
Phase 1 code baseline: 17404f1ad3bd8edfa914e93a7de6f12ba4f339e0. Branch feat/cloudflare-migration.
Status: IMPLEMENTATION STARTED; VALIDATION PENDING. Final locked-install run 45648776762 is SUCCESS; Phase 1 local functional POC is closed. Dedicated local CPU/peak-memory qualification remains OPEN (carry forward to P2-16; hosted measurements Phase 7). User approved Phase 2 implementation in local-only scope. No remote resources or production data.

## 1. Objective and non-goals
Replace the synthetic POC state operations with a reusable asynchronous storage layer and upstream-compatible state transition core. Preserve the upstream JSON document semantics, revisions, write ids, deletions, reset markers, unknown fields and offline merge. Keep Docker upstream unchanged. Test in local workerd with disposable data only.
Not in scope: production API routing, browser/phone auth, account bootstrap, session tokens, real user migration, media/R2, background notifications, external integrations, deploy, paid plan, changes to Learning Hub, or main merge. Test-only routes must remain loopback and use synthetic trusted profile ids; no real client access or production bypass.

## 2. Baseline evidence and contract gaps
Read pinned api/server.js lines 260–285 (readStateStrict, forClient), 505–584 (writeStateAs, commitState), 986–1035 (readBody), 3133 onward (GET /api/data and revision endpoint), 3177–3225 (PUT /api/data). See api/sync-stamps.js, frontend/src/lib/sync-merge.js, frontend/src/store/useStore.js and tests server-data-rev, server-data-wid, server-data-reset, server-data-rev-endpoint. Do not replace upstream stampPut or invent a merge algorithm.
| Current POC gap | Required Phase 2 behavior |
|---|---|
| Requires baseRev and baseWid unconditionally | Preserve upstream optional legacy overwrite when baseRev is absent/null; if supplied, reject stale rev; compare baseWid only when baseRev is present, baseWid is a string and stored wid exists. Explicitly test intentional overwrite and no lost data for modern clients. |
| Conflict body returns internal state | Return 409 {error:'conflict',rev,state:forClient(cur)}; strip _unstamped and _prior from external reads and conflict response, retain internally. |
| PUT response omits ts | Preserve {ok:true,ts:state._ts or null,rev:oldRev+1,wid}; persisted _rev may be oldRev+2 if report.changed, next GET/rev returns actual stored revision. |
| Uses UUID write id | Preserve server-owned random 8-byte hex wid shape and last 50 string ancestors, ignore client-assigned bookkeeping. |
| Only basic validation | Preserve empty-state rejection, invalid top-level arrays, invalid workouts/routines list types, filtering malformed list entries, deep nesting/RangeError handling, bounded JSON envelope 5 MiB, content-type and JSON errors (413/415/400) where applicable. |
| Missing reset guard | Keep monotonically advancing resetAt and resetIds rules; preserve deletes, edits, stamps and unknown legacy fields. |
| Missing vs unreadable conflated | Missing only returns {state:null,rev:0}; corrupt/partial/digest mismatch yields explicit storage error/503 for state read/write, never empty or successful overwrite. For revision endpoint record intentional fail-closed behavior on corruption rather than silently returning zero; differential test documents this safety deviation from upstream cache fallback. |
| State keyed only by synthetic singleton | Introduce storage namespace for trusted profile key and verify isolation; do not use caller supplied id as authorization. Phase 3 supplies authenticated profile identity. |
| POC revision query may return metadata with corrupt body | Metadata-only revision polling by design, verify metadata integrity without loading chunks; detect body corruption on full read and write, never report known corrupt state as valid. |

## 3. Proposed modules and storage contracts
Keep new modules under cloudflare-poc/src/storage/ and cloudflare-poc/src/sync/ or a clearly isolated local-only package with existing lockfile. No changes to upstream app or failover config. Prefer Fetch-native forwarding with heavy operations inside DO, since Phase 1 only proved a representative Node HTTP handler.
- StateStore async boundary: read(profile), revision(profile), compareAndWrite(profile, request, trusted context), importSnapshot(profile, snapshot, explicit mode). Return discriminated missing/ok/corrupt/unavailable or structured result. Separate pure transition from I/O. No read-then-write across independent awaits. Only synchronous transaction body may inspect current version, apply pure logic and persist. Caller cannot obtain a success before durable commit.
- SQL design: schema version table; profile_state(profile_id PK, rev, wid, byte_count, chunk_count, digest/check metadata, updated_at); profile_chunks(profile_id, idx, bytes BLOB, composite PK). Exact column definitions to be reviewed against workerd limits. 512 KiB UTF-8 BLOB chunks, contiguous order, byte count validation, strict decoding, no partial return. Versioned schema migration within transactional initialization; reject newer unknown schema, no destructive auto-reset.
- Use SHA-256 for snapshot/transfer checks; for transactional integrity avoid awaiting asynchronous hash within transactionSync (compute using synchronous compatible crypto or validate precomputed bytes and recheck current revision under lock; prove approach with tests). Metadata + chunks written in one transaction. Distinguish missing row vs malformed metadata, absent chunk, duplicate/out-of-range index, invalid JSON/UTF-8, byte/digest mismatch; safe bounds on total chunk count and serialized output. Preserve source 5 MiB request cap; state after stamping may be larger than input, budget explicitly and fail without truncation if limit exceeded.
- Revision polling reads metadata only, no chunk query/decode; instrument SQL calls in tests. Avoid parsing whole documents in thin Worker. Verify corruption/error semantics and avoid cached state invalidation races. Record row reads/writes and bytes to evaluate quotas; no guarantee of cloud CPU/memory based on local timing.

## 4. Work packages (sequential; small commits)
P2-A: Contract baseline and differential fixtures. Read upstream tests and exact wire payloads, define error precedence, deterministic clock/wid generators for comparisons. Document intentional safety deviations. Add tests first, keep existing POC suite intact.
P2-B: Storage interfaces and chunk codec. Async boundary, pure codec, missing/corrupt outcomes; test multilingual Unicode, 512 KiB edges, chunk ordering, empty/invalid data, size bounds, schema version, metadata-only queries.
P2-C: SQLite DO persistence and transactions. Implement profile-keyed metadata/chunks, non-destructive initialization, atomic compare/write, no cross-profile access, durable acknowledgement. Test parallel writers, same rev different wid, injected failure after first chunk/metadata, restart/eviction where locally possible and shrinking document (no orphan chunks).
P2-D: Sync parity. Extract/adapt pure transition from baseline commitState/readBody/forClient; reuse stampPut, compare legacy and modern cases with upstream Docker-style Node test server via deterministic fixture replay. Verify actual stored state and wire payload, allow only documented timing/id normalization. Include client merge roundtrip with independent edits, deleted entries, reset, rollback/rewind, unknown fields, active omitted. No production routes yet.
P2-E: Import fixtures and verification. Synthetic upstream db.json/state-uid.json shape inventory; export/import state snapshot with schema version, digest, byte/chunk limits, trusted uid mapping, rev/wid ancestry and reset marks preserved. Explicitly distinguish initial seed vs restore into existing profile; refuse overwrite of existing data in initial import; dry-run report and transactional/idempotent apply, test malformed/mismatched input and mid-import failure. No copying real credentials, secrets, media or real phone data; full account/media backup belongs to Phase 6. No silent live revision rewind.
P2-F: CI and local acceptance. Add dedicated storage tests to local CI; retain sequential Wrangler tests and npm ci lockfile. Run POC, upstream API, frontend and asset manifest. Record per-operation local wall-time, memory/CPU profiling if available (distinguish measurement scope; hosted metrics deferred), row usage, failure/rollback evidence, actual commit and artifact links. Review regressions, apply narrowly scoped hotfixes if needed. User acceptance before Phase 3.

## 5. Acceptance matrix
| ID | Required evidence |
|---|---|
| P2-01 | Versioned schema boots empty; repeated init preserves data; unsupported schema fails closed |
| P2-02 | Async interface returns missing separately from corruption/unavailable |
| P2-03 | UTF-8 roundtrip, chunk edges, near-5 MiB request and post-stamping size handled without truncation; oversize rejected |
| P2-04 | GET state and revision metadata match stored rev/wid; revision path never reads chunks |
| P2-05 | Two simultaneous modern writes at same base produce one success and one conflict; client merge and retry keeps both edits |
| P2-06 | Mismatched baseWid at same rev rejected; legacy optional fields behave as upstream |
| P2-07 | Response revision vs persisted revision divergence for legacy report.changed tested; wid shape/history and ts parity |
| P2-08 | Invalid content-type/JSON/empty/array/deep documents cannot erase valid data; malformed entries filtered as upstream |
| P2-09 | _unstamped/_prior hidden externally, active excluded; delete/reset/unknown field semantics match upstream |
| P2-10 | Injected mid-transaction failure leaves prior bytes and metadata unchanged; no false 200 |
| P2-11 | Restart preserves exact bytes/state/revision; shorter writes remove old chunks; corruption fails closed |
| P2-12 | Profile isolation; trusted identity boundary test-only, no public auth bypass |
| P2-13 | Synthetic import dry-run and commit, idempotency, checksum, no silent overwrite/rewind; corrupt fixtures fail without changes |
| P2-14 | Upstream differential tests pass (all intentional differences documented), sync-stamps parity retained |
| P2-15 | Latest commit full POC/API/frontend/build/assets CI passes with npm ci; no disabled checks |
| P2-16 | Local performance/row budgets recorded with explicit measurement limits; hosted CPU/quota remains staging gate |
| P2-17 | No changes to original Docker/frontend/failover/main/Learning Hub; no remote resources/deploy; user approves next phase |

## 6. Stop / rollback criteria
Stop on lost acknowledged writes, corrupt state returned as empty, failed atomicity, API compatibility regression, unbounded payload/memory, unmanageable quota or authentication boundary violations. Fix locally or present alternatives; do not bypass tests. Roll back code by reverting feature-branch implementation commit, not rewinding any live data. All fixtures disposable. No production authorization in Phase 2.

## 7. Expected deliverables
Storage contract and schema docs, state transition and codec modules, local DO adapter, differential/transaction/import fixtures and tests, CI evidence and updated PROGRESS / VALIDATION_MATRIX / phase report. This file is a plan, not implementation. All P2 acceptance checks NOT RUN.

## Phase 1 handoff
Final tested code baseline remains 17404f1ad3bd8edfa914e93a7de6f12ba4f339e0. Subsequent commits are documentation only. Local functional closure does not waive performance qualification: explicitly attempt CPU and peak-memory measurement in P2-16, record measurement scope/tooling limitations, and keep hosted validation as a blocking release gate. All P2 implementation and tests remain NOT RUN.

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
