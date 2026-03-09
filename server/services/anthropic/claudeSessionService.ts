import { exec, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const CLAUDE_BIN = "claude";
const CLAUDE_TIMEOUT_MS = 10_000;

interface ClaudeAuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

interface ClaudeUsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeStatsCache {
  modelTotals?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  >;
}

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

export async function getClaudeSessionSummary(
  workspaceRoot = process.cwd(),
): Promise<ClaudeSessionSummary> {
  const warnings: string[] = [];
  const [authStatus, version, settingsModelAlias, statsCache, latestSession, mcpServers, activeAgents] =
    await Promise.all([
      loadClaudeAuthStatus(warnings),
      runClaudeVersion(warnings),
      loadClaudeSettingsModel(warnings),
      loadClaudeStatsCache(warnings),
      loadLatestClaudeSession(workspaceRoot, warnings),
      loadClaudeMcpServers(warnings),
      loadClaudeAgents(warnings),
    ]);

  return {
    connected: authStatus?.loggedIn === true,
    authMethod: authStatus?.authMethod ?? null,
    apiProvider: authStatus?.apiProvider ?? null,
    email: authStatus?.email ?? null,
    orgId: authStatus?.orgId ?? null,
    orgName: authStatus?.orgName ?? null,
    subscriptionType: authStatus?.subscriptionType ?? null,
    version,
    workspaceRoot,
    defaultModelAlias: settingsModelAlias,
    currentModel: latestSession.currentModel,
    currentSessionId: latestSession.sessionId,
    lastActivityAt: latestSession.lastActivityAt,
    currentSessionMessageCount: latestSession.messageCount,
    currentSessionUsage: latestSession.usage,
    availableModels: collectAvailableModels(
      statsCache?.modelTotals ?? {},
      settingsModelAlias,
      latestSession.currentModel,
    ),
    modelTotals: toSortedModelTotals(statsCache?.modelTotals ?? {}),
    mcpServers,
    activeAgents,
    quota: {
      status: "unknown",
      message:
        "Claude Code does not expose remaining Pro session quota through a stable non-interactive command yet.",
      resetAtLabel: null,
      checkedAt: null,
    },
    lastUpdatedAt: new Date().toISOString(),
    warnings,
  };
}

export async function lookUpClaudeQuota(): Promise<ClaudeQuotaSummary> {
  const checkedAt = new Date().toISOString();

  try {
    const output = await runClaudeQuotaShellCommand();
    return parseClaudeQuotaOutput(output, checkedAt);
  } catch (error) {
    return {
      status: "unknown",
      message: `Quota lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      resetAtLabel: null,
      checkedAt,
    };
  }
}

async function loadClaudeAuthStatus(warnings: string[]): Promise<ClaudeAuthStatus | null> {
  try {
    const stdout = await runClaudeCommand(["auth", "status", "--json"]);
    return JSON.parse(stdout) as ClaudeAuthStatus;
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude auth status", error));
    return null;
  }
}

async function runClaudeVersion(warnings: string[]): Promise<string | null> {
  try {
    const stdout = await runClaudeCommand(["--version"]);
    return stdout.trim() || null;
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude version", error));
    return null;
  }
}

async function loadClaudeSettingsModel(warnings: string[]): Promise<string | null> {
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { model?: string };
    return typeof settings.model === "string" ? settings.model : null;
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude settings", error));
    return null;
  }
}

async function loadClaudeStatsCache(warnings: string[]): Promise<ClaudeStatsCache | null> {
  try {
    const statsPath = path.join(os.homedir(), ".claude", "stats-cache.json");
    if (!fs.existsSync(statsPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(statsPath, "utf8")) as ClaudeStatsCache;
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude stats cache", error));
    return null;
  }
}

async function loadLatestClaudeSession(
  workspaceRoot: string,
  warnings: string[],
): Promise<{
  sessionId: string | null;
  currentModel: string | null;
  lastActivityAt: string | null;
  messageCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
}> {
  try {
    const projectDir = path.join(os.homedir(), ".claude", "projects", toClaudeProjectKey(workspaceRoot));
    if (!fs.existsSync(projectDir)) {
      return emptySession();
    }

    const sessionFiles = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => ({
        filePath: path.join(projectDir, entry.name),
        modifiedMs: fs.statSync(path.join(projectDir, entry.name)).mtimeMs,
      }))
      .sort((left, right) => right.modifiedMs - left.modifiedMs);

    if (sessionFiles.length === 0) {
      return emptySession();
    }

    const content = fs.readFileSync(sessionFiles[0].filePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    let sessionId: string | null = null;
    let currentModel: string | null = null;
    let lastActivityAt: string | null = null;
    let messageCount = 0;
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          sessionId?: string;
          timestamp?: string;
          type?: string;
          message?: {
            model?: string;
            usage?: ClaudeUsageRecord;
          };
        };

        sessionId = parsed.sessionId ?? sessionId;
        lastActivityAt = parsed.timestamp ?? lastActivityAt;

        if (parsed.type === "assistant") {
          messageCount += 1;
          currentModel = parsed.message?.model ?? currentModel;
          usage.inputTokens += parsed.message?.usage?.input_tokens ?? 0;
          usage.outputTokens += parsed.message?.usage?.output_tokens ?? 0;
          usage.cacheReadInputTokens += parsed.message?.usage?.cache_read_input_tokens ?? 0;
          usage.cacheCreationInputTokens += parsed.message?.usage?.cache_creation_input_tokens ?? 0;
        }
      } catch {
        continue;
      }
    }

    return {
      sessionId,
      currentModel,
      lastActivityAt,
      messageCount,
      usage,
    };
  } catch (error) {
    warnings.push(toWarning("Unable to read latest Claude session", error));
    return emptySession();
  }
}

async function loadClaudeMcpServers(
  warnings: string[],
): Promise<Array<{ name: string; endpoint: string | null; status: string }>> {
  try {
    const stdout = await runClaudeCommand(["mcp", "list"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.toLowerCase().startsWith("checking mcp server health"))
      .map((line) => {
        const colonIndex = line.indexOf(":");
        const name = colonIndex >= 0 ? line.slice(0, colonIndex).trim() : line;
        const rest = colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : "";
        const [endpoint, status] = rest.split(" - ", 2);
        return {
          name,
          endpoint: endpoint?.trim() || null,
          status: status?.trim() || "unknown",
        };
      });
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude MCP servers", error));
    return [];
  }
}

async function loadClaudeAgents(
  warnings: string[],
): Promise<Array<{ name: string; model: string; scope: "project" | "built_in" }>> {
  try {
    const stdout = await runClaudeCommand(["agents"]);
    const agents: Array<{ name: string; model: string; scope: "project" | "built_in" }> = [];
    let currentScope: "project" | "built_in" | null = null;

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith("Project agents:")) {
        currentScope = "project";
        continue;
      }

      if (line.startsWith("Built-in agents:")) {
        currentScope = "built_in";
        continue;
      }

      if (!currentScope) {
        continue;
      }

      const normalizedLine = line.replace("Â·", "·");
      if (!normalizedLine.includes("·")) {
        continue;
      }

      const [name, model] = normalizedLine.split("·").map((part) => part.trim());
      if (!name || !model) {
        continue;
      }

      agents.push({ name, model, scope: currentScope });
    }

    return agents;
  } catch (error) {
    warnings.push(toWarning("Unable to read Claude agent presets", error));
    return [];
  }
}

async function runClaudeCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(CLAUDE_BIN, args, {
    cwd: process.cwd(),
    timeout: CLAUDE_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.toString();
}

async function runClaudeQuotaShellCommand(): Promise<string> {
  const command =
    process.platform === "win32"
      ? 'claude config list 2>&1 | Out-String'
      : "claude config list 2>&1";

  const shellCommand =
    process.platform === "win32"
      ? {
          file: "powershell.exe",
          args: ["-NoProfile", "-Command", command],
        }
      : {
          file: "/bin/sh",
          args: ["-lc", command],
        };

  try {
    const { stdout, stderr } = await execFileAsync(shellCommand.file, shellCommand.args, {
      cwd: process.cwd(),
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (error) {
    if (isExecFileError(error)) {
      const stdout = error.stdout?.toString() ?? "";
      const stderr = error.stderr?.toString() ?? "";
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (combined) {
        return combined;
      }
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      timeout: CLAUDE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
    }).catch((execError) => {
      if (isExecFileError(execError)) {
        return {
          stdout: execError.stdout?.toString() ?? "",
          stderr: execError.stderr?.toString() ?? "",
        };
      }
      throw execError;
    });

    return [stdout, stderr].filter(Boolean).join("\n").trim();
  }
}

function toClaudeProjectKey(workspaceRoot: string): string {
  return workspaceRoot.replace(/:/g, "-").replace(/[\\/]/g, "-");
}

function emptySession() {
  return {
    sessionId: null,
    currentModel: null,
    lastActivityAt: null,
    messageCount: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}

function collectAvailableModels(
  modelTotals: ClaudeStatsCache["modelTotals"],
  settingsModelAlias: string | null,
  currentModel: string | null,
): string[] {
  const modelIds = new Set<string>();

  for (const modelId of Object.keys(modelTotals ?? {})) {
    if (modelId.startsWith("claude-")) {
      modelIds.add(modelId);
    }
  }

  if (currentModel) {
    modelIds.add(currentModel);
  }

  if (settingsModelAlias) {
    modelIds.add(`alias:${settingsModelAlias}`);
  }

  return [...modelIds].sort((left, right) => left.localeCompare(right));
}

function toSortedModelTotals(
  modelTotals: ClaudeStatsCache["modelTotals"],
): Array<{
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}> {
  return Object.entries(modelTotals ?? {})
    .map(([modelId, totals]) => ({
      modelId,
      inputTokens: totals.inputTokens ?? 0,
      outputTokens: totals.outputTokens ?? 0,
      cacheReadInputTokens: totals.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: totals.cacheCreationInputTokens ?? 0,
    }))
    .sort((left, right) => {
      const leftTotal =
        left.inputTokens + left.outputTokens + left.cacheReadInputTokens + left.cacheCreationInputTokens;
      const rightTotal =
        right.inputTokens + right.outputTokens + right.cacheReadInputTokens + right.cacheCreationInputTokens;
      return rightTotal - leftTotal;
    });
}

function parseClaudeQuotaOutput(output: string, checkedAt: string): ClaudeQuotaSummary {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      status: "unknown",
      message:
        "Claude did not expose quota output to the backend process. It appears to only print this reset line in an interactive terminal session.",
      resetAtLabel: null,
      checkedAt,
    };
  }

  const resetMatch = normalized.match(/resets?\s+(.+)$/i);
  const resetAtLabel = resetMatch?.[1]?.trim() ?? null;

  if (/hit your limit/i.test(normalized)) {
    return {
      status: "limit_hit",
      message: normalized,
      resetAtLabel,
      checkedAt,
    };
  }

  return {
    status: "available",
    message: normalized,
    resetAtLabel,
    checkedAt,
  };
}

function toWarning(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

function isExecFileError(
  error: unknown,
): error is Error & { stdout?: string | Buffer; stderr?: string | Buffer } {
  return typeof error === "object" && error !== null && ("stdout" in error || "stderr" in error);
}
