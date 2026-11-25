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
