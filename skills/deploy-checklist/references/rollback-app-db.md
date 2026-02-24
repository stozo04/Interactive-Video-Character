# Rollback (App + DB) (reference)

Use this reference to generate a rollback section that covers both application and database changes.

## Principle: prefer “forward fixes” over “down migrations”

Many teams do not maintain safe down-migrations. If the user does not have a proven down-migration system, recommend:

- App rollback: redeploy the previous known-good image/tag.
- DB rollback: restore from backup/snapshot, or apply a new forward migration that reverts the behavioral change.

## Minimum rollback inputs

- “Previous known-good” app version (image tag / git SHA).
- DB backup/snapshot plan:
  - How to create a pre-deploy backup
  - How to restore it
  - Expected restore time
- Data risk notes: whether the new version writes new/changed data formats.

## Rollback checklist structure

- Trigger conditions (what signals “rollback now”).
- App rollback steps (exactly what to redeploy, and how to verify).
- DB rollback steps (backup restore or forward migration plan).
- Comms: who to notify, where to post status updates.
- Post-rollback validation: health checks + key user journeys.

