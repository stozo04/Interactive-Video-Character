// src/components/SettingsPanel.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { hasXScope, isXConnected, initXAuth, revokeXAuth } from '../services/xClient';
import { supabase } from '../services/supabaseClient';
import { getMultiAgentHealth, getWhatsAppHealth, getTelegramHealth, getOpeyHealth } from '../services/multiAgentService';
import type { ProactiveSettings } from '../types';

interface SettingsPanelProps {
  className?: string;
  proactiveSettings?: ProactiveSettings;
  onProactiveSettingsChange?: (updates: Partial<ProactiveSettings>) => void;
  onAdminDashboard?: () => void;
}

export function SettingsPanel({ 
  className = '',
  proactiveSettings,
  onProactiveSettingsChange,
  onAdminDashboard
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Check if all proactive features are off
  const allProactiveOff = proactiveSettings 
    ? !proactiveSettings.calendar && !proactiveSettings.news && !proactiveSettings.checkins
    : false;

  // --------------------------------------------------------------------------
  // X (Twitter) Integration State
  // --------------------------------------------------------------------------
  const [xConnected, setXConnected] = useState<boolean | null>(null); // null = checking
  const [xLoading, setXLoading] = useState(false);
  const [xPostingMode, setXPostingMode] = useState<'approval' | 'autonomous'>('approval');
  const [xMissingMediaScope, setXMissingMediaScope] = useState<boolean>(false);

  // --------------------------------------------------------------------------
  // Multi-agent Server Health
  // --------------------------------------------------------------------------
  const [serverHealthStatus, setServerHealthStatus] = useState<'ok' | 'unreachable' | null>(null);
  const [serverHealthLatencyMs, setServerHealthLatencyMs] = useState<number | null>(null);
  const [isServerHealthLoading, setIsServerHealthLoading] = useState(false);
  const [serverHealthError, setServerHealthError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // WhatsApp Bridge Health
  // --------------------------------------------------------------------------
  const [waStatus, setWaStatus] = useState<'ok' | 'unreachable' | null>(null);
  const [waLatencyMs, setWaLatencyMs] = useState<number | null>(null);

  // --------------------------------------------------------------------------
  // Telegram Bridge Health
  // --------------------------------------------------------------------------
  const [telegramStatus, setTelegramStatus] = useState<'ok' | 'unreachable' | null>(null);

  // --------------------------------------------------------------------------
  // Opey Health
  // --------------------------------------------------------------------------
  const [opeyStatus, setOpeyStatus] = useState<'ok' | 'busy' | 'unreachable' | null>(null);

  const checkXConnection = useCallback(async () => {
    try {
      const connected = await isXConnected();
      setXConnected(connected);
      if (connected) {
        const hasMediaWrite = await hasXScope('media.write');
        setXMissingMediaScope(hasMediaWrite === false);
      } else {
        setXMissingMediaScope(false);
      }
    } catch {
      setXConnected(false);
      setXMissingMediaScope(false);
    }
  }, []);

  const loadXPostingMode = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('user_facts')
        .select('fact_value')
        .eq('category', 'preference')
        .eq('fact_key', 'x_posting_mode')
        .limit(1)
        .maybeSingle();
      if (data?.fact_value === 'autonomous') {
        setXPostingMode('autonomous');
      }
    } catch {
      // No preference set yet — default to approval
    }
  }, []);

  const loadServerHealth = useCallback(async () => {
    setIsServerHealthLoading(true);
    setServerHealthError(null);
    try {
      const [multiAgent, whatsapp, telegram, opey] = await Promise.all([
        getMultiAgentHealth(),
        getWhatsAppHealth(),
        getTelegramHealth(),
        getOpeyHealth(),
      ]);

      if (!multiAgent.ok) {
        setServerHealthStatus('unreachable');
        setServerHealthLatencyMs(null);
        setServerHealthError(multiAgent.error || 'Server health check failed.');
      } else {
        setServerHealthStatus('ok');
        setServerHealthLatencyMs(typeof multiAgent.latencyMs === 'number' ? multiAgent.latencyMs : null);
      }

      setWaStatus(whatsapp.ok && whatsapp.connected ? 'ok' : 'unreachable');
      setWaLatencyMs(typeof whatsapp.latencyMs === 'number' ? whatsapp.latencyMs : null);
      setTelegramStatus(telegram.ok && telegram.running ? 'ok' : 'unreachable');
      setOpeyStatus(!opey.ok ? 'unreachable' : opey.currentTicketId ? 'busy' : 'ok');
    } catch (error) {
      console.error('Server health check failed:', error);
      setServerHealthStatus('unreachable');
      setServerHealthLatencyMs(null);
      setServerHealthError('Server health check failed.');
      setWaStatus('unreachable');
      setTelegramStatus('unreachable');
      setOpeyStatus('unreachable');
    } finally {
      setIsServerHealthLoading(false);
    }
  }, []);

  // Check X status when panel opens
  useEffect(() => {
    if (isOpen) {
      checkXConnection();
      loadXPostingMode();
      loadServerHealth();
    }
  }, [isOpen, checkXConnection, loadXPostingMode, loadServerHealth]);

  const handleConnectX = async () => {
    setXLoading(true);
    try {
      const authUrl = await initXAuth();
      // Same-tab redirect — user authorizes on X, then App.tsx handles the callback
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to start X OAuth:', error);
      setXLoading(false);
    }
  };

  const handleDisconnectX = async () => {
    setXLoading(true);
    try {
      await revokeXAuth();
      setXConnected(false);
    } catch (error) {
      console.error('Failed to disconnect X:', error);
    } finally {
      setXLoading(false);
    }
  };

  const handleTogglePostingMode = async () => {
    const newMode = xPostingMode === 'approval' ? 'autonomous' : 'approval';
    setXPostingMode(newMode);
    try {
      await supabase
        .from('user_facts')
        .upsert(
          { category: 'preference', fact_key: 'x_posting_mode', fact_value: newMode },
          { onConflict: 'category,fact_key' }
        );
    } catch (error) {
      console.error('Failed to save X posting mode:', error);
      // Revert on failure
      setXPostingMode(xPostingMode);
    }
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

            {/* Proactive Features Section */}
            {proactiveSettings && onProactiveSettingsChange && (
              <div className="border-b border-gray-700 pb-4 mb-4">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Proactive Features
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Control what Kayley proactively brings up
                </p>
                
                {/* Master toggle - All Off */}
                <div className="flex items-center justify-between py-2 border-b border-gray-700/50 mb-2">
                  <span className="text-sm text-gray-300">All Off</span>
                  <button
                    onClick={() => {
                      if (allProactiveOff) {
                        onProactiveSettingsChange({ calendar: true, news: true, checkins: true });
                      } else {
                        onProactiveSettingsChange({ calendar: false, news: false, checkins: false });
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      allProactiveOff ? 'bg-purple-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        allProactiveOff ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                
                {/* Calendar Events toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm text-gray-300">Calendar Events</span>
                    <p className="text-xs text-gray-500">Reminders for upcoming events</p>
                  </div>
                  <button
                    onClick={() => onProactiveSettingsChange({ calendar: !proactiveSettings.calendar })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      proactiveSettings.calendar ? 'bg-purple-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        proactiveSettings.calendar ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                
                {/* Tech News toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm text-gray-300">Tech News</span>
                    <p className="text-xs text-gray-500">AI/tech news from Hacker News</p>
                  </div>
                  <button
                    onClick={() => onProactiveSettingsChange({ news: !proactiveSettings.news })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      proactiveSettings.news ? 'bg-purple-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        proactiveSettings.news ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                
                {/* Random Check-ins toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm text-gray-300">Random Check-ins</span>
                    <p className="text-xs text-gray-500">Conversation starters when idle</p>
                  </div>
                  <button
                    onClick={() => onProactiveSettingsChange({ checkins: !proactiveSettings.checkins })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      proactiveSettings.checkins ? 'bg-purple-600' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        proactiveSettings.checkins ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Gmail Integration Section */}
            <div className="space-y-3">
              {/* Server Status Section */}
              <div className="border-t border-gray-700 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-300">Server Status</h3>
                  <button
                    onClick={loadServerHealth}
                    disabled={isServerHealthLoading}
                    className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white"
                  >
                    {isServerHealthLoading ? 'Checking...' : 'Refresh'}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      serverHealthStatus === 'ok'
                        ? 'bg-green-400'
                        : serverHealthStatus === 'unreachable'
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <span>
                    {serverHealthStatus
                      ? `Multi-agent: ${serverHealthStatus}${
                          serverHealthLatencyMs !== null
                            ? ` (${serverHealthLatencyMs}ms)`
                            : ''
                        }`
                      : 'Multi-agent: unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      waStatus === 'ok'
                        ? 'bg-green-400'
                        : waStatus === 'unreachable'
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <span>
                    {waStatus
                      ? `WhatsApp: ${waStatus}${waLatencyMs !== null ? ` (${waLatencyMs}ms)` : ''}`
                      : 'WhatsApp: unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      telegramStatus === 'ok'
                        ? 'bg-green-400'
                        : telegramStatus === 'unreachable'
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <span>{telegramStatus ? `Telegram: ${telegramStatus}` : 'Telegram: unknown'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      opeyStatus === 'ok'
                        ? 'bg-green-400'
                        : opeyStatus === 'busy'
                          ? 'bg-blue-400'
                          : opeyStatus === 'unreachable'
                            ? 'bg-red-400'
                            : 'bg-amber-400'
                    }`}
                  />
                  <span>{opeyStatus ? `Opey: ${opeyStatus === 'busy' ? 'implementing' : opeyStatus}` : 'Opey: unknown'}</span>
                </div>
                {serverHealthError && (
                  <p className="text-xs text-red-400 mt-2">{serverHealthError}</p>
                )}
              </div>

              {/* X (Twitter) Integration Section */}
              <div className="border-t border-gray-700 pt-3">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  X (Twitter) Integration
                </h3>

                {xConnected === null ? (
                  <p className="text-xs text-gray-500">Checking connection...</p>
                ) : xConnected ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
                        <span className="text-xs text-green-400 font-medium">Connected</span>
                      </div>
                      <button
                        onClick={handleDisconnectX}
                        disabled={xLoading}
                        className="text-xs px-3 py-1 bg-red-600/60 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
                      >
                        {xLoading ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>

                    {xMissingMediaScope && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                        <p className="text-xs text-amber-200">
                          Media uploads are disabled. Reconnect X to grant `media.write`.
                        </p>
                      </div>
                    )}

                    {/* Posting Mode Toggle — only relevant when a character is active */}
                    {proactiveSettings && <div className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm text-gray-300">Auto-post</span>
                        <p className="text-xs text-gray-500">
                          {xPostingMode === 'autonomous'
                            ? 'Posts automatically'
                            : 'Asks for approval first'}
                        </p>
                      </div>
                      <button
                        onClick={handleTogglePostingMode}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          xPostingMode === 'autonomous' ? 'bg-purple-600' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            xPostingMode === 'autonomous' ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>}
                  </div>
                ) : (
                  <button
                    onClick={handleConnectX}
                    disabled={xLoading}
                    className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {xLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        <span>Connect X Account</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Admin Dashboard Section */}
              <div className="border-t border-gray-700 pt-3">
                <button
                  onClick={() => {
                    if (onAdminDashboard) {
                      onAdminDashboard();
                      setIsOpen(false);
                    }
                  }}
                  className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Admin Dashboard
                </button>
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
}
