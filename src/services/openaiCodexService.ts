import type { OpenAICodexStatusSnapshot } from './openaiCodexStatusParser';

export interface OpenAICodexModelSummary {
  slug: string;
  displayName: string;
  description: string | null;
  defaultReasoningLevel: string | null;
  supportedReasoningLevels: string[];
  supportsReasoningSummaries: boolean;
}

export interface OpenAICodexSessionSummary {
  connected: boolean;
  loginMethod: string | null;
  cliVersion: string | null;
  latestAvailableVersion: string | null;
  currentModel: string | null;
  currentReasoningEffort: string | null;
  personality: string | null;
  workspaceRoot: string;
  projectTrustLevel: string | null;
  recentHistorySessionId: string | null;
  recentIndexedSessionId: string | null;
  usageUrl: string;
  availableModels: OpenAICodexModelSummary[];
  snapshot: OpenAICodexStatusSnapshot | null;
  warnings: string[];
  lastUpdatedAt: string;
}

interface OpenAICodexSessionResponse {
  success: boolean;
  summary?: OpenAICodexSessionSummary;
  error?: string;
}

export async function getOpenAICodexSessionSummary(): Promise<OpenAICodexSessionSummary> {
  const response = await fetch('/agent/openai/session');
  const data = (await response.json()) as OpenAICodexSessionResponse;

  if (!response.ok || !data.success || !data.summary) {
    throw new Error(data.error || `Failed to load OpenAI Codex session (${response.status})`);
  }

  return data.summary;
}
