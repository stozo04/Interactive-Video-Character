import React, { useState } from 'react';
import AnthropicApiSettingsPanel from './agents/anthropic/AnthropicApiSettingsPanel';
import AnthropicSessionPanel from './agents/anthropic/AnthropicSessionPanel';

type AnthropicView = 'session' | 'api_settings';

export default function AnthropicTab() {
  const [view, setView] = useState<AnthropicView>('session');

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Anthropic</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Claude Control Center</h2>
          <p className="mt-1 text-sm text-slate-400">
            Session telemetry first, API settings second.
          </p>
        </div>

        <div className="flex rounded-2xl border border-white/10 bg-slate-950/60 p-1.5">
          <button
            onClick={() => setView('session')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              view === 'session'
                ? 'bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.2)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Claude Session
          </button>
          <button
            onClick={() => setView('api_settings')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              view === 'api_settings'
                ? 'bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.2)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            API Settings
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'session' ? <AnthropicSessionPanel /> : <AnthropicApiSettingsPanel />}
      </div>
    </div>
  );
}
