import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { log } from "../runtimeLogger";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_JSON_BYTES = 1024 * 256;
const MAX_SEARCH_RESULTS = 50;
const MAX_READ_CHARS = 20_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".worktrees"]);

type WorkspaceActionType =
  | "mkdir"
  | "read"
  | "write"
  | "search"
  | "status"
  | "commit"
  | "push"
  | "delete";

interface WorkspaceActionRequestBody {
  action?: WorkspaceActionType;
  args?: Record<string, unknown>;
  prompt?: string;
}

interface WorkspaceAgentRunStep {
  stepId: string;
  type: string;
  status: string;
  exitCode: number | null;
  evidence: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface WorkspaceAgentRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "success" | "failed";
  summary: string;
  workspaceRoot: string;
  request: {
    action: string;
    args: Record<string, unknown>;
    prompt?: string;
  };
  approval: {
    required: boolean;
    status: "not_required";
  };
  steps: WorkspaceAgentRunStep[];
}

interface WorkspaceAgentHealth {
  status: string;
  service: string;
  workspaceRoot: string;
  runCount: number;
  activeRunId: string | null;
  pendingQueueCount: number;
  timestamp: string;
}

interface WorkspaceAgentRouterOptions {
  workspaceRoot: string;
}

const runtimeLog = log.fromContext({
  source: "workspaceAgentRoutes",
  route: "/workspace-agent",
});

