import { createHash } from "node:crypto";
import { executeRunInBackground } from "../executor";
import type { WorkspaceRunStatus, WorkspaceRunStore } from "../runStore";
import type { WorkspaceRunQueue } from "../runQueue";
import type { AgentRequestedAction } from "./agentTurnSchemas";
import type { EngineeringArtifact, EngineeringTicket } from "./types";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[WorkspaceRunLinker]";
const runtimeLog = log.fromContext({ source: "workspaceRunLinker" });

// A lightweight link from a requested action to a workspace run id.
export interface WorkspaceRunLink {
  runId: string;
  action: string;
  path?: string;
}

// Result of linking requested actions to workspace runs.
export interface WorkspaceRunLinkResult {
  links: WorkspaceRunLink[];
  artifacts: EngineeringArtifact[];
  idempotencyKey: string;
  deferredActions: Array<{
    action: string;
    reason: string;
  }>;
}

interface WorkspaceRunLinkerOptions {
  runStore: WorkspaceRunStore;
  runQueue: WorkspaceRunQueue;
}

export interface WorkspaceRunQueueSettledEvent {
  ticketId: string;
  finalRunId: string | null;
  finalStatus: WorkspaceRunStatus | null;
  finalSummary: string | null;
  deferredActions: Array<{
    action: string;
    reason: string;
  }>;
}

// WorkspaceRunLinker converts agent requested actions into workspace runs.
// It also applies an in-memory idempotency guard to avoid duplicates.
export class WorkspaceRunLinker {
  private readonly runStore: WorkspaceRunStore;
  private readonly runQueue: WorkspaceRunQueue;
  private readonly seenKeys = new Set<string>();
  private readonly runTicketIds = new Map<string, string>();
  private readonly ticketOpenRunCounts = new Map<string, number>();
  private readonly ticketDeferredActions = new Map<
    string,
    Array<{ action: string; reason: string }>
  >();
  private onTicketRunsSettled?: (event: WorkspaceRunQueueSettledEvent) => Promise<void> | void;

  public constructor(options: WorkspaceRunLinkerOptions) {
    this.runStore = options.runStore;
    this.runQueue = options.runQueue;
  }

  public setOnTicketRunsSettled(
    callback: (event: WorkspaceRunQueueSettledEvent) => Promise<void> | void,
  ): void {
    this.onTicketRunsSettled = callback;
  }

