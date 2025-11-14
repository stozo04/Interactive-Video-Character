// src/components/GmailConnectButton.tsx
import React, { useState, useEffect } from "react";
import * as auth from "../services/googleAuth";
import { gmailService } from "../services/gmailService";

// This type definition must be in a shared file
import { GmailSession } from "../services/googleAuth";

export function GmailConnectButton() {
  const [session, setSession] = useState<GmailSession | null>(null);
  const [status, setStatus] = useState<"idle" | "authenticating" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // On load, check if we're already logged in from localStorage
  useEffect(() => {
    const existingSession = auth.getSession();
    if (existingSession) {
      setSession(existingSession);
      setStatus("connected");
    }
  }, []);

  const handleConnect = async () => {
    setStatus("authenticating");
    setError(null);
    try {
      // 1. Get token. forceConsent = true to show popup.
      const { accessToken, expiresAt } = await auth.getAccessToken(true);
      
      // 2. Get user's email for display
      const email = await auth.getUserEmail(accessToken);
      
      // 3. Get the starting historyId for polling
      await gmailService.getInitialHistoryId(accessToken);
      
      // 4. Save session and update state
      const newSession: GmailSession = { email, accessToken, expiresAt };
      auth.saveSession(newSession);
      setSession(newSession);
      setStatus("connected");

    } catch (err: any) {
      setError(err.message || "Failed to connect.");
      setStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    if (session) {
      await auth.signOut(session.accessToken);
      setSession(null);
      setStatus("idle");
      // Note: We also clear localStorage.removeItem(HISTORY_ID_KEY)
      // in the auth.signOut() or here.
      localStorage.removeItem("gmail_history_id");
    }
  };

  if (status === "connected" && session) {
    return (
      <div>
        <p>Connected as: **{session.email}**</p>
        <button onClick={handleDisconnect}>Disconnect Gmail</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={handleConnect} disabled={status === "authenticating"}>
        {status === "authenticating" ? "Connecting..." : "Connect Gmail"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}