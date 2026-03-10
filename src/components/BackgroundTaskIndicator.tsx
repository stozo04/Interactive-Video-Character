// src/components/BackgroundTaskIndicator.tsx
//
// Floating badge showing running background tasks with per-task kill switches.
// Polls /agent/tasks/active every 3s. Disappears when no tasks are running.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { agentClient, type ActiveBackgroundTask } from '../services/agentClient';

const POLL_INTERVAL_MS = 3_000;

function formatDuration(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const BackgroundTaskIndicator: React.FC = () => {
  const [tasks, setTasks] = useState<ActiveBackgroundTask[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [, forceUpdate] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick durations every second when expanded
  useEffect(() => {
    if (!expanded || tasks.length === 0) return;
    const id = setInterval(() => forceUpdate(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, [expanded, tasks.length]);

  const poll = useCallback(async () => {
    const active = await agentClient.getActiveTasks();
    setTasks(active);
    // Auto-collapse if no tasks remain
    if (active.length === 0) setExpanded(false);
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const handleCancel = async (taskId: string) => {
    setCancelling(prev => new Set(prev).add(taskId));
    await agentClient.cancelBackgroundTask(taskId);
    // Optimistically remove; poll will confirm
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setCancelling(prev => { const s = new Set(prev); s.delete(taskId); return s; });
  };

  const handleCancelAll = async () => {
    for (const task of tasks) {
      await handleCancel(task.id);
    }
  };

  if (tasks.length === 0) return null;

  return (
    <div className="absolute top-2 right-2 z-30 flex flex-col items-end gap-1">
      {/* Badge */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-900/80 border border-blue-500/40 text-xs text-blue-300 hover:bg-gray-800/90 transition-colors shadow-lg backdrop-blur-sm"
        title="Background tasks running"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
        <span>{tasks.length} task{tasks.length !== 1 ? 's' : ''} running</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="w-72 rounded-lg border border-gray-700/60 bg-gray-900/90 shadow-xl backdrop-blur-sm text-xs overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700/60 flex items-center justify-between">
            <span className="text-gray-400 font-medium">Background Tasks</span>
            {tasks.length > 1 && (
              <button
                type="button"
                onClick={handleCancelAll}
                className="text-red-400 hover:text-red-300 transition-colors"
              >
                cancel all
              </button>
            )}
          </div>

          <div className="divide-y divide-gray-700/40">
            {tasks.map(task => (
              <div key={task.id} className="flex items-center gap-2 px-3 py-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-200 truncate">{task.label}</div>
                  <div className="text-gray-500 truncate">{formatDuration(task.startedAt)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancel(task.id)}
                  disabled={cancelling.has(task.id)}
                  className="flex-shrink-0 text-gray-500 hover:text-red-400 disabled:opacity-40 transition-colors p-0.5 rounded"
                  title={`Cancel "${task.label}"`}
                >
                  {cancelling.has(task.id) ? (
                    <span className="inline-block w-3.5 h-3.5 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BackgroundTaskIndicator;
