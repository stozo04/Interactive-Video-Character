// server/services/xTwitterServerService.ts
//
// Server-owned X (Twitter) service. Handles OAuth, posting, draft CRUD,
// mention polling, and metrics without any browser-only assumptions.

import { createHash, randomBytes } from "node:crypto";
import { log } from "../runtimeLogger";
import { supabaseAdmin as supabase } from "./supabaseAdmin";
import { generateCompanionSelfie } from "../../src/services/imageGenerationService";

const runtimeLog = log.fromContext({ source: "xTwitterServerService" });

const AUTH_BASE_URL = "https://twitter.com/i/oauth2/authorize";
const X_API_BASE = "https://api.x.com/2";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const X_AUTH_SCOPES = "tweet.read tweet.write users.read offline.access media.write";

const X_CLIENT_ID = process.env.VITE_X_CLIENT_ID ?? "";
const X_CLIENT_SECRET = process.env.VITE_X_CLIENT_SECRET ?? "";
const X_CALLBACK_URL = process.env.VITE_X_CALLBACK_URL ?? process.env.X_CALLBACK_URL ?? "";

const TABLES = {
  AUTH_TOKENS: "x_auth_tokens",
  TWEET_DRAFTS: "x_tweet_drafts",
  MENTIONS: "x_mentions",
} as const;

const oauthStateStore = new Map<string, { codeVerifier: string; createdAt: number }>();

export interface XAuthTokens {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
}

export interface XAuthStatus {
  connected: boolean;
  scopes: string[];
  hasMediaWrite: boolean;
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
  includeSelfie: boolean;
  selfieScene: string | null;
  mediaId: string | null;
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

export interface TweetMetrics {
  likes: number;
  reposts: number;
  replies: number;
  impressions: number;
}

export interface XMention {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  text: string;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  createdAt: string;
}

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
  announcementText: string | null;
  announcementCreatedAt: string | null;
  telegramSentAt: string | null;
  whatsappSentAt: string | null;
  historyLoggedAt: string | null;
  createdAt: string;
  repliedAt: string | null;
}

export interface ResolveTweetDraftResult {
  success: boolean;
  action: "post" | "reject";
  draftId: string;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
}

function requireXCredentials(): void {
  if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
    throw new Error("X client credentials are not configured");
  }
}

function requireXCallbackUrl(): void {
  if (!X_CALLBACK_URL) {
    throw new Error("VITE_X_CALLBACK_URL is not configured");
  }
}

function pruneOAuthStateStore(nowMs: number = Date.now()): void {
  for (const [state, entry] of oauthStateStore.entries()) {
    if (nowMs - entry.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(state);
    }
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

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
    includeSelfie: (row.include_selfie as boolean) ?? false,
    selfieScene: (row.selfie_scene as string) ?? null,
    mediaId: (row.media_id as string) ?? null,
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
    announcementText: (row.announcement_text as string) ?? null,
    announcementCreatedAt: (row.announcement_created_at as string) ?? null,
    telegramSentAt: (row.telegram_sent_at as string) ?? null,
    whatsappSentAt: (row.whatsapp_sent_at as string) ?? null,
    historyLoggedAt: (row.history_logged_at as string) ?? null,
    createdAt: row.created_at as string,
    repliedAt: (row.replied_at as string) ?? null,
  };
}

export function parseMediaUploadResponse(result: unknown): string {
  const mediaId = (result as { data?: { id?: string } })?.data?.id;
  if (!mediaId) {
    throw new Error("Media upload failed: missing media id in response");
  }
  return mediaId;
}

async function storeTokens(tokenResponse: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();

  const { data: existing, error: selectError } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (selectError) {
    runtimeLog.error("Failed to read existing X tokens", { error: selectError.message });
  }

  if (existing?.id) {
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
      runtimeLog.error("Failed to update X tokens", { error: error.message });
      throw error;
    }
    return;
  }

  const { error } = await supabase.from(TABLES.AUTH_TOKENS).insert({
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: expiresAt,
    scope: tokenResponse.scope,
  });

  if (error) {
    runtimeLog.error("Failed to store X tokens", { error: error.message });
    throw error;
  }
}

