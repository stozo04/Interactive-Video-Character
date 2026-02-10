/**
 * X (Twitter) Service
 *
 * Handles OAuth 2.0 PKCE authentication, token management,
 * tweet posting, and draft CRUD via X API v2.
 *
 * All X API calls go through the Vite dev proxy (/api/x → https://api.x.com)
 * to bypass CORS restrictions in the browser.
 */

import { supabase } from "./supabaseClient";

const LOG_PREFIX = "🐦 [X]";

const X_CLIENT_ID = import.meta.env.VITE_X_CLIENT_ID;
const X_CLIENT_SECRET = import.meta.env.VITE_X_CLIENT_SECRET;
// Must match what's registered in the X Developer Portal
const X_CALLBACK_URL = import.meta.env.VITE_X_CALLBACK_URL || `${window.location.origin}/auth/x/callback`;

const TABLES = {
  AUTH_TOKENS: "x_auth_tokens",
  TWEET_DRAFTS: "x_tweet_drafts",
} as const;

// Token refresh buffer — refresh 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ============================================
// Types
// ============================================

export interface XAuthTokens {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
}

export interface XTweetDraft {
  id: string;
  tweetText: string;
  status: "pending_approval" | "queued" | "posted" | "rejected" | "failed";
  intent: string | null;
  reasoning: string | null;
  tweetId: string | null;
  tweetUrl: string | null;
  generationContext: Record<string, unknown> | null;
  rejectionReason: string | null;
  errorMessage: string | null;
  postedAt: string | null;
  createdAt: string;
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

const PKCE_VERIFIER_KEY = "x_oauth_code_verifier";
const PKCE_STATE_KEY = "x_oauth_state";

/**
 * Starts the X OAuth 2.0 PKCE flow by returning the authorization URL.
 * Call this when the user clicks "Connect X Account".
 * The code_verifier is stored in sessionStorage for the callback.
 */
export async function initXAuth(): Promise<string> {
  if (!X_CLIENT_ID) {
    throw new Error("VITE_X_CLIENT_ID is not configured");
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateCodeVerifier(); // random state for CSRF protection

  // Store for callback
  sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: X_CLIENT_ID,
    redirect_uri: X_CALLBACK_URL,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  console.log(`${LOG_PREFIX} OAuth flow initiated`);
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Handles the OAuth callback after X redirects back.
 * Exchanges the authorization code for tokens and stores them.
 */
export async function handleXAuthCallback(code: string, state: string): Promise<void> {
  const savedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  if (!savedState || state !== savedState) {
    throw new Error("OAuth state mismatch — possible CSRF attack");
  }

  if (!codeVerifier) {
    throw new Error("Missing code_verifier — OAuth flow was not properly initiated");
  }

  // Clean up AFTER successful exchange (not before, so retries work)
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);

  // Exchange code for tokens via proxy
  // For confidential clients (Web App): use Basic auth, don't duplicate client_id in body
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: X_CALLBACK_URL,
    code_verifier: codeVerifier,
  });

  console.log(`${LOG_PREFIX} Token exchange request`, {
    redirect_uri: X_CALLBACK_URL,
    hasCode: !!code,
    hasCodeVerifier: !!codeVerifier,
    codeLength: code.length,
  });

