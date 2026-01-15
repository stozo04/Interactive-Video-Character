// src/services/googleAuth.ts

// Gmail scopes - using metadata scope for privacy
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
// Calendar scope for read/write access
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// User info scopes for authentication
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const USERINFO_PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";

// Combine all scopes into one array for Supabase
export const SCOPES_ARRAY = [GMAIL_SCOPE, CALENDAR_SCOPE, USERINFO_EMAIL_SCOPE, USERINFO_PROFILE_SCOPE];
const SCOPES = SCOPES_ARRAY.join(' ');

// Buffer time before token expiry to refresh (10 minutes)
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

/**
 * Stores session info in localStorage.
 */
export interface GmailSession {
  email: string;
  accessToken: string;
  expiresAt: number; // Timestamp (Date.now() + expiresIn * 1000)
  refreshedAt: number; // Timestamp of last refresh
}

/**
 * OAuth status for UI feedback
 */
export type AuthStatus = 
  | 'idle' 
  | 'loading' 
  | 'authenticating' 
  | 'connected' 
  | 'needs_reconnect'
  | 'refreshing' 
  | 'error';

const SESSION_KEY = "gmail_session";
const CONNECTED_KEY = "google_connected";
import { supabase } from './supabaseClient';
export { supabase };

// Global token client instance for refresh - still kept for potential UI needs
let tokenClientInstance: any = null;

// Helper to load the Google GIS script
let gisScriptLoaded: Promise<void> | null = null;

/**
 * Loads the Google Identity Services script
 */
function loadGisScript(): Promise<void> {
  if (!gisScriptLoaded) {
    gisScriptLoaded = new Promise((resolve, reject) => {
      // Check if script is already loaded
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        console.log('Google Identity Services script loaded');
        resolve();
      };
      script.onerror = () => {
        const error = new Error("Failed to load Google Identity Services script. Check your internet connection.");
        console.error(error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  }
  return gisScriptLoaded;
}

/**
 * Validates that Google Client ID is configured
 */
function validateClientId(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Google Client ID is not configured. Please set VITE_GOOGLE_CLIENT_ID in your environment variables."
    );
  }
  return clientId;
}

/**
 * Gets or creates the token client
 */
function getTokenClient(): any {
  if (!tokenClientInstance) {
    const clientId = validateClientId();
    tokenClientInstance = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {}, // Will be overridden per request
      error_callback: () => {}, // Will be overridden per request
    });
  }
  return tokenClientInstance;
}

/**
 * Gets a fresh access token from Google.
 * @param forceConsent - If true, will always show the Google "consent" screen.
 * If false (default), it will try a silent login first.
 */
/**
 * Gets a fresh access token from the Supabase session or local storage bridge.
 * Supabase handles the refresh_token automatically for its own session, 
 * but we manage the Google provider token persistence.
 */
export async function getAccessToken(): Promise<Omit<GmailSession, "email">> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('Error getting Supabase session:', error);
    throw error;
  }

  // Check if session has a provider token
  if (session?.provider_token) {
    console.log('✅ Provider token found in Supabase session');
    // Use standard 1-hour expiry for Google tokens
    const expiresAt = Date.now() + 3600 * 1000;
    return {
      accessToken: session.provider_token,
      expiresAt: expiresAt,
      refreshedAt: Date.now(),
    };
  }

  // Bridge: If Supabase has no token, check if we have a valid one in local storage
  const existingSession = getSession();
  if (existingSession && existingSession.accessToken) {
    const now = Date.now();
    // If it's still valid (with 30s safety margin), use it
    if (existingSession.expiresAt > now + 30000) {
      console.log('✅ Using cached provider token from bridge');
      return {
        accessToken: existingSession.accessToken,
        expiresAt: existingSession.expiresAt,
        refreshedAt: existingSession.refreshedAt,
      };
    }
  }

  throw new Error("No active Google session found in Supabase or bridge.");
}

/**
 * Refreshes an existing access token via Supabase
 */
export async function refreshAccessToken(): Promise<Omit<GmailSession, "email">> {
  console.log('Refreshing Supabase session...');
  const { data, error } = await supabase.auth.refreshSession();
  
  if (error) {
    console.warn('Supabase refresh call failed:', error);
    throw error;
  }

  const sbSession = data.session;
  
  // If Supabase returned a new provider token, use it
  if (sbSession?.provider_token) {
    console.log('✅ Refreshed Provider token present in Supabase response');
    return {
      accessToken: sbSession.provider_token,
      expiresAt: Date.now() + 3600 * 1000,
      refreshedAt: Date.now(),
    };
  }

  // If no provider token in refresh response, bridge to local storage if valid
  const existingSession = getSession();
  if (existingSession && existingSession.accessToken) {
    if (existingSession.expiresAt > Date.now() + 30000) {
      console.log('✅ Provider token missing in refresh, but bridging to valid local token');
      return {
        accessToken: existingSession.accessToken,
        expiresAt: existingSession.expiresAt,
        refreshedAt: existingSession.refreshedAt,
      };
    }
  }

  // If we reach here, we truly have no valid provider token
  throw new Error("PROVIDER_TOKEN_MISSING");
}

