// server/services/googleTokenService.ts
//
// Server-side Google OAuth token management.
//
// The browser stores provider_refresh_token in google_api_auth_tokens on first sign-in.
// This service reads that row and keeps the access_token fresh indefinitely —
// triggered on demand (e.g. by a WhatsApp message), no browser required.
//
// Required env vars (server-side only, never exposed to browser):
//   VITE_GOOGLE_CLIENT_ID  — available via envShim from .env.local
//   GOOGLE_CLIENT_SECRET   — add to .env.local

import { supabaseAdmin as supabase } from './supabaseAdmin';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[GoogleTokenService]';
const runtimeLog = log.fromContext({ source: 'googleTokenService', route: 'server/auth' });

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Refresh 5 minutes before actual expiry to avoid races
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Returns a valid Google access token, refreshing it automatically if needed.
 *
 * Reads from the google_api_auth_tokens table (written by the browser on sign-in).
 * If the stored access token is still valid, returns it immediately.
 * If it has expired (or is within the 5-minute buffer), calls Google's token
 * endpoint with the stored refresh token, updates the DB, and returns the
 * fresh access token.
 *
 * Throws if no token row exists (user has never signed in) or if the
 * refresh call fails (revoked access).
 */
export async function getValidGoogleToken(): Promise<string> {
  // Read credentials at call-time, not module-init — the env shim may not be
  // fully hydrated when this module first loads (server startup race condition).
  const CLIENT_ID     = (globalThis as any).__importMetaEnv?.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  if (!CLIENT_ID) {
    throw new Error(`${LOG_PREFIX} VITE_GOOGLE_CLIENT_ID not configured`);
  }
  if (!CLIENT_SECRET) {
    throw new Error(`${LOG_PREFIX} GOOGLE_CLIENT_SECRET not configured — add it to .env.local`);
  }

  // 1. Load the stored token row
  const { data, error } = await supabase
    .from('google_api_auth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('auth_mode', 'oauth')
    .maybeSingle();

  if (error) {
    runtimeLog.error('Failed to read google_api_auth_tokens from Supabase', {
      source: 'googleTokenService',
      error: error.message,
    });
    throw new Error(`${LOG_PREFIX} DB read failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `${LOG_PREFIX} No OAuth token row found. Open the browser app and sign in with Google first.`
    );
  }

  if (!data.refresh_token) {
    throw new Error(
      `${LOG_PREFIX} refresh_token is missing. Re-open the browser app and sign in again (consent screen).`
    );
  }

  // 2. Check if the access token is still valid
  const expiresAt  = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const isValid    = !!data.access_token && expiresAt > Date.now() + REFRESH_BUFFER_MS;

  if (isValid) {
    runtimeLog.info('Google access token still valid, reusing', {
      source: 'googleTokenService',
      expiresInMs: expiresAt - Date.now(),
    });
    return data.access_token as string;
  }

  // 3. Token expired or expiring soon — call Google to refresh it
  runtimeLog.info('Google access token expired or expiring, refreshing via Google API', {
    source: 'googleTokenService',
    expiresAt: data.expires_at,
  });
  console.log(`${LOG_PREFIX} Refreshing Google access token...`);

  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: data.refresh_token as string,
    grant_type:    'refresh_token',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    runtimeLog.error('Google token refresh call failed', {
      source: 'googleTokenService',
      status: response.status,
      body: errText.substring(0, 200),
    });

    // Detect expired/revoked refresh token specifically — caller can send WA notification
    if (errText.includes('invalid_grant')) {
      throw new Error('GOOGLE_REFRESH_TOKEN_EXPIRED');
    }
    throw new Error(`${LOG_PREFIX} Token refresh failed (${response.status}): ${errText}`);
  }

  const tokenData = await response.json();
  const newAccessToken  = tokenData.access_token as string;
  const expiresInMs     = ((tokenData.expires_in as number) || 3600) * 1000;
  const newExpiresAt    = new Date(Date.now() + expiresInMs).toISOString();

  // 4. Persist the fresh token back to DB
  const { error: updateErr } = await supabase
    .from('google_api_auth_tokens')
    .update({
      access_token: newAccessToken,
      expires_at:   newExpiresAt,
    })
    .eq('auth_mode', 'oauth');

  if (updateErr) {
    // Non-fatal — we still return the token, just log the save failure
    runtimeLog.error('Failed to update refreshed token in DB', {
      source: 'googleTokenService',
      error: updateErr.message,
    });
  }

  console.log(`${LOG_PREFIX} ✅ Token refreshed, valid for ${Math.round(expiresInMs / 60000)} minutes`);
  runtimeLog.info('Google access token refreshed successfully', {
    source: 'googleTokenService',
    expiresInMs,
    newExpiresAt,
  });

  return newAccessToken;
}

/**
 * Returns how many days old the stored refresh token is, or null if unknown.
 * Used by the WA bridge to warn Steven before the 7-day Testing-mode expiry.
 */
export async function getTokenAgeDays(): Promise<number | null> {
  const { data } = await supabase
    .from('google_api_auth_tokens')
    .select('refresh_token_issued_at')
    .eq('auth_mode', 'oauth')
    .maybeSingle();

  if (!data?.refresh_token_issued_at) return null;

  const issuedAt = new Date(data.refresh_token_issued_at).getTime();
  return (Date.now() - issuedAt) / (1000 * 60 * 60 * 24);
}
