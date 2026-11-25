# Phase 3 pinned API inventory

170 operations from upstream api/openapi.yaml. 24 implemented candidates (not verified); remaining 146 deferred. No full parity claim. Callers: frontend/src/lib/api.js for auth/pairing; frontend/src/store/useStore.js for state; account settings for passkeys/device-link; native background nudge-check documented in docs/MOBILE.md. Activity deferred: presence is multi-user/admin-related but actual app calls must be checked before Phase 4. Media Phase 5; other modules disabled. Individual caller audit and exact error/shape differential remain pending.

| Operation | Scope |
|---|---|
| `GET /api/health` | Phase 3 candidate |
| `GET /api/config` | Phase 3 candidate |
| `GET /api/me` | Phase 3 candidate |
| `POST /api/register/options` | Phase 3 candidate |
| `POST /api/register/verify` | Phase 3 candidate |
| `POST /api/login/options` | Phase 3 candidate |
| `POST /api/login/verify` | Phase 3 candidate |
| `POST /api/logout` | Phase 3 candidate |
| `GET /api/oidc/start` | Deferred |
| `GET /api/oidc/callback` | Deferred |
| `POST /api/oidc/app/redeem` | Deferred |
| `POST /api/oidc/link` | Deferred |
| `POST /api/oidc/unlink` | Deferred |
| `POST /api/logout/all` | Phase 3 candidate |
| `POST /api/account/delete` | Phase 3 candidate |
| `POST /api/pair/create` | Phase 3 candidate |
| `POST /api/pair/redeem` | Phase 3 candidate |
| `POST /api/watch/pair` | Deferred |
| `POST /api/watch/redeem` | Deferred |
| `GET /api/tokens` | Deferred |
| `POST /api/tokens` | Deferred |
| `POST /api/tokens/revoke` | Deferred |
| `GET /api/calendar` | Deferred |
| `POST /api/calendar` | Deferred |
| `POST /api/calendar/revoke` | Deferred |
| `GET /api/calendar/{token}.ics` | Deferred |
| `GET /api/token/me` | Deferred |
| `GET /api/token/data` | Deferred |
| `PUT /api/token/data` | Deferred |
| `GET /api/token/data/rev` | Deferred |
| `GET /api/watch/links` | Deferred |
| `POST /api/watch/unlink` | Deferred |
| `PUT /api/watch/snapshot` | Deferred |
| `GET /api/watch/events` | Deferred |
| `POST /api/watch/ack` | Deferred |
| `GET /api/watch/box` | Deferred |
| `POST /api/watch/box` | Deferred |
| `POST /api/login/password` | Deferred |
| `POST /api/register/password` | Deferred |
| `POST /api/login/password-reset` | Deferred |
| `GET /api/account/password` | Deferred |
| `POST /api/account/password` | Deferred |
| `DELETE /api/account/password` | Deferred |
| `POST /api/account/email` | Deferred |
| `DELETE /api/account/email` | Deferred |
| `POST /api/admin/user/recovery` | Deferred |
| `POST /api/admin/user/password-reset` | Deferred |
| `GET /api/account/passkeys` | Phase 3 candidate |
| `DELETE /api/account/passkeys` | Phase 3 candidate |
| `POST /api/account/passkeys/options` | Phase 3 candidate |
| `POST /api/account/passkeys/verify` | Phase 3 candidate |
| `POST /api/account/passkeys/rename` | Phase 3 candidate |
| `POST /api/account/device-link` | Phase 3 candidate |
| `POST /api/device-link/options` | Phase 3 candidate |
| `POST /api/device-link/verify` | Phase 3 candidate |
| `GET /api/data` | Phase 3 candidate |
| `PUT /api/data` | Phase 3 candidate |
| `GET /api/data/rev` | Phase 3 candidate |
| `GET /api/nudge-check` | Phase 3 candidate |
| `GET /api/media/{hash}` | Deferred / media review |
| `PUT /api/media/{hash}` | Deferred / media review |
| `POST /api/media/missing` | Deferred / media review |
| `POST /api/media/sweep` | Deferred / media review |
| `GET /api/shared` | Deferred |
| `POST /api/shared` | Deferred |
| `GET /api/shared/{id}` | Deferred |
| `PATCH /api/shared/{id}` | Deferred |
| `DELETE /api/shared/{id}` | Deferred |
| `POST /api/shared/{id}/import` | Deferred |
| `POST /api/shared/{id}/report` | Deferred |
| `GET /api/shared/media/{hash}` | Deferred / media review |
| `GET /api/admin/shared` | Deferred |
| `POST /api/admin/shared/{id}` | Deferred |
| `POST /api/admin/users/{uid}/sharing` | Deferred |
| `GET /api/push/public-key` | Deferred |
| `POST /api/push/subscribe` | Deferred |
| `GET /api/push/status` | Deferred |
| `POST /api/push/unsubscribe` | Deferred |
| `POST /api/push/test` | Deferred |
| `POST /api/push/rest-timer` | Deferred |
| `POST /api/push/rest-timer/cancel` | Deferred |
| `GET /api/integrations` | Deferred |
| `POST /api/integrations/connect` | Deferred |
| `POST /api/integrations/update` | Deferred |
| `POST /api/integrations/disconnect` | Deferred |
| `POST /api/integrations/test` | Deferred |
| `POST /api/integrations/retry` | Deferred |
| `GET /api/integrations/oauth/start` | Deferred |
| `GET /api/integrations/oauth/callback` | Deferred |
| `GET /api/integrations/log` | Deferred |
| `POST /api/activity` | Deferred |
| `GET /api/admin/users` | Deferred |
| `GET /api/admin/user` | Deferred |
| `POST /api/admin/user/disable` | Deferred |
| `POST /api/admin/user/delete` | Deferred |
| `POST /api/admin/user/role` | Deferred |
| `POST /api/admin/owner` | Deferred |
| `GET /api/admin/invites` | Deferred |
| `POST /api/admin/invites/new` | Deferred |
| `POST /api/admin/invites/revoke` | Deferred |
| `GET /api/admin/audit` | Deferred |
| `POST /api/admin/audit/clear` | Deferred |
| `GET /api/coach/disclosure` | Deferred |
| `GET /api/coach/status` | Deferred |
| `POST /api/coach/plan` | Deferred |
| `POST /api/coach/review` | Deferred |
| `POST /api/coach/ask` | Deferred |
| `POST /api/coach/adapt` | Deferred |
| `POST /api/coach/debrief` | Deferred |
| `POST /api/coach/pending/resolve` | Deferred |
| `GET /api/coach/cohort` | Deferred |
| `POST /api/coach/cohort/share` | Deferred |
| `GET /api/coach/account` | Deferred |
| `POST /api/coach/forget` | Deferred |
| `GET /api/admin/oidc` | Deferred |
| `POST /api/admin/oidc/check` | Deferred |
| `GET /api/admin/coach` | Deferred |
| `POST /api/admin/coach/config` | Deferred |
| `POST /api/admin/coach/test` | Deferred |
| `GET /.well-known/oauth-authorization-server` | Deferred |
| `GET /.well-known/openid-configuration` | Deferred |
| `GET /.well-known/oauth-protected-resource` | Deferred |
| `GET /.well-known/oauth-protected-resource/mcp` | Deferred |
| `POST /api/oauth/register` | Deferred |
| `GET /api/oauth/authorize` | Deferred |
| `GET /api/oauth/request` | Deferred |
| `POST /api/oauth/approve` | Deferred |
| `POST /api/oauth/deny` | Deferred |
| `POST /api/oauth/token` | Deferred |
| `POST /api/oauth/revoke` | Deferred |
| `POST /api/admin/coach/chatgpt/start` | Deferred |
| `POST /api/admin/coach/chatgpt/finish` | Deferred |
| `POST /api/admin/coach/discover` | Deferred |
| `POST /api/admin/coach/models` | Deferred |
| `POST /api/admin/coach/connect` | Deferred |
| `POST /api/admin/coach/disconnect` | Deferred |
| `GET /api/sharing` | Deferred |
| `POST /api/sharing/code` | Deferred |
| `POST /api/sharing/connect` | Deferred |
| `POST /api/sharing/decline` | Deferred |
| `POST /api/sharing/update` | Deferred |
| `POST /api/sharing/disconnect` | Deferred |
| `POST /api/sharing/leave` | Deferred |
| `GET /api/sharing/log` | Deferred |
| `GET /api/sharing/export` | Deferred |
| `GET /api/trainer` | Deferred |
| `POST /api/trainer/codes` | Deferred |
| `POST /api/trainer/codes/revoke` | Deferred |
| `POST /api/trainer/requests/answer` | Deferred |
| `POST /api/trainer/disconnect` | Deferred |
| `GET /api/trainer/members` | Deferred |
| `GET /api/trainer/member` | Deferred |
| `GET /api/trainer/member/photo` | Deferred |
| `POST /api/trainer/ops` | Deferred |
| `POST /api/trainer/assign` | Deferred |
| `POST /api/trainer/comment` | Deferred |
| `POST /api/trainer/leave-gym` | Deferred |
| `GET /api/gym` | Deferred |
| `POST /api/gym/code` | Deferred |
| `POST /api/gym/staff` | Deferred |
| `GET /api/sharing/inbox` | Deferred |
| `POST /api/sharing/inbox/answer` | Deferred |
| `POST /api/sharing/inbox/seen` | Deferred |
| `POST /api/sharing/undo` | Deferred |
| `GET /api/sharing/preview` | Deferred |
| `GET /api/admin/gyms` | Deferred |
| `POST /api/admin/gyms/new` | Deferred |
| `POST /api/admin/gyms/update` | Deferred |
| `POST /api/admin/gyms/staff` | Deferred |
| `POST /api/admin/user/trainer` | Deferred |

Safety deviations: user verification required, kindless legacy tokens rejected, duplicate/mixed credentials refused, persistent single-owner bootstrap closed even after deletion, fixed global/owner throttling (no trusted client address in local mode), CORS exact local/native allowlist, device link 10 min as upstream, pair/challenge 5 min. Generic crypto verification errors until exact upstream error mapping is tested. No production approval.

Auth contract tests now include upstream actual Node HTTP differential subset and a Chrome virtual ceremony, pending CI. Device links follow upstream 10 min TTL. Physical browser/manual, full caller mapping, supported-route exact error mapping and activity behavior remain pending.
