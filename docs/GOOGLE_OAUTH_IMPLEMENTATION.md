# Google OAuth Implementation Summary

This document provides a technical overview of the standalone Google OAuth implementation in the Interactive Video Character application.

## Overview

A complete standalone Google OAuth 2.0 flow has been implemented directly in the React application, enabling Gmail integration without requiring a backend server. The implementation uses Google Identity Services (GIS) and includes automatic token refresh, session management, and a polished user interface.

## Architecture

### Component Structure

```
src/
├── contexts/
│   └── GoogleAuthContext.tsx       # React Context for global auth state
├── services/
│   ├── googleAuth.ts               # Core OAuth logic and token management
│   └── gmailService.ts             # Gmail API integration (existing)
└── components/
    ├── GmailConnectButton.tsx      # OAuth UI component
    └── SettingsPanel.tsx           # Settings container with OAuth button
```

## Implementation Details

### 1. Enhanced Google Auth Service (`src/services/googleAuth.ts`)

#### Key Features
- **Token Management**: Access token storage, validation, and expiry checking
- **Automatic Refresh**: Proactive token refresh before expiration (5-minute buffer)
- **Session Persistence**: LocalStorage-based session management with validation
- **Error Handling**: Comprehensive error messages for common OAuth issues
- **Type Safety**: Full TypeScript support with proper typing

#### Core Functions

```typescript
// Get new access token with optional consent
getAccessToken(forceConsent: boolean): Promise<Omit<GmailSession, "email">>

// Refresh an expiring token
refreshAccessToken(): Promise<Omit<GmailSession, "email">>

// Ensure session is valid, refresh if needed
ensureValidSession(session: GmailSession): Promise<GmailSession>

// Get user email (validates token)
getUserEmail(accessToken: string): Promise<string>

// Sign out and revoke token
signOut(accessToken: string): Promise<void>

// Session management helpers
saveSession(session: GmailSession): void
getSession(): GmailSession | null
clearSession(): void
hasValidSession(): boolean
getTimeUntilExpiry(session: GmailSession): number
```

#### Session Interface

```typescript
interface GmailSession {
  email: string;
  accessToken: string;
  expiresAt: number;      // Timestamp in milliseconds
  refreshedAt: number;     // Last refresh timestamp
}
```

### 2. Google Auth Context (`src/contexts/GoogleAuthContext.tsx`)

#### Purpose
Provides app-wide access to authentication state and operations using React Context API.

#### Features
- **Global State**: Centralized auth state accessible from any component
- **Auto-Refresh**: Configurable automatic token refresh (default: 60s interval)
- **Session Restoration**: Automatically restores valid sessions on app load
- **Status Tracking**: Real-time authentication status updates

#### Context Interface

```typescript
interface GoogleAuthContextType {
  session: GmailSession | null;
  status: AuthStatus;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
}

type AuthStatus = 
  | 'idle'           // Not authenticated
  | 'loading'        // Loading existing session
  | 'authenticating' // OAuth flow in progress
  | 'connected'      // Successfully authenticated
  | 'refreshing'     // Refreshing token
  | 'error';         // Error occurred
```

#### Hooks

```typescript
// Main auth hook
useGoogleAuth(): GoogleAuthContextType

// Convenience hooks
useIsAuthenticated(): boolean
useAccessToken(): string | null
```

### 3. Gmail Connect Button (`src/components/GmailConnectButton.tsx`)

#### UI States

1. **Not Connected**: Shows "Connect with Google" button with Google icon
2. **Authenticating**: Loading spinner with "Connecting..." message
3. **Connected**: Displays user email with "Disconnect" button
4. **Error**: Shows error message with dismiss option
5. **Refreshing**: Indicates token refresh in progress

#### Features
- **Status Indicator**: Visual dot indicator (green/red/gray) with pulse animation
- **Loading States**: Animated spinners during async operations
- **Error Display**: User-friendly error messages with close button
- **Connection Callback**: Optional callback to notify parent of connection changes
- **Gmail Initialization**: Automatically initializes Gmail service on connection

#### Props

```typescript
interface GmailConnectButtonProps {
  onConnectionChange?: (isConnected: boolean) => void;
  className?: string;
}
```

