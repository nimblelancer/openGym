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