const runs: WorkspaceAgentRun[] = [];
const WORKSPACE_AGENT_BASE_PATH = "/workspace-agent";
const sseClients = new Set<ServerResponse>();

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function writeSseEvent(
  res: ServerResponse,
  eventType: string,
  payload: unknown,
): void {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createSseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

function broadcastRunEvent(eventType: "run_created" | "run_updated", run: WorkspaceAgentRun): void {
  if (sseClients.size === 0) {
    return;
  }

  const payload = {
    type: eventType,
    runId: run.id,
    timestamp: new Date().toISOString(),
    run,
  };

  for (const client of sseClients) {
    writeSseEvent(client, eventType, payload);
  }
}

function handleSseSubscription(
  req: IncomingMessage,
  res: ServerResponse,
  runId?: string,
): void {
  Object.entries(createSseHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.flushHeaders?.();

  sseClients.add(res);

  writeSseEvent(res, "connected", {
    type: "connected",
    runId,
    activeRunId: null,
    pendingCount: 0,
    message: "Workspace agent event stream connected.",
    timestamp: new Date().toISOString(),
  });

  const heartbeat = setInterval(() => {
    writeSseEvent(res, "heartbeat", {
      type: "heartbeat",
      runId,
      activeRunId: null,
      pendingCount: 0,
      message: "Workspace agent heartbeat.",
      timestamp: new Date().toISOString(),
    });
  }, 15_000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    res.end();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > MAX_JSON_BYTES) {
      throw new Error(`Request body exceeds ${MAX_JSON_BYTES} bytes.`);
    }
  }
  if (!body.trim()) {
    return {} as T;
  }
  return JSON.parse(body) as T;
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("Missing path.");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Path must be relative to workspace root.");
  }
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error("Path escapes workspace root.");
  }
  return resolved;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated after ${maxChars} chars]`;
}

async function walkFiles(
  startDir: string,
  onFile: (filePath: string) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const queue: string[] = [startDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      onFile(path.join(current, entry.name));
      if (shouldStop()) return;
    }
  }
}

function buildRun(
  workspaceRoot: string,
  action: WorkspaceActionType,
  args: Record<string, unknown>,
  summary: string,
  step: WorkspaceAgentRunStep,
  status: "success" | "failed",
): WorkspaceAgentRun {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status,
    summary,
    workspaceRoot,
    request: {
      action,
      args,
    },
    approval: {
      required: false,
      status: "not_required",
    },
    steps: [step],
  };
}

export function createWorkspaceAgentRouter(options: WorkspaceAgentRouterOptions) {
  const { workspaceRoot } = options;

  return async function routeWorkspaceAgentRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!req.url) return false;
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith(WORKSPACE_AGENT_BASE_PATH)) {
      return false;
    }

    if (req.method === "OPTIONS") {
      writeJson(res, 204, { ok: true });
      return true;
    }

    if (req.method === "GET" && pathname === `${WORKSPACE_AGENT_BASE_PATH}/health`) {
      const health: WorkspaceAgentHealth = {
        status: "ok",
        service: "workspace_agent",
        workspaceRoot,
        runCount: runs.length,
        activeRunId: null,
        pendingQueueCount: 0,
        timestamp: new Date().toISOString(),
      };
      writeJson(res, 200, { health });
      return true;
    }

    if (req.method === "GET" && pathname === `${WORKSPACE_AGENT_BASE_PATH}/events`) {
      handleSseSubscription(req, res);
      return true;
    }

    const runEventsMatch = pathname.match(/^\/workspace-agent\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && runEventsMatch) {
      handleSseSubscription(req, res, runEventsMatch[1]);
      return true;
    }

    if (req.method === "GET" && pathname === `${WORKSPACE_AGENT_BASE_PATH}/runs`) {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 25), 200));
      const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      writeJson(res, 200, { runs: sorted.slice(0, limit) });
      return true;
    }

    const runDetailMatch = pathname.match(/^\/workspace-agent\/runs\/([^/]+)$/);
    if (req.method === "GET" && runDetailMatch) {
      const run = runs.find((candidate) => candidate.id === runDetailMatch[1]);
      if (!run) {
        writeJson(res, 404, { error: "Run not found." });
        return true;
      }

      writeJson(res, 200, { run });
      return true;
    }

    const runApprovalMatch = pathname.match(/^\/workspace-agent\/runs\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && runApprovalMatch) {
      const [, runId, action] = runApprovalMatch;
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) {
        writeJson(res, 404, { error: "Run not found." });
        return true;
      }

      writeJson(res, 409, {
        run,
        error: `Run ${runId} does not support ${action} in the local workspace agent.`,
      });
      return true;
    }

    if (req.method === "POST" && pathname === `${WORKSPACE_AGENT_BASE_PATH}/runs`) {
      try {
        const payload = await parseJsonBody<WorkspaceActionRequestBody>(req);
        const action = payload.action;
        const args = payload.args ?? {};

        if (!action) {
          writeJson(res, 400, { error: "Missing action." });
          return true;
        }

        const stepId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const evidence: string[] = [];
        let summary = "";
        let status: "success" | "failed" = "success";
        let errorMessage: string | undefined;

        try {
          if (action === "read") {
            const relativePath = String(args.path ?? "");
            const resolvedPath = resolveWorkspacePath(workspaceRoot, relativePath);
            const content = await fs.promises.readFile(resolvedPath, "utf8");
            evidence.push(`path: ${relativePath}`);
            evidence.push(`content:\n${truncateText(content, MAX_READ_CHARS)}`);
            summary = `Read file ${relativePath}.`;
          } else if (action === "write") {
            const relativePath = String(args.path ?? "");
            const resolvedPath = resolveWorkspacePath(workspaceRoot, relativePath);
            const content = String(args.content ?? "");
            const append = Boolean(args.append);
            await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
            if (append) {
              await fs.promises.appendFile(resolvedPath, content, "utf8");
            } else {
              await fs.promises.writeFile(resolvedPath, content, "utf8");
            }
            evidence.push(`path: ${relativePath}`);
            evidence.push(`bytes: ${Buffer.byteLength(content, "utf8")}`);
            summary = `${append ? "Appended" : "Wrote"} ${relativePath}.`;
          } else if (action === "mkdir") {
            const relativePath = String(args.path ?? "");
            const resolvedPath = resolveWorkspacePath(workspaceRoot, relativePath);
            await fs.promises.mkdir(resolvedPath, { recursive: true });
            evidence.push(`path: ${relativePath}`);
            summary = `Created directory ${relativePath}.`;
          } else if (action === "search") {
            const query = String(args.query ?? "").trim();
            if (!query) {
              throw new Error("Search query is required.");
            }
            const rootPath = String(args.rootPath ?? "");
            const caseSensitive = Boolean(args.caseSensitive);
            const startDir = rootPath
              ? resolveWorkspacePath(workspaceRoot, rootPath)
              : workspaceRoot;
            const matches: string[] = [];
            const needle = caseSensitive ? query : query.toLowerCase();

            await walkFiles(
              startDir,
              (filePath) => {
                if (matches.length >= MAX_SEARCH_RESULTS) return;
                const fileName = path.basename(filePath);
                const haystack = caseSensitive ? fileName : fileName.toLowerCase();
                if (haystack.includes(needle)) {
                  matches.push(path.relative(workspaceRoot, filePath));
                }
              },
              () => matches.length >= MAX_SEARCH_RESULTS,
            );

            evidence.push(`query: ${query}`);
            evidence.push(`matches:\n${matches.map((m) => `- ${m}`).join("\n")}`);
            summary = `Found ${matches.length} match(es) for "${query}".`;
          } else {
            throw new Error(`Unsupported action: ${action}`);
          }
        } catch (error) {
          status = "failed";
          errorMessage = error instanceof Error ? error.message : String(error);
          summary = `Workspace action failed: ${errorMessage}`;
        }

        const finishedAt = new Date().toISOString();
        const step: WorkspaceAgentRunStep = {
          stepId,
          type: action,
          status,
          exitCode: status === "success" ? 0 : 1,
          evidence,
          error: errorMessage,
          startedAt,
          finishedAt,
        };

        const run = buildRun(workspaceRoot, action, args, summary, step, status);
        runs.push(run);
        broadcastRunEvent("run_created", run);

        runtimeLog.info("Workspace action processed", {
          action,
          status,
          summary,
          stepId,
          evidenceCount: evidence.length,
        });

        writeJson(res, status === "success" ? 200 : 400, { run });
        return true;
      } catch (error) {
        runtimeLog.error("Workspace action handler failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        writeJson(res, 500, { error: "Workspace agent request failed." });
        return true;
      }
    }

    writeJson(res, 404, { error: "Route not found." });
    return true;
  };
}
