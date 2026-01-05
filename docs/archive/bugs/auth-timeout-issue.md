# Bug: Frequent Logout After Supabase Migration (30-60m Interval)

## Problem Description
Users are being logged out of the application approximately every 30-60 minutes, even after migrating to Supabase Auth. The application returns to the login screen, forcing a full re-authentication.

## Root Cause Analysis
The investigation revealed a chain of events triggered by Google Access Token expiry:

1.  **Token Expiry**: The `provider_token` (Google OAuth Access Token) provided by Supabase has a standard lifespan of 1 hour (3600 seconds).
2.  **Lack of Provider Refresh**: While the Supabase session (JWT) is automatically refreshed by the `supabase-js` client, the `provider_token` is **not** refreshed. Supabase only provides the `provider_token` during the initial OAuth handshake.
3.  **401 Errors**: Services like [gmailService.ts](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/gmailService.ts) and [calendarService.ts](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/calendarService.ts) use this token for polling. When it expires, they receive a 401 Unauthorized response.
4.  **Forced Sign-Out**: In [App.tsx](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/App.tsx#L972-978), there is a shared `handleAuthError` listener that responds to the `auth-error` event by calling `signOut()`:
    ```typescript
    const handleAuthError = () => {
      console.log("🔒 Auth error detected. Signing out...");
      // ...
      signOut(); // 👈 This triggers the global logout
    };
    ```
5.  **30-Minute Interval**: The "30 minute" report likely corresponds to cases where the token was already halfway through its life or when Supabase session settings are configured for a shorter duration, triggering the `ensureValidSession` logic which fails to find a new `provider_token`.

## Proposed Changes

### Phase 1: Decouple Google Auth from Application Auth
We should not log the user out of the entire application just because a third-party token (Google) expired.

*   **Modify `App.tsx`**: Update `handleAuthError` to set a "reconnection required" state for Google services instead of calling `signOut()`.
*   **Update UI**: Show a subtle "Reconnect Google" button in the header or settings when the token is invalid, rather than redirecting to the login page.

### Phase 2: Implement Silent Token Refresh
Try to refresh the Google token without a full logout.

*   **Silent Re-auth**: Use `supabase.auth.signInWithOAuth()` with `prompt: 'none'` in a hidden iframe or background process to get a fresh `provider_token` if the user is still logged into Google.
*   **Improve `ensureValidSession`**: Enhance the logic in [googleAuth.ts](file:///c:/Users/gates/Personal/Interactive-Video-Character/src/services/googleAuth.ts) to handle the absence of `provider_token` during Supabase refreshes more gracefully.

### Phase 3: Supabase Configuration (External)
*   Check Supabase Dashboard for "JWT Expiry" settings and ensure it is set to a reasonable duration (e.g., 24 hours) to reduce the frequency of session refreshes that might lead to token loss.

## Verification Plan

### Automated Tests
*   Mock a 401 response from the Calendar API and verify that the application remains in the `chat` view but displays a "reconnect" warning.
*   Test the `ensureValidSession` logic with a mocked expired token.

### Manual Verification
1.  Login via Google.
2.  Manually invalidate the `provider_token` in localStorage.
3.  Wait for a polling cycle (1-2 minutes).
4.  Verify the app does NOT redirect to the login page.
5.  Verify that clicking "Reconnect" (if implemented) restores functionality.
