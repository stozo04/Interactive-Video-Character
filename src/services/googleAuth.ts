// src/services/googleAuth.ts

// This is the (safer) scope we need. It lets us read headers and
// snippets, but NOT the full email body.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

/**
 * Stores session info in localStorage.
 */
export interface GmailSession {
  email: string;
  accessToken: string;
  expiresAt: number; // Timestamp (Date.now() + expiresIn * 1000)
}

const SESSION_KEY = "gmail_session";

// Helper to load the Google GIS script
let gisScriptLoaded: Promise<void> | null = null;
function loadGisScript(): Promise<void> {
  if (!gisScriptLoaded) {
    gisScriptLoaded = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google GIS script."));
      document.body.appendChild(script);
    });
  }
  return gisScriptLoaded;
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

  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: GMAIL_SCOPE,
      // 'prompt' is the key:
      // 'consent' = always show popup
      // '' (empty) = try silent sign-in
      prompt: forceConsent ? "consent" : "",
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          return reject(new Error(tokenResponse.error_description));
        }
        
        const expiresAt = Date.now() + Number(tokenResponse.expires_in) * 1000;
        resolve({
          accessToken: tokenResponse.access_token,
          expiresAt: expiresAt,
        });
      },
      error_callback: (error) => {
        reject(new Error(error.message));
      },
    });
    
    // Request the token
    client.requestAccessToken();
  });
}

/**
 * Fetches the user's email address (for display).
 * This also confirms the token is valid.
 */
export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch user profile.");
  }

  const data = await response.json();
  return data.emailAddress;
}

/**
 * Signs the user out by revoking the token.
 */
export function signOut(accessToken: string): Promise<void> {
  // This tells Google to invalidate the token.
  google.accounts.oauth2.revoke(accessToken, () => {
    console.log("Google token revoked.");
  });
  // Clear our local storage
  localStorage.removeItem(SESSION_KEY);
  return Promise.resolve();
}

// --- LocalStorage Helpers ---

export function saveSession(session: GmailSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession(): GmailSession | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }
  
  const session = JSON.parse(stored) as GmailSession;
  
  // Check if it's expired
  if (Date.now() > session.expiresAt) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  
  return session;
}