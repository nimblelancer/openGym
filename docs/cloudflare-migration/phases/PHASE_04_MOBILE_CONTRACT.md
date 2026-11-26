# Mobile contract and consolidated manual gate
Pinned v1.4.5/e4a68a9. Actual released APK/IPA version not inspected. No native build required or performed. Source-based compatibility only until official installed-app test.
| Contract | Upstream caller | Required response / behavior |
|---|---|---|
| GET /api/config | api.js serverConfig, useStore loadConfig | JSON, invite_only true, allow_guest false, absent/null unsupported features; no provider sign-in |
| POST /api/pair/redeem | remote.js connect, api.js pairRedeem | 200 token/user, 400 invalid/expired/used; no cookie needed; never accept HTML/empty body |
| GET /api/me | useStore boot, remote.js renewToken | user, optional renewed token; revoked/expired 401; keep file and owed changes |
| GET /api/data/rev | useStore poll | rev/wid; no body payload; detect rewind |
| GET /api/data | useStore pull/adopt | state/rev including _wid/_wids, null on missing, JSON 503 corruption |
| PUT /api/data | useStore doPush | baseRev/baseWid/stamped/state, 200 ok/rev/wid, 409 state/rev conflict, 413 cap, 401 revoke |
| POST /api/logout | useStore signOut | JSON; local disconnect guard/stash independent of HTTP |
| POST /api/logout/all | browser/account | revoke all, mobile remains owed until re-pair |
| POST /api/account/delete | useStore deleteAccount | named confirmation, bearer-kind proof allowed, atomic state deletion |
| POST /api/activity | Workout.jsx | ephemeral heartbeat, JSON ok; no fake success |
| GET /api/nudge-check | nudge-check.js + native plugin | date/done/nudge; no answer leaves local notifications unchanged |
| OPTIONS /api/* | Android/iOS WebView | allow exact native origins (https://localhost, http://localhost, capacitor://localhost), Authorization/content-type/Access headers; no cross-origin cookies |
| Media | media-sync.js | deferred Phase 5, no personal media tests here |
| Watch relay, coach, OIDC, password, sharing, trainers, server push, integrations | optional modules | unsupported JSON 404, must suppress or honestly report unavailable capabilities before release |
| Native local features | mobile.js, health-sync.js, Capacitor plugins | local file mirror, notifications, Health Connect/HealthKit, local watch; upstream regression only; OS permissions and real native execution deferred |
## Verification boundaries
Actual JS api/remote/store/merge modules, local Worker HTTP, synthetic owner fixtures; mock OS file/secure storage and native plugin bridge. Browser CORS enforcement and Android native fallback transport are not physically tested; CORS response headers are checked directly. Cloudflare Access service-token feature is not required and no hosted Access resources configured. Existing upstream tests cover many local features; verify latest integrated run before claims.
## Consolidated owner manual checklist (pending)
| ID | Action | Expected |
|---|---|---|
| M4-01 | Record installed official app version, OS, fresh disposable profile; use approved staging endpoint when available | no rebuilt app or real data |
| M4-02 | Browser physical passkey M3-01..09 then generate pairing code, enter server URL in app | actual device pairs with same account |
| M4-03 | Log synthetic workout/routine/bodyweight on app and web | both copies converge, no lost changes |
| M4-04 | Disconnect network, edit on phone, edit on web, restore network | queued edit persists, conflict merges without silent loss |
| M4-05 | Kill/restart app with unsent changes, reconnect | durable mirror/stash preserved |
| M4-06 | Sign out everywhere in browser, edit offline, pair again | token revoked, local edit retained and merged |
| M4-07 | Disconnect with unsent changes; then force only on disposable profile | guard refuses; forced disconnect preserves stash; same-account re-pair restores |
| M4-08 | Delete synthetic workout/reset only disposable profile, sync stale device | no resurrection; rewind/recovery scenarios in controlled staging |
| M4-09 | Native local notifications/health permissions as applicable, no real health data | local-only features work; background scheduling subject to OS |
| M4-10 | Verify unsupported features are visibly unavailable, no media loss; Phase 5 media checklist separately | no false success |
No LAN exposure or tunnel now. Real device cannot reach the loopback-only CI Worker; manual test requires later separately approved secure staging. M3/M4 and all release blockers before Phase 7 acceptance. Do not deploy production.

## P4-13 focused source audit (2026-11-26)
- `useStore.js` mobile boot awaits /me, /config and state pull; adoption, push, polling and disconnect use core routes. Core store fixture now checks local-only boot has no successful HTTP calls, cold-boot config and absence of deferred route responses throughout its sync/stash/reset path. This is not a mounted App test.
- `media-sync.js` runFor exits when config.media is absent; prefetch also checks it. No claim of media backup or sync until Phase 5.
- `coach.js` coachAvailable requires a configured server coach (device BYOK is separate); shared-api libraryOf, sharing-api sharingOn, trainer-api trainerRoles and api-tokens tokensOn gate unavailable server features. Integrations.jsx only fetches /api/integrations when providers are advertised; its calendar fetch is token gated. Native reminders do not require browser push (Settings.jsx).
- `App.jsx` always starts watch relay; `watch-relay.js` status probes /api/watch/events for a signed-in account and catches errors, reporting no paired/reachable watch. A 404 is an expected nonfatal probe, not a successful relay. The actual relay bridge is exercised against the local Worker; snapshot and drain must not send after an unsuccessful status. Explicit Zepp pairing is unsupported; check UI error wording on installed app. Native watch functionality remains separate.
- Added actual upstream capability predicate assertions and explicit authenticated 404 checks in the mobile contract fixture. No upstream runtime changes or synthetic success responses. Source audit is targeted, not exhaustive mounted UI coverage; M4-10 remains open. All added assertions require a new CI run.
