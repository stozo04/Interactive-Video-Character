import React, { useState, useEffect } from 'react';
import type { ToolCallDisplay } from '../types';

interface ToolCallBoxProps {
  toolCall: ToolCallDisplay;
}

const ToolCallBox: React.FC<ToolCallBoxProps> = ({ toolCall }) => {
  const { toolDisplayName, status, durationMs, resultSummary, startedAt } = toolCall;
  const [expanded, setExpanded] = useState(false);

  // Live elapsed timer for running tools
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [startedAt, status]);

  const displayMs = status === 'running' ? elapsed : (durationMs ?? 0);
  const formattedDuration = displayMs < 1000
    ? `${displayMs}ms`
    : `${(displayMs / 1000).toFixed(1)}s`;

  const statusIcon =
    status === 'running' ? (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
    ) : status === 'success' ? (
      <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ) : (
      <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );

  const borderColor =
    status === 'running' ? 'border-blue-500/30'
    : status === 'success' ? 'border-gray-600/50'
    : 'border-red-500/30';

  return (
    <div className={`rounded-lg border ${borderColor} bg-gray-800/60 text-xs my-1`}>
      <button
        type="button"
        onClick={() => status !== 'running' && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
      >
        {statusIcon}
        <span className="text-gray-300 flex-1 truncate">{toolDisplayName}</span>
        <span className="text-gray-500 tabular-nums">{formattedDuration}</span>
        {status !== 'running' && (
          <svg
            className={`w-3 h-3 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && resultSummary && (
        <div className="px-3 pb-2 text-gray-400 break-words border-t border-gray-700/50 pt-1.5">
          {resultSummary}
        </div>
      )}
    </div>
  );
};

export default ToolCallBox;