export async function getStoredTokens(): Promise<XAuthTokens | null> {
  const { data, error } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    runtimeLog.error("Failed to read X auth tokens", { error: error.message });
    return null;
  }

  return data as XAuthTokens | null;
}

async function refreshXToken(refreshToken: string): Promise<string | null> {
  requireXCredentials();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: X_CLIENT_ID,
  });

  const response = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    runtimeLog.error("X token refresh failed", { status: response.status, error: errorText });
    return null;
  }

  const tokens = await response.json();
  await storeTokens(tokens);
  return tokens.access_token as string;
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();
  if (!tokens) return null;

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();

  if (now < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return tokens.access_token;
  }

  runtimeLog.info("X token expired or expiring soon, refreshing");
  return await refreshXToken(tokens.refresh_token);
}

let cachedUsername: string | null = null;
let cachedUserId: string | null = null;

async function getAuthenticatedUsername(accessToken: string): Promise<string> {
  if (cachedUsername) return cachedUsername;

  const response = await fetch(`${X_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    runtimeLog.warning("Failed to fetch X username, using fallback", {
      status: response.status,
    });
    return "i";
  }

  const data = await response.json();
  cachedUsername = data.data.username;
  cachedUserId = data.data.id;
  return cachedUsername;
}

export async function getAuthenticatedUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const response = await fetch(`${X_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    runtimeLog.warning("Failed to fetch X user id", { status: response.status });
    return null;
  }

  const data = await response.json();
  cachedUserId = data.data.id;
  cachedUsername = data.data.username;
  return cachedUserId;
}

export async function initXAuth(): Promise<string> {
  requireXCredentials();
  requireXCallbackUrl();

  pruneOAuthStateStore();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateCodeVerifier();

  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: X_CLIENT_ID,
    redirect_uri: X_CALLBACK_URL,
    scope: X_AUTH_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTH_BASE_URL}?${params.toString()}`;
}

export async function handleXAuthCallback(code: string, state: string): Promise<void> {
  requireXCredentials();
  requireXCallbackUrl();

  pruneOAuthStateStore();
  const stateEntry = oauthStateStore.get(state);
  if (!stateEntry) {
    throw new Error("OAuth state mismatch or expired state");
  }
  oauthStateStore.delete(state);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: X_CALLBACK_URL,
    code_verifier: stateEntry.codeVerifier,
  });

  const response = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const tokens = await response.json();
  await storeTokens(tokens);
  cachedUsername = null;
  cachedUserId = null;
}

export async function isXConnected(): Promise<boolean> {
  if (!X_CLIENT_ID || !X_CLIENT_SECRET) return false;
  const token = await getValidAccessToken();
  return token !== null;
}

export async function hasXScope(scope: string): Promise<boolean | null> {
  const tokens = await getStoredTokens();
  if (!tokens?.scope) return null;
  return tokens.scope.split(" ").includes(scope);
}

export async function getXAuthStatus(): Promise<XAuthStatus> {
  const connected = await isXConnected();
  const tokens = connected ? await getStoredTokens() : null;
  const scopes = tokens?.scope?.split(" ").filter(Boolean) ?? [];
  return {
    connected,
    scopes,
    hasMediaWrite: scopes.includes("media.write"),
  };
}

export async function revokeXAuth(): Promise<void> {
  requireXCredentials();
  const tokens = await getStoredTokens();
  if (!tokens) return;

  try {
    await fetch(`${X_API_BASE}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        token: tokens.access_token,
        token_type_hint: "access_token",
      }).toString(),
    });
  } catch (error) {
    runtimeLog.warning("Token revocation call failed; continuing with local cleanup", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const { error } = await supabase
    .from(TABLES.AUTH_TOKENS)
    .delete()
    .eq("id", tokens.id);

  if (error) {
    runtimeLog.error("Failed to delete X tokens", { error: error.message });
    throw error;
  }

  cachedUsername = null;
  cachedUserId = null;
}

export async function postTweet(text: string): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("X account not connected - no valid access token");
  }

  const response = await fetch(`${X_API_BASE}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`Tweet posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  return { tweetId, tweetUrl };
}

