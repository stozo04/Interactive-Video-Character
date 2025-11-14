// src/components/GmailConnectButton.tsx
import React, { useEffect } from "react";
import { useGoogleAuth } from "../contexts/GoogleAuthContext";
import { gmailService } from "../services/gmailService";

interface GmailConnectButtonProps {
  onConnectionChange?: (isConnected: boolean) => void;
  className?: string;
}

export function GmailConnectButton({ 
  onConnectionChange, 
  className = "" 
}: GmailConnectButtonProps) {
  const { session, status, error, signIn, signOut, clearError } = useGoogleAuth();

  // Initialize Gmail service when connected
  useEffect(() => {
    const initializeGmail = async () => {
      if (session && status === 'connected') {
        try {
          await gmailService.getInitialHistoryId(session.accessToken);
          console.log('Gmail service initialized');
        } catch (err) {
          console.error('Failed to initialize Gmail service:', err);
        }
      }
    };

    initializeGmail();
  }, [session, status]);

  // Notify parent component of connection changes
  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(session !== null && status === 'connected');
    }
  }, [session, status, onConnectionChange]);

  const handleConnect = async () => {
    clearError();
    await signIn();
  };

  const handleDisconnect = async () => {
    // Clear Gmail history ID
    localStorage.removeItem("gmail_history_id");
    await signOut();
  };

  // Get status display info
  const getStatusInfo = () => {
    switch (status) {
      case 'loading':
        return { text: 'Loading...', color: 'text-blue-400', showSpinner: true };
      case 'authenticating':
        return { text: 'Authenticating...', color: 'text-blue-400', showSpinner: true };
      case 'refreshing':
        return { text: 'Refreshing...', color: 'text-blue-400', showSpinner: true };
      case 'connected':
        return { text: 'Connected', color: 'text-green-400', showSpinner: false };
      case 'error':
        return { text: 'Error', color: 'text-red-400', showSpinner: false };
      default:
        return { text: 'Not Connected', color: 'text-gray-400', showSpinner: false };
    }
  };

  const statusInfo = getStatusInfo();
  const isConnected = session !== null && status === 'connected';
  const isProcessing = status === 'loading' || status === 'authenticating' || status === 'refreshing';

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Status Display */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-2">
          {/* Status Indicator Dot */}
          <div className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500 animate-pulse' : 
            status === 'error' ? 'bg-red-500' : 
            'bg-gray-500'
          }`} />
          <span className={statusInfo.color}>
            {statusInfo.text}
          </span>
          {statusInfo.showSpinner && (
            <svg 
              className="animate-spin h-4 w-4 text-blue-400" 
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24"
            >
              <circle 
                className="opacity-25" 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="4"
              />
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Connected State */}
      {isConnected && session && (
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <svg 
              className="w-5 h-5 text-green-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-300">
                Connected as
              </p>
              <p className="text-xs text-gray-400 truncate">
                {session.email}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={isProcessing}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-md transition-colors text-sm font-medium"
          >
            Disconnect Gmail
          </button>
        </div>
      )}

      {/* Not Connected State */}
      {!isConnected && (
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <svg 
              className="w-5 h-5 text-gray-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" 
              />
            </svg>
            <p className="text-sm text-gray-400">
              Connect your Gmail account
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={isProcessing}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-md transition-colors text-sm font-medium flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <svg 
                  className="animate-spin h-4 w-4" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24"
                >
                  <circle 
                    className="opacity-25" 
                    cx="12" 
                    cy="12" 
                    r="10" 
                    stroke="currentColor" 
                    strokeWidth="4"
                  />
                  <path 
                    className="opacity-75" 
                    fill="currentColor" 
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <svg 
                  className="w-5 h-5" 
                  viewBox="0 0 24 24" 
                  fill="currentColor"
                >
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Connect with Google</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg 
              className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-red-300">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-300 transition-colors"
              aria-label="Close error"
            >
              <svg 
                className="w-5 h-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}