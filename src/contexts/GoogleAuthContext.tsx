// src/contexts/GoogleAuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as googleAuth from '../services/googleAuth';
import type { GmailSession, AuthStatus } from '../services/googleAuth';

interface GoogleAuthContextType {
  session: GmailSession | null;
  status: AuthStatus;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
}

const GoogleAuthContext = createContext<GoogleAuthContextType | undefined>(undefined);

interface GoogleAuthProviderProps {
  children: React.ReactNode;
  autoRefresh?: boolean;
  refreshCheckInterval?: number; // in milliseconds
}

/**
 * Provider component for Google OAuth authentication
 */
export function GoogleAuthProvider({ 
  children, 
  autoRefresh = true,
  refreshCheckInterval = 60000, // Check every minute
}: GoogleAuthProviderProps) {
  const [session, setSession] = useState<GmailSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const lastSilentRefreshAtRef = useRef<number>(0);

  const attemptSilentRefresh = useCallback(async (reason: string) => {
    const now = Date.now();
    if (now - lastSilentRefreshAtRef.current < 30000) {
      //console.log(`Silent refresh throttled (${reason})`);
      return;
    }
    lastSilentRefreshAtRef.current = now;
    const error = await googleAuth.silentRefresh();
    if (error) throw error;
    // console.log(`Silent refresh request sent (${reason})`);
  }, []);

  // Load existing session on mount
  useEffect(() => {
    const loadSession = async () => {
      setStatus('loading');
      try {
        // Try to get existing Supabase session first
        const { data: { session: sbSession } } = await googleAuth.supabase.auth.getSession();

        if (sbSession && sbSession.provider_token) {
          const gmailSession: GmailSession = {
            email: sbSession.user.email || '',
            accessToken: sbSession.provider_token,
            expiresAt: (sbSession.expires_at || 0) * 1000,
            refreshedAt: Date.now(),
          };
          googleAuth.saveSession(gmailSession);
          setSession(gmailSession);
          setStatus('connected');
        } else {
        // Fallback to local storage if it's still valid
          const existingSession = googleAuth.getSession();
          if (existingSession) {
            try {
              const validSession = await googleAuth.ensureValidSession(existingSession);
              setSession(validSession);
              setStatus('connected');
            } catch (err) {
              console.warn('Existing session is invalid:', err);
              setSession(null);
              setStatus('idle');
            }
          } else {
            setStatus('idle');
          }
        }
      } catch (err) {
        console.error('Error loading session:', err);
        setStatus('idle');
      }
    };

    loadSession();

    // Listen for auth state changes (especially important for Supabase redirects)
    const { data: { subscription } } = googleAuth.supabase.auth.onAuthStateChange(async (event, sbSession) => {
      //  console.log('Auth state changed:', event);

      const isSignIn = event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED';

      if (isSignIn && sbSession) {
        googleAuth.setConnectedHint(true);
        const hasProviderToken = !!sbSession.provider_token;
        const hasLocalToken = !!googleAuth.getSession()?.accessToken;

        if (!hasProviderToken && !hasLocalToken) {
          setStatus('refreshing');
          try {
            await attemptSilentRefresh('auth_state_missing_token');
          } catch (silentErr: any) {
            console.error('Silent re-auth failed:', silentErr);
            setError(silentErr.message || 'Failed to refresh session');
            setStatus('needs_reconnect');
          }
        }

        // Bridged Update: Preserve current token if Supabase didn't provide one
        setSession(prev => {
          if (!hasProviderToken && prev?.accessToken) {
            // console.log(`dY", Session ${event}: Preserving existing Google token`);
            return {
              ...prev,
              email: sbSession.user.email || prev.email,
              // Keep old accessToken and expiresAt
            };
          }

          if (hasProviderToken) {
            // console.log(`?o. Session ${event}: New Google token received`);
            const next = {
              email: sbSession.user.email || '',
              accessToken: sbSession.provider_token!,
              expiresAt: Date.now() + 3600 * 1000, // Google default 1h
              refreshedAt: Date.now(),
            };
            googleAuth.saveSession(next);
            return next;
          }

          return prev;
        });

        if (hasProviderToken || hasLocalToken) {
          setStatus('connected');
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setStatus('idle');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Auto-refresh timer - simplified since Supabase handles refresh
  useEffect(() => {
    if (!autoRefresh || !session || status !== 'connected') {
      return;
    }

    const checkAndRefresh = async () => {
      if (status !== 'connected' || !session) return;

      try {
        // Use the context's refreshSession which has built-in silent re-auth and bridging
        await refreshSession();
      } catch (err) {
        console.warn('Background checkAndRefresh failed:', err);
      }
    };

    // If token is already expired or very close, check immediately
    const timeUntilExpiry = googleAuth.getTimeUntilExpiry(session);
    if (timeUntilExpiry < 60000) { // 1 minute
      checkAndRefresh();
    }

    refreshTimerRef.current = window.setInterval(checkAndRefresh, refreshCheckInterval);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
      }
    };
  }, [session, status, autoRefresh, refreshCheckInterval]);

  const signIn = useCallback(async () => {
    setStatus('authenticating');
    setError(null);

    try {
      const { error } = await googleAuth.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: googleAuth.SCOPES_ARRAY.join(' '),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          redirectTo: window.location.origin,
        },
      });

      if (error) throw error;
      
      // Note: redirection happens here, UI will be updated via onAuthStateChange on return
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sign in';
      console.error('Sign in error:', errorMessage);
      setError(errorMessage);
      setStatus('error');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await googleAuth.signOut();
      setSession(null);
      setStatus('idle');
      setError(null);
    } catch (err: any) {
      console.error('Sign out error:', err);
      setSession(null);
      setStatus('idle');
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!session) {
      setStatus('refreshing');
      setError(null);

      if (!googleAuth.hasConnectedHint()) {
        setStatus('idle');
        throw new Error('No active session to refresh');
      }

      try {
        await attemptSilentRefresh('no_session');
        return;
      } catch (silentErr: any) {
        console.error('Silent re-auth failed:', silentErr);
        setError(silentErr.message || 'Failed to refresh session');
        setStatus('needs_reconnect');
        throw silentErr;
      }
    }

    setStatus('refreshing');
    setError(null);

    try {
      const validSession = await googleAuth.ensureValidSession(session);
      setSession(validSession);
      setStatus('connected');
      // console.log('?o. Session refreshed successfully via Supabase');
    } catch (err: any) {
      console.warn('Standard refresh failed, trying silent silent re-auth...', err);

      try {
        // Try silent re-auth as a last resort before showing banner
        await attemptSilentRefresh('refresh_failed');
      } catch (silentErr: any) {
        console.error('Silent re-auth failed:', silentErr);
        setError(err.message || 'Failed to refresh session');
        setStatus('needs_reconnect');
      }
    }
  }, [session, attemptSilentRefresh]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: GoogleAuthContextType = {
    session,
    status,
    error,
    signIn,
    signOut,
    refreshSession,
    clearError,
  };

  return (
    <GoogleAuthContext.Provider value={value}>
      {children}
    </GoogleAuthContext.Provider>
  );
}

/**
 * Hook to use Google Auth context
 */
export function useGoogleAuth(): GoogleAuthContextType {
  const context = useContext(GoogleAuthContext);
  if (context === undefined) {
    throw new Error('useGoogleAuth must be used within a GoogleAuthProvider');
  }
  return context;
}

/**
 * Hook to check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  const { session, status } = useGoogleAuth();
  return session !== null && status === 'connected';
}

/**
 * Hook to get the current access token (with auto-refresh)
 */
export function useAccessToken(): string | null {
  const { session } = useGoogleAuth();
  return session?.accessToken || null;
}