  public async linkRequestedActions(
    ticket: EngineeringTicket,
    worktreeRoot: string,
    requestedActions: AgentRequestedAction[],
    options?: { fullAuto?: boolean },
  ): Promise<WorkspaceRunLinkResult> {
    // Orchestrator full-auto flows expect linked runs to start immediately.
    const shouldAutoStartQueuedRuns = options?.fullAuto === true;

    // Normalize inputs to avoid mutation surprises.
    const allNormalizedActions = requestedActions.map((action) =>
      normalizeRequestedAction(action),
    );
    const executableActions = allNormalizedActions.filter(
      (action) => !getDeferredActionReason(action),
    );
    const deferredActions = allNormalizedActions
      .filter((action) => Boolean(getDeferredActionReason(action)))
      .map((action) => ({
        action: String(action.args.originalAction || action.action),
        reason:
          getDeferredActionReason(action) ||
          "Deferred action (reason unavailable).",
      }));

    const idempotencyKey = buildIdempotencyKey(ticket.id, allNormalizedActions);
    // Idempotency guard: skip if we've already processed these exact actions.
    if (this.seenKeys.has(idempotencyKey)) {
      runtimeLog.warning(`${LOG_PREFIX} Duplicate requested actions ignored`, {
        ticketId: ticket.id,
      });
      return {
        links: [],
        artifacts: [],
        idempotencyKey,
        deferredActions: [],
      };
    }
    this.seenKeys.add(idempotencyKey);

    const links: WorkspaceRunLink[] = [];
    const artifacts: EngineeringArtifact[] = [];
    if (deferredActions.length > 0) {
      this.ticketDeferredActions.set(ticket.id, deferredActions);
      console.log(`${LOG_PREFIX} deferred non-executable actions`, {
        ticketId: ticket.id,
        deferredActions,
      });
      runtimeLog.info(`${LOG_PREFIX} deferred non-executable actions`, {
        ticketId: ticket.id,
        deferredActions,
      });
    }

    // Create a workspace run for each requested action and enqueue it.
    for (const action of executableActions) {
      const run = await this.runStore.createRun(
        {
          action: action.action,
          args: action.args,
        },
        worktreeRoot,
      );
      this.runTicketIds.set(run.id, ticket.id);
      this.ticketOpenRunCounts.set(
        ticket.id,
        (this.ticketOpenRunCounts.get(ticket.id) ?? 0) + 1,
      );

      links.push({
        runId: run.id,
        action: action.action,
        path: typeof action.args.path === "string" ? action.args.path : undefined,
      });

      const runToStart = this.runQueue.enqueue(run.id);
      if (runToStart) {
        const details = {
          ticketId: ticket.id,
          runId: run.id,
          action: action.action,
          queueState: "active",
          pendingCount: this.runQueue.getPendingCount(),
          autoStart: shouldAutoStartQueuedRuns,
        };
        console.log(`${LOG_PREFIX} run queued`, details);
        runtimeLog.info(`${LOG_PREFIX} run queued`, details);
        if (shouldAutoStartQueuedRuns) {
          this.scheduleQueuedRunExecution(runToStart);
        }
      } else {
        const details = {
          ticketId: ticket.id,
          runId: run.id,
          action: action.action,
          queueState: "pending",
          pendingCount: this.runQueue.getPendingCount(),
        };
        console.log(`${LOG_PREFIX} run queued`, details);
        runtimeLog.info(`${LOG_PREFIX} run queued`, details);
      }
    }

    // If there are no executable actions, notify QA-deferred settlement immediately.
    if (shouldAutoStartQueuedRuns && executableActions.length === 0 && deferredActions.length > 0) {
      this.scheduleTicketRunsSettledNotification({
        ticketId: ticket.id,
        finalRunId: null,
        finalStatus: null,
        finalSummary: "No executable workspace runs; QA-only actions deferred to Claudy.",
        deferredActions,
      });
    }

    return {
      links,
      artifacts,
      idempotencyKey,
      deferredActions,
    };
  }