// Buffer time before token expiry to refresh (10 minutes)
// (Moved to top level)

/**
 * Checks if a session needs refresh and refreshes if necessary
 */
export async function ensureValidSession(
  session: GmailSession
): Promise<GmailSession> {
  const now = Date.now();
  const timeUntilExpiry = session.expiresAt - now;
  
  // If token expires within the buffer time, try to get a fresh one
  if (timeUntilExpiry < TOKEN_REFRESH_BUFFER_MS) {
    console.log(`Token expiring soon (${Math.round(timeUntilExpiry / 1000)}s), checking session...`);
    try {
      // getAccessToken() logic will return a fresh token if Supabase has refreshed it
      const { accessToken, expiresAt, refreshedAt } = await getAccessToken();
      
      const refreshedSession: GmailSession = {
        ...session,
        accessToken,
        expiresAt,
        refreshedAt,
      };
      saveSession(refreshedSession);
      return refreshedSession;
    } catch (error) {
      console.warn('Failed to get fresh token from Supabase, attempting explicit refresh:', error);
      try {
        const { accessToken, expiresAt, refreshedAt } = await refreshAccessToken();
        const refreshedSession: GmailSession = {
          ...session,
          accessToken,
          expiresAt,
          refreshedAt,
        };
        saveSession(refreshedSession);
        return refreshedSession;
      } catch (refreshError: any) {
        if (refreshError.message !== 'PROVIDER_TOKEN_MISSING') {
          console.warn('Failed to refresh Supabase session:', refreshError);
        }
        // Throw a specific error that can be caught to trigger a silent refresh or needs_reconnect
        throw new Error('AUTH_REFRESH_FAILED');
      }
    }
  }
  
  return session;
}

/**
 * Attempt a silent OAuth refresh
 */
export async function silentRefresh() {
  console.log('🔄 Attempting silent OAuth refresh...');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: SCOPES_ARRAY.join(' '),
      queryParams: {
        access_type: 'offline',
        prompt: 'none',
      },
      redirectTo: window.location.origin,
    },
  });
  return error;
}

/**
 * Fetches the user's profile (email and ID).
 * This also confirms the token is valid.
 */
export async function getUserProfile(accessToken: string): Promise<{ email: string; id: string }> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      throw new Error("Authentication token is invalid or expired.");
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.email) {
      throw new Error("No email address returned from Google.");
    }
    
    return { email: data.email, id: data.id };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
}

/**
 * Signs the user out by revoking the token.
 */
export async function signOut(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // Clear local storage
    clearSession();
    clearConnectedHint();
    console.log('Signed out from Supabase and cleared local session');
  } catch (error) {
    console.error('Error during sign out:', error);
    clearSession();
    clearConnectedHint();
  }
}

// --- LocalStorage Helpers ---

/**
 * Saves the session to localStorage.
 * SMART: Won't overwrite a valid access token with a null/empty one.
 */
export function saveSession(session: GmailSession): void {
  try {
    // Check if we already have a valid session and this new one is "empty"
    const current = getSession();
    if (current && current.accessToken && !session.accessToken) {
      console.log('Skipping session save: Attempted to overwrite valid token with empty one');
      return;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (session.accessToken) {
      setConnectedHint(true);
    }
    if (session.accessToken) {
      console.log('Session saved for:', session.email);
    }
  } catch (error) {
    console.error('Failed to save session:', error);
    throw new Error('Failed to save authentication session.');
  }
}

/**
 * Gets the session from localStorage
 */
export function getSession(): GmailSession | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      return null;
    }
    
    const session = JSON.parse(stored) as GmailSession;
    
    // Check if it's expired
    if (Date.now() > session.expiresAt) {
      console.log('Session expired, clearing...');
      clearSession();
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('Failed to load session:', error);
    clearSession();
    return null;
  }
}

/**
 * Clears the session from localStorage
 */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  console.log('Session cleared');
}

export function setConnectedHint(value: boolean): void {
  if (value) {
    localStorage.setItem(CONNECTED_KEY, "true");
  } else {
    localStorage.removeItem(CONNECTED_KEY);
  }
}

export function clearConnectedHint(): void {
  localStorage.removeItem(CONNECTED_KEY);
}

export function hasConnectedHint(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === "true";
}

/**
 * Checks if there is a valid session
 */
export function hasValidSession(): boolean {
  return getSession() !== null;
}

/**
 * Gets the time remaining until token expiry in milliseconds
 */
export function getTimeUntilExpiry(session: GmailSession): number {
  return Math.max(0, session.expiresAt - Date.now());
}
