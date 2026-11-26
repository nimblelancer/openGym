# Phase 3 physical passkey acceptance — localhost only
Status: READY FOR MANUAL RUN; NOT RUN by owner. This is not production or Phase 4. Use Node 26 as CI, Chrome/Edge current, Windows Hello or a physical FIDO2 security key with user verification. A real passkey may be saved or synced by the chosen provider; use a disposable test credential, not an existing openGym account. Do not delete unrelated localhost credentials.
## Setup (Windows terminal or WSL)
1. Use a fresh local clone of the feature branch; do not reuse Learning Hub directory or data. Example: git clone --branch feat/cloudflare-migration --single-branch https://github.com/nimblelancer/openGym.git opengym-phase3-local
2. cd opengym-phase3-local/cloudflare-poc; node -v (26.x); npm ci --no-audit --no-fund.
3. node test/manual-passkey.mjs
4. Open the printed http://localhost:<port> in a dedicated browser profile (not regular browser profile; cookies are host-scoped, not port-scoped). Use Windows browser for Windows Hello. If WSL localhost forwarding does not work, run the same commands with Windows Node instead; never expose port on LAN or use a tunnel.
5. The terminal prints a one-time disposable setup code. Enter only in local test page, never share it or screenshots containing it. The helper starts Wrangler --local with fresh random secrets and unique temporary persistence, then a loopback-only proxy; no Cloudflare credentials needed. No change to Worker API route list.
## Acceptance checklist
| ID | Action | Expected |
|---|---|---|
| M3-01 | Register test owner with printed setup code, complete real native UV prompt | register options/verify 200; actual native prompt, not virtual |
| M3-02 | Check session | GET /api/me 200, test name true, cookie not readable in JS |
| M3-03 | Save synthetic workout | GET rev 200, PUT data 200 |
| M3-04 | Logout, Check session | logout 200, me 401 |
| M3-05 | Login, cancel native prompt; Check session | cancellation, no verify success, me 401 |
| M3-06 | Login again and complete native UV | login options/verify 200, me 200 |
| M3-07 | Read synthetic workout | GET data 200, synthetic workout present true |
| M3-08 | Logout everywhere, Check session | logout/all 200, me 401 |
| M3-09 | Login again using same passkey | login 200; read still true |
Report browser+version, OS, authenticator type, PASS/FAIL for M3-01..09, exact status/error category if failed. Do not send tokens, setup/pair codes, credential IDs, authenticator material or full logs. Do not lower UV requirement to make pass. If browser prompts are virtual, mark virtual only. Physical browser acceptance is distinct from official app pairing Phase 4.
## Cleanup
Ctrl+C in terminal stops proxy/Worker and removes disposable local persistence. Close separate profile. Remove only the test passkey named Phase 3 manual fixture under localhost in your passkey manager, if it was saved; verify correct entry first. Do not remove unrelated credentials or real passkeys. No changes to Cloudflare or Learning Hub.

## Automated harness readiness
Final CI [45657223798](https://github.com/nimblelancer/openGym/actions/runs/45657223798) on ab4e37829ddb18c74267460e821644c0b5743d18 completed SUCCESS, all five jobs. Direct Chrome virtual and manual UI/proxy virtual smoke both PASS. The readiness gate is met; owner may run M3-01..09 on that tested commit or a documentation-only successor. For an existing test clone, update with git pull --ff-only on the feature branch; verify branch/commit before running. This is not a physical passkey acceptance result. Phase 3 stays open until manual results and explicit owner acceptance.
