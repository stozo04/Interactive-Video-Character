// src/services/googleAuth.ts

// Gmail scopes - using metadata scope for privacy
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
// Calendar scope for read/write access
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

// Combine all scopes into one string
const SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE].join(' ');

// Buffer time before token expiry to refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Stores session info in localStorage.
 */
export interface GmailSession {
  email: string;
  accessToken: string;
  expiresAt: number; // Timestamp (Date.now() + expiresIn * 1000)
  refreshedAt: number; // Timestamp of last refresh
  user?: {
    id: string;
  }
}

/**
 * OAuth status for UI feedback
 */
export type AuthStatus = 
  | 'idle' 
  | 'loading' 
  | 'authenticating' 
  | 'connected' 
  | 'refreshing' 
  | 'error';

const SESSION_KEY = "gmail_session";

// Global token client instance for refresh
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
export async function getAccessToken(
  forceConsent = false
): Promise<Omit<GmailSession, "email">> {
  await loadGisScript();
  validateClientId();

  return new Promise((resolve, reject) => {
    try {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        // 'prompt' is the key:
        // 'consent' = always show popup
        // '' (empty) = try silent sign-in
        prompt: forceConsent ? "consent" : "",
        callback: (tokenResponse: any) => {
          if (tokenResponse.error) {
            const errorMsg = tokenResponse.error_description || tokenResponse.error;
            console.error('Token error:', errorMsg);
            return reject(new Error(errorMsg));
          }
          
          if (!tokenResponse.access_token) {
            return reject(new Error("No access token received from Google."));
          }
          
          const expiresAt = Date.now() + Number(tokenResponse.expires_in) * 1000;
          console.log('Access token obtained, expires in', tokenResponse.expires_in, 'seconds');
          
          resolve({
            accessToken: tokenResponse.access_token,
            expiresAt: expiresAt,
            refreshedAt: Date.now(),
            user: { id: 'legacy-user' } // Populate with real ID in getUserEmail step if possible, or leave as placeholder to be filled.
            // Actually, getAccessToken only resolves tokens. getUserEmail fetches profile. 
            // We should update getUserEmail to return ID as well.
          });
        },
        error_callback: (error: any) => {
          const errorMsg = error.message || error.type || 'Unknown error';
          console.error('OAuth error:', errorMsg);
          
          if (errorMsg.includes('popup_closed')) {
            reject(new Error("Authentication popup was closed. Please try again."));
          } else if (errorMsg.includes('popup_blocked')) {
            reject(new Error("Popup was blocked. Please allow popups for this site."));
          } else {
            reject(new Error(`Authentication failed: ${errorMsg}`));
          }
        },
      });
      
      // Request the token
      client.requestAccessToken();
    } catch (error) {
      console.error('Error initializing token client:', error);
      reject(error);
    }
  });
}

/**
 * Refreshes an existing access token
 */
export async function refreshAccessToken(): Promise<Omit<GmailSession, "email">> {
  console.log('Refreshing access token...');
  // For Google OAuth 2.0 with implicit flow, we need to request a new token
  // This will attempt silent authentication
  return getAccessToken(false);
}

/**
 * Checks if a session needs refresh and refreshes if necessary
 */
export async function ensureValidSession(
  session: GmailSession
): Promise<GmailSession> {
  const now = Date.now();
  const timeUntilExpiry = session.expiresAt - now;
  
  // If token expires within the buffer time, refresh it
  if (timeUntilExpiry < TOKEN_REFRESH_BUFFER_MS) {
    console.log('Token expiring soon, refreshing...');
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
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // Clear invalid session
      clearSession();
      throw new Error('Session expired. Please sign in again.');
    }
  }
  
  return session;
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
export async function signOut(accessToken: string): Promise<void> {
  try {
    await loadGisScript();
    
    // Revoke the token with Google
    return new Promise((resolve) => {
      google.accounts.oauth2.revoke(accessToken, (done: any) => {
        if (done.error) {
          console.warn('Error revoking token:', done.error);
        } else {
          console.log('Google token revoked successfully');
        }
        // Always clear local storage, even if revocation fails
        clearSession();
        resolve();
      });
    });
  } catch (error) {
    console.error('Error during sign out:', error);
    // Clear local storage even if revocation fails
    clearSession();
  }
}

// --- LocalStorage Helpers ---

/**
 * Saves the session to localStorage
 */
export function saveSession(session: GmailSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    console.log('Session saved for:', session.email);
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