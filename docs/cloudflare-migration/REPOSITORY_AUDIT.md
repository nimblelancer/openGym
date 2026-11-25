# Phase 0 repository audit

Baseline: e4a68a94c42a3c17cbd560d66ce2e46a7048ab99. Static inspection, not a full line-by-line audit of every module. No tests executed.
## Observations
- api/package.json and frontend/package.json: version 1.4.5. Node HTTP, SimpleWebAuthn 13.3.3, undici, web-push, optional Claude SDK; React 19/Vite/Zustand/Capacitor. 
- api/openapi.yaml: 157 distinct path declarations, 170 HTTP method declarations (static count). Existing api/test/openapi-routes.test.js compares spec and upstream route table. Worker coverage must be explicitly tracked separately.
- api/server.js: imports node:http/fs/crypto/https, loads persistent secret and db synchronously on initialization (~140–250); state files, fs cache and atomic writes (~260–585), signed cookies and bearer sessions (~766–833), in-memory challenge/pairing Maps and timers (~920–960), HTTP handler (~3677 onward). db.json backup and fail-closed corrupted-state behavior must survive migration.
- api/durable.js: temp file + fsync + rename + directory fsync; Workers virtual fs is request-local, not durable.
- api/sync-stamps.js and frontend/src/lib/sync-merge.js: server stamps and client merge rules; keep parity. frontend/src/store/useStore.js sends state, stamped, baseRev and baseWid; receives rev/wid and reconciles.
- api/server.js GET /api/data and /api/data/rev, PUT /api/data (~3133–3230): stale revision or mismatching write id yields 409 with server state; stampPut may advance stored rev an extra step for legacy writers; keep actual response semantics; reject empty/invalid documents; unreadable state yields 503, not empty. MAX_BODY = 5 MiB including request envelope. Upstream notes 2.4 MB document parsing took 31 ms on its host.
- api/server.js POST /api/pair/create and /api/pair/redeem (~2837 onward): owner proof; one live code per user, five-minute TTL, one-use; bearer session issued on redeem. Browser session and native bearer have same signing scheme/version checks. /api/me renews native tokens past half life. CORS preflight and CSRF guards critical.
- api/password.js: scrypt N=32768 r=8 p=1 (source estimates 32 MiB and 50–150 ms on one CPU core). Disable initially; no reduction of KDF strength. Passkey-only is proposed.
- api/media.js: hash-based paths, file streaming, content sniff, MP4 random-access parsing, ownership, quotas, garbage collection, range serving. Default video limit 100 MB, image 2 MB, GIF 8 MB, audio 2 MB. Port deliberately, not a naive R2 wrapper.
- web/nginx.conf.template: same-origin /api routing, separate media handling, security headers and SPA fallback. Worker must never return HTML for API failure.
- docs/MOBILE.md: official app supports custom server and pairing, native bundled exercise media and offline sync. Device acceptance still untested.
- cloudflare/worker.js, wrangler.jsonc, build.sh: existing opengym.ch failover for homelab/static demo, not self-hosted API. Never deploy this configuration, use original author's zone/token or change it.
- scripts/catalogue/stage-media.mjs: copies stills and clips into frontend dist; actual file count and max size pending build manifest. catalogue/media/NOTICE.md: licensed only within openGym, 180 px server assets; not AGPL; no extracting, hotlinking, or repurposing. Preserve notices.
- .github/workflows/test.yml: existing Node 26 frontend/API/MCP/catalogue/routines/image/Android checks. Existing suite not executed here. api/test includes server-pairing, server-data-rev, server-data-wid, server-media, sync-stamps, password, server-config-session and OpenAPI route checks; frontend includes sync-stamps-parity, sync-merge and useStore mobile-remote/rev-rewind tests.

## Core contracts
| Route | Required behavior |
|---|---|
| GET /api/health | truthful JSON health/writability; 503 on unavailable storage |
| GET /api/config | correct flags and signed_in; absent disabled modules as upstream |
| GET /api/me | signed-in user, token renewal, 401 on invalid/revoked |
| POST /api/register/options, /api/register/verify | WebAuthn options + verify; private bootstrap; persistent one-shot challenge |
| POST /api/login/options, /api/login/verify | verify RP/origin/challenge/signature/counter |
| POST /api/pair/create, /api/pair/redeem | owner proof, one-use TTL, native token |
| GET /api/data, /api/data/rev; PUT /api/data | original payload/status/revision/write-id/stamp semantics |
| POST /api/logout, /api/logout/all; /api/account/delete | session invalidation / data deletion consistent with upstream |
| GET /api/nudge-check | native reminder background contract |
| GET/PUT /api/media/{hash}, POST /api/media/missing, /api/media/sweep | private ownership, hash validation, range, quotas, safe GC |

Remaining account/passkey/device-link/activity paths must be mapped from actual client calls in Phase 1/3. Full 170-operation parity not claimed. Test unknown and disabled routes, not just success cases.
