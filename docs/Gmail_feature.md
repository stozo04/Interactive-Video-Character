# Gmail Integration Feature Plan

This document outlines the step-by-step implementation for integrating Google Gmail into the AI Character Companion application.

---

## Phase 1: Google Cloud Setup (The "Plumbing")

Before you write a single line of code, you need to tell Google your app exists.

1.  **Go to the Google Cloud Console:** Log in at [console.cloud.google.com](https://console.cloud.google.com).
2.  **Create a New Project:** If you don't have one already, create a new project (e.g., "AI Character Companion").
3.  **Enable the Gmail API:**
    * In the search bar, type "Gmail API" and select it.
    * Click the **"Enable"** button.
4.  **Create Credentials:**
    * Go to "APIs & Services" > **"Credentials"** in the left-hand menu.
    * Click **"+ Create Credentials"** at the top and select **"OAuth 2.0 Client ID"**.
    * Set the "Application type" to **"Web application"**.
    * Give it a name (e.g., "AI Companion Web Client").
5.  **Configure Client ID:** This is the most important part.
    * Under **"Authorized JavaScript origins"**, you *must* add your development server's URL. For a standard Vite app, this is `http://localhost:5173`. It's also wise to add `http://localhost`.
    * You can leave "Authorized redirect URIs" blank for this (GIS) flow.
    * Click **"Create"**.
6.  **Get Your Client ID:**
    * A pop-up will show you your **"Client ID"**. It will look something like `123456789-abc...apps.googleusercontent.com`.
    * Copy this value. You will need it in the next phase.
7.  **Configure the OAuth Consent Screen:**
    * Go to the **"OAuth consent screen"** tab on the left.
    * Select **"External"** and click "Create".
    * Fill in the required fields (App name, User support email, Developer contact). You can leave the rest blank for now.
    * On the "Scopes" page, *you can leave it blank*. We will request scopes from our code.
    * On the "Test users" page, **ADD YOUR OWN GMAIL ADDRESS**. This is critical. While in "Testing" mode, only accounts listed here are allowed to log in.
    * Save and go back to the dashboard.

> **IMPORTANT:** Your app is now in "Testing" mode. This means when *you* log in, you will see an "unverified app" warning screen. This is normal. Just click "Advanced" -> "Go to (your app name)" to proceed. You must be logged in with the email you added as a "Test user".

---

## Phase 2: Environment Setup (Connecting Code to Cloud)

1.  **Create `.env.local` file:** In the root of your project, create a file named `.env.local`.
2.  **Add Client ID:** Add the Client ID you copied from Phase 1.

    ```.env
    VITE_GOOGLE_CLIENT_ID="YOUR-CLIENT-ID-GOES-HERE.apps.googleusercontent.com"
    VITE_GMAIL_POLL_INTERVAL_MS=60000
    ```
    *(A poll interval of 60,000ms = 60 seconds is a good starting point.)*

3.  **Update `.gitignore`:** Ensure `.env.local` is in your `.gitignore` file. You must never commit secret keys.

---

## Phase 3: The Authentication Service (`src/services/googleAuth.ts`)

This file's only job is to handle Google Sign-In (GIS) and give you an access token. 

---

## Phase 4: The Gmail Service (src/services/gmailService.ts)
This file handles the actual Gmail logic: polling, fetching headers, and telling the app when new mail arrives.

---

## Phase 5: UI & State (src/App.tsx and Components)
This is where you tie everything to your React state and UI.

src/components/GmailConnectButton.tsx
This component manages its own state and handles the auth flow.

src/App.tsx (Polling & Chat Bridge)
Now, App.tsx just needs to start the polling after the GmailConnectButton has established a session.

// src/App.tsx (Partial)
import React, { useState, useEffect } from "react";
import { GmailConnectButton } from "./components/GmailConnectButton";
import { gmailService, NewEmailPayload } from "./services/gmailService";
import * as auth from "./services/googleAuth";
import { useDebounce } from "./hooks/useDebounce"; // (You'll need to create this)

// A simple debounce hook (create in src/hooks/useDebounce.ts)
// export const useDebounce = (callback, delay) => { ... }

function App() {
  // ... your other app state (chatHistory, etc.)
  const [gmailSession, setGmailSession] = useState<auth.GmailSession | null>(
    auth.getSession()
  );
  
  // This state will hold new emails *before* we send them to the character
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  
  // --- Polling Logic ---
  useEffect(() => {
    // We need a way to know if the session is active.
    // The GmailConnectButton handles login, but we need to re-check
    // on page load.
    const currentSession = auth.getSession();
    setGmailSession(currentSession);

    if (currentSession) {
      const interval = setInterval(async () => {
        try {
          await gmailService.pollForNewMail(currentSession.accessToken);
        } catch (error: any) {
          console.error("Polling failed:", error);
          // If token expired, we stop polling.
          // The auth-error event will handle this.
        }
      }, Number(import.meta.env.VITE_GMAIL_POLL_INTERVAL_MS));

      return () => clearInterval(interval);
    }
  }, [gmailSession]); // Re-run this effect if the session changes

  
  // --- Event Listener Logic (The "Bridge") ---
  useEffect(() => {
    // This is the "Bridge". It listens for events from gmailService.
    const handleNewMail = (event: CustomEvent<NewEmailPayload[]>) => {
      console.log("New mail received!", event.detail);
      // Add new emails to our temporary queue
      setEmailQueue((prev) => [...prev, ...event.detail]);
    };
    
    // Handle auth errors (e.g., token expired)
    const handleAuthError = () => {
      console.error("Gmail auth error. Signing out.");
      auth.signOut(gmailSession!.accessToken);
      setGmailSession(null);
      localStorage.removeItem("gmail_history_id");
    };

    gmailService.addEventListener("new-mail", handleNewMail as EventListener);
    gmailService.addEventListener("auth-error", handleAuthError);

    return () => {
      gmailService.removeEventListener("new-mail", handleNewMail as EventListener);
      gmailService.removeEventListener("auth-error", handleAuthError);
    };
  }, [gmailSession]); // We need gmailSession in the handler


  // --- Debouncer Logic (To avoid spamming the character) ---
  // This custom hook (you'll build it) will watch the emailQueue.
  // When the queue stops growing for 5 seconds, it gives us the final list.
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); // 5 sec delay

  useEffect(() => {
    if (debouncedEmailQueue.length > 0) {
      // We have emails! Time to tell the character.
      
      // 1. Create a summary message
      let systemMessage = "";
      if (debouncedEmailQueue.length === 1) {
        const email = debouncedEmailQueue[0];
        systemMessage = `[New Email] From: ${email.from}, Subject: ${email.subject}, Snippet: ${email.snippet}`;
      } else {
        systemMessage = `[New Emails] You just received ${debouncedEmailQueue.length} new emails. The first one is from ${debouncedEmailQueue[0].from} about "${debouncedEmailQueue[0].subject}".`;
      }

      // 2. Call your existing chat function
      // (This is your function from your plan)
      // ingestSystemEvent('email', systemMessage);
      
      console.log("SENDING TO CHARACTER:", systemMessage);

      // 3. Clear the queue
      setEmailQueue([]);
    }
  }, [debouncedEmailQueue]); // Only runs when the debounced value changes

  return (
    <div>
      {/* ... your app ... */}
      <GmailConnectButton />
      {/* ... your chat window ... */}
    </div>
  );
}

