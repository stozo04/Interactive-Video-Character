# Server (Workspace Agent)

This folder hosts the Workspace Agent server that powers multi-agent workflows and auxiliary services used by the Vite UI. It runs a Node HTTP server, orchestrates the Opey dev loop, and schedules background jobs.

## Entry Point

- `server/index.ts`

## What It Does

- Starts the Workspace Agent HTTP server (default port `4010`).
- Loads environment variables from `server/.env.local`, `server/.env`, and root `.env` (highest to lowest priority).
- Starts background services:
  - Opey dev ticket polling loop (reads `engineering_tickets`).
  - Cron scheduler for scheduled digests and reminders.
- Serves `/multi-agent/*` API routes for tickets, events, turns, and chats (Supabase-backed).
- Provides a lightweight `/multi-agent/health` endpoint for liveness checks.

## Dev Setup (High Level)

1. Install dependencies at repo root:

```bash
npm install
```

2. Start the UI + dev proxy:

```bash
npm run dev
```

3. Start the server (separate terminal):

```bash
npm run agent:dev
```

## CORS / Proxy Notes

- In development, the Vite dev server proxies `/multi-agent` to `http://localhost:4010` to avoid CORS preflight failures.
- The frontend uses same-origin requests in dev unless `VITE_WORKSPACE_AGENT_URL` is explicitly set.
- In production, you must expose a backend route for `/multi-agent` or configure CORS on the external multi-agent service.
- A `404 {"error":"Route not found."}` for `/multi-agent/*` usually means this server is not running or the request is hitting a different service without the route handler.

## Multi-Agent API

Base path: `/multi-agent`

- `GET /multi-agent/health` -> `{ ok: true, latencyMs }`
- `GET /multi-agent/tickets?limit=25`
- `POST /multi-agent/tickets`
- `GET /multi-agent/tickets/:id`
- `POST /multi-agent/tickets/:id/transition`
- `GET /multi-agent/tickets/:id/events?limit=100`
- `GET /multi-agent/tickets/:id/turns?limit=100`
- `GET /multi-agent/chats?limit=25`
- `POST /multi-agent/chats`
- `GET /multi-agent/chats/:id/messages?limit=100`
- `POST /multi-agent/chats/:id/messages`

## Environment Variables

Required for persistence (values not listed here):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)

Optional:

- `OPEY_BACKEND` (e.g., `claude` or `openai`)
- `CRON_TICK_MS`
- `CRON_SCHEDULER_ID`

## Troubleshooting

- If you see CORS errors in the browser console, make sure:
  - the server is running on `http://localhost:4010`, and
  - the Vite dev server is running on `http://localhost:3000`.
- If the server exits immediately, confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- If `/multi-agent/*` returns 404, confirm `npm run agent:dev` is running and that the request is not going to a different server on port `4010`.

## Lessons Learned

- A Vite proxy avoids CORS in development, but it does not create backend routes. The server still must implement `/multi-agent/*`.
- A `{"error":"Route not found."}` response means the request reached a server that does not recognize the route (not a browser CORS issue).
- A lightweight health endpoint (`/multi-agent/health`) is a fast way to confirm server + Supabase connectivity before debugging UI failures.
