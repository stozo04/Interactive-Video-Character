export interface ClaudeQuotaSummary {
  status: "unknown" | "available" | "limit_hit";
  message: string;
  resetAtLabel: string | null;
  checkedAt: string | null;
}

export interface ClaudeSessionSummary {
  connected: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgId: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  version: string | null;
  workspaceRoot: string;
  defaultModelAlias: string | null;
  currentModel: string | null;
  currentSessionId: string | null;
  lastActivityAt: string | null;
  currentSessionMessageCount: number;
  currentSessionUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  availableModels: string[];
  modelTotals: Array<{
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  }>;
  mcpServers: Array<{
    name: string;
    endpoint: string | null;
    status: string;
  }>;
  activeAgents: Array<{
    name: string;
    model: string;
    scope: "project" | "built_in";
  }>;
  quota: ClaudeQuotaSummary;
  lastUpdatedAt: string;
  warnings: string[];
}

interface ClaudeSessionResponse {
  success: boolean;
  summary?: ClaudeSessionSummary;
  error?: string;
}

interface ClaudeQuotaResponse {
  success: boolean;
  quota?: ClaudeQuotaSummary;
  error?: string;
}

export async function getClaudeSessionSummary(): Promise<ClaudeSessionSummary> {
  const response = await fetch('/agent/anthropic/session');
  const data = (await response.json()) as ClaudeSessionResponse;

  if (!response.ok || !data.success || !data.summary) {
    throw new Error(data.error || `Failed to load Claude session (${response.status})`);
  }

  return data.summary;
}

export async function lookUpClaudeQuota(): Promise<ClaudeQuotaSummary> {
  const response = await fetch('/agent/anthropic/quota', { method: 'POST' });
  const data = (await response.json()) as ClaudeQuotaResponse;

  if (!response.ok || !data.success || !data.quota) {
    throw new Error(data.error || `Failed to look up Claude quota (${response.status})`);
  }

  return data.quota;
}
