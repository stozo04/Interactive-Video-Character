import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseOpenAICodexStatusSnapshot,
  type OpenAICodexStatusSnapshot,
} from "../../../src/services/openaiCodexStatusParser";

const execFileAsync = promisify(execFile);
const CODEX_BIN = "codex";
const CODEX_TIMEOUT_MS = 10_000;
const CODEX_USAGE_URL = "https://chatgpt.com/codex/settings/usage";

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

interface CodexConfigSummary {
  currentModel: string | null;
  currentReasoningEffort: string | null;
  personality: string | null;
  projectTrustLevel: string | null;
}

export async function getOpenAICodexSessionSummary(
  workspaceRoot = process.cwd(),
): Promise<OpenAICodexSessionSummary> {
  const warnings: string[] = [];

  const [loginMethod, cliVersion, config, versionInfo, modelsCache, recentHistorySessionId, recentIndexedSessionId, snapshot] =
    await Promise.all([
      loadCodexLoginMethod(warnings),
      loadCodexCliVersion(warnings),
      loadCodexConfig(workspaceRoot, warnings),
      loadCodexVersionInfo(warnings),
      loadCodexModelsCache(warnings),
      loadRecentHistorySessionId(warnings),
      loadRecentIndexedSessionId(warnings),
      loadLatestCodexStatusSnapshot(warnings),
    ]);

  return {
    connected: loginMethod !== null,
    loginMethod,
    cliVersion,
    latestAvailableVersion: versionInfo?.latestVersion ?? null,
    currentModel: config.currentModel,
    currentReasoningEffort: config.currentReasoningEffort,
    personality: config.personality,
    workspaceRoot,
    projectTrustLevel: config.projectTrustLevel,
    recentHistorySessionId,
    recentIndexedSessionId,
    usageUrl: CODEX_USAGE_URL,
    availableModels: (modelsCache?.models ?? []).map((model) => ({
      slug: typeof model.slug === "string" ? model.slug : "unknown",
      displayName:
        typeof model.display_name === "string"
          ? model.display_name
          : typeof model.slug === "string"
            ? model.slug
            : "unknown",
      description: typeof model.description === "string" ? model.description : null,
      defaultReasoningLevel:
        typeof model.default_reasoning_level === "string" ? model.default_reasoning_level : null,
      supportedReasoningLevels: Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels
            .map((entry) => (typeof entry?.effort === "string" ? entry.effort : null))
            .filter((entry): entry is string => Boolean(entry))
        : [],
      supportsReasoningSummaries: model.supports_reasoning_summaries === true,
    })),
    snapshot,
    warnings,
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function loadCodexLoginMethod(warnings: string[]): Promise<string | null> {
  try {
    const stdout = await runCodexCommand(["login", "status"]);
    const normalized = stdout.trim();
    if (!normalized) {
      return null;
    }

    return normalized.replace(/^Logged in using\s+/i, "").trim() || normalized;
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex login status", error));
    return null;
  }
}

async function loadCodexCliVersion(warnings: string[]): Promise<string | null> {
  try {
    const stdout = await runCodexCommand(["-V"]);
    const versionMatch = stdout.match(/codex-cli\s+([^\s]+)/i);
    return versionMatch?.[1] ?? stdout.trim() ?? null;
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex CLI version", error));
    return null;
  }
}

async function loadCodexConfig(
  workspaceRoot: string,
  warnings: string[],
): Promise<CodexConfigSummary> {
  try {
    const configPath = path.join(os.homedir(), ".codex", "config.toml");
    if (!fs.existsSync(configPath)) {
      return emptyConfig();
    }

    const content = fs.readFileSync(configPath, "utf8");
    return {
      currentModel: matchTomlValue(content, /^model\s*=\s*"([^"]+)"/m),
      currentReasoningEffort: matchTomlValue(content, /^model_reasoning_effort\s*=\s*"([^"]+)"/m),
      personality: matchTomlValue(content, /^personality\s*=\s*"([^"]+)"/m),
      projectTrustLevel: matchProjectTrustLevel(content, workspaceRoot),
    };
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex config", error));
    return emptyConfig();
  }
}

async function loadCodexVersionInfo(
  warnings: string[],
): Promise<{ latestVersion: string | null } | null> {
  try {
    const versionPath = path.join(os.homedir(), ".codex", "version.json");
    if (!fs.existsSync(versionPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(versionPath, "utf8")) as { latest_version?: string };
    return {
      latestVersion: typeof parsed.latest_version === "string" ? parsed.latest_version : null,
    };
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex version cache", error));
    return null;
  }
}

async function loadCodexModelsCache(
  warnings: string[],
): Promise<{ models?: any[] } | null> {
  try {
    const modelsPath = path.join(os.homedir(), ".codex", "models_cache.json");
    if (!fs.existsSync(modelsPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(modelsPath, "utf8")) as { models?: any[] };
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex models cache", error));
    return null;
  }
}

async function loadRecentHistorySessionId(warnings: string[]): Promise<string | null> {
  try {
    const historyPath = path.join(os.homedir(), ".codex", "history.jsonl");
    if (!fs.existsSync(historyPath)) {
      return null;
    }

    const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]) as { session_id?: string };
        if (typeof parsed.session_id === "string" && parsed.session_id) {
          return parsed.session_id;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex history sessions", error));
    return null;
  }
}

async function loadRecentIndexedSessionId(warnings: string[]): Promise<string | null> {
  try {
    const sessionIndexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
    if (!fs.existsSync(sessionIndexPath)) {
      return null;
    }

    const lines = fs.readFileSync(sessionIndexPath, "utf8").split(/\r?\n/).filter(Boolean);
    const lastLine = lines.at(-1);
    if (!lastLine) {
      return null;
    }

    const parsed = JSON.parse(lastLine) as { id?: string };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch (error) {
    warnings.push(toWarning("Unable to read Codex session index", error));
    return null;
  }
}

async function loadLatestCodexStatusSnapshot(
  warnings: string[],
): Promise<OpenAICodexStatusSnapshot | null> {
  try {
    const historyPath = path.join(os.homedir(), ".codex", "history.jsonl");
    if (!fs.existsSync(historyPath)) {
      return null;
    }

    const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]) as { text?: string; ts?: number };
        if (typeof parsed.text !== "string") {
          continue;
        }

        const capturedAt =
          typeof parsed.ts === "number" ? new Date(parsed.ts * 1000).toISOString() : null;
        const snapshot = parseOpenAICodexStatusSnapshot(parsed.text, capturedAt);
        if (snapshot) {
          return snapshot;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    warnings.push(toWarning("Unable to read latest Codex status snapshot", error));
    return null;
  }
}

async function runCodexCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(CODEX_BIN, args, {
    cwd: process.cwd(),
    timeout: CODEX_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.toString();
}

function emptyConfig(): CodexConfigSummary {
  return {
    currentModel: null,
    currentReasoningEffort: null,
    personality: null,
    projectTrustLevel: null,
  };
}

function matchTomlValue(content: string, pattern: RegExp): string | null {
  return content.match(pattern)?.[1]?.trim() ?? null;
}

function matchProjectTrustLevel(content: string, workspaceRoot: string): string | null {
  const candidates = [workspaceRoot, `\\\\?\\${workspaceRoot}`];

  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    const blockPattern = new RegExp(
      String.raw`\[projects\.'${escaped}'\][\s\S]*?trust_level\s*=\s*"([^"]+)"`,
      "m",
    );
    const matched = content.match(blockPattern)?.[1]?.trim();
    if (matched) {
      return matched;
    }
  }

  return null;
}

function toWarning(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
