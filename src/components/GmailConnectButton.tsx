// src/components/GmailConnectButton.tsx
import React, { useEffect } from "react";
import { useGoogleAuth } from "../contexts/GoogleAuthContext";

interface GmailConnectButtonProps {
  onConnectionChange?: (isConnected: boolean) => void;
  className?: string;
}

export function GmailConnectButton({
  onConnectionChange,
  className = "",
}: GmailConnectButtonProps) {
  const { session, status, error, signIn, signOut, clearError } = useGoogleAuth();

  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(session !== null && status === "connected");
    }
  }, [session, status, onConnectionChange]);

  const handleConnect = async () => {
    clearError();
    await signIn();
  };

  const handleDisconnect = async () => {
    localStorage.removeItem("gmail_history_id");
    await signOut();
  };

  const isConnected = session !== null && status === "connected";
  const isProcessing = status === "loading" || status === "authenticating" || status === "refreshing";

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isConnected ? "bg-green-400" : status === "error" ? "bg-red-400" : "bg-gray-500"
            }`}
          />
          <span
            className={`text-xs font-medium ${
              isConnected ? "text-green-400" : "text-gray-400"
            }`}
          >
            {isProcessing ? "Connecting..." : isConnected ? "Connected" : "Not connected"}
          </span>
        </div>

        {isConnected ? (
          <button
            onClick={handleDisconnect}
            disabled={isProcessing}
            className="text-xs px-3 py-1 bg-red-600/60 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
          >
            {isProcessing ? "Disconnecting..." : "Disconnect"}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isProcessing}
            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors"
          >
            {isProcessing ? "Connecting..." : "Connect"}
          </button>
        )}
      </div>
      {isConnected && session && (
        <p className="text-xs text-gray-500 pl-4">{session.email}</p>
      )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 flex items-start gap-2">
          <p className="text-xs text-red-300 flex-1">{error}</p>
          <button onClick={clearError} className="text-red-400 hover:text-red-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
