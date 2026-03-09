export interface OpenAICodexLimitSnapshot {
  label: string;
  remainingText: string;
  resetText: string | null;
}

export interface OpenAICodexStatusSnapshot {
  version: string | null;
  model: string | null;
  reasoningEffort: string | null;
  summariesMode: string | null;
  directory: string | null;
  permissions: string | null;
  agentsFile: string | null;
  account: string | null;
  plan: string | null;
  collaborationMode: string | null;
  sessionId: string | null;
  fiveHourLimit: OpenAICodexLimitSnapshot | null;
  weeklyLimit: OpenAICodexLimitSnapshot | null;
  credits: string | null;
  rawText: string;
  capturedAt: string | null;
}

export function parseOpenAICodexStatusSnapshot(
  rawText: string,
  capturedAt: string | null = null,
): OpenAICodexStatusSnapshot | null {
  const text = rawText.replace(/\r/g, "");
  if (!/OpenAI Codex/i.test(text) || !/Model:/i.test(text)) {
    return null;
  }

  const version = matchValue(text, /OpenAI Codex\s+\(v([^)]+)\)/i);
  const modelLine = matchValue(text, /Model:\s+([^\n]+)/i);
  const directory = matchValue(text, /Directory:\s+([^\n]+)/i);
  const permissions = matchValue(text, /Permissions:\s+([^\n]+)/i);
  const agentsFile = matchValue(text, /Agents\.md:\s+([^\n]+)/i);
  const accountLine = matchValue(text, /Account:\s+([^\n]+)/i);
  const collaborationMode = matchValue(text, /Collaboration mode:\s+([^\n]+)/i);
  const sessionId = matchValue(text, /Session:\s+([0-9a-f-]+)/i);
  const fiveHourLimitLine = matchValue(text, /5h limit:\s+([^\n]+)/i);
  const weeklyLimitLine = matchValue(text, /Weekly limit:\s+([^\n]+)/i);
  const credits = matchValue(text, /Credits:\s+([^\n]+)/i);

  const model = modelLine ? modelLine.split("(")[0].trim() : null;
  const detailMatch = modelLine?.match(/\(([^)]+)\)/);
  const reasoningEffort = detailMatch?.[1]?.match(/reasoning\s+([^,]+)/i)?.[1]?.trim() ?? null;
  const summariesMode = detailMatch?.[1]?.match(/summaries\s+(.+)$/i)?.[1]?.trim() ?? null;

  const account = accountLine ? accountLine.split("(")[0].trim() : null;
  const plan = accountLine?.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;

  return {
    version,
    model,
    reasoningEffort,
    summariesMode,
    directory,
    permissions,
    agentsFile,
    account,
    plan,
    collaborationMode,
    sessionId,
    fiveHourLimit: parseLimitLine("5h limit", fiveHourLimitLine),
    weeklyLimit: parseLimitLine("Weekly limit", weeklyLimitLine),
    credits,
    rawText,
    capturedAt,
  };
}

function parseLimitLine(label: string, line: string | null): OpenAICodexLimitSnapshot | null {
  if (!line) {
    return null;
  }

  const normalized = line.replace(/\[\]/g, "").replace(/\s+/g, " ").trim();
  const resetMatch = normalized.match(/\(resets\s+([^)]+)\)/i);
  const resetText = resetMatch?.[1]?.trim() ?? null;
  const remainingText = normalized.replace(/\(resets\s+([^)]+)\)/i, "").trim();

  return {
    label,
    remainingText,
    resetText,
  };
}

function matchValue(text: string, regex: RegExp): string | null {
  return text.match(regex)?.[1]?.trim() ?? null;
}