  private scheduleQueuedRunExecution(runId: string): void {
    queueMicrotask(() => {
      void this.executeQueuedRun(runId).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Unknown queued run execution error.";
        const details = {
          ticketId: this.runTicketIds.get(runId),
          runId,
          error: message,
        };
        console.error(`${LOG_PREFIX} executeQueuedRun crashed`, details);
        runtimeLog.error(`${LOG_PREFIX} executeQueuedRun crashed`, details);
      });
    });
  }

  private async executeQueuedRun(runId: string): Promise<void> {
    const ticketId = this.runTicketIds.get(runId);
    const run = await this.runStore.getRun(runId);
    if (!run) {
      const details = {
        ticketId,
        runId,
        activeRunId: this.runQueue.getActiveRunId(),
        pendingCount: this.runQueue.getPendingCount(),
      };
      console.warn(`${LOG_PREFIX} executeQueuedRun missing run`, details);
      runtimeLog.warning(`${LOG_PREFIX} executeQueuedRun missing run`, details);
      return;
    }

    const startDetails = {
      ticketId,
      runId,
      action: run.request.action,
      workspaceRoot: run.workspaceRoot,
      activeRunId: this.runQueue.getActiveRunId(),
      pendingCount: this.runQueue.getPendingCount(),
    };
    console.log(`${LOG_PREFIX} executeQueuedRun start`, startDetails);
    runtimeLog.info(`${LOG_PREFIX} executeQueuedRun start`, startDetails);

    await executeRunInBackground({
      runStore: this.runStore,
      runId,
      workspaceRoot: run.workspaceRoot,
    });

    const runAfterExecution = await this.runStore.getRun(runId);
    if (!runAfterExecution) {
      const details = {
        ticketId,
        runId,
        pendingCount: this.runQueue.getPendingCount(),
      };
      console.warn(`${LOG_PREFIX} executeQueuedRun missing run after execution`, details);
      runtimeLog.warning(
        `${LOG_PREFIX} executeQueuedRun missing run after execution`,
        details,
      );
      return;
    }

    const nextRunId = this.runQueue.resolveRunStatus(runId, runAfterExecution.status);
    const completeDetails = {
      ticketId,
      runId,
      status: runAfterExecution.status,
      summary: runAfterExecution.summary,
      nextRunId: nextRunId ?? null,
      activeRunId: this.runQueue.getActiveRunId(),
      pendingCount: this.runQueue.getPendingCount(),
    };
    const completionLogMessage = `${LOG_PREFIX} executeQueuedRun complete`;
    if (runAfterExecution.status === "failed" || runAfterExecution.status === "rejected") {
      console.error(completionLogMessage, completeDetails);
      runtimeLog.error(completionLogMessage, completeDetails);
    } else if (runAfterExecution.status === "verification_failed") {
      console.warn(completionLogMessage, completeDetails);
      runtimeLog.warning(completionLogMessage, completeDetails);
    } else {
      console.log(completionLogMessage, completeDetails);
      runtimeLog.info(completionLogMessage, completeDetails);
    }

    if (ticketId && TERMINAL_RUN_STATUSES.has(runAfterExecution.status)) {
      const remaining = Math.max(
        (this.ticketOpenRunCounts.get(ticketId) ?? 1) - 1,
        0,
      );
      if (remaining === 0) {
        this.ticketOpenRunCounts.delete(ticketId);
        const deferredActions = this.consumeDeferredActions(ticketId);
        this.scheduleTicketRunsSettledNotification({
          ticketId,
          finalRunId: runId,
          finalStatus: runAfterExecution.status,
          finalSummary: runAfterExecution.summary,
          deferredActions,
        });
      } else {
        this.ticketOpenRunCounts.set(ticketId, remaining);
        runtimeLog.info(`${LOG_PREFIX} ticket run count decremented`, {
          ticketId,
          remainingRuns: remaining,
        });
      }
    }

    if (!nextRunId) {
      return;
    }

    this.scheduleQueuedRunExecution(nextRunId);
  }

  private consumeDeferredActions(
    ticketId: string,
  ): Array<{ action: string; reason: string }> {
    const deferred = this.ticketDeferredActions.get(ticketId) ?? [];
    this.ticketDeferredActions.delete(ticketId);
    return deferred;
  }

  private scheduleTicketRunsSettledNotification(
    event: WorkspaceRunQueueSettledEvent,
  ): void {
    if (!this.onTicketRunsSettled) {
      return;
    }

    const details = {
      ticketId: event.ticketId,
      finalRunId: event.finalRunId,
      finalStatus: event.finalStatus,
      deferredActions: event.deferredActions.length,
    };
    console.log(`${LOG_PREFIX} ticket runs settled`, details);
    runtimeLog.info(`${LOG_PREFIX} ticket runs settled`, details);

    queueMicrotask(() => {
      void Promise.resolve(this.onTicketRunsSettled?.(event)).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Unknown ticket-runs-settled callback error.";
        const callbackDetails = {
          ticketId: event.ticketId,
          finalRunId: event.finalRunId,
          error: message,
        };
        console.error(`${LOG_PREFIX} ticket runs settled callback failed`, callbackDetails);
        runtimeLog.error(
          `${LOG_PREFIX} ticket runs settled callback failed`,
          callbackDetails,
        );
      });
    });
  }
}

