/**
 * Anthropic Service
 *
 * Handles API key auth, OAuth PKCE, token management,
 * model listing, and config persistence via Supabase.
 *
 * All Anthropic API calls are proxied through the Node server
 * (/api/anthropic -> localhost:4010/anthropic) to bypass CORS.
 */

import { supabase } from "./supabaseClient";

const LOG_PREFIX = "[Anthropic]";

const TABLES = {
  AUTH_TOKENS: "anthropic_auth_tokens",
  CONFIG: "anthropic_config",
} as const;

// ============================================
// Types
// ============================================

export type AnthropicAuthMode = "api_key" | "oauth";

export interface AnthropicAuthTokens {
  id: string;
  auth_mode: AnthropicAuthMode;
  api_key: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnthropicModel {
  id: string;
  display_name: string;
  type: string;
  created_at?: string;
}

// ============================================
// API Key CRUD
// ============================================

export async function saveApiKey(apiKey: string): Promise<boolean> {
  try {
    // Upsert: clear any existing rows, insert new one
    await supabase.from(TABLES.AUTH_TOKENS).delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error } = await supabase.from(TABLES.AUTH_TOKENS).insert({
      auth_mode: "api_key",
      api_key: apiKey,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to save API key:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} saveApiKey error:`, err);
    return false;
  }
}

export async function getStoredAuth(): Promise<AnthropicAuthTokens | null> {
  try {
    const { data, error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as AnthropicAuthTokens;
  } catch {
    return null;
  }
}

export async function clearAuth(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      console.error(`${LOG_PREFIX} clearAuth error:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} clearAuth error:`, err);
    return false;
  }
}

// ============================================
// Test Connectivity (via server proxy)
// ============================================

export async function testApiKey(apiKey: string): Promise<{ ok: boolean; error?: string; models?: AnthropicModel[] }> {
  try {
    const res = await fetch("/api/anthropic/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });

    const data = await res.json();

    if (res.ok && data.ok) {
      const models = data.models?.data || [];
      return { ok: true, models };
    }

    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    console.error(`${LOG_PREFIX} testApiKey error:`, err);
    return { ok: false, error: "Network error — is the server running on port 4010?" };
  }
}

// ============================================
// List Models (via server proxy)
// ============================================

export async function listModels(apiKey: string): Promise<AnthropicModel[]> {
  try {
    const res = await fetch("/api/anthropic/models", {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });

    if (!res.ok) {
      console.error(`${LOG_PREFIX} listModels failed:`, res.status);
      return [];
    }

    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.error(`${LOG_PREFIX} listModels error:`, err);
    return [];
  }
}

// ============================================
// Config CRUD (anthropic_config table)
// ============================================

export async function getConfig(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONFIG)
      .select("config_value")
      .eq("config_key", key)
      .maybeSingle();

    if (error || !data) return null;
    return data.config_value;
  } catch {
    return null;
  }
}

export async function setConfig(key: string, value: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLES.CONFIG)
      .upsert({ config_key: key, config_value: value }, { onConflict: "config_key" });

    if (error) {
      console.error(`${LOG_PREFIX} setConfig error:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} setConfig error:`, err);
    return false;
  }
}

// ============================================
// PKCE Helpers (browser-native Web Crypto)
// ============================================

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================
// OAuth 2.0 PKCE Flow
// ============================================

const PKCE_VERIFIER_KEY = "anthropic_oauth_code_verifier";
const PKCE_STATE_KEY = "anthropic_oauth_state";

const ANTHROPIC_CLIENT_ID = import.meta.env.VITE_ANTHROPIC_CLIENT_ID || "";
const ANTHROPIC_CALLBACK_URL =
  import.meta.env.VITE_ANTHROPIC_CALLBACK_URL || `${window.location.origin}/auth/anthropic/callback`;

/**
 * Starts the Anthropic OAuth 2.0 PKCE flow.
 * Returns the authorization URL to redirect the user to.
 */
export async function initOAuth(): Promise<string> {
  if (!ANTHROPIC_CLIENT_ID) {
    throw new Error("VITE_ANTHROPIC_CLIENT_ID is not configured");
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: ANTHROPIC_CLIENT_ID,
    redirect_uri: ANTHROPIC_CALLBACK_URL,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "org:read user:read",
  });

  return `https://console.anthropic.com/oauth/authorize?${params.toString()}`;
}

/**
 * Handles the OAuth callback — exchanges the authorization code for tokens.
 */
export async function handleOAuthCallback(code: string, state: string): Promise<boolean> {
  const storedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const storedVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  if (!storedState || storedState !== state) {
    console.error(`${LOG_PREFIX} OAuth state mismatch`);
    return false;
  }

  if (!storedVerifier) {
    console.error(`${LOG_PREFIX} Missing PKCE verifier`);
    return false;
  }

  try {
    const res = await fetch("/api/anthropic/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: storedVerifier,
        redirect_uri: ANTHROPIC_CALLBACK_URL,
        client_id: ANTHROPIC_CLIENT_ID,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error(`${LOG_PREFIX} OAuth token exchange failed:`, data);
      return false;
    }

    // Clear PKCE state
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);

    // Store tokens in Supabase
    await supabase.from(TABLES.AUTH_TOKENS).delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    const { error } = await supabase.from(TABLES.AUTH_TOKENS).insert({
      auth_mode: "oauth",
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_at: expiresAt,
      scope: data.scope || null,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to save OAuth tokens:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} OAuth callback error:`, err);
    return false;
  }
}

/**
 * Refreshes an expired OAuth access token.
 */
export async function refreshOAuthToken(): Promise<boolean> {
  const auth = await getStoredAuth();
  if (!auth || auth.auth_mode !== "oauth" || !auth.refresh_token) return false;

  try {
    const res = await fetch("/api/anthropic/oauth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: auth.refresh_token,
        client_id: ANTHROPIC_CLIENT_ID,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error(`${LOG_PREFIX} OAuth refresh failed:`, data);
      return false;
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    const { error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || auth.refresh_token,
        expires_at: expiresAt,
      })
      .eq("id", auth.id);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to update OAuth tokens:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} refreshOAuthToken error:`, err);
    return false;
  }
}