  const response = await fetch("/api/x/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Token exchange failed`, { status: response.status, error: errorText });
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const tokens = await response.json();
  await storeTokens(tokens);
  console.log(`${LOG_PREFIX} OAuth flow completed — X account connected`);
}

// ============================================
// Token Management
// ============================================

async function storeTokens(tokenResponse: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();

  // Upsert — only one row should ever exist
  const { data: existing } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .select("id")
    .limit(1)
    .single();

  if (existing) {
    const { error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .update({
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_at: expiresAt,
        scope: tokenResponse.scope,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to update tokens`, { error });
      throw error;
    }
  } else {
    const { error } = await supabase.from(TABLES.AUTH_TOKENS).insert({
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: expiresAt,
      scope: tokenResponse.scope,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to store tokens`, { error });
      throw error;
    }
  }

  console.log(`${LOG_PREFIX} Tokens stored`, { expiresAt });
}

async function getStoredTokens(): Promise<XAuthTokens | null> {
  const { data, error } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .select("*")
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(`${LOG_PREFIX} Failed to read tokens`, { error });
    return null;
  }

  return data ?? null;
}

/**
 * Returns a valid access token, refreshing if needed.
 * Returns null if no X account is connected.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();
  if (!tokens) return null;

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();

  if (now < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return tokens.access_token;
  }

  // Token expired or about to expire — refresh
  console.log(`${LOG_PREFIX} Token expired or expiring soon, refreshing`);
  return await refreshXToken(tokens.refresh_token);
}

async function refreshXToken(refreshToken: string): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: X_CLIENT_ID,
    });

    const response = await fetch("/api/x/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error(`${LOG_PREFIX} Token refresh failed`, { status: response.status });
      return null;
    }

    const tokens = await response.json();
    await storeTokens(tokens);
    return tokens.access_token;
  } catch (error) {
    console.error(`${LOG_PREFIX} Token refresh error`, { error });
    return null;
  }
}

/**
 * Checks if an X account is connected and tokens are available.
 */
export async function isXConnected(): Promise<boolean> {
  if (!X_CLIENT_ID || !X_CLIENT_SECRET) return false;
  const token = await getValidAccessToken();
  return token !== null;
}

/**
 * Revokes X access and deletes stored tokens.
 */
export async function revokeXAuth(): Promise<void> {
  const tokens = await getStoredTokens();
  if (!tokens) return;

  try {
    await fetch("/api/x/2/oauth2/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        token: tokens.access_token,
        token_type_hint: "access_token",
      }).toString(),
    });
  } catch {
    console.warn(`${LOG_PREFIX} Token revocation call failed (continuing with local cleanup)`);
  }

  const { error } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .delete()
    .eq("id", tokens.id);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to delete tokens`, { error });
  }

  console.log(`${LOG_PREFIX} X account disconnected`);
}

// ============================================
// Tweet Posting
// ============================================

/**
 * Posts a tweet to X via API v2.
 * Returns the tweet ID and URL.
 */
export async function postTweet(text: string): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("X account not connected — no valid access token");
  }

  console.log(`${LOG_PREFIX} Posting tweet`, { length: text.length });

  const response = await fetch("/api/x/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Tweet posting failed`, { status: response.status, error: errorText });
    throw new Error(`Tweet posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;

  // Fetch the authenticated user's username for the URL
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  console.log(`${LOG_PREFIX} Tweet posted`, { tweetId, tweetUrl });
  return { tweetId, tweetUrl };
}

let cachedUsername: string | null = null;

async function getAuthenticatedUsername(accessToken: string): Promise<string> {
  if (cachedUsername) return cachedUsername;

  const response = await fetch("/api/x/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn(`${LOG_PREFIX} Failed to fetch username, using 'i' as fallback`);
    return "i";
  }

  const data = await response.json();
  cachedUsername = data.data.username;
  return cachedUsername!;
}

// ============================================
// Draft Management
// ============================================

function mapDraftRow(row: Record<string, unknown>): XTweetDraft {
  return {
    id: row.id as string,
    tweetText: row.tweet_text as string,
    status: row.status as XTweetDraft["status"],
    intent: (row.intent as string) ?? null,
    reasoning: (row.reasoning as string) ?? null,
    tweetId: (row.tweet_id as string) ?? null,
    tweetUrl: (row.tweet_url as string) ?? null,
    generationContext: (row.generation_context as Record<string, unknown>) ?? null,
    rejectionReason: (row.rejection_reason as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    postedAt: (row.posted_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Creates a tweet draft in the database.
 */
export async function createDraft(
  tweetText: string,
  intent: string,
  reasoning: string,
  generationContext: Record<string, unknown>,
  status: "pending_approval" | "queued" = "pending_approval",
): Promise<XTweetDraft | null> {
  console.log(`${LOG_PREFIX} Creating draft`, { status, length: tweetText.length, intent });

  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .insert({
      tweet_text: tweetText,
      status,
      intent,
      reasoning,
      generation_context: generationContext,
    })
    .select()
    .single();

  if (error || !data) {
    console.error(`${LOG_PREFIX} Failed to create draft`, { error });
    return null;
  }

  console.log(`${LOG_PREFIX} Draft created`, { id: data.id });
  return mapDraftRow(data);
}

/**
 * Fetches drafts by status.
 */
export async function getDrafts(status?: XTweetDraft["status"]): Promise<XTweetDraft[]> {
  let query = supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error || !data) {
    if (error) console.error(`${LOG_PREFIX} Failed to fetch drafts`, { error });
    return [];
  }

  return data.map(mapDraftRow);
}

/**
 * Fetches a single draft by ID.
 */
export async function getDraftById(id: string): Promise<XTweetDraft | null> {
  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    if (error) console.error(`${LOG_PREFIX} Failed to fetch draft`, { id, error });
    return null;
  }

  return mapDraftRow(data);
}

/**
 * Updates a draft's status and optional extra fields.
 */
export async function updateDraftStatus(
  id: string,
  status: XTweetDraft["status"],
  extra?: Record<string, unknown>,
): Promise<boolean> {
  console.log(`${LOG_PREFIX} Updating draft status`, { id, status });

  const updates: Record<string, unknown> = { status, ...extra };

  const { error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to update draft`, { id, status, error });
    return false;
  }

  console.log(`${LOG_PREFIX} Draft status updated`, { id, status });
  return true;
}

/**
 * Fetches recently posted tweets from the database (for LLM context / dedup).
 */
export async function getRecentPostedTweets(limit: number = 20): Promise<XTweetDraft[]> {
  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) console.error(`${LOG_PREFIX} Failed to fetch recent tweets`, { error });
    return [];
  }

  return data.map(mapDraftRow);
}
