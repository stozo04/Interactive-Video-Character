# Bug: Google Auth 401 "Invalid Credentials" After Supabase Refresh

**Status:** Open
**Severity:** High
**Component:** Google OAuth + Supabase session bridging
**Related Files:**
- `src/contexts/GoogleAuthContext.tsx:200`
- `src/services/googleAuth.ts:120`
- `src/services/googleAuth.ts:161`
- `src/services/googleAuth.ts:205`
- `src/App.tsx:814`

---

## Problem Summary
The app repeatedly receives `401 Unauthorized` responses from Google Calendar and Gmail endpoints, even after Supabase reports a successful session refresh. The auto-recovery path fails because `refreshSession()` throws when the local Gmail session is missing, preventing a silent OAuth refresh. This leaves the app stuck in a loop of 401s until the user manually reconnects.

---

## Evidence

### Console Logs (`c:/Users/gates/Downloads/console_logs.txt`)
- `calendarService.ts:83` -> `GET https://www.googleapis.com/calendar/v3/... 401 (Unauthorized)`
- `calendarService.ts:94` -> `Calendar API: Token expired or invalid`
- `App.tsx:815` -> `Google Auth error detected. Attempting background refresh...`
- `GoogleAuthContext.tsx:202` -> `Uncaught (in promise) Error: No active session to refresh`
- `GoogleAuthContext.tsx:212` -> `Session refreshed successfully via Supabase` (but 401s continue)
- `gmailService.ts:76` -> `GET https://www.googleapis.com/gmail/v1/users/me/history... 401 (Unauthorized)`

### HAR (`c:/Users/gates/Downloads/localhost.har`)
- Multiple responses return:
  ```json
  {
    "error": {
      "code": 401,
      "message": "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.",
      "errors": [
        {
          "message": "Invalid Credentials",
          "domain": "global",
          "reason": "authError",
          "location": "Authorization",
          "locationType": "header"
        }
      ],
      "status": "UNAUTHENTICATED"
    }
  }
  ```

---

## Root Cause Analysis

1. **Google access tokens expire hourly**
   The app relies on `provider_token` from Supabase or a bridged token in localStorage. When the token expires, Google returns `401`.

2. **Local session can become null**
   `googleAuth.getSession()` clears localStorage if the token is expired. This leaves `session` as `null` inside `GoogleAuthContext`.

3. **`refreshSession()` blocks recovery when `session` is null**
   In `GoogleAuthContext.tsx:200-203`, the guard throws `No active session to refresh` before attempting silent OAuth refresh. That short-circuits the only path that could recover in the background.

4. **Supabase refresh events often do not include `provider_token`**
   `googleAuth.refreshAccessToken()` throws `PROVIDER_TOKEN_MISSING` when Supabase refresh returns a session without `provider_token`. The bridging logic only helps if a still-valid local token exists.

5. **`handleAuthError` does not await or handle failures**
   `App.tsx:814-816` triggers `refreshSession()` but does not await or catch it, so the thrown error becomes an unhandled promise rejection and the recovery path stalls.

---

## Why This Keeps Recurring
- Access tokens expire every hour, and refresh relies on a fragile combination of `provider_token` and a valid local bridge.
- Any gap in this chain (expired local token + missing `provider_token`) collapses the recovery flow and forces a manual reconnect.
- The guard in `refreshSession()` prevents the silent refresh fallback from running exactly when it is needed most.

---

## Proposed Resolution (Final Fix)

### 1) Allow recovery even when `session` is null
- Change `refreshSession()` to attempt `googleAuth.silentRefresh()` when no session exists, rather than throwing immediately.
- Maintain a lightweight local flag like `google_connected=true` after successful auth, so the app knows it should attempt silent refresh even if session state is empty.

### 2) Treat `PROVIDER_TOKEN_MISSING` as a trigger for silent refresh
- In `googleAuth.ensureValidSession()`, if refresh fails with `PROVIDER_TOKEN_MISSING` or `AUTH_REFRESH_FAILED`, attempt `silentRefresh()` before setting `needs_reconnect`.

### 3) Await and handle background refresh
- Update `handleAuthError` to `await refreshSession()` and catch errors so the recovery path can continue and the UI can update properly.

### 4) Preserve “connected” intent across auth events
- On `TOKEN_REFRESHED` or `SIGNED_IN` events without a `provider_token`, do not drop the Google connection state. Instead, mark it as `connected_needs_refresh` and trigger a silent refresh.

---

## Verification Plan

### Manual
1. Sign in with Google and confirm Calendar/Gmail polling works.
2. Let the token expire (1 hour) or manually set an expired `expiresAt` in localStorage.
3. Trigger a calendar/gmail request.
4. Verify:
   - Silent refresh is attempted even with no local session.
   - No unhandled `No active session to refresh` error.
   - Requests recover without manual reconnect.

### Automated
- Unit test `refreshSession()` when `session` is null to confirm `silentRefresh()` is invoked.
- Unit test `ensureValidSession()` to confirm `PROVIDER_TOKEN_MISSING` leads to silent refresh before `needs_reconnect`.

---

## Related Bugs
- `docs/archive/bugs/auth-timeout-issue.md`
- `docs/archive/bugs/google-auth-refresh-token-loss.md`
- `docs/bugs/recurring-google-auth-401.md`