export async function uploadMedia(
  imageBase64: string,
  mimeType: string = "image/jpeg",
): Promise<string> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const tokens = await getStoredTokens();
  if (!tokens?.scope?.includes("media.write")) {
    throw new Error("X token missing media.write scope - reconnect X account to grant media permissions");
  }

  const cleanedBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  const buffer = Buffer.from(cleanedBase64, "base64");
  const maxBytes = 5 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error("Media upload failed: image exceeds 5 MB limit");
  }

  const supportedTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  if (!supportedTypes.has(mimeType)) {
    throw new Error(`Media upload failed: unsupported image type ${mimeType}`);
  }

  const formData = new FormData();
  formData.append("media", new Blob([buffer], { type: mimeType }), "image");
  formData.append("media_category", "tweet_image");

  const response = await fetch(`${X_API_BASE}/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`Media upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return parseMediaUploadResponse(result);
}

export async function postTweetWithMedia(
  text: string,
  mediaIds: string[],
): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const response = await fetch(`${X_API_BASE}/tweets`, {
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
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`Tweet posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  return { tweetId, tweetUrl };
}

export async function createDraft(
  tweetText: string,
  intent: string,
  reasoning: string,
  generationContext: Record<string, unknown>,
  status: "pending_approval" | "queued" = "pending_approval",
  options?: {
    include_selfie?: boolean;
    selfie_scene?: string | null;
  },
): Promise<XTweetDraft | null> {
  const includeSelfie = options?.include_selfie ?? (generationContext.include_selfie === true);
  const selfieScene = options?.selfie_scene ??
    (typeof generationContext.selfie_scene === "string" ? generationContext.selfie_scene : null);

  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .insert({
      tweet_text: tweetText,
      status,
      intent,
      reasoning,
      generation_context: generationContext,
      include_selfie: includeSelfie,
      selfie_scene: selfieScene,
    })
    .select()
    .single();

  if (error || !data) {
    runtimeLog.error("Failed to create X tweet draft", {
      error: error?.message ?? "unknown",
      status,
      textLength: tweetText.length,
    });
    return null;
  }

  return mapDraftRow(data);
}

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
    if (error) {
      runtimeLog.error("Failed to fetch X tweet drafts", { error: error.message, status: status ?? null });
    }
    return [];
  }

  return data.map(mapDraftRow);
}

export async function getDraftById(id: string): Promise<XTweetDraft | null> {
  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch X tweet draft", { id, error: error.message });
    }
    return null;
  }

  return mapDraftRow(data);
}

export async function getPendingDraftForConversationScope(
  conversationScopeId: string,
): Promise<XTweetDraft | null> {
  if (!conversationScopeId) return null;

  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("status", "pending_approval")
    .filter("generation_context->>conversationScopeId", "eq", conversationScopeId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch pending X tweet draft", {
        conversationScopeId,
        error: error.message,
      });
    }
    return null;
  }

  return mapDraftRow(data);
}

export async function getOldestPendingDraft(): Promise<XTweetDraft | null> {
  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("status", "pending_approval")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch oldest pending X tweet draft", {
        error: error.message,
      });
    }
    return null;
  }

  return mapDraftRow(data);
}

export async function updateDraftStatus(
  id: string,
  status: XTweetDraft["status"],
  extra?: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .update({ status, ...extra })
    .eq("id", id);

  if (error) {
    runtimeLog.error("Failed to update X tweet draft", { id, status, error: error.message });
    return false;
  }

  return true;
}

export async function getRecentPostedTweets(limit: number = 20): Promise<XTweetDraft[]> {
  const { data, error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .select("*")
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch recent posted tweets", { error: error.message });
    }
    return [];
  }

  return data.map(mapDraftRow);
}

async function markDraftFailed(draftId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from(TABLES.TWEET_DRAFTS)
    .update({
      status: "failed",
      error_message: message,
    })
    .eq("id", draftId);

  if (error) {
    runtimeLog.error("Failed to mark X tweet draft as failed", {
      draftId,
      error: error.message,
      originalError: message,
    });
  }
}

export async function resolveTweetDraft(
  draftId: string,
  action: "post" | "reject",
): Promise<ResolveTweetDraftResult> {
  const draft = await getDraftById(draftId);
  if (!draft) {
    return {
      success: false,
      action,
      draftId,
      error: "Draft not found.",
    };
  }

  if (draft.status !== "pending_approval") {
    return {
      success: false,
      action,
      draftId,
      error: "Draft is not pending approval.",
    };
  }

  if (action === "reject") {
    const updated = await updateDraftStatus(draftId, "rejected", {
      rejection_reason: "Rejected from approval flow",
    });

    return updated
      ? { success: true, action, draftId }
      : { success: false, action, draftId, error: "Failed to reject draft." };
  }

  let mediaId: string | null = null;
  try {
    if (draft.includeSelfie) {
      if (!draft.selfieScene) {
        throw new Error("Draft requested a selfie but selfie_scene is missing.");
      }

      const selfie = await generateCompanionSelfie({
        scene: draft.selfieScene,
        mood: draft.intent === "humor" ? "playful" : "casual",
        userMessage: draft.selfieScene,
        conversationHistory: [],
      });

      if (!selfie.success || !selfie.imageBase64) {
        throw new Error("Selfie generation failed for approved tweet draft.");
      }

      mediaId = await uploadMedia(selfie.imageBase64, selfie.mimeType || "image/jpeg");
    }

    const posted = mediaId
      ? await postTweetWithMedia(draft.tweetText, [mediaId])
      : await postTweet(draft.tweetText);

    const updated = await updateDraftStatus(draftId, "posted", {
      tweet_id: posted.tweetId,
      tweet_url: posted.tweetUrl,
      posted_at: new Date().toISOString(),
      ...(mediaId ? { media_id: mediaId } : {}),
    });

    if (!updated) {
      return {
        success: false,
        action,
        draftId,
        error: "Tweet posted but failed to update draft.",
      };
    }

    return {
      success: true,
      action,
      draftId,
      tweetId: posted.tweetId,
      tweetUrl: posted.tweetUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markDraftFailed(draftId, message);
    return {
      success: false,
      action,
      draftId,
      error: message,
    };
  }
}

export async function fetchTweetMetrics(tweetId: string): Promise<TweetMetrics | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  try {
    const response = await fetch(
      `${X_API_BASE}/tweets/${tweetId}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      runtimeLog.warning("Failed to fetch tweet metrics", { tweetId, status: response.status });
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
    runtimeLog.error("Failed to fetch tweet metrics", {
      tweetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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

  let updated = 0;
  for (const tweet of recentTweets) {
    const metrics = await fetchTweetMetrics(tweet.tweet_id as string);
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

    if (!updateError) {
      updated += 1;
    }
  }

  return updated;
}

export async function fetchMentions(sinceId?: string): Promise<XMention[]> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return [];

  const userId = await getAuthenticatedUserId();
  if (!userId) return [];

  const url = new URL(`${X_API_BASE}/users/${userId}/mentions`);
  url.searchParams.set("tweet.fields", "created_at,conversation_id,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  url.searchParams.set("max_results", "10");
  if (sinceId) url.searchParams.set("since_id", sinceId);

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(unreadable)");
      runtimeLog.warning("Mentions fetch failed", { status: response.status, body: errorBody });
      return [];
    }

    const result = await response.json();
    const tweets = result.data ?? [];
    const users = result.includes?.users ?? [];
    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.id, user.username);
    }

    return tweets.map((tweet: Record<string, unknown>) => ({
      tweetId: tweet.id as string,
      authorId: tweet.author_id as string,
      authorUsername: userMap.get(tweet.author_id as string) ?? "unknown",
      text: tweet.text as string,
      conversationId: (tweet.conversation_id as string) ?? null,
      inReplyToTweetId: null,
      createdAt: (tweet.created_at as string) ?? new Date().toISOString(),
    }));
  } catch (error) {
    runtimeLog.error("Failed to fetch mentions", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function postReply(
  text: string,
  inReplyToTweetId: string,
): Promise<{ tweetId: string; tweetUrl: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("X account not connected");

  const response = await fetch(`${X_API_BASE}/tweets`, {
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
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`Reply posting failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const tweetId = result.data.id;
  const username = await getAuthenticatedUsername(accessToken);
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  return { tweetId, tweetUrl };
}

export async function storeMentions(
  mentions: XMention[],
  knownUsernames: Set<string>,
): Promise<number> {
  if (mentions.length === 0) return 0;

  let stored = 0;
  for (const mention of mentions) {
    const normalizedAuthor = normalizeXUsername(mention.authorUsername);
    const isKnown = normalizedAuthor ? knownUsernames.has(normalizedAuthor) : false;
    const { error } = await supabase
      .from(TABLES.MENTIONS)
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

    if (!error) {
      stored += 1;
    }
  }

  return stored;
}

export async function getMentions(
  status?: StoredMention["status"],
  limit: number = 10,
): Promise<StoredMention[]> {
  let query = supabase
    .from(TABLES.MENTIONS)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch X mentions", { error: error.message, status: status ?? null });
    }
    return [];
  }

  return data.map(mapMentionRow);
}

export async function getMentionsByTweetIds(tweetIds: string[]): Promise<StoredMention[]> {
  if (tweetIds.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLES.MENTIONS)
    .select("*")
    .in("tweet_id", tweetIds);

  if (error || !data) {
    if (error) {
      runtimeLog.error("Failed to fetch X mentions by tweet ids", {
        error: error.message,
        tweetIds,
      });
    }
    return [];
  }

  return data.map(mapMentionRow);
}

export async function updateMentionStatus(
  id: string,
  status: StoredMention["status"],
  extra?: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase
    .from(TABLES.MENTIONS)
    .update({ status, ...extra })
    .eq("id", id);

  if (error) {
    runtimeLog.error("Failed to update X mention", { id, status, error: error.message });
    return false;
  }

  return true;
}

export async function queueMentionAnnouncement(
  mentionId: string,
  message: string,
): Promise<boolean> {
  const { error } = await supabase
    .from(TABLES.MENTIONS)
    .update({
      announcement_text: message,
      announcement_created_at: new Date().toISOString(),
    })
    .eq("id", mentionId)
    .is("announcement_created_at", null);

  if (error) {
    runtimeLog.error("Failed to queue X mention announcement", {
      mentionId,
      error: error.message,
    });
    return false;
  }

  return true;
}

export async function markMentionAnnouncementDelivered(
  mentionId: string,
  channel: "telegram" | "whatsapp",
): Promise<boolean> {
  const column = channel === "telegram" ? "telegram_sent_at" : "whatsapp_sent_at";
  const { error } = await supabase
    .from(TABLES.MENTIONS)
    .update({
      [column]: new Date().toISOString(),
    })
    .eq("id", mentionId);

  if (error) {
    runtimeLog.error("Failed to mark X mention announcement delivered", {
      mentionId,
      channel,
      error: error.message,
    });
    return false;
  }

  return true;
}

export async function markMentionAnnouncementHistoryLogged(
  mentionId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from(TABLES.MENTIONS)
    .update({
      history_logged_at: new Date().toISOString(),
    })
    .eq("id", mentionId)
    .is("history_logged_at", null);

  if (error) {
    runtimeLog.error("Failed to mark X mention announcement history logged", {
      mentionId,
      error: error.message,
    });
    return false;
  }

  return true;
}

export async function getLatestMentionTweetId(): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLES.MENTIONS)
    .select("tweet_id")
    .order("tweet_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.tweet_id as string;
}

function normalizeXUsername(username: string | null | undefined): string | null {
  if (!username) return null;
  const normalized = username.trim().toLowerCase().replace(/^@+/, "");
  return normalized.length > 0 ? normalized : null;
}

export async function getKnownXUsernames(): Promise<Set<string>> {
  const [factResult, historicalResult] = await Promise.all([
    supabase
      .from("user_facts")
      .select("fact_value")
      .eq("category", "preference")
      .eq("fact_key", "x_known_users")
      .limit(1)
      .maybeSingle(),
    supabase
      .from(TABLES.MENTIONS)
      .select("author_username, is_known_user, status")
      .not("author_username", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const envKnownUsers = [
    process.env.X_KNOWN_USERS,
    process.env.TWITTER_KNOWN_USERS,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((username) => normalizeXUsername(username))
    .filter((username): username is string => !!username);

  const factKnownUsers = String(factResult.data?.fact_value || "")
    .split(",")
    .map((username) => normalizeXUsername(username))
    .filter((username): username is string => !!username);

  const historicalKnownUsers = (historicalResult.data || [])
    .filter(
      (row) =>
        row.is_known_user === true ||
        row.status === "reply_drafted" ||
        row.status === "replied",
    )
    .map((row) => normalizeXUsername(row.author_username as string | null))
    .filter((username): username is string => !!username);

  return new Set([
    ...envKnownUsers,
    ...factKnownUsers,
    ...historicalKnownUsers,
  ]);
}

export async function reclassifyKnownPendingMentions(
  knownUsernames: Set<string>,
): Promise<StoredMention[]> {
  if (knownUsernames.size === 0) return [];

  const { data, error } = await supabase
    .from(TABLES.MENTIONS)
    .select("*")
    .eq("status", "pending")
    .eq("is_known_user", false)
    .not("author_username", "is", null)
    .limit(50);

  if (error || !data?.length) {
    if (error) {
      runtimeLog.error("Failed to load pending mentions for known-user reclassification", {
        error: error.message,
      });
    }
    return [];
  }

  const mentionsToUpdate = data
    .filter((row) => {
      const normalized = normalizeXUsername(row.author_username as string | null);
      return normalized ? knownUsernames.has(normalized) : false;
    });

  if (mentionsToUpdate.length === 0) return [];

  const idsToUpdate = mentionsToUpdate.map((row) => row.id as string);

  const { error: updateError } = await supabase
    .from(TABLES.MENTIONS)
    .update({ is_known_user: true })
    .in("id", idsToUpdate);

  if (updateError) {
    runtimeLog.error("Failed to reclassify pending mentions as known users", {
      error: updateError.message,
      mentionCount: idsToUpdate.length,
    });
    return [];
  }

  return mentionsToUpdate.map((row) =>
    mapMentionRow({
      ...row,
      is_known_user: true,
    }),
  );
}

export function formatTweetApprovalPrompt(draft: Pick<XTweetDraft, "tweetText" | "includeSelfie" | "selfieScene">): string {
  const selfieLine = draft.includeSelfie
    ? `Selfie: yes${draft.selfieScene ? ` (${draft.selfieScene})` : ""}`
    : "Selfie: no";

  return [
    "Tweet draft pending approval:",
    `"${draft.tweetText}"`,
    selfieLine,
    "Reply with POST TWEET to publish it or REJECT TWEET to reject it.",
  ].join("\n");
}

export function parseTweetApprovalAction(text: string): "post" | "reject" | null {
  const normalized = text.trim().toUpperCase();
  if (!normalized) return null;

  const postPhrases = new Set([
    "POST TWEET",
    "APPROVE TWEET",
    "POST IT",
    "APPROVE",
    "YES",
    "YEAH",
    "YEP",
    "YUP",
    "DO IT",
    "DOOO IT",
    "LETS DO IT",
    "LET'S DO IT",
    "LETS DOO IT",
    "LET'S DOO IT",
    "SEND IT",
    "PUBLISH IT",
    "POST",
    "GO AHEAD",
  ]);

  const rejectPhrases = new Set([
    "REJECT TWEET",
    "DISCARD TWEET",
    "REJECT IT",
    "REJECT",
    "DISCARD",
    "SKIP IT",
    "SKIP",
    "NO",
    "NOPE",
    "DONT POST",
    "DON'T POST",
    "CANCEL TWEET",
    "CANCEL",
  ]);

  if (postPhrases.has(normalized)) {
    return "post";
  }
  if (rejectPhrases.has(normalized)) {
    return "reject";
  }
  return null;
}