function normalizeRequestedAction(action: AgentRequestedAction): AgentRequestedAction {
  const normalizedArgs = { ...action.args };
  const originalAction = action.action;

  if (originalAction === "shell_command") {
    const rawCommand =
      typeof normalizedArgs.command === "string" ? normalizedArgs.command.trim() : "";
    const translated = translateShellCommandAction(rawCommand, normalizedArgs, originalAction);
    if (translated) {
      return translated;
    }
    return {
      action: "shell_command",
      args: {
        ...normalizedArgs,
        originalAction,
        translationFailed: true,
      },
    };
  }

  if (
    originalAction === "readFile" ||
    originalAction === "readArtifact" ||
    originalAction === "read_file" ||
    originalAction === "read_artifact"
  ) {
    const pathValue =
      typeof normalizedArgs.path === "string"
        ? normalizedArgs.path
        : typeof normalizedArgs.filePath === "string"
          ? normalizedArgs.filePath
          : typeof normalizedArgs.file_path === "string"
            ? normalizedArgs.file_path
            : "";
    return {
      action: "read",
      args: {
        ...normalizedArgs,
        path: pathValue,
        originalAction,
      },
    };
  }

  if (originalAction === "searchRepo" || originalAction === "search_repo") {
    const query =
      typeof normalizedArgs.query === "string"
        ? normalizedArgs.query
        : typeof normalizedArgs.searchTerm === "string"
          ? normalizedArgs.searchTerm
          : typeof normalizedArgs.search_term === "string"
            ? normalizedArgs.search_term
        : typeof normalizedArgs.pattern === "string"
          ? normalizedArgs.pattern
          : "";
    const rootPath =
      typeof normalizedArgs.rootPath === "string"
        ? normalizedArgs.rootPath
        : typeof normalizedArgs.root === "string"
          ? normalizedArgs.root
          : typeof normalizedArgs.directory === "string"
            ? normalizedArgs.directory
        : Array.isArray(normalizedArgs.paths) && typeof normalizedArgs.paths[0] === "string"
          ? normalizedArgs.paths[0]
          : ".";

    return {
      action: "search",
      args: {
        ...normalizedArgs,
        query,
        rootPath,
        originalAction,
      },
    };
  }

  if (originalAction === "runTests" || originalAction === "run_tests") {
    return {
      action: "command",
      args: {
        ...normalizedArgs,
        command: "npm test -- --run",
        timeoutMs: 300_000,
        originalAction,
      },
    };
  }

  if (
    originalAction === "runValidation" ||
    originalAction === "runChecks" ||
    originalAction === "run_validation" ||
    originalAction === "run_checks" ||
    originalAction === "run_project_checks"
  ) {
    const goal =
      typeof normalizedArgs.goal === "string" ? normalizedArgs.goal.toLowerCase() : "";
    const command = goal.includes("build")
      ? "npm run build"
      : goal.includes("lint")
        ? "npm run lint"
        : "npm test -- --run";
    return {
      action: "command",
      args: {
        ...normalizedArgs,
        command,
        timeoutMs: 300_000,
        originalAction,
      },
    };
  }

  if (originalAction === "manualVerify") {
    return {
      action: "manualVerify",
      args: {
        ...normalizedArgs,
        originalAction,
      },
    };
  }

  return {
    action: originalAction,
    args: normalizedArgs,
  };
}

function isDeferredQaReviewAction(action: AgentRequestedAction): boolean {
  const originalAction =
    typeof action.args.originalAction === "string"
      ? action.args.originalAction
      : action.action;
  return (
    originalAction === "manualVerify" ||
    originalAction === "verifyUI" ||
    originalAction === "manual_verify" ||
    originalAction === "verify_ui"
  );
}

function isDeferredImplementationAction(action: AgentRequestedAction): boolean {
  const originalAction =
    typeof action.args.originalAction === "string"
      ? action.args.originalAction
      : action.action;
  if (
    originalAction === "shell_command" &&
    action.args.translationFailed === true
  ) {
    return true;
  }
  if (
    [
      "inspectUITextSources",
      "locateRenderSource",
      "applyFix",
      "fixTypo",
      "inspect_ui_text_sources",
      "locate_render_source",
      "apply_fix",
      "fix_typo",
    ].includes(originalAction)
  ) {
    return true;
  }

  if (originalAction === "edit") {
    const hasPath = typeof action.args.path === "string" && action.args.path.trim().length > 0;
    const hasWritePayload =
      typeof action.args.content === "string" ||
      typeof action.args.patch === "string" ||
      (typeof action.args.find === "string" && typeof action.args.replace === "string");
    return !hasPath || !hasWritePayload;
  }

  return false;
}

