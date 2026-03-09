import React from 'react';
import OpenAISessionPanel from './agents/openai/OpenAISessionPanel';

export default function OpenAITab() {
  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">OpenAI</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Codex Control Center</h2>
          <p className="mt-1 text-sm text-slate-400">
            Local Codex configuration and interactive status snapshot.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <OpenAISessionPanel />
      </div>
    </div>
  );
}