### 4. Settings Panel (`src/components/SettingsPanel.tsx`)

#### Purpose
Provides a modal settings panel accessible from the app header.

#### Features
- **Modal Overlay**: Click-outside-to-close backdrop
- **Settings Icon**: Gear icon in app header
- **Gmail Section**: Contains the GmailConnectButton
- **Expandable**: Future sections can be added easily

#### UI Behavior
- Toggles open/close on settings icon click
- Closes on backdrop click
- Positioned absolutely in top-right corner
- Responsive design with proper z-indexing

### 5. App Integration

#### Main App (`src/App.tsx`)
- **Settings Panel**: Added to header for easy access
- **Visual Integration**: Positioned in top-right corner

#### App Entry (`src/main.tsx`)
- **Context Provider**: Wraps entire app with `GoogleAuthProvider`
- **Auto-refresh**: Enabled with 60-second check interval

```tsx
<GoogleAuthProvider autoRefresh={true} refreshCheckInterval={60000}>
  <App />
</GoogleAuthProvider>
```

## OAuth Flow Diagram

```
User clicks "Connect with Google"
         ↓
Load Google Identity Services script
         ↓
Initialize OAuth token client
         ↓
Open Google sign-in popup
         ↓
User selects account and grants permissions
         ↓
Receive access token + expiry time
         ↓
Fetch user email to validate token
         ↓
Initialize Gmail service (get history ID)
         ↓
Save session to localStorage
         ↓
Update UI to "Connected" state
         ↓
Start auto-refresh timer
         ↓
(Every 60s check if token needs refresh)
         ↓
(5 minutes before expiry: refresh token)
```

## Security Features

### Client-Side Token Storage
- **LocalStorage**: Tokens stored in browser localStorage
- **Expiry Checking**: Tokens validated on every use
- **Automatic Cleanup**: Expired sessions removed automatically

### Token Refresh Strategy
- **Proactive Refresh**: Tokens refreshed 5 minutes before expiry
- **Silent Refresh**: Uses OAuth implicit flow for seamless refresh
- **Fallback**: Forces re-authentication if refresh fails

### Scope Limitation
- **Minimal Scope**: Only requests `gmail.metadata` scope
- **No Email Content**: Cannot read actual email body text
- **Privacy-First**: Metadata includes only headers (subject, from, date)

### Error Handling
- **Popup Blocker**: Detects and alerts user
- **Network Errors**: Graceful handling with user feedback
- **Invalid Tokens**: Automatic cleanup and re-auth prompt
- **Session Expiry**: Clear messaging and easy re-connection

## Configuration

### Environment Variables

Required in `.env` file:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### Google Cloud Console Setup

1. **OAuth Client ID** (Web application type)
   - Authorized JavaScript origins: `http://localhost:5173`, production domain
   - No redirect URIs needed (client-side flow)

2. **OAuth Consent Screen**
   - External user type
   - Gmail API scope: `https://www.googleapis.com/auth/gmail.metadata`

3. **APIs Enabled**
   - Gmail API

See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) for detailed instructions.

## Usage Examples

### Using the Context in Components

```tsx
import { useGoogleAuth } from '../contexts/GoogleAuthContext';

function MyComponent() {
  const { session, status, signIn, signOut } = useGoogleAuth();

  if (status === 'connected' && session) {
    return <div>Connected as {session.email}</div>;
  }

  return <button onClick={signIn}>Sign In</button>;
}
```

### Accessing the Access Token

```tsx
import { useAccessToken } from '../contexts/GoogleAuthContext';

function GmailComponent() {
  const accessToken = useAccessToken();

  const fetchEmails = async () => {
    if (!accessToken) return;
    
    const response = await fetch(
      'https://www.googleapis.com/gmail/v1/users/me/messages',
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    // ... handle response
  };
}
```

### Checking Authentication Status

```tsx
import { useIsAuthenticated } from '../contexts/GoogleAuthContext';

function ProtectedFeature() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) {
    return <div>Please connect your Gmail account</div>;
  }

  return <div>Protected content</div>;
}
```

## Testing

### Manual Testing Checklist

- [ ] Initial connection flow
  - [ ] Click "Connect with Google"
  - [ ] See Google sign-in popup
  - [ ] Grant permissions
  - [ ] See "Connected as [email]" message