function getDeferredActionReason(action: AgentRequestedAction): string | null {
  if (isDeferredQaReviewAction(action)) {
    return "Deferred to Claudy QA review (LLM judgment) instead of workspace executor.";
  }
  if (
    (typeof action.args.originalAction === "string"
      ? action.args.originalAction
      : action.action) === "shell_command" &&
    action.args.translationFailed === true
  ) {
    return "Deferred because shell_command could not be safely translated to executor-supported actions. Opey should emit read/search/write/command/status actions directly.";
  }
  if (isDeferredImplementationAction(action)) {
    return "Deferred until Opey implementation turn provides concrete executor actions (e.g., read/search/write/command).";
  }
  return null;
}

function translateShellCommandAction(
  rawCommand: string,
  normalizedArgs: Record<string, unknown>,
  originalAction: string,
): AgentRequestedAction | null {
  if (!rawCommand) {
    return null;
  }

  const tokens = tokenizeShellLikeCommand(rawCommand);
  if (tokens.length === 0) {
    return null;
  }

  const [commandToken, ...restTokens] = tokens;
  const normalizedCommandToken = commandToken.toLowerCase();

  if (["get-content", "cat", "type"].includes(normalizedCommandToken)) {
    const pathToken = restTokens.find((token) => token.trim().length > 0);
    if (!pathToken) {
      return null;
    }
    return {
      action: "read",
      args: {
        ...normalizedArgs,
        path: pathToken,
        originalAction,
      },
    };
  }

  if (normalizedCommandToken === "rg") {
    const nonFlagTokens = extractRipgrepPositionalTokens(restTokens);
    const query = nonFlagTokens[0] ?? "";
    const rootPath = nonFlagTokens[1] ?? ".";
    if (!query.trim()) {
      return null;
    }
    return {
      action: "search",
      args: {
        ...normalizedArgs,
        query,
        rootPath,
        originalAction,
      },
    };
  }

  if (normalizedCommandToken === "git" && restTokens[0]?.toLowerCase() === "status") {
    return {
      action: "status",
      args: {
        ...normalizedArgs,
        originalAction,
      },
    };
  }

  if (normalizedCommandToken === "npm") {
    return {
      action: "command",
      args: {
        ...normalizedArgs,
        command: rawCommand,
        timeoutMs:
          typeof normalizedArgs.timeoutMs === "number" ? normalizedArgs.timeoutMs : 300_000,
        originalAction,
      },
    };
  }

  return null;
}

function tokenizeShellLikeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function extractRipgrepPositionalTokens(tokens: string[]): string[] {
  const positional: string[] = [];
  let skipNextAsFlagValue = false;

  for (const token of tokens) {
    if (skipNextAsFlagValue) {
      skipNextAsFlagValue = false;
      continue;
    }

    if (token.startsWith("--")) {
      if ([
        "--glob",
        "--iglob",
        "--type",
        "--type-not",
        "--max-filesize",
        "--max-count",
        "--context",
        "--before-context",
        "--after-context",
      ].includes(token)) {
        skipNextAsFlagValue = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      continue;
    }

    positional.push(token);
  }

  return positional;
}

// Deterministic hash to identify identical requested-action batches.
function buildIdempotencyKey(
  ticketId: string,
  actions: Array<{ action: string; args: Record<string, unknown> }>,
): string {
  const hash = createHash("sha256");
  hash.update(ticketId);
  hash.update(JSON.stringify(actions));
  return hash.digest("hex");
}

const TERMINAL_RUN_STATUSES: ReadonlySet<WorkspaceRunStatus> = new Set([
  "success",
  "failed",
  "verification_failed",
  "rejected",
]);
