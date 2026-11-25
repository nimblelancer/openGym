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
