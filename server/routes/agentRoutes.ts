import type { IncomingMessage, ServerResponse } from "node:http";
import { executeRunInBackground } from "../agent/executor";
import {
  type WorkspaceRun,
  type WorkspaceRunStore,
} from "../agent/runStore";
import { type WorkspaceActionType } from "../agent/policyEngine";
import { type WorkspaceRunEventHub } from "../agent/runEvents";
import { type WorkspaceRunQueue } from "../agent/runQueue";

interface AgentRouteContext {
  runStore: WorkspaceRunStore;
  runEventHub: WorkspaceRunEventHub;
  runQueue: WorkspaceRunQueue;
  workspaceRoot: string;
}

interface CreateRunRequestBody {
  prompt?: string;
  action?: string;
  args?: Record<string, unknown>;
}

interface ApprovalRequestBody {
  reason?: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const HEARTBEAT_INTERVAL_MS = 20_000;

const ACTIONS: ReadonlySet<WorkspaceActionType> = new Set([
  "mkdir",
  "read",
  "write",
  "search",
  "status",
  "commit",
  "push",
  "delete",
]);

export async function routeAgentRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRouteContext,
): Promise<boolean> {
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (!pathname.startsWith("/agent/")) {
    return false;
  }

  if (req.method === "OPTIONS") {
    writeJson(res, 204, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/agent/runs") {
    await handleCreateRun(req, res, context);
    return true;
  }

  if (req.method === "POST") {
    const approveMatch = pathname.match(/^\/agent\/runs\/([^/]+)\/approve$/);
    if (approveMatch) {
      await handleApproveRun(req, res, context, approveMatch[1]);
      return true;
    }

    const rejectMatch = pathname.match(/^\/agent\/runs\/([^/]+)\/reject$/);
    if (rejectMatch) {
      await handleRejectRun(req, res, context, rejectMatch[1]);
      return true;
    }
  }

  if (req.method === "GET") {
    if (pathname === "/agent/health") {
      await handleHealth(res, context);
      return true;
    }

    if (pathname === "/agent/runs") {
      const limit = Number(url.searchParams.get("limit") || 25);
      await handleListRuns(res, context, limit);
      return true;
    }

    if (pathname === "/agent/events") {
      handleRunEventsSse(req, res, context);
      return true;
    }

    const runEventMatch = pathname.match(/^\/agent\/runs\/([^/]+)\/events$/);
    if (runEventMatch) {
      handleRunEventsSse(req, res, context, runEventMatch[1]);
      return true;
    }

    const runIdMatch = pathname.match(/^\/agent\/runs\/([^/]+)$/);
    if (runIdMatch) {
      await handleGetRun(res, context, runIdMatch[1]);
      return true;
    }
  }

  writeJson(res, 404, { error: "Agent route not found." });
  return true;
}

async function handleCreateRun(
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRouteContext,
): Promise<void> {
  let body: CreateRunRequestBody;

  try {
    body = await parseJsonBody<CreateRunRequestBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const actionValue = typeof body.action === "string" ? body.action.trim() : "";
  if (!ACTIONS.has(actionValue as WorkspaceActionType)) {
    writeJson(res, 400, {
      error: "Unsupported action.",
      receivedAction: actionValue || null,
      supportedActions: Array.from(ACTIONS),
    });
    return;
  }

  const args = isPlainObject(body.args) ? body.args : {};

  const run = await context.runStore.createRun(
    {
      prompt: body.prompt,
      action: actionValue,
      args,
    },
    context.workspaceRoot,
  );

  writeJson(res, 202, { run });

  const runToStart = context.runQueue.enqueue(run.id);
  if (runToStart) {
    queueMicrotask(() => {
      void executeQueuedRun(context, runToStart);
    });
  }
}

async function handleApproveRun(
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRouteContext,
  runId: string,
): Promise<void> {
  let body: ApprovalRequestBody = {};
  try {
    body = await parseJsonBody<ApprovalRequestBody>(req);
  } catch {
    body = {};
  }

  const updatedRun = await context.runStore.updateRun(runId, (currentRun) => {
    if (currentRun.status !== "requires_approval") {
      return currentRun;
    }

    return {
      ...currentRun,
      status: "accepted",
      summary: `Approval granted for ${currentRun.request.action}. Run queued.`,
      approval: {
        required: true,
        status: "approved",
        reason: body.reason || "Approved from dashboard.",
        decidedAt: new Date().toISOString(),
      },
      steps: currentRun.steps.map((step) =>
        step.type === "approval"
          ? {
              ...step,
              status: "success",
              evidence: [...step.evidence, "Approval granted by operator."],
              finishedAt: new Date().toISOString(),
            }
          : step,
      ),
    };
  });

  if (!updatedRun) {
    writeJson(res, 404, { error: `Run not found: ${runId}` });
    return;
  }

  if (updatedRun.status !== "accepted") {
    writeJson(res, 409, { error: `Run is not awaiting approval: ${runId}`, run: updatedRun });
    return;
  }

  writeJson(res, 200, { run: updatedRun });

  queueMicrotask(() => {
    void executeQueuedRun(context, updatedRun.id);
  });
}

async function handleRejectRun(
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRouteContext,
  runId: string,
): Promise<void> {
  let body: ApprovalRequestBody = {};
  try {
    body = await parseJsonBody<ApprovalRequestBody>(req);
  } catch {
    body = {};
  }

  const updatedRun = await context.runStore.updateRun(runId, (currentRun) => {
    if (currentRun.status !== "requires_approval") {
      return currentRun;
    }

    return {
      ...currentRun,
      status: "rejected",
      summary: `Run rejected by operator before execution.`,
      approval: {
        required: true,
        status: "rejected",
        reason: body.reason || "Rejected from dashboard.",
        decidedAt: new Date().toISOString(),
      },
      steps: currentRun.steps.map((step) =>
        step.type === "approval"
          ? {
              ...step,
              status: "failed",
              error: "Approval rejected by operator.",
              evidence: [...step.evidence, "Approval rejected by operator."],
              finishedAt: new Date().toISOString(),
            }
          : step,
      ),
    };
  });

  if (!updatedRun) {
    writeJson(res, 404, { error: `Run not found: ${runId}` });
    return;
  }

  if (updatedRun.status !== "rejected") {
    writeJson(res, 409, { error: `Run is not awaiting approval: ${runId}`, run: updatedRun });
    return;
  }

  writeJson(res, 200, { run: updatedRun });

  const nextRunId = context.runQueue.resolveRunStatus(updatedRun.id, updatedRun.status);
  if (nextRunId) {
    queueMicrotask(() => {
      void executeQueuedRun(context, nextRunId);
    });
  }
}

async function handleGetRun(
  res: ServerResponse,
  context: AgentRouteContext,
  runId: string,
): Promise<void> {
  const run = await context.runStore.getRun(runId);

  if (!run) {
    writeJson(res, 404, { error: `Run not found: ${runId}` });
    return;
  }

  writeJson(res, 200, { run });
}

async function handleListRuns(
  res: ServerResponse,
  context: AgentRouteContext,
  limit: number,
): Promise<void> {
  const runs = await context.runStore.listRuns(limit);
  writeJson(res, 200, { runs });
}

async function handleHealth(
  res: ServerResponse,
  context: AgentRouteContext,
): Promise<void> {
  const runCount = await context.runStore.getRunCount();

  writeJson(res, 200, {
    health: {
      status: "healthy",
      service: "workspace_agent",
      workspaceRoot: context.workspaceRoot,
      runCount,
      activeRunId: context.runQueue.getActiveRunId(),
      pendingQueueCount: context.runQueue.getPendingCount(),
      timestamp: new Date().toISOString(),
    },
  });
}

function handleRunEventsSse(
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRouteContext,
  runIdFilter?: string,
): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  writeSseEvent(res, "connected", {
    ok: true,
    runIdFilter: runIdFilter || null,
    timestamp: new Date().toISOString(),
  });

  const unsubscribe = context.runEventHub.subscribe((event) => {
    if (runIdFilter && event.runId !== runIdFilter) {
      return;
    }

    writeSseEvent(res, event.type, event);
  });

  const heartbeat = setInterval(() => {
    const activeRunId = context.runQueue.getActiveRunId();
    if (!activeRunId) {
      writeSseEvent(res, "heartbeat", {
        timestamp: new Date().toISOString(),
        activeRunId: null,
        pendingCount: context.runQueue.getPendingCount(),
        message: "Agent is idle.",
      });
      return;
    }

    void context.runStore.getRun(activeRunId).then((activeRun) => {
      const status = activeRun?.status;
      const message =
        status === "requires_approval"
          ? "Waiting for your approval to continue this task."
          : "Still working on your queued workspace task.";

      writeSseEvent(res, "heartbeat", {
        timestamp: new Date().toISOString(),
        activeRunId,
        pendingCount: context.runQueue.getPendingCount(),
        message,
      });
    }).catch(() => {
      writeSseEvent(res, "heartbeat", {
        timestamp: new Date().toISOString(),
        activeRunId,
        pendingCount: context.runQueue.getPendingCount(),
        message: "Still working on your queued workspace task.",
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function writeSseEvent(res: ServerResponse, eventName: string, payload: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 1024 * 256;
  let body = "";

  for await (const chunk of req) {
    body += chunk.toString();

    if (body.length > maxBytes) {
      throw new Error("Request body exceeds 256KB limit.");
    }
  }

  if (!body.trim()) {
    return {} as T;
  }

  return JSON.parse(body) as T;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type { WorkspaceRun };

async function executeQueuedRun(
  context: AgentRouteContext,
  runId: string,
): Promise<void> {
  await executeRunInBackground({
    runStore: context.runStore,
    runId,
    workspaceRoot: context.workspaceRoot,
  });

  const runAfterExecution = await context.runStore.getRun(runId);
  if (!runAfterExecution) {
    return;
  }

  const nextRunId = context.runQueue.resolveRunStatus(
    runId,
    runAfterExecution.status,
  );
  if (!nextRunId) {
    return;
  }

  queueMicrotask(() => {
    void executeQueuedRun(context, nextRunId);
  });
}
