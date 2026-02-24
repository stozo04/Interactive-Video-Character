# Deploy Checklist — {{APP_NAME}}

Defaults:
- Environment: **staging + production**
- Target: **Docker/VM**
- Rollback: **App + DB rollback**

## Preflight (common)
- [ ] Confirm release scope + version/tag: `{{RELEASE_ID}}`
- [ ] Confirm deployment window + on-call owner: `{{OWNER}}`
- [ ] Confirm last successful deploy reference: `{{LAST_GOOD_RELEASE_ID}}`
- [ ] Confirm monitoring access (logs/metrics) is available
- [ ] Confirm secrets/required env vars exist in the deploy target (do not paste secrets here)
- [ ] Confirm DB backup/restore path exists and has been tested (at least once)
- [ ] Confirm migration plan (forward + rollback) is understood

## Build + Test (common)
- [ ] Install deps (proposed): `npm ci`
- [ ] Run unit tests (proposed): `npm test -- --run`
- [ ] Build (proposed): `npm run build`
- [ ] Record build artifact / image tag: `{{IMAGE_TAG}}`

## Staging Deploy (Docker/VM)
- [ ] Ensure staging config is selected (env vars / compose override / systemd unit)
- [ ] Pull/build image on staging host(s) (proposed): `{{STAGING_IMAGE_PULL_COMMAND}}`
- [ ] Apply DB migrations (staging) (proposed): `{{STAGING_MIGRATE_COMMAND}}`
- [ ] Restart/rollout app (staging) (proposed): `{{STAGING_ROLLOUT_COMMAND}}`
- [ ] Verify health endpoint / basic page load (staging): `{{STAGING_HEALTHCHECK_URL}}`

## Staging Validation
- [ ] Smoke test critical paths (login, core flows, video/asset loading, etc.)
- [ ] Confirm error logs remain clean for 10–15 minutes
- [ ] Confirm performance/regressions (largest endpoints/views)

## Production Deploy (Docker/VM)
- [ ] Confirm staging sign-off (who/when): `{{STAGING_SIGNOFF}}`
- [ ] Confirm production config is selected (env vars / compose override / systemd unit)
- [ ] Pull/build image on prod host(s) (proposed): `{{PROD_IMAGE_PULL_COMMAND}}`
- [ ] Apply DB migrations (prod) (proposed): `{{PROD_MIGRATE_COMMAND}}`
- [ ] Rollout app (prod) (proposed): `{{PROD_ROLLOUT_COMMAND}}`

## Post-deploy Validation (production)
- [ ] Verify health endpoint: `{{PROD_HEALTHCHECK_URL}}`
- [ ] Verify core user journey (happy path)
- [ ] Verify error rate / logs (first 15–30 minutes)
- [ ] Verify key dashboards/alerts are green
- [ ] Announce completion in `{{CHANNEL}}` with `{{RELEASE_ID}}`

## Rollback (if needed)
Use: `templates/rollback_app_db.template.md`