- [ ] Session persistence
  - [ ] Refresh page while connected
  - [ ] Session should restore automatically
  - [ ] No re-authentication required

- [ ] Token refresh
  - [ ] Wait for token to approach expiry (or manually set short expiry)
  - [ ] Verify automatic refresh occurs
  - [ ] No user interaction required

- [ ] Sign out
  - [ ] Click "Disconnect Gmail"
  - [ ] Session cleared
  - [ ] Token revoked with Google

- [ ] Error handling
  - [ ] Block popup → see error message
  - [ ] Close popup → see error message
  - [ ] Invalid Client ID → see configuration error
  - [ ] Network error → see connection error

### Browser Console Verification

When testing, monitor the console for log messages:
- `Google Identity Services script loaded`
- `Access token obtained, expires in X seconds`
- `Session saved for: [email]`
- `Session auto-refreshed`
- `Google token revoked successfully`

## Troubleshooting

### Common Issues

1. **"Google Client ID is not configured"**
   - Add `VITE_GOOGLE_CLIENT_ID` to `.env` file
   - Restart development server

2. **"Popup blocked"**
   - Allow popups in browser settings
   - Click connect button again

3. **"Failed to load Google Identity Services script"**
   - Check internet connection
   - Verify no browser extensions blocking Google scripts

4. **Token refresh fails**
   - User needs to re-authenticate
   - Check Google Cloud Console for API errors
   - Verify OAuth consent screen is published

See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md#troubleshooting) for more details.

## Future Enhancements

### Potential Improvements

1. **Multi-Account Support**
   - Allow multiple Google accounts
   - Switch between accounts

2. **Advanced Token Management**
   - Token rotation strategies
   - Secure token storage (consider IndexedDB)

3. **Enhanced Error Recovery**
   - Automatic retry with exponential backoff
   - Offline mode handling

4. **Analytics Integration**
   - Track authentication success/failure rates
   - Monitor token refresh patterns

5. **Testing**
   - Unit tests for auth service
   - Integration tests for OAuth flow
   - E2E tests with mock OAuth

## Dependencies

### Required Packages
- `react` - UI framework
- `react-dom` - React rendering

### External Services
- Google Identity Services (GIS) - Loaded via CDN
- Gmail API - REST API calls

### No Additional NPM Packages Required
The implementation uses:
- Native browser APIs (fetch, localStorage)
- Google's hosted GIS library
- React's built-in Context API

## Performance Considerations

### Optimization Strategies

1. **Script Loading**: GIS script loaded once and cached
2. **Token Caching**: Tokens stored locally, no unnecessary API calls
3. **Lazy Refresh**: Refresh only when needed (5-min buffer)
4. **Efficient Storage**: LocalStorage for minimal overhead
5. **Context Optimization**: Context updates only on auth state changes

### Bundle Size Impact
- **Context Provider**: ~2KB minified
- **Auth Service**: ~3KB minified
- **Components**: ~4KB minified
- **Total Addition**: ~9KB minified (excluding GIS library which is loaded from CDN)

## Maintenance

### Regular Tasks

1. **Monitor Google Cloud Console**
   - Check API quotas and usage
   - Review OAuth metrics
   - Check for security alerts

2. **Update Documentation**
   - Keep setup guide current
   - Document any API changes
   - Update troubleshooting section

3. **Test Periodically**
   - Verify OAuth flow still works
   - Check token refresh mechanism
   - Test error scenarios

4. **Security Reviews**
   - Audit token handling
   - Review error messages (no sensitive data leaked)
   - Check for security updates from Google

## References

- [Google Identity Services Documentation](https://developers.google.com/identity/gsi/web)
- [Gmail API Reference](https://developers.google.com/gmail/api)
- [OAuth 2.0 for Client-side Web Applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [React Context API](https://react.dev/reference/react/useContext)

## Change Log

### v1.0.0 - Initial Implementation
- Standalone OAuth flow using Google Identity Services
- React Context for global auth state management
- Automatic token refresh mechanism
- Enhanced UI with status indicators
- Comprehensive error handling
- Session persistence across page reloads
- Settings panel integration
- Full documentation suite

