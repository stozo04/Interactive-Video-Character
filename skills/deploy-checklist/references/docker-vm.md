# Docker on VM (reference)

Use this reference to expand the “deploy target” portion of a checklist when the user is deploying to a VM that runs Docker.

## Typical flow (Compose)

- Build artifact(s) (or image) in CI.
- Push image to registry.
- On VM: pull the new image and restart services via `docker compose up -d`.
- Validate health checks and basic smoke tests.
- Monitor logs/metrics for a short stabilization window.

## Checklist prompts (things that commonly bite)

- Confirm the VM has enough disk space for the new image (and old images).
- Confirm `.env` values exist on the VM (don’t print secrets in logs).
- Confirm port bindings and reverse proxy routing (nginx/caddy/traefik).
- Confirm a restart policy is set (`unless-stopped` or supervisor/systemd).
- Confirm log retention (docker logs can fill disks).

## Common command placeholders (do not claim execution)

- Build/test (local/CI): `npm ci`, `npm test -- --run`, `npm run build`
- Image build: `docker build -t <image>:<tag> .`
- Push: `docker push <image>:<tag>`
- On VM:
  - `docker pull <image>:<tag>`
  - `docker compose up -d`
  - `docker image prune` (only if you are sure it won’t delete needed images)