---

## Phase 6: Testing (How to Check Your Work)
Run the app: npm run dev

Open Developer Tools: (F12) and go to the "Application" tab.

Click "Connect Gmail": You should see the Google pop-up.

See the "Unverified App" Screen: Click "Advanced" and "Proceed".

Select Your Account: Choose the same email you added as a "Test User" in Phase 1.

Grant Permission: Allow access.

Check the UI: The button should change to "Connected as: your-email@gmail.com".

Check Local Storage: In the "Application" tab, go to "Local Storage". You should see:

gmail_session (with your token and email)

gmail_history_id (with a long number)

Send Yourself an Email: From a different account, send an email to your connected account.

Wait: Wait for your poll interval (e.g., 60 seconds).

Check the Console: You should see a log: "New mail received!" with the email data.

Wait 5 More Seconds: After the 5-second debounce, you should see the final "SENDING TO CHARACTER:" log.

Reload the Page: The app should load and still show "Connected". Polling should restart automatically.

Click "Disconnect": The UI should update, and the gmail_session and gmail_history_id should be removed from Local Storage.



--- 

## PHASE 7: Send Email

he .../auth/gmail.metadata scope is "look, don't touch." To send mail, you need to add "touch" permissions.

You will need to change the GMAIL_SCOPE constant in src/services/googleAuth.ts from a single string to a space-separated list of scopes:
// The new scope list
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.metadata", // (To keep polling)
  "https://www.googleapis.com/auth/gmail.readonly", // (To read the *full* email you're replying to)
  "https://www.googleapis.com/auth/gmail.compose"   // (To send/draft messages)
].join(" ");

