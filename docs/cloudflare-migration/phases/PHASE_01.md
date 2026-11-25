# Phase 1 — Cloudflare Foundation & POC

Base: Phase 0 commit 83f41c30f757cd8b35fdde4848af5a2aa0e0d5f0. Implementation only; no production approval.
- Separate cloudflare-poc/ package, Wrangler 4.168.0, SimpleWebAuthn 13.3.3; local SQLite DO; no D1, R2, remote bindings, routes, secrets or deployment.
- Fetch routing forwards state/auth operations to DO. Node HTTP adapter tests a representative echo handler, not server.js. Full original backend cannot simply be imported due to fs/init/timers. Fetch-native path preferred pending results.
- DO SQL chunks 512 KiB to avoid row-limit variance; revision metadata separate, transactionSync compare and commit, rollback and restart tests. Uses upstream stampPut; intentionally stricter POC baseRev/baseWid validation, not contract-complete.
- Synthetic WebAuthn registration/authentication test includes actual ES256 signature, bad challenge and replay. No production authentication, owner bootstrap, session or mobile implementation.
- Local 5 MiB envelope test, local wall timing (not CPU), asset manifest and upstream regression jobs. Hosted CPU/memory and browser/device compatibility deferred to explicitly approved staging. Direct dependencies pinned, lock not generated yet.
- CI separate, read-only repository permissions, no credentials or deployment; fork Actions may require enablement. The existing upstream workflow and app source remain unchanged.

## Gate
Implementation delivered; validation PENDING until CI runs. Authoring container DNS/network unavailable for GitHub clone and npm registry. No runtime test has been claimed PASS. Require local Worker boot, DO restart, rollback, conflict, valid/invalid synthetic auth, large-state, asset manifest and baseline checks. Review any failures before starting Phase 2. Actual browser passkey and cloud CPU/billing not proven by local tests.

## Review follow-up
Separated Node HTTP adapter from Fetch/DO runtime into its own Worker and local test. CI pins setup-node to upstream's reviewed revision and publishes generated dependency lockfile and asset manifest as artifacts. No run was listed immediately after implementation commit; fork Actions availability is unconfirmed. No test status upgraded.

## Hotfix 001
CI run 45647012258 exposes parallel Wrangler internal port collision (not an HTTP API compatibility failure). Run files sequentially; keep adapter and Fetch/DO isolated, and let earlier regression jobs finish when a new commit is pushed. Previous combined POC passed; latest Fetch/DO and 1084 upstream API tests passed. Frontend/asset result pending. Temporary lock evidence script allows exact public npm lockfile retrieval from job logs; remove it once the verified lockfile is tracked. Latest hotfix not yet validated.

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
