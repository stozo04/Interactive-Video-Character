// src/components/SettingsPanel.tsx
import React, { useState } from 'react';
import { GmailConnectButton } from './GmailConnectButton';
import { useGoogleAuth } from '../contexts/GoogleAuthContext';
import { useAIService } from '../contexts/AIServiceContext'; // Import the hook

interface SettingsPanelProps {
  className?: string;
  onGmailConnectionChange?: (isConnected: boolean) => void;
}

export function SettingsPanel({ className = '', onGmailConnectionChange }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { session, signOut, status } = useGoogleAuth();
  
  // 1. Get the active service and setter from context
  const { activeServiceId, setService } = useAIService();

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsOpen(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // 2. Add the handler with logging
  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newService = e.target.value as 'grok' | 'gemini' | 'chatgpt';
    console.log(`🔄 [Settings] User toggled AI Service to: ${newService.toUpperCase()}`);
    setService(newService);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Settings Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
        aria-label="Settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      {/* Settings Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-12 bg-gray-800 rounded-lg shadow-2xl border border-gray-700 p-4 z-50 min-w-[320px] max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-100">Settings</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-300 transition-colors"
                aria-label="Close settings"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
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

            {/* 3. ADD THIS SECTION: AI Brain Toggle */}
            <div className="border-b border-gray-700 pb-4 mb-4">
              <h3 className="text-sm font-medium text-gray-300 mb-2">
                AI Intelligence
              </h3>
              <div className="relative">
                <select
                  value={activeServiceId}
                  onChange={handleServiceChange}
                  className="w-full bg-gray-900 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none appearance-none"
                >
                  <option value="grok">Grok (xAI) - Beta</option>
                  <option value="gemini">Gemini (Google)</option>
                  <option value="chatgpt">ChatGPT (OpenAI)</option>
                </select>
                {/* Custom Arrow Icon */}
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Controls which AI model powers the character.
              </p>
            </div>

            {/* Gmail Integration Section */}
            <div className="space-y-3">
              <div className="border-t border-gray-700 pt-3">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Gmail Integration
                </h3>
                <GmailConnectButton onConnectionChange={onGmailConnectionChange} />
              </div>

              {/* Account Section */}
              <div className="border-t border-gray-700 pt-3">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Account
                </h3>
                {session && (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-400 bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
                      <div className="flex items-center gap-2 mb-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                        <span className="font-medium">Signed in as:</span>
                      </div>
                      <div className="pl-6 text-gray-300">{session.email}</div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      disabled={status === 'loading'}
                      className="w-full px-4 py-2 bg-red-600/80 hover:bg-red-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      {status === 'loading' ? (
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
                          <span>Signing out...</span>
                        </>
                      ) : (
                        <>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                          </svg>
                          <span>Sign Out</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}