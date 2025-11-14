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

  // Load existing session on mount
  useEffect(() => {
    const loadSession = async () => {
      setStatus('loading');
      try {
        const existingSession = googleAuth.getSession();
        if (existingSession) {
          // Validate and potentially refresh the session
          try {
            const validSession = await googleAuth.ensureValidSession(existingSession);
            setSession(validSession);
            setStatus('connected');
          } catch (err) {
            // Session is invalid, clear it
            console.warn('Existing session is invalid:', err);
            setSession(null);
            setStatus('idle');
          }
        } else {
          setStatus('idle');
        }
      } catch (err) {
        console.error('Error loading session:', err);
        setStatus('idle');
      }
    };

    loadSession();
  }, []);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh || !session || status !== 'connected') {
      return;
    }

    const checkAndRefresh = async () => {
      try {
        const validSession = await googleAuth.ensureValidSession(session);
        if (validSession.accessToken !== session.accessToken) {
          // Token was refreshed
          setSession(validSession);
          console.log('Session auto-refreshed');
        }
      } catch (err) {
        console.error('Auto-refresh failed:', err);
        setError('Session expired. Please sign in again.');
        setSession(null);
        setStatus('idle');
      }
    };

    // Set up periodic check
    refreshTimerRef.current = window.setInterval(checkAndRefresh, refreshCheckInterval);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [session, status, autoRefresh, refreshCheckInterval]);

  const signIn = useCallback(async () => {
    setStatus('authenticating');
    setError(null);

    try {
      // Get access token (force consent to show popup)
      const { accessToken, expiresAt, refreshedAt } = await googleAuth.getAccessToken(true);
      
      // Get user email
      const email = await googleAuth.getUserEmail(accessToken);
      
      // Create and save session
      const newSession: GmailSession = {
        email,
        accessToken,
        expiresAt,
        refreshedAt,
      };
      
      googleAuth.saveSession(newSession);
      setSession(newSession);
      setStatus('connected');
      
      console.log('Successfully signed in as:', email);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sign in';
      console.error('Sign in error:', errorMessage);
      setError(errorMessage);
      setStatus('error');
      
      // Reset to idle after showing error
      setTimeout(() => {
        if (status === 'error') {
          setStatus('idle');
        }
      }, 3000);
    }
  }, [status]);

  const signOut = useCallback(async () => {
    if (!session) return;

    try {
      await googleAuth.signOut(session.accessToken);
      setSession(null);
      setStatus('idle');
      setError(null);
      
      console.log('Successfully signed out');
    } catch (err: any) {
      console.error('Sign out error:', err);
      // Clear session even if sign out fails
      setSession(null);
      setStatus('idle');
    }
  }, [session]);

  const refreshSession = useCallback(async () => {
    if (!session) {
      throw new Error('No active session to refresh');
    }

    setStatus('refreshing');
    setError(null);

    try {
      const validSession = await googleAuth.ensureValidSession(session);
      setSession(validSession);
      setStatus('connected');
      console.log('Session refreshed successfully');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to refresh session';
      console.error('Refresh error:', errorMessage);
      setError(errorMessage);
      setSession(null);
      setStatus('idle');
    }
  }, [session]);

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

