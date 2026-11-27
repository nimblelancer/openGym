# Phase 6 — Privacy and recovery (local engineering)

Date: 2026-11-27. Branch: feat/cloudflare-migration.
Entry baseline: Phase 5 scoped freeze 85b3e00416668b9bfd00aec35a49d5c1cc8c97ef, CI 46033465083. Owner approved D1–D4 and local Phase 6 implementation. Prior phases 3–5 remain OPEN for mandatory deferred acceptance. This plan does not authorize deployment.

## Master-plan scope

Backup/restore, quota ledger, restrictive registration, secrets, failure paths. Exit requires verified restore and backup off provider, abuse/quota tests. Local tests cannot qualify real hosted quotas, actual devices, independent operational backup or production security. Reuse Phase 2 atomic storage, Phase 3 auth and Phase 5 private media/retention; do not change frozen frontend/native behavior.

## Work packages

| Work | Deliverable |
| --- | --- |
| P6-A | Owner-approved freeze, privacy/threat inventory, backup/restore contract, explicit exclusions |
| P6-B | Versioned authenticated encrypted recovery archive, exact known state/media and retained inventory verification, bounded parsing, separate recovery key, corruption/wrong-owner rejection |
| P6-C | Independent durable synthetic disk backup and restore, interruption/stale revision/restart tests, source preservation, backup/key recovery runbook and off-provider qualification |
| P6-D | Read-only quota ledger distinguishing committed state, media, retained objects and known device-only data; bound resources and reconcile inventory; abuse/fault tests |
| P6-E | Restrictive registration, session/secret rotation, fail-closed recovery, privacy and unsupported capability audit; no auth bypass or secret export |
| P6-F | Integrated CI, profiles, artifacts, acceptance matrix and owner decision; no automatic phase transition |

## Acceptance criteria (initial)

| ID | Requirement | Entry status |
| --- | --- | --- |
| P6-01 | Approved freeze and scoped privacy/recovery contract | DOCUMENTED |
| P6-02 | Versioned authenticated encrypted archive, key separate from payload and auth secrets | OPEN |
| P6-03 | Exact known snapshot/inventory integrity incl retained and local-only media; refuse incomplete/mismatched input | OPEN |
| P6-04 | Reject malformed, wrong owner/key, tampered, truncated, oversized archive; bounded work | OPEN |
| P6-05 | Durable independent backup write/readback, key recovery and failure handling | OPEN |
| P6-06 | Restore compatible state/media on independent local destination; no false commit on failure | Historical P5 scoped evidence; P6 integration OPEN |
| P6-07 | Stale revision/owner and interrupted restore recovery; source never erased | Historical P5 scoped evidence; P6 integration OPEN |
| P6-08 | Quota ledger verified against actual inventory, retained bytes count, no false free capacity | OPEN |
| P6-09 | Quota/abuse boundary and invalid/unavailable inventory fail closed | OPEN |
| P6-10 | Restrictive registration, secret configuration, key rotation, session revocation regression | Historical P3 scoped evidence; P6 audit OPEN |
| P6-11 | Privacy, truthful reset/erase, no secret leakage, recovery hold and unsupported feature audit | OPEN |
| P6-12 | Local CI integration and profiling/artifact evidence, frozen scope comparison | OPEN |
| P6-13 | Independent off-provider backup and key custody, actual restore rehearsal | DEFERRED hosted/owner gate, not waived |
| P6-14 | Actual hosted quota/CPU/storage/cost and abuse qualification | DEFERRED Phase 7, not waived |
| P6-15 | Owner sign-off, deferred gates disposition and authorization for next phase | OPEN |

## Initial design decisions (local proof, not release format)

Keep the archive codec outside Worker request paths. No auth credentials, session tokens, passkeys, secret configuration or raw databases as export inputs; allow only explicitly selected workout-state snapshots and known media inventory. A caller must establish source ownership and enumerate all required snapshots and retained objects; codec verifies supplied known inventory, cannot discover devices or identify arbitrary sensitive fields in state. Separate random 256-bit recovery key, AES-256-GCM with version-bound AAD; reject without authenticated payload. Bound total archive/individual file/snapshot count, refuse oversize instead of truncating. This increment deliberately bounds memory for synthetic qualification; production-capacity streaming/export design and independently durable key storage remain open. Treat retained and local-only bytes as preservation obligations, not upload authorization. Quota ledger is read-only conservative accounting of supplied owner-bound inventory, not Cloudflare billing/available account capacity or deletion permission. No restore writes in first increment; later independently qualify actual destination revision, ownership, capacity, safe interrupted restore and verified readback. All implementation claims require tests; no production secrets/data or backup bytes in CI artifacts/logs.

## Phase 6 initial implementation — 2026-11-27

