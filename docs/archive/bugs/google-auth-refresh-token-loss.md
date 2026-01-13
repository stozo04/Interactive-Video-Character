# Bug: Google Auth Token Loss During Session Refresh

## Problem Description
The application loses its Google `provider_token` (access token) approximately every 10-60 minutes when the Supabase session refreshes. This causes Google-dependent services (Calendar, Gmail) to fail with 401 Unauthorized errors and prompts the "Reconnect Google" warning banner, even though the user is technically still signed into Google.

## Root Cause
Supabase Auth simplifies OAuth by providing the `provider_token` and `provider_refresh_token` during the initial `signInWithOAuth` flow. However:
1. **Supabase does not persist these tokens**: Subsequent calls to `supabase.auth.getSession()` or `supabase.auth.onAuthStateChange` events for `TOKEN_REFRESHED` often return a session object where `provider_token` is `null` or `undefined`.
2. **Fixed Google Token Lifetime**: Google's OAuth 2.0 access tokens have a fixed, non-customizable lifetime of **1 hour** (3600 seconds). Extending this duration to 4 or more hours is not possible at the token level; instead, applications must use `refresh_tokens` or silent re-auth to obtain new access tokens.
3. **Aggressive State Updates**: The application's `GoogleAuthContext` listens for these state changes and was inadvertently overwriting a valid local `accessToken` with the `null` value from the refreshed Supabase session.
4. **Imperfect Sync**: The Google token lifespan (1 hour) and Supabase JWT lifespan are managed independently, leading to cases where the application thinks a session is valid when it isn't, or vice-versa.

## How to Resolve

### 1. Bridged Persistence Strategy
Modify `googleAuth.ts` and `GoogleAuthContext.tsx` to use a "Bridge" logic:
- **Never Overwrite with Null**: When a Supabase session update occurs, only update the `provider_token` if a new one is actually provided. If the update has a `null` provider token, retain the one currently in memory/localStorage.
- **Independent Expiry Tracking**: Manually set and track the 1-hour expiry for Google tokens upon acquisition, rather than relying on the Supabase session `expires_at`.

### 2. Proactive Silent Refresh
Implement a background refresh mechanism:
- Use `supabase.auth.signInWithOAuth()` with `prompt: 'none'` and `access_type: 'offline'`.
- This should be attempted in the `GoogleAuthContext` auto-refresh loop (with a 10-minute buffer) before the token actually expires.

### 3. Graceful Error Handling
Ensure that 401 errors from Google APIs trigger a silent refresh attempt first, and only show the "Needs Reconnect" banner if silent re-auth fails (e.g., if the user revoked access or their Google session also expired).

## Verification
- Monitor the console for "Supabase session refreshed but no provider token found". 
- Verify that the `accessToken` in `localStorage` persists after this message.
- Manually trigger `supabase.auth.refreshSession()` and confirm Google services remain active.
