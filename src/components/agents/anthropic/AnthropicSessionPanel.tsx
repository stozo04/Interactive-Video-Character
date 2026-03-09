import React, { useCallback, useEffect, useState } from 'react';
import {
  getClaudeSessionSummary,
  lookUpClaudeQuota,
  type ClaudeQuotaSummary,
  type ClaudeSessionSummary,
} from '../../../services/anthropicSessionService';

export default function AnthropicSessionPanel() {
  const [summary, setSummary] = useState<ClaudeSessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuotaLoading, setIsQuotaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await getClaudeSessionSummary();
      setSummary(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Claude session.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleQuotaLookup = useCallback(async () => {
    setIsQuotaLoading(true);
    setQuotaError(null);
    try {
      const quota = await lookUpClaudeQuota();
      setSummary((current) => (current ? { ...current, quota } : current));
    } catch (err) {
      setQuotaError(err instanceof Error ? err.message : 'Failed to look up Claude quota.');
    } finally {
      setIsQuotaLoading(false);
    }
  }, []);

  if (isLoading && !summary) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.03] text-sm text-slate-400">
        Loading Claude session...
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

  const sessionHealthClass = summary.connected
    ? 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100'
    : 'border-rose-400/30 bg-rose-400/12 text-rose-100';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(16,35,64,0.94),rgba(8,20,38,0.86))] p-6 shadow-[0_22px_80px_rgba(25,145,255,0.16)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
              Anthropic Claude
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Live Claude session, account, and model telemetry.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This reads your local Claude Code session state directly from the machine you are using.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${sessionHealthClass}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${summary.connected ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              {summary.connected ? 'Connected' : 'Offline'}
            </span>
            <button
              onClick={() => void loadSummary()}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : 'Refresh Claude'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-4">
        <InfoCard
          eyebrow="Account"
          title={summary.email || 'Not connected'}
          detail={[
            summary.subscriptionType ? `Plan: ${toTitleCase(summary.subscriptionType)}` : null,
            summary.authMethod ? `Login: ${summary.authMethod}` : null,
          ]}
        />
        <InfoCard
          eyebrow="Current Model"
          title={summary.currentModel || summary.defaultModelAlias || 'Unknown'}
          detail={[
            summary.defaultModelAlias ? `Default alias: ${summary.defaultModelAlias}` : null,
            summary.version ? `Claude Code ${summary.version}` : null,
          ]}
        />
        <InfoCard
          eyebrow="Session"
          title={summary.currentSessionId ? shortenId(summary.currentSessionId) : 'No active session'}
          detail={[
            summary.currentSessionMessageCount > 0 ? `${summary.currentSessionMessageCount} assistant turns` : null,
            summary.lastActivityAt ? `Last activity ${formatRelativeTime(summary.lastActivityAt)}` : null,
          ]}
        />
        <InfoCard
          eyebrow="Quota"
          title={getQuotaTitle(summary.quota)}
          detail={[
            summary.quota.resetAtLabel ? `Resets ${summary.quota.resetAtLabel}` : null,
            summary.quota.checkedAt ? `Checked ${formatRelativeTime(summary.quota.checkedAt)}` : null,
            summary.quota.message,
          ]}
          actionLabel={isQuotaLoading ? 'Looking Up...' : 'Look Up Now'}
          onAction={() => void handleQuotaLookup()}
          disabled={isQuotaLoading}
        />
      </section>

      {quotaError && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {quotaError}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Current Session Usage</p>
              <h3 className="mt-2 text-lg font-semibold text-white">Latest Claude session activity</h3>
            </div>
            <span className="text-xs text-slate-500">
              Updated {formatRelativeTime(summary.lastUpdatedAt)}
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Input" value={formatCompactNumber(summary.currentSessionUsage.inputTokens)} />
            <MetricTile label="Output" value={formatCompactNumber(summary.currentSessionUsage.outputTokens)} />
            <MetricTile label="Cache Read" value={formatCompactNumber(summary.currentSessionUsage.cacheReadInputTokens)} />
            <MetricTile label="Cache Created" value={formatCompactNumber(summary.currentSessionUsage.cacheCreationInputTokens)} />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
            <div className="flex flex-wrap gap-6">
              <MetaPair label="Organization" value={summary.orgName || 'Unknown'} />
              <MetaPair label="Workspace" value={summary.workspaceRoot} />
              <MetaPair label="API Provider" value={summary.apiProvider || 'Unknown'} />
              <MetaPair label="Org ID" value={summary.orgId || 'Unknown'} />
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Available Models</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Known Claude models on this machine</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.availableModels.length === 0 && (
              <span className="text-sm text-slate-500">No local model history yet.</span>
            )}
            {summary.availableModels.map((modelId) => (
              <span
                key={modelId}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  modelId === summary.currentModel || modelId === `alias:${summary.defaultModelAlias}`
                    ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.04] text-slate-300'
                }`}
              >
                {modelId.replace(/^alias:/, '')}
              </span>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {summary.modelTotals.slice(0, 5).map((model) => (
              <div key={model.modelId} className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{model.modelId}</span>
                  <span className="text-xs text-slate-500">
                    {formatCompactNumber(model.inputTokens + model.outputTokens)} prompt/output tokens
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">MCP Servers</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Connected tools and auth status</h3>

          <div className="mt-4 space-y-3">
            {summary.mcpServers.length === 0 && (
              <div className="text-sm text-slate-500">No MCP servers detected.</div>
            )}
            {summary.mcpServers.map((server) => (
              <div key={`${server.name}-${server.endpoint || 'none'}`} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{server.name}</div>
                    <div className="mt-1 break-all text-xs text-slate-500">{server.endpoint || 'No endpoint reported'}</div>
                  </div>
                  <StatusPill status={server.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Agent Presets</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Project and built-in Claude agents</h3>

          <div className="mt-4 space-y-3">
            {summary.activeAgents.length === 0 && (
              <div className="text-sm text-slate-500">No agent presets reported.</div>
            )}
            {summary.activeAgents.map((agent) => (
              <div key={`${agent.scope}-${agent.name}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-white">{agent.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{agent.scope === 'project' ? 'Project agent' : 'Built-in agent'}</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                  {agent.model}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

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

function InfoCard({
  eyebrow,
  title,
  detail,
  actionLabel,
  onAction,
  disabled = false,
}: {
  eyebrow: string;
  title: string;
  detail: Array<string | null>;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
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
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          disabled={disabled}
          className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {actionLabel}
        </button>
      )}
    </article>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const isGood = normalized.includes('ok') || normalized.includes('connected');
  const classes = isGood
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : 'border-amber-400/30 bg-amber-400/10 text-amber-100';

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>
      {status}
    </span>
  );
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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

function shortenId(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getQuotaTitle(quota: ClaudeQuotaSummary): string {
  if (quota.status === 'limit_hit') {
    return 'Session limit reached';
  }

  if (quota.status === 'available') {
    return 'Quota checked';
  }

  return 'Quota lookup available';
}
