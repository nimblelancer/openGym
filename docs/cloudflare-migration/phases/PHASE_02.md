# Phase 2 — Storage Migration (detailed plan only)

Date: 2026-11-25. Upstream baseline: e4a68a94c42a3c17cbd560d66ce2e46a7048ab99 (v1.4.5).
Phase 1 code baseline: 17404f1ad3bd8edfa914e93a7de6f12ba4f339e0. Branch feat/cloudflare-migration.
Status: PLANNED, NOT STARTED. Prerequisites: final locked-install run 45648776762 all jobs green, review local measurement limitations, document Phase 1 closure, obtain explicit approval to implement. No remote resources or production data.

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
