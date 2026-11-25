# Deployment guardrails (draft; no deploy commands executed)
- Use dedicated Worker/DO namespace and optionally R2 Standard private bucket; never use the existing cloudflare/wrangler.jsonc (upstream failover).
- Phase 1 uses local-only bindings and synthetic data. No remote resources or deploy in CI by default. Dry-run is not a live deployment.
- Staging/production use different named resources, explicit approval and least-privilege tokens stored in GitHub Actions secrets, never pasted into chat or committed. Do not grant zone routes access for upstream domain. Check all target names/IDs and quota before creating resources.
- Verify actual account plan, Learning Hub usage, R2 headroom, native app compatibility, backup/restore and rollback. A spending alert is not an absolute cap on R2 costs.
- Keep a stable HTTPS hostname (WebAuthn RP ID); same-origin web and API; native CORS and bearer support. No reverse-proxy login page on API routes. Restrict first owner setup with a one-time secret and close registration atomically.
- Store backup off-provider with encryption; include credentials/session metadata as required, data, and media. Rehearse restore on disposable environment; do not roll back live state automatically when rolling back code. Keep upstream AGPL and separate media notice.
- Document exact Wrangler commands only after resource configuration and schema are validated. No production rollout until user approves.
