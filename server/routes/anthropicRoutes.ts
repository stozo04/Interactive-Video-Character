import type { IncomingMessage, ServerResponse } from "node:http";

const LOG_PREFIX = "[Anthropic]";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const ANTHROPIC_API_BASE = "https://api.anthropic.com";

export async function routeAnthropicRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!req.url) return false;

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (!pathname.startsWith("/anthropic/")) return false;

  if (req.method === "OPTIONS") {
    writeJson(res, 204, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/test") {
    await handleTestKey(req, res);
    return true;
  }

  if (req.method === "GET" && pathname === "/anthropic/models") {
    await handleListModels(req, res);
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/oauth/token") {
    await handleOAuthToken(req, res);
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/oauth/refresh") {
    await handleOAuthRefresh(req, res);
    return true;
  }

  writeJson(res, 404, { error: "Anthropic route not found." });
  return true;
}

/**
 * POST /anthropic/test
 * Body: { apiKey: string }
 * Tests the API key by hitting Anthropic's /v1/models endpoint.
 */
async function handleTestKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody<{ apiKey: string }>(req);
  const apiKey = body.apiKey?.trim();

  if (!apiKey) {
    writeJson(res, 400, { error: "apiKey is required." });
    return;
  }

  try {
    const upstream = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (upstream.ok) {
      const data = await upstream.json();
      writeJson(res, 200, { ok: true, models: data });
    } else {
      const errorText = await upstream.text();
      console.error(`${LOG_PREFIX} Key test failed (${upstream.status}):`, errorText);
      writeJson(res, upstream.status, { ok: false, error: errorText });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Key test network error:`, err);
    writeJson(res, 502, { ok: false, error: "Failed to reach Anthropic API." });
  }
}

/**
 * GET /anthropic/models
 * Requires x-api-key header from the frontend.
 */
async function handleListModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    writeJson(res, 401, { error: "x-api-key header is required." });
    return;
  }

  try {
    const upstream = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (upstream.ok) {
      const data = await upstream.json();
      writeJson(res, 200, data);
    } else {
      const errorText = await upstream.text();
      writeJson(res, upstream.status, { error: errorText });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Models list error:`, err);
    writeJson(res, 502, { error: "Failed to reach Anthropic API." });
  }
}

/**
 * POST /anthropic/oauth/token
 * Body: { code, code_verifier, redirect_uri }
 * Exchanges an OAuth authorization code for tokens (PKCE flow).
 */
async function handleOAuthToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody<{
    code: string;
    code_verifier: string;
    redirect_uri: string;
    client_id: string;
  }>(req);

  if (!body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
    writeJson(res, 400, { error: "code, code_verifier, redirect_uri, and client_id are required." });
    return;
  }

  try {
    const upstream = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: body.code,
        code_verifier: body.code_verifier,
        redirect_uri: body.redirect_uri,
        client_id: body.client_id,
      }),
    });

    const data = await upstream.json();
    writeJson(res, upstream.status, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} OAuth token exchange error:`, err);
    writeJson(res, 502, { error: "Failed to exchange OAuth code." });
  }
}

/**
 * POST /anthropic/oauth/refresh
 * Body: { refresh_token, client_id }
 * Refreshes an expired OAuth access token.
 */
async function handleOAuthRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody<{
    refresh_token: string;
    client_id: string;
  }>(req);

  if (!body.refresh_token || !body.client_id) {
    writeJson(res, 400, { error: "refresh_token and client_id are required." });
    return;
  }

  try {
    const upstream = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: body.refresh_token,
        client_id: body.client_id,
      }),
    });

    const data = await upstream.json();
    writeJson(res, upstream.status, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} OAuth refresh error:`, err);
    writeJson(res, 502, { error: "Failed to refresh OAuth token." });
  }
}

// ============================================
// Utility
// ============================================

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 1024 * 64;
  let body = "";

  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > maxBytes) {
      throw new Error("Request body exceeds 64KB limit.");
    }
  }

  if (!body.trim()) return {} as T;
  return JSON.parse(body) as T;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}
