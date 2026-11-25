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
