# Bug: Gmail Notifications Stopped Working (History ID Reset)

## Problem Description
The AI companion no longer proactively notifies the user about new emails. This feature was working previously but stopped functioning after recent authentication stability improvements.

## Root Cause
The root cause is a race condition/redundant initialization in the `GmailConnectButton` component and `App.tsx`:
1. **Redundant Initializations**: Every time the Google Auth session refreshes (which now happens more reliably and frequently), the `GmailConnectButton` triggers a `useEffect` that calls `gmailService.getInitialHistoryId`.
2. **Pointer Reset**: `getInitialHistoryId` fetches the *current* `historyId` from the Gmail API and saves it to `localStorage`.
3. **Skipped Deltas**: By resetting the pointer to the "now" state every few minutes, any emails that arrived between the last poll and the refresh are lost to the polling logic. The poll only checks for changes *since* the stored `historyId`, which is now always "recent".

## How to Resolve

### 1. Guard Initialization
Modify `GmailConnectButton.tsx` to only call `getInitialHistoryId` if `gmailService.isInitialzed()` is false. This ensures the pointer is only set once per session (or when explicitly logging in), rather than on every token refresh.

### 2. Improve Polling Stability
Ensure that `App.tsx` handles the transition between "loading" and "connected" states without resetting the Gmail queue or polling interval redundantly.

### 3. Verification
- Trigger a manual session refresh (or wait for one).
- Send a test email during the refresh interval.
- Verify that the AI companion still detects and announces the email.
