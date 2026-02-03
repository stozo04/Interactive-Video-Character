## Title
Gmail history polling returns 401 Unauthorized after Supabase Google Auth refresh

## Date
2026-02-01

## Reporter
Steven

## Summary
Gmail history polling repeatedly fails with `401 (Unauthorized)` when calling
`https://www.googleapis.com/gmail/v1/users/me/history?startHistoryId=21363810`.
The app detects a Google Auth error and attempts a background refresh, but the
polling loop continues to error.

## Impact
- Gmail polling does not return new mail history.
- Repeated polling/refresh attempts can spam logs and keep the app in an error loop.

## Observed Logs (from user report)
- `gmailService.ts:76 GET https://www.googleapis.com/gmail/v1/users/me/history?startHistoryId=21363810 401 (Unauthorized)`
- `App.tsx:692 Google Auth error detected. Attempting background refresh...`
- `useGmail.ts:42 📬 [useGmail] Polling error: Error: Gmail history fetch failed`

## Expected Behavior
Gmail history polling succeeds (HTTP 200) or surfaces an actionable auth error
that pauses polling until the user re-auths.

## Actual Behavior
Polling continues and repeatedly receives HTTP 401 from Gmail history endpoint.

## Suspected Causes
- Access token expired or revoked; refresh flow not completing or not applied to
  Gmail API calls.
- Missing or insufficient Gmail scopes for `users.history.list`.
- `startHistoryId` is invalid/too old for the user mailbox; Gmail can return
  401/404/400 depending on state and auth.

## Findings (code inspection)
- `gmailService.ts` emits `auth-error` on HTTP 401 from Gmail history endpoint.
- `App.tsx` listens for `auth-error` and calls `refreshSession()` without forcing
  a token refresh.
- `refreshSession()` only refreshes when the token is near expiry, so revoked or
  invalid tokens can continue to fail while polling loops persist.

## Solution (planned/implemented)
- Add a **forced refresh** path in `GoogleAuthContext.refreshSession` that calls
  `googleAuth.refreshAccessToken()` and updates the in-memory and local
  sessions even if the token is not near expiry.
- Update `App.tsx` to call `refreshSession({ force: true })` on `auth-error` so
  a 401 triggers a real token refresh instead of a no-op.
- Pause Gmail polling while auth status is `refreshing` to avoid repeated 401s
  during token rotation.
- Align Supabase env vars with Vite conventions (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`) to ensure tokens load correctly in Vite builds.
- Use Supabase `expires_at` for access-token expiry when available, falling back
  to a 1-hour default only if `expires_at` is missing.

## Reproduction (inferred)
1. Sign in with Supabase Google Auth.
2. Leave app running until Gmail polling triggers.
3. Observe 401s from Gmail history endpoint and repeated refresh attempts.

## Notes
- Stack indicates `gmailService.ts` polling and `useGmail.ts` interval loop.
- A background refresh is attempted but does not resolve the 401.

---

## Update (2026-02-02)
### New user report
- On app startup, the browser is redirected to `/?error=interaction_required&error_description=#error=interaction_required`.
- Manual sign-in still works after the redirect.

### Root cause
- The app attempts **silent OAuth** (`prompt=none`) on startup when a Supabase session exists but no `provider_token` is present.
- Google blocks silent auth without user interaction and returns `interaction_required`, which Supabase surfaces in the redirect URL.
- This behavior can be triggered by the same refresh/bridging logic introduced to mitigate Gmail 401s.

### Fix (implemented)
- Disable automatic silent OAuth attempts on app startup and background refresh paths.
- When a token is missing, the app now moves to `needs_reconnect` and waits for an explicit user action.
- The reconnect button now uses interactive sign-in instead of silent refresh.

### Files touched
- `src/contexts/GoogleAuthContext.tsx`
- `src/components/AuthWarningBanner.tsx`
