import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "../runtimeLogger";

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
  if (!req.url) {
    log.warning("Anthropic route request received with missing URL", {
      source: "AnthropicRouter",
      method: req.method,
    });
    return false;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  log.info("Anthropic route request received", {
    source: "AnthropicRouter",
    method: req.method,
    pathname,
    url: req.url,
  });

  if (!pathname.startsWith("/anthropic/")) {
    log.info("Request does not match /anthropic/ prefix, skipping", {
      source: "AnthropicRouter",
      pathname,
    });
    return false;
  }

  if (req.method === "OPTIONS") {
    log.info("Handling CORS preflight request", {
      source: "AnthropicRouter",
      pathname,
    });
    writeJson(res, 204, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/test") {
    log.info("Routing to handleTestKey", {
      source: "AnthropicRouter",
      pathname,
    });
    await handleTestKey(req, res);
    return true;
  }

  if (req.method === "GET" && pathname === "/anthropic/models") {
    log.info("Routing to handleListModels", {
      source: "AnthropicRouter",
      pathname,
    });
    await handleListModels(req, res);
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/oauth/token") {
    log.info("Routing to handleOAuthToken", {
      source: "AnthropicRouter",
      pathname,
    });
    await handleOAuthToken(req, res);
    return true;
  }

  if (req.method === "POST" && pathname === "/anthropic/oauth/refresh") {
    log.info("Routing to handleOAuthRefresh", {
      source: "AnthropicRouter",
      pathname,
    });
    await handleOAuthRefresh(req, res);
    return true;
  }

  log.warning("Anthropic route not found", {
    source: "AnthropicRouter",
    method: req.method,
    pathname,
  });
  writeJson(res, 404, { error: "Anthropic route not found." });
  return true;
}

/**
 * POST /anthropic/test
 * Body: { apiKey: string }
 * Tests the API key by hitting Anthropic's /v1/models endpoint.
 */
async function handleTestKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info("Testing Anthropic API key", {
    source: "TestKey",
    route: "/anthropic/test",
  });

  const body = await parseJsonBody<{ apiKey: string }>(req);
  const apiKey = body.apiKey?.trim();

  if (!apiKey) {
    log.warning("API key test request received without apiKey in body", {
      source: "TestKey",
      hasBody: !!body,
    });
    writeJson(res, 400, { error: "apiKey is required." });
    return;
  }

  log.info("API key provided, making test request to Anthropic API", {
    source: "TestKey",
    endpoint: `${ANTHROPIC_API_BASE}/v1/models`,
    apiKeyLength: apiKey.length,
    apiKeyPrefix: apiKey.substring(0, 6),
  });

  try {
    const upstream = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    log.info("Received response from Anthropic API models endpoint", {
      source: "TestKey",
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
    });

    if (upstream.ok) {
      const data = await upstream.json();
      log.info("API key test successful, models retrieved", {
        source: "TestKey",
        modelCount: data?.data?.length || 0,
      });
      writeJson(res, 200, { ok: true, models: data });
    } else {
      const errorText = await upstream.text();
      log.error("API key test failed with non-2xx response", {
        source: "TestKey",
        status: upstream.status,
        statusText: upstream.statusText,
        errorLength: errorText.length,
        errorPreview: errorText.substring(0, 200),
      });
      writeJson(res, upstream.status, { ok: false, error: errorText });
    }
  } catch (err) {
    log.error("API key test network/parse error", {
      source: "TestKey",
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    writeJson(res, 502, { ok: false, error: "Failed to reach Anthropic API." });
  }
}

/**
 * GET /anthropic/models
 * Requires x-api-key header from the frontend.
 */
async function handleListModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info("Fetching models list from Anthropic API", {
    source: "ListModels",
    route: "/anthropic/models",
    method: "GET",
  });

  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    log.warning("Models list request received without x-api-key header", {
      source: "ListModels",
      headers: Object.keys(req.headers).join(", "),
    });
    writeJson(res, 401, { error: "x-api-key header is required." });
    return;
  }

  log.info("API key found in header, making request to Anthropic API", {
    source: "ListModels",
    endpoint: `${ANTHROPIC_API_BASE}/v1/models`,
    apiKeyLength: apiKey.length,
    apiKeyPrefix: apiKey.substring(0, 6),
  });

  try {
    const upstream = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    log.info("Received response from Anthropic API models endpoint", {
      source: "ListModels",
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
    });

    if (upstream.ok) {
      const data = await upstream.json();
      log.info("Models list retrieved successfully", {
        source: "ListModels",
        modelCount: data?.data?.length || 0,
        dataKeys: data ? Object.keys(data).join(", ") : "none",
      });
      writeJson(res, 200, data);
    } else {
      const errorText = await upstream.text();
      log.warning("Anthropic API returned non-2xx response for models list", {
        source: "ListModels",
        status: upstream.status,
        statusText: upstream.statusText,
        errorLength: errorText.length,
        errorPreview: errorText.substring(0, 200),
      });
      writeJson(res, upstream.status, { error: errorText });
    }
  } catch (err) {
    log.error("Models list network/parse error", {
      source: "ListModels",
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    writeJson(res, 502, { error: "Failed to reach Anthropic API." });
  }
}

/**
 * POST /anthropic/oauth/token
 * Body: { code, code_verifier, redirect_uri }
 * Exchanges an OAuth authorization code for tokens (PKCE flow).
 */
async function handleOAuthToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info("OAuth token exchange request received", {
    source: "OAuthToken",
    route: "/anthropic/oauth/token",
  });

  const body = await parseJsonBody<{
    code: string;
    code_verifier: string;
    redirect_uri: string;
    client_id: string;
  }>(req);

  const hasCode = !!body.code;
  const hasCodeVerifier = !!body.code_verifier;
  const hasRedirectUri = !!body.redirect_uri;
  const hasClientId = !!body.client_id;

  log.info("OAuth token exchange request body parsed", {
    source: "OAuthToken",
    hasCode,
    hasCodeVerifier,
    hasRedirectUri,
    hasClientId,
  });

  if (!hasCode || !hasCodeVerifier || !hasRedirectUri || !hasClientId) {
    log.warning("OAuth token exchange request missing required parameters", {
      source: "OAuthToken",
      missingParameters: [
        !hasCode && "code",
        !hasCodeVerifier && "code_verifier",
        !hasRedirectUri && "redirect_uri",
        !hasClientId && "client_id",
      ].filter(Boolean),
    });
    writeJson(res, 400, { error: "code, code_verifier, redirect_uri, and client_id are required." });
    return;
  }

  log.info("Making OAuth token exchange request to Anthropic", {
    source: "OAuthToken",
    endpoint: "https://console.anthropic.com/v1/oauth/token",
    clientId: body.client_id,
    codeLength: body.code.length,
    redirectUri: body.redirect_uri,
  });

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

    log.info("Received response from Anthropic OAuth token endpoint", {
      source: "OAuthToken",
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
    });

    const data = await upstream.json();

    if (upstream.ok) {
      log.info("OAuth token exchange successful", {
        source: "OAuthToken",
        status: upstream.status,
        hasAccessToken: !!data?.access_token,
        hasRefreshToken: !!data?.refresh_token,
        tokenType: data?.token_type,
      });
    } else {
      log.warning("OAuth token exchange failed with non-2xx response", {
        source: "OAuthToken",
        status: upstream.status,
        error: data?.error || "unknown error",
        errorDescription: data?.error_description || "no description",
      });
    }

    writeJson(res, upstream.status, data);
  } catch (err) {
    log.error("OAuth token exchange network/parse error", {
      source: "OAuthToken",
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    writeJson(res, 502, { error: "Failed to exchange OAuth code." });
  }
}

/**
 * POST /anthropic/oauth/refresh
 * Body: { refresh_token, client_id }
 * Refreshes an expired OAuth access token.
 */
async function handleOAuthRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  log.info("OAuth token refresh request received", {
    source: "OAuthRefresh",
    route: "/anthropic/oauth/refresh",
  });

  const body = await parseJsonBody<{
    refresh_token: string;
    client_id: string;
  }>(req);

  const hasRefreshToken = !!body.refresh_token;
  const hasClientId = !!body.client_id;

  log.info("OAuth token refresh request body parsed", {
    source: "OAuthRefresh",
    hasRefreshToken,
    hasClientId,
  });

  if (!hasRefreshToken || !hasClientId) {
    log.warning("OAuth token refresh request missing required parameters", {
      source: "OAuthRefresh",
      missingParameters: [!hasRefreshToken && "refresh_token", !hasClientId && "client_id"].filter(
        Boolean,
      ),
    });
    writeJson(res, 400, { error: "refresh_token and client_id are required." });
    return;
  }

  log.info("Making OAuth token refresh request to Anthropic", {
    source: "OAuthRefresh",
    endpoint: "https://console.anthropic.com/v1/oauth/token",
    clientId: body.client_id,
    refreshTokenLength: body.refresh_token.length,
  });

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

    log.info("Received response from Anthropic OAuth token endpoint", {
      source: "OAuthRefresh",
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
    });

    const data = await upstream.json();

    if (upstream.ok) {
      log.info("OAuth token refresh successful", {
        source: "OAuthRefresh",
        status: upstream.status,
        hasAccessToken: !!data?.access_token,
        hasRefreshToken: !!data?.refresh_token,
        tokenType: data?.token_type,
      });
    } else {
      log.warning("OAuth token refresh failed with non-2xx response", {
        source: "OAuthRefresh",
        status: upstream.status,
        error: data?.error || "unknown error",
        errorDescription: data?.error_description || "no description",
      });
    }

    writeJson(res, upstream.status, data);
  } catch (err) {
    log.error("OAuth token refresh network/parse error", {
      source: "OAuthRefresh",
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    writeJson(res, 502, { error: "Failed to refresh OAuth token." });
  }
}

// ============================================
// Utility
// ============================================

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 1024 * 64;
  let body = "";

  log.info("Parsing JSON request body", {
    source: "ParseJsonBody",
    maxBytes,
  });

  try {
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > maxBytes) {
        const error = "Request body exceeds 64KB limit.";
        log.error(error, {
          source: "ParseJsonBody",
          bodyLength: body.length,
          maxBytes,
        });
        throw new Error(error);
      }
    }

    log.info("Request body received", {
      source: "ParseJsonBody",
      bodyLength: body.length,
      isEmpty: !body.trim(),
    });

    if (!body.trim()) {
      log.info("Empty request body, returning empty object", {
        source: "ParseJsonBody",
      });
      return {} as T;
    }

    const parsed = JSON.parse(body) as T;
    log.info("JSON parsing successful", {
      source: "ParseJsonBody",
      bodyLength: body.length,
    });
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      log.error("JSON parse error - invalid JSON syntax", {
        source: "ParseJsonBody",
        error: err.message,
        bodyLength: body.length,
        bodyPreview: body.substring(0, 100),
      });
    } else {
      log.error("Unexpected error during body parsing", {
        source: "ParseJsonBody",
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });
    }
    throw err;
  }
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  log.info("Writing JSON response", {
    source: "WriteJson",
    statusCode,
    payloadType: typeof payload,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as any).join(", ") : undefined,
  });

  try {
    Object.entries(JSON_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.statusCode = statusCode;
    const jsonString = JSON.stringify(payload);
    log.info("Response headers set, writing JSON body", {
      source: "WriteJson",
      statusCode,
      jsonLength: jsonString.length,
    });
    res.end(jsonString);
  } catch (err) {
    log.error("Error writing JSON response", {
      source: "WriteJson",
      statusCode,
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    throw err;
  }
}
