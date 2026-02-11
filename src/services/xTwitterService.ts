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
  likeCount: number;
  repostCount: number;
  replyCount: number;
  impressionCount: number;
  metricsUpdatedAt: string | null;
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
    scope: "tweet.read tweet.write users.read offline.access media.write",
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
 * Returns true if the stored token includes a specific scope.
 * Returns null when scopes are unavailable.
 */
export async function hasXScope(scope: string): Promise<boolean | null> {
  const tokens = await getStoredTokens();
  if (!tokens?.scope) return null;
  return tokens.scope.split(" ").includes(scope);
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
// Media Upload (v2 API)
// ============================================

/**
 * Uploads an image to X via the v2 media upload endpoint.
 * Returns the media id for use in tweet posting.
 */
export async function uploadMedia(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const tokens = await getStoredTokens();
  if (!tokens?.scope?.includes("media.write")) {
    console.error(`${LOG_PREFIX} Missing media.write scope`, { scope: tokens?.scope ?? "unknown" });
    throw new Error("X token missing media.write scope — reconnect X account to grant media permissions");
  }

  // Clean base64 (remove data URI prefix if present)
  const cleanedBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  const binaryString = atob(cleanedBase64);
  const binaryLength = binaryString.length;

  // 5 MB max for image uploads
  const maxBytes = 5 * 1024 * 1024;
  if (binaryLength > maxBytes) {
    console.error(`${LOG_PREFIX} Media too large`, { bytes: binaryLength, maxBytes });
    throw new Error("Media upload failed: image exceeds 5 MB limit");
  }

  const supportedTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  if (!supportedTypes.has(mimeType)) {
    console.error(`${LOG_PREFIX} Unsupported media type`, { mimeType });
    throw new Error(`Media upload failed: unsupported image type ${mimeType}`);
  }

  const bytes = new Uint8Array(binaryLength);
  for (let i = 0; i < binaryLength; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeType });
  const formData = new FormData();
  formData.append("media", blob, "image");
  formData.append("media_category", "tweet_image");

  console.log(`${LOG_PREFIX} Uploading media`, { mimeType, bytes: binaryLength });

  const response = await fetch("/api/x/2/media/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Media upload failed`, { status: response.status, error: errorText });
    throw new Error(`Media upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const mediaId = parseMediaUploadResponse(result);
  console.log(`${LOG_PREFIX} Media uploaded`, { mediaId });
  return mediaId;
}

export function parseMediaUploadResponse(result: unknown): string {
  const mediaId = (result as { data?: { id?: string } })?.data?.id;
  if (!mediaId) {
    console.error(`${LOG_PREFIX} Media upload response missing id`, { result });
    throw new Error("Media upload failed: missing media id in response");
  }
  return mediaId;
}

/**
 * Posts a tweet with media attachments to X via API v2.
 */
export async function postTweetWithMedia(
  text: string,
  mediaIds: string[]
): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  console.log(`${LOG_PREFIX} Posting tweet with media`, { length: text.length, mediaCount: mediaIds.length });

  const response = await fetch("/api/x/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      media: { media_ids: mediaIds },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Tweet with media failed`, { status: response.status, error: errorText });
    throw new Error(`Tweet posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  console.log(`${LOG_PREFIX} Tweet with media posted`, { tweetId, tweetUrl });
  return { tweetId, tweetUrl };
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
    likeCount: (row.like_count as number) ?? 0,
    repostCount: (row.repost_count as number) ?? 0,
    replyCount: (row.reply_count as number) ?? 0,
    impressionCount: (row.impression_count as number) ?? 0,
    metricsUpdatedAt: (row.metrics_updated_at as string) ?? null,
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

// ============================================
// Engagement Metrics
// ============================================

export interface TweetMetrics {
  likes: number;
  reposts: number;
  replies: number;
  impressions: number;
}

/**
 * Fetches public metrics for a single tweet from X API v2.
 */
export async function fetchTweetMetrics(tweetId: string): Promise<TweetMetrics | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  try {
    const response = await fetch(
      `/api/x/2/tweets/${tweetId}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      console.warn(`${LOG_PREFIX} Failed to fetch metrics for tweet ${tweetId}`, { status: response.status });
      return null;
    }

    const result = await response.json();
    const metrics = result.data?.public_metrics;
    if (!metrics) return null;

    return {
      likes: metrics.like_count ?? 0,
      reposts: metrics.retweet_count ?? 0,
      replies: metrics.reply_count ?? 0,
      impressions: metrics.impression_count ?? 0,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Error fetching metrics for tweet ${tweetId}`, { error });
    return null;
  }
}

/**
 * Refreshes engagement metrics for all posted tweets from the last 7 days.
 * Updates the DB rows in place.
 */
export async function refreshRecentTweetMetrics(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentTweets, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("id, tweet_id")
    .eq("status", "posted")
    .not("tweet_id", "is", null)
    .gte("posted_at", sevenDaysAgo.toISOString())
    .order("posted_at", { ascending: false });

  if (error || !recentTweets || recentTweets.length === 0) {
    return 0;
  }

  console.log(`${LOG_PREFIX} Refreshing metrics for ${recentTweets.length} tweets`);
  let updated = 0;

  for (const tweet of recentTweets) {
    const metrics = await fetchTweetMetrics(tweet.tweet_id);
    if (!metrics) continue;

    const { error: updateError } = await supabase
      .from(TABLES.TWEET_DRAFTS)
      .update({
        like_count: metrics.likes,
        repost_count: metrics.reposts,
        reply_count: metrics.replies,
        impression_count: metrics.impressions,
        metrics_updated_at: new Date().toISOString(),
      })
      .eq("id", tweet.id);

    if (!updateError) updated++;
  }

  console.log(`${LOG_PREFIX} Metrics refreshed for ${updated}/${recentTweets.length} tweets`);
  return updated;
}

// ============================================
// User Identity
// ============================================

let cachedUserId: string | null = null;

/**
 * Returns the authenticated user's X user ID.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  try {
    const response = await fetch("/api/x/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.warn(`${LOG_PREFIX} Failed to fetch user ID`, { status: response.status });
      return null;
    }

    const data = await response.json();
    cachedUserId = data.data.id;
    if (!cachedUsername) cachedUsername = data.data.username;
    return cachedUserId;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error fetching user ID`, { error });
    return null;
  }
}

