import React, { useCallback, useEffect, useState } from 'react';
import {
  saveApiKey,
  getStoredAuth,
  clearAuth,
  testApiKey,
  listModels,
  getConfig,
  setConfig,
  initOAuth,
  type AnthropicAuthTokens,
  type AnthropicAuthMode,
  type AnthropicModel,
} from '../../../services/anthropicService';

type ConnectionStatus = 'disconnected' | 'testing' | 'connected' | 'error';

export default function AnthropicApiSettingsPanel() {
  const [authMode, setAuthMode] = useState<AnthropicAuthMode>('api_key');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedAuth, setStoredAuth] = useState<AnthropicAuthTokens | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<AnthropicModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  const loadAuth = useCallback(async () => {
    const auth = await getStoredAuth();
    setStoredAuth(auth);

    if (auth) {
      setAuthMode(auth.auth_mode);
      if (auth.auth_mode === 'api_key' && auth.api_key) {
        setConnectionStatus('connected');
        setStatusMessage('API key stored');
        setIsLoadingModels(true);
        const modelList = await listModels(auth.api_key);
        setModels(modelList);
        setIsLoadingModels(false);
      } else if (auth.auth_mode === 'oauth' && auth.access_token) {
        setConnectionStatus('connected');
        setStatusMessage('Connected via OAuth');
      }
    }

    const savedModel = await getConfig('default_model');
    if (savedModel) {
      setDefaultModel(savedModel);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  const handleTestKey = async () => {
    const key = apiKeyInput.trim() || storedAuth?.api_key;
    if (!key) {
      setStatusMessage('Enter an API key first');
      setConnectionStatus('error');
      return;
    }

    setConnectionStatus('testing');
    setStatusMessage('Testing connection...');

    const result = await testApiKey(key);
    if (result.ok) {
      setConnectionStatus('connected');
      setStatusMessage('Connection successful');
      if (result.models) {
        setModels(result.models);
      }
      return;
    }

    setConnectionStatus('error');
    setStatusMessage(result.error || 'Connection failed');
  };

  const handleSaveKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setStatusMessage('Enter an API key first');
      setConnectionStatus('error');
      return;
    }

    const saved = await saveApiKey(key);
    if (!saved) {
      setStatusMessage('Failed to save API key');
      setConnectionStatus('error');
      return;
    }

    setStatusMessage('API key saved');
    setConnectionStatus('connected');
    setApiKeyInput('');
    await loadAuth();
  };

  const handleClearAuth = async () => {
    const cleared = await clearAuth();
    if (!cleared) {
      return;
    }

    setStoredAuth(null);
    setApiKeyInput('');
    setModels([]);
    setDefaultModel('');
    setConnectionStatus('disconnected');
    setStatusMessage('Authentication cleared');
  };

  const handleModelChange = async (modelId: string) => {
    setDefaultModel(modelId);
    await setConfig('default_model', modelId);
  };

  const handleStartOAuth = async () => {
    try {
      const authUrl = await initOAuth();
      window.open(authUrl, '_blank', 'width=600,height=700');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'OAuth init failed');
      setConnectionStatus('error');
    }
  };

  const statusColor =
    connectionStatus === 'connected'
      ? 'bg-emerald-900/30 border-emerald-600/30 text-emerald-300'
      : connectionStatus === 'testing'
        ? 'bg-blue-900/30 border-blue-600/30 text-blue-300'
        : connectionStatus === 'error'
          ? 'bg-red-900/30 border-red-600/30 text-red-300'
          : 'bg-gray-800 border-gray-600 text-gray-400';

  const statusDot =
    connectionStatus === 'connected'
      ? 'bg-emerald-400'
      : connectionStatus === 'testing'
        ? 'bg-blue-400 animate-pulse'
        : connectionStatus === 'error'
          ? 'bg-red-400'
          : 'bg-gray-500';

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${statusColor}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
            {connectionStatus === 'connected' && 'Connected'}
            {connectionStatus === 'testing' && 'Testing...'}
            {connectionStatus === 'error' && 'Error'}
            {connectionStatus === 'disconnected' && 'Disconnected'}
          </span>
          {statusMessage && <span className="text-sm text-slate-400">{statusMessage}</span>}
        </div>
        <span className="text-xs text-slate-500">
          Mode: {authMode === 'api_key' ? 'API Key' : 'OAuth'}
        </span>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Authentication</h3>
          <div className="flex rounded-xl border border-white/10 bg-slate-950/50 p-1">
            <button
              onClick={() => setAuthMode('api_key')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                authMode === 'api_key' ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              API Key
            </button>
            <button
              onClick={() => setAuthMode('oauth')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                authMode === 'oauth' ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              OAuth
            </button>
          </div>
        </div>

        {authMode === 'api_key' && (
          <div className="space-y-3">
            {storedAuth?.auth_mode === 'api_key' && storedAuth.api_key && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Stored key:</span>
                <code className="rounded bg-slate-950/80 px-2 py-0.5 text-xs text-slate-300">
                  sk-ant-...{storedAuth.api_key.slice(-8)}
                </code>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="min-w-[260px] flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
              />
              <button
                onClick={handleTestKey}
                disabled={connectionStatus === 'testing'}
                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
              >
                Test
              </button>
              <button
                onClick={handleSaveKey}
                disabled={!apiKeyInput.trim()}
                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
              >
                Save
              </button>
              {storedAuth && (
                <button
                  onClick={handleClearAuth}
                  className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/20"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {authMode === 'oauth' && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                Experimental
              </span>
              <p className="mt-3 text-sm text-amber-100/90">
                Anthropic browser OAuth is still not the stable path here. Your Claude Pro account session
                in the new Session view is the better source of truth right now.
              </p>
            </div>

            {storedAuth?.auth_mode === 'oauth' && storedAuth.access_token && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">Token:</span>
                  <code className="rounded bg-slate-950/80 px-2 py-0.5 text-xs text-slate-300">
                    ...{storedAuth.access_token.slice(-12)}
                  </code>
                </div>
                {storedAuth.expires_at && (
                  <div className="text-xs text-slate-500">
                    Expires: {new Date(storedAuth.expires_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                className="rounded border-white/10"
              />
              I understand this is experimental.
            </label>

            <div className="flex gap-2">
              {(!storedAuth || storedAuth.auth_mode !== 'oauth') ? (
                <button
                  onClick={handleStartOAuth}
                  disabled={!tosAccepted}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Connect with Anthropic
                </button>
              ) : (
                <button
                  onClick={handleClearAuth}
                  className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/20"
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">API Models</h3>

        {isLoadingModels ? (
          <div className="text-sm text-slate-500">Loading models...</div>
        ) : models.length === 0 ? (
          <div className="text-sm text-slate-500">
            Connect with a valid Anthropic API key to browse API model inventory here.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-400">Default model:</label>
              <select
                value={defaultModel}
                onChange={(e) => void handleModelChange(e.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
              >
                <option value="">Select a model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name || model.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/10">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-950/90">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-400">Model ID</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-400">Display Name</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-400">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                      <td className="px-3 py-2 font-mono text-slate-300">{model.id}</td>
                      <td className="px-3 py-2 text-slate-400">{model.display_name || '-'}</td>
                      <td className="px-3 py-2 text-slate-500">{model.type || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
