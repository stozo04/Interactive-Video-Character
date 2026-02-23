# Rollback Plan — App + DB (Docker/VM)

## Triggers (when to rollback)
- [ ] Elevated error rate (5xx), elevated client errors, or broken critical flow
- [ ] Data corruption risk or migration issue
- [ ] Performance regression that breaches SLO

## Decision points (stop/go)
- [ ] Is the issue isolated to the app (no schema/data impact)?
- [ ] Did the deployment include DB schema changes?
- [ ] Is a forward-fix faster/safer than rollback?

## App rollback (Docker/VM)
- [ ] Identify last known-good image/tag: `{{LAST_GOOD_IMAGE_TAG}}`
- [ ] Re-deploy last known-good image (proposed): `{{APP_ROLLBACK_COMMAND}}`
- [ ] Verify health endpoint + core flow after rollback

## DB rollback (only if required and safe)
Notes:
- Prefer **logical rollback migrations** when available.
- For destructive migrations, rollback may mean **restore from backup**.

- [ ] Confirm DB backup timestamp before deploy: `{{BACKUP_ID}}`
- [ ] If rollback migration exists, run it (proposed): `{{DB_ROLLBACK_MIGRATION_COMMAND}}`
- [ ] If restore is required, execute restore runbook (proposed): `{{DB_RESTORE_COMMAND}}`
- [ ] Validate DB integrity (basic queries + app reads/writes)

## Post-rollback validation
- [ ] Confirm metrics/logs return to baseline
- [ ] Confirm user journey works
- [ ] Capture incident notes: what broke, why, and follow-ups

