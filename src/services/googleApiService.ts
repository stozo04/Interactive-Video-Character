/**
 * Google API Service
 *
 * Handles Google API key auth, configuration,
 * model listing, and config persistence via Supabase.
 *
 * All Google API calls are proxied through the Node server or Vite proxy
 * (/api/google) to bypass CORS.
 */

import { supabase } from "./supabaseClient";

const LOG_PREFIX = "[GoogleAPI]";

const TABLES = {
  AUTH_TOKENS: "google_api_auth_tokens",
  CONFIG: "google_api_config",
} as const;

// ============================================
// Types
// ============================================

export type GoogleAuthMode = "api_key" | "oauth";

export interface GoogleApiAuthTokens {
  id: string;
  auth_mode: GoogleAuthMode;
  api_key: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleModel {
  id: string;
  display_name: string;
  type: string;
  created_at?: string;
}

// ============================================
// API Key CRUD
// ============================================

export async function saveGoogleApiKey(apiKey: string): Promise<boolean> {
  try {
    // Upsert: clear any existing rows, insert new one
    await supabase.from(TABLES.AUTH_TOKENS).delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error } = await supabase.from(TABLES.AUTH_TOKENS).insert({
      auth_mode: "api_key",
      api_key: apiKey,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to save Google API key:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} saveGoogleApiKey error:`, err);
    return false;
  }
}

export async function getStoredGoogleAuth(): Promise<GoogleApiAuthTokens | null> {
  try {
    const { data, error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as GoogleApiAuthTokens;
  } catch {
    return null;
  }
}

export async function clearGoogleAuth(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLES.AUTH_TOKENS)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      console.error(`${LOG_PREFIX} clearGoogleAuth error:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} clearGoogleAuth error:`, err);
    return false;
  }
}

// ============================================
// Test Connectivity (via proxy)
// ============================================

export async function testGoogleApiKey(apiKey: string): Promise<{ ok: boolean; error?: string; models?: GoogleModel[] }> {
  try {
    // Use the Gemini models endpoint via proxy
    const res = await fetch(`/api/google/v1beta/models?key=${apiKey}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();

    if (res.ok && data.models) {
      const models = data.models.map((m: any) => ({
        id: m.name.replace('models/', ''),
        display_name: m.displayName || m.name,
        type: m.description || 'Model',
      }));
      return { ok: true, models };
    }

    return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    console.error(`${LOG_PREFIX} testGoogleApiKey error:`, err);
    return { ok: false, error: "Network error — check your proxy configuration." };
  }
}

// ============================================
// List Models (via proxy)
// ============================================

export async function listGoogleModels(apiKey: string): Promise<GoogleModel[]> {
  try {
    const res = await fetch(`/api/google/v1beta/models?key=${apiKey}`, {
      method: "GET",
    });

    if (!res.ok) {
      console.error(`${LOG_PREFIX} listGoogleModels failed:`, res.status);
      return [];
    }

    const data = await res.json();
    return (data.models || []).map((m: any) => ({
      id: m.name.replace('models/', ''),
      display_name: m.displayName || m.name,
      type: m.description || 'Model',
    }));
  } catch (err) {
    console.error(`${LOG_PREFIX} listGoogleModels error:`, err);
    return [];
  }
}

// ============================================
// Config CRUD (google_api_config table)
// ============================================

export async function getGoogleConfig(key: string): Promise<string | null> {
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

export async function setGoogleConfig(key: string, value: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(TABLES.CONFIG)
      .upsert({ config_key: key, config_value: value }, { onConflict: "config_key" });

    if (error) {
      console.error(`${LOG_PREFIX} setGoogleConfig error:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} setGoogleConfig error:`, err);
    return false;
  }
}
