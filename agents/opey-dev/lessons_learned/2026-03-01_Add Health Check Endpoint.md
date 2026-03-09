# Lessons Learned — Add Health Check Endpoint — 2026-03-01

## Ticket
Add a /healthz endpoint to server/index.ts that returns plain text "ok".

## Codebase Discoveries
- `server/index.ts` routes requests directly on a Node `http` server and delegates to custom routers before falling back to a JSON 404.

## Gotchas & Bugs
- None encountered.

## Approach That Worked
- Added a fast-path `GET /healthz` check using `URL` parsing before routing to other handlers.

## What Future Opey Should Know
- Health checks should return plain text with an explicit `text/plain` content type and bypass other routers.
