# Bug: Recurring Google Auth 401 (Unauthorized) Errors

## Problem Description
Users are repeatedly encountering `401 Unauthorized` errors when the application attempts to access Google Calendar or Gmail. Despite implementing "bridging" logic to preserve tokens, the application frequently falls into a state where it cannot recover without a manual reconnect, even if the user is still signed into Google.

### Symptoms
- Console shows `401 (Unauthorized)` for Google API calls.
- `Google Auth error detected. Attempting background refresh...` log appears.
- Followed by `Error: No active session to refresh` from `GoogleAuthContext.tsx`.
- The "Needs Reconnect" banner appears or functionality simply ceases until manual intervention.

## Root Cause Analysis
The investigation revealed a failure in the "recovery loop" within `GoogleAuthContext.tsx`:

1.  **Token Expiry**: Google Access Tokens have a hard 1-hour limit.
2.  **State Erosion**: When a token expires, `googleAuth.getSession()` returns `null` and clears the local storage. This causes the `GoogleAuthContext` state (`session`) to become `null`.
3.  **Blocking Guard**: The `refreshSession` function in `GoogleAuthContext.tsx` begins with a guard:
    ```typescript
    if (!session) {
      throw new Error('No active session to refresh');
    }
    ```
4.  **Recovery Failure**: Because the state is `null`, the logic never reaches the `silentRefresh` (prompt='none') attempt. The application "forgets" it was ever logged in, even though a background refresh could have succeeded.
5.  **Race Conditions**: Supabase session refreshes (`TOKEN_REFRESHED` events) often do not include the `provider_token`. If the application doesn't have a valid token in memory, it treats this as a logged-out state for Google services.

## Proposed Resolution

### 1. Decouple Recovery from Current State
Modify `refreshSession` in `GoogleAuthContext.tsx` to attempt a `silentRefresh` even if `session` is `null`. We should use a `persistence hint` (like a flag in localStorage) to track that a Google connection *should* exist.

### 2. Proactive Silent Refresh
In `googleAuth.ts`, if `ensureValidSession` detects an expired token and no bridged token is available, it should be able to trigger a silent re-auth attempt.

### 3. Improve `onAuthStateChange` Logic
Ensure that `SIGNED_IN` or `TOKEN_REFRESHED` events never clear a "connected" status unless explicitly signed out, even if the `provider_token` is missing from that specific event.

## Verification Plan

### Automated Tests
- Mock an expired token and verify that `refreshSession` triggers `supabase.auth.signInWithOAuth` with `prompt: 'none'`.
- Verify that `getSession` returns `null` but the Context maintains a `recovery` state.

### Manual Verification
1. Log in to Google.
2. Wait 1 hour (or manually expire the token in localStorage).
3. Trigger a Gmail/Calendar action.
4. Verify that the app recovers silently (via redirect or background update) without showing the "Needs Reconnect" banner.