Owner approval/freeze was committed first at 260daacd22b7c903c0148fad6ff5ff1915bff7d6. Candidate 543fd856973577397b1893ec5e973b29db3bc6df, [CI 46037351112](https://github.com/nimblelancer/openGym/actions/runs/46037351112), initially QUEUED. Phase 6 is OPEN, no acceptance result yet for new tests.

- P6-B: cloudflare-poc/src/recovery/archive.js implements a local-only, versioned AES-256-GCM envelope (fresh 96-bit nonce, 128-bit tag, version-bound AAD, caller-provided independent 32-byte key), strict expected owner, server snapshot revision/write identity, one server plus explicit device/stash snapshots, known media and poster/active references using pinned walkers, unique inventory rows, canonical base64, SHA-256 and MIME/size agreement. Retained and device-only files may be included without upload authorization. Reject missing known refs, conflicting metadata, invalid snapshot structure, wrong owner/key, tamper and oversize rather than truncate. Bound envelope to 16 MiB, individual declared file to 100 MiB (subject to smaller aggregate limit), 32 snapshots, 1000 inventory rows, bounded per-state JSON structure. A synthetic proof only: no production-capacity archive, file format commitment, arbitrary secret scanning, discovery of unknown/malformed source records beyond pinned reference traversal, durable write or restore operation. A caller must supply complete known snapshots/inventory and an independent key; complete account inventory and cutover flags always false. No secrets, archive bytes or keys logged or uploaded.
- P6-D: read-only inventory ledger deduplicates supplied hashes by requiring unique rows, counts server media bytes/objects including retained files, device copies and device-only bytes, reports missing server references and per-file media cap plus 200 MiB/500-object configured limits. Counts are for supplied known inventory, not actual available quota or billing; actual authenticated R2 reconciliation, committed-state byte accounting, account-wide quota and abuse/operation budget tests remain OPEN. No mutation or deletion.
- Five authored Node tests in cloudflare-poc/test/privacy-recovery.test.mjs: exact known archive roundtrip, wrong key/owner/version and tamper/truncation/size failures, missing/conflicting/foreign snapshot and byte integrity failures, quota/retention and 501-object bound, oversized 8 MiB+1 original preserved and excessive/deep/cyclic input rejected. Fixtures are synthetic byte-integrity samples, not validated playable files. New eighth privacy-recovery job uses existing pinned checkout/setup-node actions, Node 26, no secrets, no remote resources, GNU time profile artifact only; seven previous jobs unchanged. All eight jobs, profiles and artifacts require review.
- Compared to frozen Phase 5 85b3e004: 4 ahead, 0 behind at tested candidate, only new Phase 6 module/test, workflow and five migration documents. Dependency lock Git blob 0cde099db0392a2583158df6911b3180d20698be unchanged. No edits to runtime/auth/media, frontend/native, upstream API, frozen tests or dependencies. Phase 5 scoped CI 46033465083 remains last verified green checkpoint until new run reviewed.

| Criterion | Current status |
| --- | --- |
| P6-01 | DOCUMENTED, owner sequencing authorized |
| P6-02 | Authenticated archive authored; CI REQUIRED |
| P6-03 | Supplied known inventory verification authored; CI REQUIRED, actual complete inventory OPEN |
| P6-04 | Negative cases and bounded proof authored; CI REQUIRED |
| P6-05 | OPEN durable independent disk backup/key recovery |
| P6-06 / P6-07 | OPEN Phase 6 codec integration against independent local Worker and recovery faults; historical P5 scoped evidence retained |
| P6-08 / P6-09 | PARTIAL authored known-inventory accounting; CI REQUIRED, actual quota reconciliation, state bytes and abuse OPEN |
| P6-10 / P6-11 | OPEN restrictive registration/secrets/privacy and unsupported capability audit; historical P3/P5 evidence retained |
| P6-12 | Eight-job workflow queued; CI/artifact/profile verification REQUIRED |
| P6-13 / P6-14 | DEFERRED off-provider and hosted acceptance, not waived |
| P6-15 | OPEN owner final sign-off |

P6-A documented, B/D initial candidate authored, C/E/F remain outstanding. Next: review 46037351112 all eight jobs, seven artifacts if emitted, profile and frozen diff. Fix confirmed failures only. If initial CI passes, qualify durable local disk write/readback using the new codec, separate recoverable synthetic key, independent local Worker restore and actual quota reconciliation, then restrictive registration/secret rotation/failure/abuse tests and privacy runbook. Do not treat temporary archives as off-provider backup. Carry D1–D4 and every deferred P3/P4/P5 gate including original declared-length HTTP and installed-client legacy reconciliation. No phase closure, Phase 7, production, main merge, native rebuild, real-data cutover, remote resources, destructive purge or Learning Hub changes.
