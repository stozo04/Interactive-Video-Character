import React, { useState, useEffect, useCallback } from 'react';
import {
  saveGoogleApiKey,
  getStoredGoogleAuth,
  clearGoogleAuth,
  testGoogleApiKey,
  listGoogleModels,
  getGoogleConfig,
  setGoogleConfig,
  type GoogleApiAuthTokens,
  type GoogleAuthMode,
  type GoogleModel,
} from '../services/googleApiService';

type ConnectionStatus = 'disconnected' | 'testing' | 'connected' | 'error';

export default function GoogleTab() {
  // Auth state
  const [authMode, setAuthMode] = useState<GoogleAuthMode>('api_key');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedAuth, setStoredAuth] = useState<GoogleApiAuthTokens | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('');

  // Models state
  const [models, setModels] = useState<GoogleModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // OAuth state
  const [tosAccepted, setTosAccepted] = useState(false);

  // Load stored auth on mount
  const loadAuth = useCallback(async () => {
    const auth = await getStoredGoogleAuth();
    setStoredAuth(auth);

    if (auth) {
      setAuthMode(auth.auth_mode);
      if (auth.auth_mode === 'api_key' && auth.api_key) {
        setConnectionStatus('connected');
        setStatusMessage('API key stored');
        // Load models with stored key
        setIsLoadingModels(true);
        const modelList = await listGoogleModels(auth.api_key);
        setModels(modelList);
        setIsLoadingModels(false);
      } else if (auth.auth_mode === 'oauth' && auth.access_token) {
        setConnectionStatus('connected');
        setStatusMessage('Connected via OAuth');
      }
    }

    const savedModel = await getGoogleConfig('default_model');
    if (savedModel) setDefaultModel(savedModel);
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  // ============================================
  // API Key Actions
  // ============================================

  const handleTestKey = async () => {
    const key = apiKeyInput.trim() || storedAuth?.api_key;
    if (!key) {
      setStatusMessage('Enter an API key first');
      setConnectionStatus('error');
      return;
    }

    setConnectionStatus('testing');
    setStatusMessage('Testing connection...');

    const result = await testGoogleApiKey(key);

    if (result.ok) {
      setConnectionStatus('connected');
      setStatusMessage('Connection successful');
      if (result.models) setModels(result.models);
    } else {
      setConnectionStatus('error');
      setStatusMessage(result.error || 'Connection failed');
    }
  };

  const handleSaveKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setStatusMessage('Enter an API key first');
      setConnectionStatus('error');
      return;
    }

    const saved = await saveGoogleApiKey(key);
    if (saved) {
      setStatusMessage('API key saved');
      setConnectionStatus('connected');
      setApiKeyInput('');
      await loadAuth();
    } else {
      setStatusMessage('Failed to save API key');
      setConnectionStatus('error');
    }
  };

  const handleClearAuth = async () => {
    const cleared = await clearGoogleAuth();
    if (cleared) {
      setStoredAuth(null);
      setApiKeyInput('');
      setModels([]);
      setDefaultModel('');
      setConnectionStatus('disconnected');
      setStatusMessage('Authentication cleared');
    }
  };

  // ============================================
  // Model Selection
  // ============================================

  const handleModelChange = async (modelId: string) => {
    setDefaultModel(modelId);
    await setGoogleConfig('default_model', modelId);
  };

  // ============================================
  // Render Helpers
  // ============================================

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
      {/* Connection Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-gray-700 rounded-xl bg-gray-900/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm ${statusColor}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
            {connectionStatus === 'connected' && 'Connected'}
            {connectionStatus === 'testing' && 'Testing...'}
            {connectionStatus === 'error' && 'Error'}
            {connectionStatus === 'disconnected' && 'Disconnected'}
          </span>
          {statusMessage && (
            <span className="text-sm text-gray-400">{statusMessage}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Mode: {authMode === 'api_key' ? 'API Key' : 'OAuth'}
          </span>
        </div>
      </div>

      {/* Auth Mode Toggle */}
      <div className="border border-gray-700 rounded-xl bg-gray-900/50 p-4">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-gray-300">Google API Authentication</h3>
          <div className="flex bg-gray-800 p-0.5 rounded-lg border border-gray-700">
            <button
              onClick={() => setAuthMode('api_key')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                authMode === 'api_key' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              API Key
            </button>
            <button
              onClick={() => setAuthMode('oauth')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                authMode === 'oauth' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              OAuth (Experimental)
            </button>
          </div>
        </div>

        {/* API Key Section */}
        {authMode === 'api_key' && (
          <div className="space-y-3">
            {storedAuth?.auth_mode === 'api_key' && storedAuth.api_key && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400">Stored key:</span>
                <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-xs">
                  {storedAuth.api_key.substring(0, 4)}...{storedAuth.api_key.slice(-8)}
                </code>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              <button
                onClick={handleTestKey}
                disabled={connectionStatus === 'testing'}
                className="px-4 py-2 bg-blue-700/80 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Test
              </button>
              <button
                onClick={handleSaveKey}
                disabled={!apiKeyInput.trim()}
                className="px-4 py-2 bg-emerald-700/80 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Save
              </button>
              {storedAuth && (
                <button
                  onClick={handleClearAuth}
                  className="px-4 py-2 bg-red-700/80 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-500">
              Get an API key from the <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">Google AI Studio</a>.
            </p>
          </div>
        )}

        {/* OAuth Section */}
        {authMode === 'oauth' && (
          <div className="space-y-3">
            <div className="border border-amber-600/30 rounded-lg p-3 bg-amber-900/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-gray-700 border border-gray-600 text-gray-400">
                  Coming Soon
                </span>
              </div>
              <p className="text-sm text-amber-200">
                Project-level Google OAuth for Gemini is not yet implemented.
                User-level OAuth for Gmail/Calendar is available in the main Settings panel.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tos-accept"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                className="rounded border-gray-600"
              />
              <label htmlFor="tos-accept" className="text-xs text-gray-400">
                I understand this is experimental and accept the risks
              </label>
            </div>

            <div className="flex gap-2">
              <button
                disabled={!tosAccepted}
                className="px-4 py-2 bg-purple-700/80 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Connect with Google
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Models Section */}
      <div className="border border-gray-700 rounded-xl bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Available Gemini Models</h3>

        {isLoadingModels ? (
          <div className="text-sm text-gray-500">Loading models...</div>
        ) : models.length === 0 ? (
          <div className="text-sm text-gray-500">
            Connect with a valid API key to browse available models.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400">Default Model:</label>
              <select
                value={defaultModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">Select a model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name || model.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium">Model ID</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium">Display Name</th>
                    <th className="text-left px-3 py-2 text-gray-400 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id} className="border-t border-gray-800 hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-300 font-mono">{model.id}</td>
                      <td className="px-3 py-2 text-gray-400">{model.display_name || '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{model.type || '-'}</td>
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