What this means:

You must update the initTokenClient call to use this new GMAIL_SCOPES variable.

All users must re-consent. The handleConnect function (and any "get token" logic) will need to be triggered with forceConsent: true one time for all existing users to "upgrade" their permission.

## 2. Implementation: New gmailService.ts Methods
Your gmailService.ts will need new functions to handle these new abilities.

A Safer First Step: Creating Drafts
I strongly recommend starting by having the character create drafts instead of sending directly. This is much safer, as it gives you a "review" step.

You would add this method to gmailService.ts:

// In src/services/gmailService.ts

/**
 * Creates a new email draft (but does not send it).
 * @param accessToken - The user's auth token
 * @param to - Recipient email
 * @param subject - Email subject
 * @param body - The plain text email body
 * @param threadId - (Optional) If replying, the thread to attach to.
 */
async createDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string
) {
  // 1. Create the raw email string (RFC 2822 format)
  const emailLines = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    `Subject: ${subject}`,
    "", // blank line separates headers from body
    body,
  ];
  const email = emailLines.join("\n");

  // 2. Base64-encode it (required by the API)
  const base64Email = btoa(email).replace(/\+/g, "-").replace(/\//g, "_");

  const draftBody: any = {
    message: {
      raw: base64Email,
    },
  };

  // 3. If it's a reply, add the threadId
  if (threadId) {
    draftBody.message.threadId = threadId;
  }

  // 4. Call the drafts.create endpoint
  const response = await fetch(`${this.apiBase}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(draftBody),
  });

  if (!response.ok) {
    throw new Error("Failed to create draft.");
  }
  
  return await response.json();
}

The "Direct Send" Method
If you want to send directly (be careful!), you use the messages.send endpoint instead. The process is identical, except you call a different API.
// In src/services/gmailService.ts

async sendMessage(accessToken: string, /* ...same params... */) {
  // ... (Steps 1 & 2 are identical to createDraft)
  const base64Email = /* ... */ ;

  const sendBody: any = {
    raw: base64Email,
  };
  
  if (threadId) {
    sendBody.threadId = threadId;
  }

  // 4. Call the messages.send endpoint
  const response = await fetch(`${this.apiBase}/messages/send`, {
    method: "POST",
    // ... (same headers & body)
    body: JSON.stringify(sendBody),
  });
  
  // ... (same error handling)
  return await response.json();
}

3. The Big Warning: Google Verification
This is the most important part.

Your current gmail.metadata scope is considered "sensitive".

The new scopes (.../readonly and .../compose) are considered "restricted".

This means Google's "unverified app" warning screen will be even scarier. For your own personal "Test user" account, this is fine—you can just click "Advanced" and proceed.

If you ever wanted to release this app to the public, it would be almost impossible to get it verified by Google. They have extremely strict rules for apps that request "restricted" scopes.