# Gmail Integration Guide for Junior Developers

## 📚 Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [How It Works](#how-it-works)
4. [Authentication Flow](#authentication-flow)
5. [Email Polling System](#email-polling-system)
6. [Event System](#event-system)
7. [Current Implementation Status](#current-implementation-status)
8. [Code Walkthrough](#code-walkthrough)
9. [Common Issues & Troubleshooting](#common-issues--troubleshooting)
10. [Future Implementation](#future-implementation)

---

## 📖 Overview

The Gmail integration allows the AI Character Companion app to:
- Connect to a user's Gmail account securely
- Monitor their inbox for new emails in real-time
- Notify the AI character when new emails arrive
- Allow the character to respond naturally to email notifications

Think of it like this: Your AI companion can "see" when you get emails and chat with you about them, just like a real friend might ask "Hey, I see you got an email from your boss. Everything okay?"

---

## 🏗️ Architecture

The Gmail integration consists of **four main components**:

### 1. **Authentication Service** (`src/services/googleAuth.ts`)
- **Purpose**: Handles Google sign-in and token management
- **Responsibility**: Get and maintain valid access tokens
- **Key Concept**: Uses OAuth 2.0 to get permission to access Gmail

### 2. **Gmail Service** (`src/services/gmailService.ts`)
- **Purpose**: Communicates with Gmail API
- **Responsibility**: Check for new emails and fetch their details
- **Key Concept**: Polls Gmail periodically and emits events when emails arrive

### 3. **Auth Context** (`src/contexts/GoogleAuthContext.tsx`)
- **Purpose**: Manages authentication state across the entire app
- **Responsibility**: Provides sign-in/out functions and current session info
- **Key Concept**: React Context that any component can use

### 4. **UI Components** (`src/components/GmailConnectButton.tsx`)
- **Purpose**: User interface for connecting/disconnecting Gmail
- **Responsibility**: Shows connection status and handles user actions
- **Key Concept**: The button users click to link their Gmail

### Data Flow Diagram
```
User Clicks "Connect Gmail"
         ↓
GoogleAuthContext.signIn()
         ↓
googleAuth.getAccessToken() → Opens Google popup
         ↓
User grants permission
         ↓
Access token stored in localStorage
         ↓
GmailConnectButton initializes Gmail service
         ↓
Polling starts (every 60 seconds)
         ↓
New email detected
         ↓
"new-mail" event fired
         ↓
App.tsx (not yet implemented) would handle the event
         ↓
Character is notified via chat
```

---

## 🔐 Authentication Flow

### What is OAuth 2.0?

OAuth is like giving someone a **temporary key card** instead of your master password:
- You tell Google: "This app can check my emails"
- Google gives the app a **token** (not your password!)
- The token expires after 1 hour for security
- The app can refresh the token when needed

### Step-by-Step Authentication

#### Step 1: User Initiates Connection
```typescript
// User clicks "Connect with Google" button
const handleConnect = async () => {
  await signIn(); // Calls GoogleAuthContext
};
```

#### Step 2: Request Access Token
```typescript
// In googleAuth.ts
const { accessToken, expiresAt, refreshedAt } = await getAccessToken(true);
```
**What happens:**
- Opens a Google popup window
- Shows which permissions the app needs
- User clicks "Allow"
- Returns an access token (a long string like "ya29.a0AfH6...")

#### Step 3: Get User Email
```typescript
const email = await getUserEmail(accessToken);
```
**Why:** We need to know which Gmail account is connected (for display purposes)

#### Step 4: Save Session
```typescript
const newSession: GmailSession = {
  email: 'user@gmail.com',
  accessToken: 'ya29.a0AfH6...',
  expiresAt: 1699999999999, // Unix timestamp
  refreshedAt: 1699996399999
};
localStorage.setItem('gmail_session', JSON.stringify(newSession));
```

**Important:** The session is saved to `localStorage` so it persists even if the user refreshes the page.

#### Step 5: Initialize Gmail Service
```typescript
// In GmailConnectButton.tsx
await gmailService.getInitialHistoryId(session.accessToken);
```
**Purpose:** Gets a starting point (historyId) for tracking new emails.

---

## 📬 Email Polling System

### What is Polling?

**Polling** means repeatedly checking for something at regular intervals. It's like:
- Checking your mailbox every 60 seconds
- Instead of having the mail carrier knock on your door (which would be a "push" system)

Gmail doesn't notify us automatically, so we have to check periodically.

### The historyId Concept

Think of `historyId` as a **bookmark** in your mailbox:
- Gmail assigns a unique number to every state of your mailbox
- When you first connect: `historyId = 12345`
- You get a new email: Gmail's historyId is now `12346`
- We ask: "What changed between 12345 and 12346?"
- Gmail tells us: "One new email arrived!"

### Polling Flow

#### Every 60 Seconds, This Happens:

```typescript
// 1. Get our last bookmark
const lastHistoryId = localStorage.getItem("gmail_history_id");
// Example: "12345"

// 2. Ask Gmail: "What's new since bookmark 12345?"
const historyResponse = await fetch(
  `https://www.googleapis.com/gmail/v1/users/me/history?startHistoryId=${lastHistoryId}`,
  { headers: { Authorization: `Bearer ${accessToken}` }}
);

// 3. Gmail responds with changes
const historyData = await historyResponse.json();
/*
Example response:
{
  "historyId": "12346",
  "history": [
    {
      "messagesAdded": [
        { "message": { "id": "abc123", "labelIds": ["INBOX"] } }
      ]
    }
  ]
}
*/

// 4. Filter for INBOX messages only
const newMessages = historyData.history
  .flatMap(record => record.messagesAdded || [])
  .filter(item => item.message.labelIds.includes("INBOX"));

// 5. If we found new emails, get their details
if (newMessages.length > 0) {
  const messageIds = newMessages.map(item => item.message.id);
  const emailDetails = await fetchMessageHeaders(accessToken, messageIds);
  
  // 6. Notify the app!
  this.dispatchEvent(new CustomEvent("new-mail", { detail: emailDetails }));
}

// 7. Update our bookmark for next time
localStorage.setItem("gmail_history_id", historyData.historyId);
// Now lastHistoryId = "12346"
```

### Fetching Email Details

When we detect new emails, we need their metadata (From, Subject, etc.):

```typescript
async fetchMessageHeaders(accessToken: string, messageIds: string[]) {
  // Gmail's "batch" API lets us get multiple emails in one request
  // This is more efficient than making 10 requests for 10 emails
  
  const batchResponse = await fetch(
    'https://www.googleapis.com/batch/gmail/v1',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'multipart/mixed; boundary=batch_boundary'
      },
      body: buildBatchRequest(messageIds)
    }
  );
  
  // Parse the response and extract email data
  return [
    {
      id: "abc123",
      from: "boss@company.com",
      subject: "Meeting Tomorrow",
      snippet: "Hi, let's meet at 10am...",
      receivedAt: "2024-11-14T10:30:00Z"
    }
  ];
}
```

---

## 🎯 Event System

### Why Use Events?

The Gmail service needs to **notify** the app when emails arrive, but it shouldn't directly manipulate the app's state. This is called **separation of concerns**.

Think of it like:
- 📬 Mailman (Gmail service): "I have mail!"
- 🏠 House (App.tsx): "Thanks, I'll handle it from here."

### How EventTarget Works

```typescript
// GmailService extends EventTarget (built into browsers)
class GmailService extends EventTarget {
  async pollForNewMail() {
    // ... checking for emails ...
    
    // Dispatch an event (like ringing a doorbell)
    this.dispatchEvent(
      new CustomEvent("new-mail", { 
        detail: emailPayloads // The actual email data
      })
    );
  }
}

// In App.tsx (or wherever), we listen for the doorbell
useEffect(() => {
  const handleNewMail = (event) => {
    console.log("New emails:", event.detail);
    // Do something with the emails
  };
  
  // Start listening
  gmailService.addEventListener("new-mail", handleNewMail);
  
  // Stop listening when component unmounts
  return () => {
    gmailService.removeEventListener("new-mail", handleNewMail);
  };
}, []);
```

### Two Types of Events

1. **"new-mail"** - Emitted when new emails are detected
   - Payload: Array of `NewEmailPayload` objects

2. **"auth-error"** - Emitted when the access token is invalid
   - Payload: None
   - **Action Required:** Sign out the user and clear session

---

## ✅ Current Implementation Status

### ✔️ What's Working

1. **Authentication System** - 100% Complete
   - ✅ Google OAuth sign-in
   - ✅ Access token management
   - ✅ Auto-refresh before expiration
   - ✅ Session persistence in localStorage
   - ✅ Sign-out functionality

2. **Gmail Service** - 100% Complete
   - ✅ Initial history ID retrieval
   - ✅ Polling for new emails
   - ✅ Fetching email metadata
   - ✅ Event emission
   - ✅ Error handling

3. **UI Components** - 100% Complete
   - ✅ Connect/Disconnect button
   - ✅ Connection status display
   - ✅ Error messages
   - ✅ Loading states

4. **Context Provider** - 100% Complete
   - ✅ Global authentication state
   - ✅ Auto-refresh timer
   - ✅ Session validation

### ❌ What's Missing

1. **Polling Integration in App.tsx** - Not Implemented
   - ❌ No polling loop when Gmail is connected
   - ❌ No event listeners for new emails

2. **Chat Integration** - Not Implemented
   - ❌ No email queue state
   - ❌ No debouncing logic
   - ❌ No system messages to character
   - ❌ Character doesn't know about emails

3. **Email Display** - Not Implemented
   - ❌ No UI to show recent emails
   - ❌ No way to view email details

---

## 🔍 Code Walkthrough

### 1. GmailService Class Structure

```typescript
class GmailService extends EventTarget {
  // Base URL for Gmail API
  private apiBase = "https://www.googleapis.com/gmail/v1/users/me";
  
  // Gets starting point for polling
  async getInitialHistoryId(accessToken: string): Promise<string>
  
  // Checks for new emails (called every 60 seconds)
  async pollForNewMail(accessToken: string): Promise<void>
  
  // Fetches email details using batch API (private helper)
  private async fetchMessageHeaders(
    accessToken: string, 
    messageIds: string[]
  ): Promise<NewEmailPayload[]>
}
```

**Key Points:**
- `EventTarget` is a built-in browser API (same thing used for DOM events)
- `private` methods can only be called from inside the class
- All methods are `async` because they make network requests

### 2. GoogleAuthContext Structure

```typescript
interface GoogleAuthContextType {
  session: GmailSession | null;      // Current logged-in session
  status: AuthStatus;                // 'idle' | 'loading' | 'connected' | etc.
  error: string | null;              // Error message if something failed
  signIn: () => Promise<void>;       // Function to log in
  signOut: () => Promise<void>;      // Function to log out
  refreshSession: () => Promise<void>; // Manually refresh token
  clearError: () => void;            // Dismiss error message
}
```

**Usage in Components:**
```typescript
function MyComponent() {
  const { session, status, signIn, signOut } = useGoogleAuth();
  
  if (status === 'connected' && session) {
    return <div>Logged in as {session.email}</div>;
  }
  
  return <button onClick={signIn}>Sign In</button>;
}
```

### 3. GmailConnectButton Flow

```typescript
export function GmailConnectButton() {
  const { session, status, signIn, signOut } = useGoogleAuth();
  
  // Effect 1: Initialize Gmail when connected
  useEffect(() => {
    if (session && status === 'connected') {
      gmailService.getInitialHistoryId(session.accessToken);
    }
  }, [session, status]);
  
  // Effect 2: Notify parent component
  useEffect(() => {
    onConnectionChange?.(session !== null);
  }, [session]);
  
  // Render different UI based on status
  return status === 'connected' 
    ? <ConnectedView /> 
    : <NotConnectedView />;
}
```

---

## 🐛 Common Issues & Troubleshooting

### Issue 1: "No historyId found" Error

**Symptom:** Console shows "No historyId found. Call getInitialHistoryId first."

**Cause:** Polling started before initialization.

**Solution:**
```typescript
// Make sure getInitialHistoryId is called BEFORE polling starts
await gmailService.getInitialHistoryId(accessToken);
// Only then start polling
```

### Issue 2: 401 Unauthorized Error

**Symptom:** Polling fails with 401 error.

**Cause:** Access token expired (they last ~1 hour).

**Solution:** The service automatically emits an "auth-error" event. Handle it:
```typescript
gmailService.addEventListener("auth-error", () => {
  console.log("Token expired, signing out...");
  signOut();
  localStorage.removeItem("gmail_history_id");
});
```

### Issue 3: Gmail Popup Blocked

**Symptom:** Nothing happens when clicking "Connect Gmail".

**Cause:** Browser blocked the popup window.

**Solution:**
1. Check browser's address bar for popup blocker icon
2. Click "Always allow popups from this site"
3. Try again

### Issue 4: "Unverified App" Warning

**Symptom:** Google shows scary warning about unverified app.

**Cause:** App is in "Testing" mode on Google Cloud Console.

**Solution:**
1. Click "Advanced"
2. Click "Go to [App Name] (unsafe)"
3. This is normal for development!
4. For production, you'd need Google verification (very difficult)

### Issue 5: Polling Not Working

**Symptom:** New emails arrive but nothing happens.

**Cause:** No event listeners set up in App.tsx (not implemented yet).

**Solution:** See "Future Implementation" section below.

---

## 🚀 Future Implementation

### What Needs to Be Added to App.tsx

Here's what a junior developer would need to implement:

#### 1. Add State Variables

```typescript
function App() {
  // Existing state...
  
  // NEW: Gmail-related state
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  
  // ... rest of component
}
```

#### 2. Add Polling Loop

```typescript
// Start polling when Gmail is connected
useEffect(() => {
  if (!isGmailConnected || !session) {
    return; // Don't poll if not connected
  }
  
  // Poll immediately on connection
  const pollNow = async () => {
    try {
      await gmailService.pollForNewMail(session.accessToken);
    } catch (error) {
      console.error("Polling error:", error);
    }
  };
  
  pollNow(); // Initial poll
  
  // Then poll every 60 seconds
  const intervalId = setInterval(pollNow, 60000);
  
  // Cleanup: Stop polling when component unmounts or disconnects
  return () => clearInterval(intervalId);
}, [isGmailConnected, session]);
```

**Explanation:**
- `useEffect` runs when `isGmailConnected` or `session` changes
- `setInterval` creates a timer that runs every 60,000 ms (60 seconds)
- Return cleanup function stops the timer

#### 3. Add Event Listeners

```typescript
useEffect(() => {
  // Handler for new emails
  const handleNewMail = (event: CustomEvent<NewEmailPayload[]>) => {
    console.log("📧 New emails received:", event.detail);
    
    // Add to queue instead of immediately processing
    // (in case more emails arrive quickly)
    setEmailQueue(prev => [...prev, ...event.detail]);
  };
  
  // Handler for auth errors
  const handleAuthError = () => {
    console.error("🔒 Gmail authentication error");
    setIsGmailConnected(false);
    signOut();
    localStorage.removeItem("gmail_history_id");
  };
  
  // Start listening
  gmailService.addEventListener("new-mail", handleNewMail as EventListener);
  gmailService.addEventListener("auth-error", handleAuthError);
  
  // Stop listening on cleanup
  return () => {
    gmailService.removeEventListener("new-mail", handleNewMail as EventListener);
    gmailService.removeEventListener("auth-error", handleAuthError);
  };
}, [signOut]); // Re-run if signOut function changes
```

#### 4. Add Debouncing Logic

**Why Debounce?**
If 5 emails arrive in quick succession, we don't want to notify the character 5 times. Instead, wait 5 seconds after the last email, then notify once.

```typescript
// Custom hook: useDebounce
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    // Set up a timer
    const timerId = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    // If value changes again before timer finishes, cancel old timer
    return () => clearTimeout(timerId);
  }, [value, delay]);
  
  return debouncedValue;
}

// Usage in App component
const debouncedEmailQueue = useDebounce(emailQueue, 5000); // 5 seconds
```

**How it works:**
1. Email arrives → `emailQueue` updates → timer starts (5 seconds)
2. Another email arrives → `emailQueue` updates → timer **resets** (5 more seconds)
3. No more emails for 5 seconds → timer completes → `debouncedEmailQueue` updates

#### 5. Send to Character

```typescript
useEffect(() => {
  if (debouncedEmailQueue.length === 0) {
    return; // No emails to process
  }
  
  // Create a message for the character
  let systemMessage = "";
  
  if (debouncedEmailQueue.length === 1) {
    const email = debouncedEmailQueue[0];
    systemMessage = 
      `[New Email] ` +
      `From: ${email.from}, ` +
      `Subject: ${email.subject}, ` +
      `Snippet: ${email.snippet}`;
  } else {
    systemMessage = 
      `[New Emails] You just received ${debouncedEmailQueue.length} new emails. ` +
      `The first one is from ${debouncedEmailQueue[0].from} ` +
      `about "${debouncedEmailQueue[0].subject}".`;
  }
  
  console.log("💬 Notifying character:", systemMessage);
  
  // TODO: Send to your chat service
  // This would integrate with your existing handleSendMessage or similar
  // Example:
  // await sendSystemMessage(systemMessage);
  
  // Clear the queue
  setEmailQueue([]);
}, [debouncedEmailQueue]);
```

### Example Complete Integration

```typescript
function App() {
  const { session, signOut } = useGoogleAuth();
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000);
  
  // 1. Polling loop
  useEffect(() => {
    if (!isGmailConnected || !session) return;
    
    const pollNow = async () => {
      try {
        await gmailService.pollForNewMail(session.accessToken);
      } catch (error) {
        console.error("Polling error:", error);
      }
    };
    
    pollNow();
    const intervalId = setInterval(pollNow, 60000);
    return () => clearInterval(intervalId);
  }, [isGmailConnected, session]);
  
  // 2. Event listeners
  useEffect(() => {
    const handleNewMail = (event: CustomEvent<NewEmailPayload[]>) => {
      setEmailQueue(prev => [...prev, ...event.detail]);
    };
    
    const handleAuthError = () => {
      setIsGmailConnected(false);
      signOut();
      localStorage.removeItem("gmail_history_id");
    };
    
    gmailService.addEventListener("new-mail", handleNewMail as EventListener);
    gmailService.addEventListener("auth-error", handleAuthError);
    
    return () => {
      gmailService.removeEventListener("new-mail", handleNewMail as EventListener);
      gmailService.removeEventListener("auth-error", handleAuthError);
    };
  }, [signOut]);
  
  // 3. Process debounced emails
  useEffect(() => {
    if (debouncedEmailQueue.length === 0) return;
    
    const systemMessage = debouncedEmailQueue.length === 1
      ? `[New Email] From: ${debouncedEmailQueue[0].from}, Subject: ${debouncedEmailQueue[0].subject}`
      : `[New Emails] You received ${debouncedEmailQueue.length} new emails.`;
    
    console.log("Notifying character:", systemMessage);
    // TODO: Send to chat service
    
    setEmailQueue([]);
  }, [debouncedEmailQueue]);
  
  return (
    <div>
      <GmailConnectButton 
        onConnectionChange={setIsGmailConnected}
      />
      {/* Rest of app */}
    </div>
  );
}
```

---

## 📝 Key Takeaways for Junior Developers

1. **OAuth is for Security** - Never ask users for their password. Use OAuth to get a temporary token.

2. **Polling vs Push** - Gmail doesn't push notifications, so we poll (check) periodically.

3. **historyId is Key** - Think of it as a bookmark. We ask "what's new since my last bookmark?"

4. **Events Decouple Code** - Gmail service emits events, App listens. They don't directly call each other.

5. **Debouncing Prevents Spam** - Wait a bit before acting, in case more events come quickly.

6. **Token Expiration** - Access tokens expire! Always handle 401 errors gracefully.

7. **localStorage for Persistence** - Session and historyId must survive page refreshes.

---

## 🔗 Related Documentation

- [Google OAuth Setup](./GOOGLE_OAUTH_SETUP.md) - How to configure Google Cloud Console
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Required configuration
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - Overall project status

---

## 📞 Need Help?

Common questions:
- **"Why 60 seconds?"** - Balance between responsiveness and API quota limits
- **"Can we use webhooks?"** - Gmail supports push notifications via Pub/Sub, but it's more complex
- **"How many emails can we poll?"** - Gmail API has quotas (~1 billion requests/day for free)
- **"What about sent emails?"** - Current implementation only monitors INBOX, but could be extended

---

**Last Updated:** November 14, 2024  
**Status:** Authentication & Polling Complete, Chat Integration Pending

