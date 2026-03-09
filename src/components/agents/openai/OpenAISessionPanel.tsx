import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getOpenAICodexSessionSummary,
  type OpenAICodexSessionSummary,
} from '../../../services/openaiCodexService';
import {
  parseOpenAICodexStatusSnapshot,
  type OpenAICodexStatusSnapshot,
} from '../../../services/openaiCodexStatusParser';

const LOCAL_SNAPSHOT_KEY = 'admin-dashboard-openai-codex-status';

export default function OpenAISessionPanel() {
  const [summary, setSummary] = useState<OpenAICodexSessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasting, setIsPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<OpenAICodexStatusSnapshot | null>(loadStoredSnapshot);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await getOpenAICodexSessionSummary();
      setSummary(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Codex session.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const activeSnapshot = useMemo(() => {
    if (localSnapshot?.capturedAt && summary?.snapshot?.capturedAt) {
      return new Date(localSnapshot.capturedAt) > new Date(summary.snapshot.capturedAt)
        ? localSnapshot
        : summary.snapshot;
    }

    return localSnapshot ?? summary?.snapshot ?? null;
  }, [localSnapshot, summary?.snapshot]);

  const handlePasteSnapshot = useCallback(async () => {
    setIsPasting(true);
    setSnapshotError(null);
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseOpenAICodexStatusSnapshot(text, new Date().toISOString());
      if (!parsed) {
        setSnapshotError('Clipboard does not contain a recognizable Codex status block.');
        return;
      }

      setLocalSnapshot(parsed);
      window.localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(parsed));
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : 'Failed to read status from clipboard.');
    } finally {
      setIsPasting(false);
    }
  }, []);

  if (isLoading && !summary) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.03] text-sm text-slate-400">
        Loading Codex session...
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="rounded-[28px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
        <div>{error}</div>
        <button
          onClick={() => void loadSummary()}
          className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-semibold text-white transition hover:bg-white/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[30px] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(24,47,58,0.94),rgba(8,20,38,0.86))] p-6 shadow-[0_22px_80px_rgba(16,185,129,0.12)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200/80">
              OpenAI Codex
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Local Codex session, model inventory, and usage snapshot.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Stable session metadata comes from local Codex config and caches. Limits and credits come from the
              interactive status snapshot when available.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
              summary.connected
                ? 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100'
                : 'border-rose-400/30 bg-rose-400/12 text-rose-100'
            }`}>
              <span className={`h-2.5 w-2.5 rounded-full ${summary.connected ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              {summary.connected ? 'Connected' : 'Offline'}
            </span>
            <button
              onClick={() => void loadSummary()}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : 'Refresh Codex'}
            </button>
            <button
              onClick={() => void handlePasteSnapshot()}
              className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/20"
              disabled={isPasting}
            >
              {isPasting ? 'Reading Clipboard...' : 'Paste Status Snapshot'}
            </button>
            <a
              href={summary.usageUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Open Usage Page
            </a>
          </div>
        </div>
      </section>

      {(error || snapshotError) && (
        <div className="space-y-3">
          {error && (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {error}
            </div>
          )}
          {snapshotError && (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {snapshotError}
            </div>
          )}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-4">
        <InfoCard
          eyebrow="Model"
          title={summary.currentModel || activeSnapshot?.model || 'Unknown'}
          detail={[
            summary.currentReasoningEffort
              ? `Reasoning: ${summary.currentReasoningEffort}`
              : activeSnapshot?.reasoningEffort
                ? `Reasoning: ${activeSnapshot.reasoningEffort}`
                : null,
            activeSnapshot?.summariesMode ? `Summaries: ${activeSnapshot.summariesMode}` : null,
          ]}
        />
        <InfoCard
          eyebrow="Account"
          title={activeSnapshot?.account || `Login: ${summary.loginMethod || 'Unknown'}`}
          detail={[
            activeSnapshot?.plan ? `Plan: ${activeSnapshot.plan}` : null,
            activeSnapshot?.collaborationMode ? `Mode: ${activeSnapshot.collaborationMode}` : null,
          ]}
        />
        <InfoCard
          eyebrow="Session"
          title={activeSnapshot?.sessionId || summary.recentHistorySessionId || 'No recent session'}
          detail={[
            activeSnapshot?.permissions ? activeSnapshot.permissions : null,
            summary.projectTrustLevel ? `Project trust: ${summary.projectTrustLevel}` : null,
          ]}
        />
        <InfoCard
          eyebrow="CLI"
          title={summary.cliVersion ? `v${summary.cliVersion}` : 'Unknown version'}
          detail={[
            summary.latestAvailableVersion ? `Latest known: v${summary.latestAvailableVersion}` : null,
            summary.personality ? `Personality: ${summary.personality}` : null,
          ]}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <UsageCard
          title="5h Limit"
          primary={activeSnapshot?.fiveHourLimit?.remainingText || 'Paste a Codex status snapshot'}
          secondary={activeSnapshot?.fiveHourLimit?.resetText ? `Resets ${activeSnapshot.fiveHourLimit.resetText}` : null}
        />
        <UsageCard
          title="Weekly Limit"
          primary={activeSnapshot?.weeklyLimit?.remainingText || 'Paste a Codex status snapshot'}
          secondary={activeSnapshot?.weeklyLimit?.resetText ? `Resets ${activeSnapshot.weeklyLimit.resetText}` : null}
        />
        <UsageCard
          title="Credits"
          primary={activeSnapshot?.credits || 'Paste a Codex status snapshot'}
          secondary={activeSnapshot?.capturedAt ? `Snapshot ${formatRelativeTime(activeSnapshot.capturedAt)}` : 'Usage page remains the source of truth'}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Workspace Context</p>
              <h3 className="mt-2 text-lg font-semibold text-white">How Codex is configured here</h3>
            </div>
            <span className="text-xs text-slate-500">Updated {formatRelativeTime(summary.lastUpdatedAt)}</span>
          </div>

          <div className="mt-5 space-y-3">
            <MetaRow label="Directory" value={activeSnapshot?.directory || summary.workspaceRoot} />
            <MetaRow label="Agents File" value={activeSnapshot?.agentsFile || 'AGENTS.md'} />
            <MetaRow label="Permissions" value={activeSnapshot?.permissions || 'Not present in live config output'} />
            <MetaRow label="Recent History Session" value={summary.recentHistorySessionId || 'Unknown'} />
            <MetaRow label="Recent Indexed Session" value={summary.recentIndexedSessionId || 'Unknown'} />
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Available Models</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Codex model inventory on this machine</h3>
          <div className="mt-4 space-y-3">
            {summary.availableModels.map((model) => (
              <div key={model.slug} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{model.displayName}</div>
                    <div className="mt-1 text-xs text-slate-500">{model.description || model.slug}</div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                    Default {model.defaultReasoningLevel || 'unknown'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {model.supportedReasoningLevels.map((level) => (
                    <span key={`${model.slug}-${level}`} className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-50">
                      {level}
                    </span>
                  ))}
                  {model.supportsReasoningSummaries && (
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-50">
                      summaries
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {activeSnapshot && (
        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Latest Status Snapshot</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Parsed from the interactive Codex status block</h3>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-300">
              {activeSnapshot.rawText}
            </pre>
          </div>
        </section>
      )}

      {summary.warnings.length > 0 && (
        <section className="rounded-[28px] border border-amber-400/20 bg-amber-400/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-100/80">Warnings</p>
          <div className="mt-3 space-y-2">
            {summary.warnings.map((warning) => (
              <div key={warning} className="text-sm text-amber-50/90">
                {warning}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function loadStoredSnapshot(): OpenAICodexStatusSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as OpenAICodexStatusSnapshot;
  } catch {
    return null;
  }
}

function InfoCard({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: Array<string | null>;
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{eyebrow}</p>
      <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-3 space-y-1.5">
        {detail.filter(Boolean).map((line) => (
          <div key={line} className="text-sm text-slate-400">
            {line}
          </div>
        ))}
      </div>
    </article>
  );
}

function UsageCard({
  title,
  primary,
  secondary,
}: {
  title: string;
  primary: string;
  secondary: string | null;
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="mt-3 text-2xl font-semibold text-white">{primary}</div>
      {secondary && <div className="mt-2 text-sm text-slate-400">{secondary}</div>}
    </article>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-200 break-all">{value}</div>
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const deltaMs = date.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

  const minutes = Math.round(deltaMs / 60_000);
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }

  const hours = Math.round(deltaMs / 3_600_000);
  if (Math.abs(hours) < 48) {
    return formatter.format(hours, 'hour');
  }

  const days = Math.round(deltaMs / 86_400_000);
  return formatter.format(days, 'day');
}