// ============================================
// Mentions
// ============================================

export interface XMention {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  text: string;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  createdAt: string;
}

/**
 * Fetches recent @mentions for the authenticated user.
 * Returns only new mentions since the given sinceId.
 */
export async function fetchMentions(sinceId?: string): Promise<XMention[]> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return [];

  const userId = await getAuthenticatedUserId();
  if (!userId) return [];

  let url = `/api/x/2/users/${userId}/mentions?tweet.fields=created_at,conversation_id,in_reply_to_user_id,author_id&expansions=author_id&user.fields=username&max_results=10`;
  if (sinceId) url += `&since_id=${sinceId}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.warn(`${LOG_PREFIX} Mentions fetch failed`, { status: response.status });
      return [];
    }

    const result = await response.json();
    const tweets = result.data || [];
    const users = result.includes?.users || [];

    // Build username lookup
    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.id, user.username);
    }

    return tweets.map((tweet: Record<string, unknown>) => ({
      tweetId: tweet.id as string,
      authorId: tweet.author_id as string,
      authorUsername: userMap.get(tweet.author_id as string) || "unknown",
      text: tweet.text as string,
      conversationId: (tweet.conversation_id as string) || null,
      inReplyToTweetId: (tweet.in_reply_to_user_id as string) || null,
      createdAt: (tweet.created_at as string) || new Date().toISOString(),
    }));
  } catch (error) {
    console.error(`${LOG_PREFIX} Error fetching mentions`, { error });
    return [];
  }
}

/**
 * Posts a reply to a specific tweet.
 */
export async function postReply(
  text: string,
  inReplyToTweetId: string,
): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  console.log(`${LOG_PREFIX} Posting reply`, { length: text.length, inReplyTo: inReplyToTweetId });

  const response = await fetch("/api/x/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: inReplyToTweetId },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} Reply posting failed`, { status: response.status, error: errorText });
    throw new Error(`Reply posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  console.log(`${LOG_PREFIX} Reply posted`, { tweetId, tweetUrl });
  return { tweetId, tweetUrl };
}

// ============================================
// Mention Storage (x_mentions table)
// ============================================

export interface StoredMention {
  id: string;
  tweetId: string;
  authorId: string;
  authorUsername: string;
  text: string;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  status: "pending" | "reply_drafted" | "replied" | "ignored" | "skipped";
  replyText: string | null;
  replyTweetId: string | null;
  isKnownUser: boolean;
  createdAt: string;
  repliedAt: string | null;
}

function mapMentionRow(row: Record<string, unknown>): StoredMention {
  return {
    id: row.id as string,
    tweetId: row.tweet_id as string,
    authorId: row.author_id as string,
    authorUsername: row.author_username as string,
    text: row.text as string,
    conversationId: (row.conversation_id as string) ?? null,
    inReplyToTweetId: (row.in_reply_to_tweet_id as string) ?? null,
    status: row.status as StoredMention["status"],
    replyText: (row.reply_text as string) ?? null,
    replyTweetId: (row.reply_tweet_id as string) ?? null,
    isKnownUser: (row.is_known_user as boolean) ?? false,
    createdAt: row.created_at as string,
    repliedAt: (row.replied_at as string) ?? null,
  };
}

/**
 * Stores new mentions in the DB, skipping duplicates.
 * Returns the number of newly stored mentions.
 */
export async function storeMentions(
  mentions: XMention[],
  knownUsernames: Set<string>,
): Promise<number> {
  if (mentions.length === 0) return 0;

  let stored = 0;
  for (const mention of mentions) {
    const isKnown = knownUsernames.has(mention.authorUsername.toLowerCase());

    const { error } = await supabase
      .from("x_mentions")
      .upsert(
        {
          tweet_id: mention.tweetId,
          author_id: mention.authorId,
          author_username: mention.authorUsername,
          text: mention.text,
          conversation_id: mention.conversationId,
          in_reply_to_tweet_id: mention.inReplyToTweetId,
          is_known_user: isKnown,
          status: "pending",
        },
        { onConflict: "tweet_id", ignoreDuplicates: true },
      );

    if (!error) stored++;
  }

  console.log(`${LOG_PREFIX} Stored ${stored}/${mentions.length} new mentions`);
  return stored;
}

/**
 * Fetches mentions by status.
 */
export async function getMentions(
  status?: StoredMention["status"],
  limit: number = 10,
): Promise<StoredMention[]> {
  let query = supabase
    .from("x_mentions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error || !data) {
    if (error) console.error(`${LOG_PREFIX} Failed to fetch mentions`, { error });
    return [];
  }

  return data.map(mapMentionRow);
}

/**
 * Updates a mention's status and optional fields.
 */
export async function updateMentionStatus(
  id: string,
  status: StoredMention["status"],
  extra?: Record<string, unknown>,
): Promise<boolean> {
  const updates: Record<string, unknown> = { status, ...extra };

  const { error } = await supabase
    .from("x_mentions")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to update mention`, { id, status, error });
    return false;
  }

  console.log(`${LOG_PREFIX} Mention status updated`, { id, status });
  return true;
}

/**
 * Gets the most recent mention tweet_id for use as since_id in polling.
 */
export async function getLatestMentionTweetId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("x_mentions")
    .select("tweet_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.tweet_id as string;
}

/**
 * Returns the set of known X usernames from user_facts.
 */
export async function getKnownXUsernames(): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_facts")
    .select("fact_value")
    .eq("category", "preference")
    .eq("fact_key", "x_known_users")
    .limit(1)
    .maybeSingle();

  if (!data?.fact_value) return new Set();

  return new Set(
    (data.fact_value as string)
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter((u) => u.length > 0),
  );
}
