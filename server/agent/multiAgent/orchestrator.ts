import fs from "node:fs/promises";
import path from "node:path";
import {
  type EngineeringTicket,
  type EngineeringTicketStatus,
  type EngineeringTicketStore,
} from "./types";
import { MultiAgentEventLogger } from "./eventLogger";
import type { MultiAgentArtifactService } from "./artifactService";
import { isAllowedTransition, assertValidStatus } from "./statusMachine";
import {
  DEFAULT_RUNTIME_BOUNDS,
  type RuntimeBounds,
} from "./runtimeBounds";
import { WorktreeManager } from "./worktreeManager";
import { OpeyDeveloperAgent } from "../dev/opey";
import { KeraCoordinator } from "../assistant/kera";
import { ClaudyQaAgent } from "../qa/claudy";
import type { ExecutionTurnResult } from "./agentTurnSchemas";
import {
  assessEscalationFromTicket,
  assessEscalationFromTurns,
  logEscalation,
} from "./escalationPolicy";
import {
  WorkspaceRunLinker,
  type WorkspaceRunQueueSettledEvent,
} from "./workspaceRunLinker";
import { executeRunInBackground } from "../executor";
import type { WorkspaceRun, WorkspaceRunStore } from "../runStore";
import {
  type PrBodyEvidence,
  buildPrBodyFromTemplate,
  createGitHubPullRequest,
  resolveGitHubRepo,
  resolveGitHubToken,
  fetchDefaultBranch,
} from "./prCreator";
import {
  collectPatchCheckpoint,
  parseChangedFiles,
  isWorkflowArtifactPath,
  type PatchCheckpointResult,
} from "./patchCollector";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[MultiAgentOrchestrator]";
const baseConsole = globalThis.console;
const runtimeLog = log.fromContext({ source: "orchestrator" });
const console = {
  log: (message: string, details?: unknown) => {
    if (typeof details === "undefined") {
      baseConsole.log(message);
    } else {
      baseConsole.log(message, details);
    }
    runtimeLog.info(String(message), coerceLogDetails(details));
  },
};

function coerceLogDetails(details: unknown): Record<string, unknown> {
  if (!details) {
    return {};
  }
  if (typeof details === "object" && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  return { details };
}

// Dependencies needed by the orchestrator. Most are optional for testing.
interface OrchestratorDependencies {
  ticketStore: EngineeringTicketStore;
  eventLogger?: MultiAgentEventLogger;
  worktreeManager?: WorktreeManager;
  runtimeBounds?: RuntimeBounds;
  artifactService?: MultiAgentArtifactService;
  runStore?: WorkspaceRunStore;
  opeyAgent?: OpeyDeveloperAgent;
  keraCoordinator?: KeraCoordinator;
  claudyAgent?: ClaudyQaAgent;
  workspaceRunLinker?: WorkspaceRunLinker;
}

// MultiAgentOrchestrator is the "brain" of the workflow.
// It enforces status transitions, triggers agents, logs events, and applies guardrails.
export class MultiAgentOrchestrator {
  private readonly ticketStore: EngineeringTicketStore;
  private readonly eventLogger: MultiAgentEventLogger;
  private readonly worktreeManager: WorktreeManager | null;
  private readonly runtimeBounds: RuntimeBounds;
  private readonly artifactService: MultiAgentArtifactService | null;
  private readonly runStore: WorkspaceRunStore | null;
  private readonly opeyAgent: OpeyDeveloperAgent | null;
  private readonly keraCoordinator: KeraCoordinator | null;
  private readonly claudyAgent: ClaudyQaAgent | null;
  private readonly workspaceRunLinker: WorkspaceRunLinker | null;

  public constructor(deps: OrchestratorDependencies) {
    console.log(`${LOG_PREFIX} init`, {
      hasEventLogger: Boolean(deps.eventLogger),
      hasWorktreeManager: Boolean(deps.worktreeManager),
      hasArtifactService: Boolean(deps.artifactService),
      hasRunStore: Boolean(deps.runStore),
      hasOpey: Boolean(deps.opeyAgent),
      hasKera: Boolean(deps.keraCoordinator),
      hasClaudy: Boolean(deps.claudyAgent),
      hasWorkspaceRunLinker: Boolean(deps.workspaceRunLinker),
    });
    // Required store for ticket persistence.
    this.ticketStore = deps.ticketStore;
    // Event logger is optional, but we create a default if not provided.
    this.eventLogger =
      deps.eventLogger ?? new MultiAgentEventLogger(this.ticketStore);
    // Worktree manager can be absent in tests.
    this.worktreeManager = deps.worktreeManager ?? null;
    // Runtime bounds control max turns, cycles, runtime, etc.
    this.runtimeBounds = deps.runtimeBounds ?? DEFAULT_RUNTIME_BOUNDS;
    // Optional services and agents.
    this.artifactService = deps.artifactService ?? null;
    this.runStore = deps.runStore ?? null;
    this.opeyAgent = deps.opeyAgent ?? null;
    this.keraCoordinator = deps.keraCoordinator ?? null;
    this.claudyAgent = deps.claudyAgent ?? null;
    this.workspaceRunLinker = deps.workspaceRunLinker ?? null;
  }

  // Start a new ticket: move status from `created` → `intake_acknowledged`.
  public async startTicket(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} startTicket`, { ticketId });
    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} startTicket loaded`, {
      ticketId,
      status: ticket.status,
    });

    if (ticket.status !== "created") {
      console.log(`${LOG_PREFIX} startTicket noop (status not created)`, {
        ticketId,
        status: ticket.status,
      });
      return ticket;
    }

    return this.transitionTicket(ticket, "intake_acknowledged", {
      summary: "Ticket intake acknowledged.",
      actorType: "system",
      actorName: "orchestrator",
    });
  }

  // Resume a ticket without changing status (placeholder for future logic).
  public async resumeTicket(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} resumeTicket`, { ticketId });
    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} resumeTicket loaded`, {
      ticketId,
      status: ticket.status,
    });
    return ticket;
  }

  // Process the next step based on status (e.g., auto-trigger Opey when ready).
  public async processNextStep(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} processNextStep`, { ticketId });
    let ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} processNextStep loaded`, {
      ticketId,
      status: ticket.status,
    });
    await this.applyEscalationPolicy(ticket);
    ticket = await this.requireTicket(ticketId);

    // Deterministic intake bootstrap:
    // intake_acknowledged -> requirements_ready -> worktree -> initial artifacts.
    if (ticket.status === "intake_acknowledged") {
      if (!this.worktreeManager || !this.artifactService) {
        console.log(`${LOG_PREFIX} processNextStep intake bootstrap skipped`, {
          ticketId,
          hasWorktreeManager: Boolean(this.worktreeManager),
          hasArtifactService: Boolean(this.artifactService),
        });
      } else {
        const transitioned = this.tryAutoTransition(ticket, "requirements_ready", {
          summary: "Requirements accepted from intake; ready for planning.",
        });
        if (transitioned) {
          ticket = await transitioned;
        }
      }
    }

    if (ticket.status === "requirements_ready") {
      if (!this.worktreeManager || !this.artifactService) {
        console.log(`${LOG_PREFIX} processNextStep requirements bootstrap skipped`, {
          ticketId,
          hasWorktreeManager: Boolean(this.worktreeManager),
          hasArtifactService: Boolean(this.artifactService),
        });
      } else {
        console.log("1 Calling ensureWorktree")
        ticket = await this.ensureWorktree(ticket);
        ticket = await this.ensureInitialScaffoldArtifacts(ticket);
      }
    }

    await this.autoTriggerOpeyIfReady(ticket);

    ticket = await this.requireTicket(ticketId);
    await this.autoTriggerClaudyIfReady(ticket);

    ticket = await this.requireTicket(ticketId);
    if (ticket.status === "qa_approved") {
      console.log(`${LOG_PREFIX} processNextStep auto-trigger PR preparation`, {
        ticketId,
        status: ticket.status,
      });
      const transitioned = this.tryAutoTransition(ticket, "pr_preparing", {
        summary: "QA approved; auto-triggering PR preparation.",
      });
      if (transitioned) {
        ticket = await transitioned;
      }
    }

    ticket = await this.requireTicket(ticketId);
    console.log(
      `${LOG_PREFIX} processNextStep complete (status=${ticket.status}).`,
      {
        ticketId,
        status: ticket.status,
      },
    );
    return ticket;
  }

  // Request an Opey turn for planning/implementation/rework.
  public async requestOpeyTurn(
    ticketId: string,
    purpose: "planning" | "implementation" | "rework",
    prompt: string,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} requestOpeyTurn start`, {
      ticketId,
      purpose,
      hasOpey: Boolean(this.opeyAgent),
    });
    if (!this.opeyAgent) {
      throw new Error(`${LOG_PREFIX} Opey agent not configured.`);
    }

    // Route implementation/rework to execution mode (LLM works directly, no JSON).
    if (purpose === "implementation" || purpose === "rework") {
      await this.requestOpeyExecutionTurn(ticketId, purpose, prompt);
      return;
    }

    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} requestOpeyTurn loaded`, {
      ticketId,
      status: ticket.status,
      cycle: ticket.currentCycle,
    });
    console.log("2 Calling ensureWorktree")
    const ticketWithWorktree = await this.ensureWorktree(ticket);
    console.log(`${LOG_PREFIX} requestOpeyTurn worktree`, {
      ticketId,
      worktreePath: ticketWithWorktree.worktreePath,
      worktreeBranch: ticketWithWorktree.worktreeBranch,
    });
    let result: Awaited<ReturnType<OpeyDeveloperAgent["runTurn"]>>;
    try {
      console.log(`${LOG_PREFIX} requestOpeyTurn running agent`, {
        ticketId,
        purpose,
      });
      result = await this.opeyAgent.runTurn(ticket, {
        purpose,
        prompt: buildOpeyAutonomyPrompt(prompt),
      });
      console.log(`${LOG_PREFIX} requestOpeyTurn agent complete`, {
        ticketId,
        purpose,
        hasVerdict: Boolean(result.envelope.verdict),
        requestedActions: result.envelope.requestedActions.length,
      });
    } catch (error) {
      console.log(`${LOG_PREFIX} requestOpeyTurn agent failed`, {
        ticketId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleTurnFailure(ticket, "opey", purpose, error);
      return;
    }

    const turnIndex = await this.nextTurnIndex(
      ticketWithWorktree.id,
      ticketWithWorktree.currentCycle,
    );
    // Record the Opey turn in the database.
    console.log(`${LOG_PREFIX} requestOpeyTurn appendTurn`, {
      ticketId,
      turnIndex,
      cycle: ticketWithWorktree.currentCycle,
    });
    await this.ticketStore.appendTurn({
      ticketId: ticketWithWorktree.id,
      cycleNumber: ticketWithWorktree.currentCycle,
      turnIndex,
      agentRole: "opey",
      runtime: "codex_cli",
      purpose,
      promptExcerpt: prompt.slice(0, 500),
      responseExcerpt: result.raw.stdout.slice(0, 500),
      verdict: result.envelope.verdict,
      metadata: {
        needsHuman: result.envelope.needsHuman ?? false,
        nextStateHint: result.envelope.nextStateHint ?? null,
        requestedActions: result.envelope.requestedActions,
      },
    });

    // Log a high-level event so the audit trail is easy to read.
    console.log(`${LOG_PREFIX} requestOpeyTurn logEvent`, {
      ticketId,
      purpose,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "opey_turn_recorded",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Opey turn recorded.",
      payload: {
        purpose,
        needsHuman: result.envelope.needsHuman ?? false,
      },
    });

    // Note: implementation/rework are routed to requestOpeyExecutionTurn() above.
    // This path only handles planning turns, so always auto-advance.
    console.log(`${LOG_PREFIX} requestOpeyTurn autoAdvance`, {
      ticketId,
      purpose,
      nextStateHint: result.envelope.nextStateHint ?? null,
      verdict: result.envelope.verdict ?? null,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.autoAdvanceAfterTurn(
      ticket,
      "opey",
      purpose,
      result.envelope.nextStateHint,
      result.envelope.verdict,
      result.envelope.needsHuman,
    );

    // If no workspace linker is configured, we stop here (planning only).
    if (!this.workspaceRunLinker) {
      console.log(`${LOG_PREFIX} requestOpeyTurn no workspaceRunLinker`, {
        ticketId,
      });
      return;
    }

    // Workspace actions require a worktree path.
    if (!ticketWithWorktree.worktreePath) {
      throw new Error(
        `${LOG_PREFIX} Ticket ${ticketWithWorktree.id} missing worktree path.`,
      );
    }

    // If Opey requested no actions, skip workspace runs and auto-trigger implementation.
    if (result.envelope.requestedActions.length === 0) {
      console.log(`${LOG_PREFIX} requestOpeyTurn no requested actions`, {
        ticketId,
      });

      // If we just planned and have no actions, transition to implementing
      // and kick off execution mode directly.
      let current = await this.requireTicket(ticketId);
      if (current.status === "planning") {
        const implementing = this.tryAutoTransition(current, "implementing", {
          summary: "Planning returned no workspace actions; auto-triggering execution-mode implementation.",
        });
        if (implementing) {
          current = await implementing;
        }
      }

      if (current.status === "implementing") {
        const artifacts = await this.ticketStore.listArtifacts(current.id, 200);
        const implementationPrompt = buildOpeyImplementationPrompt({
          ticket: current,
          latestOpeyPlanExcerpt: result.raw.stdout.slice(0, 900),
          deferredActions: [],
          workspaceRunSummaries: [],
          bugArtifactPath:
            artifacts.find((a) => a.artifactType === "bug_md")?.path ?? null,
        });

        console.log(`${LOG_PREFIX} requestOpeyTurn auto-trigger execution-mode implementation (no planning actions)`, {
          ticketId,
          implementationPromptPreview: implementationPrompt.slice(0, 220),
        });
        await this.requestOpeyTurn(current.id, "implementation", implementationPrompt);
      }

      return;
    }

    // Convert requested actions into workspace runs.
    console.log(`${LOG_PREFIX} requestOpeyTurn link actions`, {
      ticketId,
      actions: result.envelope.requestedActions.length,
    });
    const linkResult = await this.workspaceRunLinker.linkRequestedActions(
      ticketWithWorktree,
      ticketWithWorktree.worktreePath,
      result.envelope.requestedActions,
      { fullAuto: true },
    );

    // Log the linkage for audit purposes.
    console.log(`${LOG_PREFIX} requestOpeyTurn log workspace linkage`, {
      ticketId,
      linkedRuns: linkResult.links.length,
      deferredActions: linkResult.deferredActions.length,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "workspace_runs_linked",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Workspace runs created from Opey requested actions.",
      payload: {
        idempotencyKey: linkResult.idempotencyKey,
        runs: linkResult.links,
        deferredActions: linkResult.deferredActions,
      },
    });

    for (const deferredAction of linkResult.deferredActions) {
      console.log(`${LOG_PREFIX} requestOpeyTurn deferred action`, {
        ticketId,
        action: deferredAction.action,
        reason: deferredAction.reason,
      });
    }

    // Store each run link as an artifact for traceability.
    for (const link of linkResult.links) {
      console.log(`${LOG_PREFIX} requestOpeyTurn createArtifact`, {
        ticketId,
        runId: link.runId,
        path: link.path ?? "",
      });
      await this.ticketStore.createArtifact({
        ticketId: ticketWithWorktree.id,
        artifactType: "workspace_run",
        path: link.path ?? "",
        status: "generated",
        createdByAgent: "opey",
        workspaceRunId: link.runId,
      });
    }
  }

  // Execution-mode Opey turn: Codex works directly in the worktree.
  // No JSON envelope, no workspace run pipeline.
  private async requestOpeyExecutionTurn(
    ticketId: string,
    purpose: "implementation" | "rework",
    rawPrompt: string,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} requestOpeyExecutionTurn start`, {
      ticketId,
      purpose,
    });

    const ticket = await this.requireTicket(ticketId);
    console.log("3 Calling ensureWorktree")
    const ticketWithWorktree = await this.ensureWorktree(ticket);

    const executionPrompt = buildOpeyExecutionPrompt(rawPrompt);
    let executionResult: ExecutionTurnResult;
    try {
      executionResult = await this.opeyAgent!.runExecutionTurn(ticketWithWorktree, {
        purpose,
        prompt: executionPrompt,
      });
      console.log(`${LOG_PREFIX} requestOpeyExecutionTurn agent complete`, {
        ticketId,
        purpose,
        summaryPreview: executionResult.summary.slice(0, 200),
      });
    } catch (error) {
      console.log(`${LOG_PREFIX} requestOpeyExecutionTurn agent failed`, {
        ticketId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleTurnFailure(ticket, "opey", purpose, error);
      return;
    }

    // Record the execution turn in the database.
    const turnIndex = await this.nextTurnIndex(
      ticketWithWorktree.id,
      ticketWithWorktree.currentCycle,
    );
    await this.ticketStore.appendTurn({
      ticketId: ticketWithWorktree.id,
      cycleNumber: ticketWithWorktree.currentCycle,
      turnIndex,
      agentRole: "opey",
      runtime: "codex_cli",
      purpose,
      promptExcerpt: rawPrompt.slice(0, 500),
      responseExcerpt: executionResult.raw.stdout.slice(0, 500),
      verdict: undefined,
      metadata: {
        executionMode: true,
        requestedActions: [],
      },
    });

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "opey_turn_recorded",
      actorType: "system",
      actorName: "orchestrator",
      summary: `Opey execution turn recorded (${purpose}).`,
      payload: { purpose, executionMode: true },
    });

    // Check if Codex actually changed anything in the worktree.
    const hasChanges = await this.detectWorktreeChanges(ticketWithWorktree.worktreePath!);
    console.log(`${LOG_PREFIX} requestOpeyExecutionTurn worktree changes`, {
      ticketId,
      hasChanges,
    });

    if (!hasChanges) {
      // No changes — check if we can retry.
      const turns = await this.ticketStore.listTurns(ticketWithWorktree.id, 200);
      const cycleTurns = turns.filter((t) => t.cycleNumber === ticketWithWorktree.currentCycle);
      const executionAttemptCount = cycleTurns.filter(
        (t) =>
          t.agentRole === "opey" &&
          (t.purpose === "implementation" || t.purpose === "rework"),
      ).length;
      const maxDevAttempts = Math.max(ticketWithWorktree.maxDevAttempts || 1, 1);

      console.log(`${LOG_PREFIX} requestOpeyExecutionTurn empty patch`, {
        ticketId,
        executionAttemptCount,
        maxDevAttempts,
      });

      if (executionAttemptCount < maxDevAttempts) {
        // Build rework prompt and retry.
        const reworkPrompt = [
          "Your previous implementation attempt produced NO file changes in the worktree.",
          "You MUST directly edit the source files to fix the issue.",
          "Do NOT just describe what to do — actually make the edits.",
          "",
          rawPrompt,
        ].join("\n");

        await this.eventLogger.logEvent({
          ticketId: ticket.id,
          eventType: "opey_rework_auto_triggered",
          actorType: "system",
          actorName: "orchestrator",
          summary: "Opey rework auto-triggered (execution mode, no changes detected).",
          payload: { executionAttemptCount, maxDevAttempts },
        });

        await this.requestOpeyExecutionTurn(ticketId, "rework", reworkPrompt);
        return;
      }

      // Max attempts reached — escalate.
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "empty_patch_max_attempts_reached",
        actorType: "system",
        actorName: "orchestrator",
        summary: "No changes after execution-mode attempts; escalating to human.",
        payload: { executionAttemptCount, maxDevAttempts },
      });

      const escalated = this.tryAutoTransition(ticket, "escalated_human", {
        summary: "No code changes after Opey execution attempts.",
      });
      if (escalated) {
        await escalated;
      }
      return;
    }

    // Collect patch checkpoint for audit/PR.
    const patchCheckpoint = await collectPatchCheckpoint({
      ticketId: ticketWithWorktree.id,
      worktreePath: ticketWithWorktree.worktreePath!,
    });
    await this.logPatchCheckpointArtifacts(ticketWithWorktree.id, patchCheckpoint);

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "patch_checkpoint_completed",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Execution-mode patch checkpoint collected.",
      payload: {
        purpose,
        executionMode: true,
        hasChanges: patchCheckpoint.hasChanges,
        changedFiles: patchCheckpoint.changedFiles,
      },
    });

    // Transition to ready_for_qa.
    let updatedTicket = await this.requireTicket(ticketId);
    if (updatedTicket.status === "implementing") {
      const readyForQa = this.tryAutoTransition(updatedTicket, "ready_for_qa", {
        summary: "Execution-mode changes detected; ready for QA.",
      });
      if (readyForQa) {
        updatedTicket = await readyForQa;
      }
    }

    // Trigger Claudy execution review.
    await this.requestClaudyExecutionTurn(ticketId, patchCheckpoint);
  }

  // Execution-mode Claudy turn: Claude inspects the worktree directly.
  private async requestClaudyExecutionTurn(
    ticketId: string,
    patchCheckpoint: PatchCheckpointResult,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} requestClaudyExecutionTurn start`, {
      ticketId,
      hasClaudy: Boolean(this.claudyAgent),
    });

    if (!this.claudyAgent) {
      throw new Error(`${LOG_PREFIX} Claudy agent not configured.`);
    }

    const ticket = await this.requireTicket(ticketId);
    console.log("6 Calling ensureWorktree")
    const ticketWithWorktree = await this.ensureWorktree(ticket);

    const reviewPrompt = buildClaudyExecutionReviewPrompt({
      ticket: ticketWithWorktree,
      patchCheckpoint,
    });

    let executionResult: ExecutionTurnResult;
    try {
      executionResult = await this.claudyAgent.runExecutionTurn(ticketWithWorktree, {
        purpose: "review",
        prompt: reviewPrompt,
      });
      console.log(`${LOG_PREFIX} requestClaudyExecutionTurn agent complete`, {
        ticketId,
        verdict: executionResult.verdict ?? "none",
        summaryPreview: executionResult.summary.slice(0, 200),
      });
    } catch (error) {
      console.log(`${LOG_PREFIX} requestClaudyExecutionTurn agent failed`, {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleTurnFailure(ticket, "claudy", "review", error);
      return;
    }

    // Record the Claudy execution turn.
    const turnIndex = await this.nextTurnIndex(
      ticketWithWorktree.id,
      ticketWithWorktree.currentCycle,
    );
    await this.ticketStore.appendTurn({
      ticketId: ticketWithWorktree.id,
      cycleNumber: ticketWithWorktree.currentCycle,
      turnIndex,
      agentRole: "claudy",
      runtime: "claude_code_cli",
      purpose: "review",
      promptExcerpt: reviewPrompt.slice(0, 500),
      responseExcerpt: executionResult.raw.stdout.slice(0, 500),
      verdict: executionResult.verdict,
      metadata: {
        executionMode: true,
        requestedActions: [],
      },
    });

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "claudy_turn_recorded",
      actorType: "system",
      actorName: "orchestrator",
      summary: `Claudy execution review recorded (verdict=${executionResult.verdict ?? "none"}).`,
      payload: {
        purpose: "review",
        executionMode: true,
        verdict: executionResult.verdict ?? null,
      },
    });

    // If no parseable verdict, escalate to human.
    if (!executionResult.verdict) {
      console.log(`${LOG_PREFIX} requestClaudyExecutionTurn no verdict — escalating`, {
        ticketId,
      });
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "qa_verdict_missing",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Claudy execution review produced no parseable verdict; escalating.",
        payload: { summaryPreview: executionResult.summary.slice(0, 300) },
      });

      const escalated = this.tryAutoTransition(ticket, "escalated_human", {
        summary: "No parseable QA verdict from Claudy execution review.",
      });
      if (escalated) {
        await escalated;
      }
      return;
    }

    // Use existing autoAdvanceAfterTurn for status transitions.
    await this.autoAdvanceAfterTurn(
      ticketWithWorktree,
      "claudy",
      "review",
      undefined,
      executionResult.verdict,
      false,
    );
  }

  // Lightweight worktree change detection via `git status --porcelain`.
  private async detectWorktreeChanges(worktreePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const { spawn } = require("node:child_process");
      const child = spawn("git", ["status", "--porcelain"], {
        cwd: worktreePath,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timeoutId = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        resolve(false);
      }, 15_000);

      child.on("close", () => {
        clearTimeout(timeoutId);
        const changedFiles = parseChangedFiles(stdout);
        const meaningfulChanges = changedFiles.filter((f) => !isWorkflowArtifactPath(f));
        resolve(meaningfulChanges.length > 0);
      });

      child.on("error", () => {
        clearTimeout(timeoutId);
        resolve(false);
      });
    });
  }

  public async handleWorkspaceRunsSettled(
    event: WorkspaceRunQueueSettledEvent,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled`, {
      ticketId: event.ticketId,
      finalRunId: event.finalRunId,
      finalStatus: event.finalStatus,
      deferredActions: event.deferredActions.length,
    });

    if (!this.claudyAgent || !this.runStore) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (missing deps)`, {
        ticketId: event.ticketId,
        hasClaudy: Boolean(this.claudyAgent),
        hasRunStore: Boolean(this.runStore),
      });
      return;
    }

    let ticket = await this.requireTicket(event.ticketId);
    if (TERMINAL_TICKET_STATUSES.has(ticket.status)) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (terminal ticket)`, {
        ticketId: ticket.id,
        status: ticket.status,
      });
      return;
    }

    const turns = await this.ticketStore.listTurns(ticket.id, 200);
    const cycleTurns = turns.filter((turn) => turn.cycleNumber === ticket.currentCycle);
    const latestOpeyTurn = [...cycleTurns]
      .reverse()
      .find((turn) => turn.agentRole === "opey");

    if (!latestOpeyTurn) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (no Opey turn)`, {
        ticketId: ticket.id,
        cycle: ticket.currentCycle,
      });
      return;
    }

    const latestOpeyRequestedActions = getRequestedActionsFromTurn(latestOpeyTurn.metadata);
    console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled latest Opey turn`, {
      ticketId: ticket.id,
      latestOpeyTurnId: latestOpeyTurn.id,
      purpose: latestOpeyTurn.purpose,
      requestedActions: latestOpeyRequestedActions.length,
    });

    const existingClaudyReview = [...cycleTurns]
      .reverse()
      .find(
        (turn) =>
          turn.agentRole === "claudy" &&
          turn.purpose === "review" &&
          new Date(turn.createdAt).getTime() >= new Date(latestOpeyTurn.createdAt).getTime(),
      );
    if (existingClaudyReview) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (Claudy already reviewed)`, {
        ticketId: ticket.id,
        claudyTurnId: existingClaudyReview.id,
        latestOpeyTurnId: latestOpeyTurn.id,
      });
      return;
    }

    const artifacts = await this.ticketStore.listArtifacts(ticket.id, 200);
    const latestOpeyTurnAt = new Date(latestOpeyTurn.createdAt).getTime();
    const recentWorkspaceRunArtifacts = artifacts
      .filter(
        (artifact) =>
          artifact.artifactType === "workspace_run" &&
          Boolean(artifact.workspaceRunId) &&
          new Date(artifact.createdAt).getTime() >= latestOpeyTurnAt,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const recentRuns = (
      await Promise.all(
        recentWorkspaceRunArtifacts.map(async (artifact) => {
          if (!artifact.workspaceRunId || !this.runStore) {
            return null;
          }
          const run = await this.runStore.getRun(artifact.workspaceRunId);
          if (!run) {
            return null;
          }
          return {
            artifact,
            run,
          };
        }),
      )
    ).filter((value): value is { artifact: typeof recentWorkspaceRunArtifacts[number]; run: WorkspaceRun } =>
      Boolean(value),
    );

    const nonTerminalRuns = recentRuns.filter(
      ({ run }) => !TERMINAL_WORKSPACE_RUN_STATUSES.has(run.status),
    );
    if (nonTerminalRuns.length > 0) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (runs still active)`, {
        ticketId: ticket.id,
        activeRuns: nonTerminalRuns.map(({ run }) => ({ runId: run.id, status: run.status })),
      });
      return;
    }

    console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled QA context`, {
      ticketId: ticket.id,
      ticketStatus: ticket.status,
      latestOpeyPurpose: latestOpeyTurn.purpose,
      workspaceRuns: recentRuns.length,
      failedRuns: recentRuns.filter(({ run }) => run.status !== "success").length,
      deferredActions: event.deferredActions.length,
    });

    if (latestOpeyTurn.purpose === "planning") {
      if (ticket.status === "planning") {
        const implementing = this.tryAutoTransition(ticket, "implementing", {
          summary: "Planning workspace runs settled; auto-triggering Opey implementation.",
        });
        if (implementing) {
          ticket = await implementing;
        }
      }

      ticket = await this.requireTicket(ticket.id);
      if (ticket.status !== "implementing") {
        console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (implementation not allowed)`, {
          ticketId: ticket.id,
          status: ticket.status,
          latestOpeyTurnId: latestOpeyTurn.id,
        });
        return;
      }

      const implementationPrompt = buildOpeyImplementationPrompt({
        ticket,
        latestOpeyPlanExcerpt: latestOpeyTurn.responseExcerpt,
        deferredActions: event.deferredActions,
        workspaceRunSummaries: recentRuns.map(({ artifact, run }) => ({
          runId: run.id,
          action: String(run.request.action || ""),
          status: run.status,
          summary: run.summary,
          path: artifact.path,
        })),
        bugArtifactPath:
          artifacts.find((artifact) => artifact.artifactType === "bug_md")?.path ?? null,
      });

      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled auto-trigger Opey implementation`, {
        ticketId: ticket.id,
        status: ticket.status,
        deferredActions: event.deferredActions,
        implementationPromptPreview: implementationPrompt.slice(0, 220),
      });
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "implementation_auto_triggered",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Opey implementation auto-triggered after planning workspace runs settled.",
        payload: {
          latestOpeyTurnId: latestOpeyTurn.id,
          deferredActions: event.deferredActions,
          finalRunId: event.finalRunId,
          finalStatus: event.finalStatus,
          workspaceRuns: recentRuns.map(({ run }) => ({
            runId: run.id,
            action: run.request.action,
            status: run.status,
          })),
        },
      });
      await this.requestOpeyTurn(ticket.id, "implementation", implementationPrompt);
      return;
    }

    if (!["implementation", "rework"].includes(latestOpeyTurn.purpose)) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (latest Opey turn purpose not actionable)`, {
        ticketId: ticket.id,
        purpose: latestOpeyTurn.purpose,
        latestOpeyTurnId: latestOpeyTurn.id,
      });
      return;
    }

    const qaReviewRequestedByAction =
      event.deferredActions.some((action) =>
        ["manualVerify", "verifyUI"].includes(action.action),
      ) ||
      latestOpeyRequestedActions.some((action) =>
        ["manualVerify", "verifyUI"].includes(action.action),
      );
    const qaTriggerReason = qaReviewRequestedByAction
      ? "explicit QA review action present"
      : "workspace runs settled after Opey implementation/rework";

    if (!ticket.worktreePath) {
      const details = {
        ticketId: ticket.id,
        purpose: latestOpeyTurn.purpose,
        status: ticket.status,
      };
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (missing worktree for patch checkpoint)`, details);
      runtimeLog.error(
        `${LOG_PREFIX} handleWorkspaceRunsSettled skip (missing worktree for patch checkpoint)`,
        details,
      );
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "patch_checkpoint_failed",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Patch checkpoint could not run because worktree path is missing.",
        payload: details,
      });
      return;
    }

    const patchCheckpoint = await collectPatchCheckpoint({
      ticketId: ticket.id,
      worktreePath: ticket.worktreePath,
    });

    await this.logPatchCheckpointArtifacts(ticket.id, patchCheckpoint);

    if (!patchCheckpoint.ok) {
      const details = {
        ticketId: ticket.id,
        purpose: latestOpeyTurn.purpose,
        errors: patchCheckpoint.errors,
      };
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (patch checkpoint failed)`, details);
      runtimeLog.error(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (patch checkpoint failed)`, details);
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "patch_checkpoint_failed",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Patch checkpoint failed; QA handoff blocked.",
        payload: details,
      });
      return;
    }

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "patch_checkpoint_completed",
      actorType: "system",
      actorName: "orchestrator",
      summary: patchCheckpoint.hasChanges
        ? "Patch checkpoint collected before QA handoff."
        : "Patch checkpoint collected but no code changes detected.",
      payload: {
        purpose: latestOpeyTurn.purpose,
        hasAnyChanges: patchCheckpoint.hasAnyChanges,
        hasChanges: patchCheckpoint.hasChanges,
        allChangedFiles: patchCheckpoint.allChangedFiles,
        changedFiles: patchCheckpoint.changedFiles,
        ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
        diffTruncated: patchCheckpoint.diffTruncated,
        artifacts: patchCheckpoint.artifacts ?? null,
      },
    });

    console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled patch checkpoint`, {
      ticketId: ticket.id,
      hasAnyChanges: patchCheckpoint.hasAnyChanges,
      hasChanges: patchCheckpoint.hasChanges,
      allChangedFiles: patchCheckpoint.allChangedFiles.length,
      changedFiles: patchCheckpoint.changedFiles.length,
      ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths.length,
      diffTruncated: patchCheckpoint.diffTruncated,
      artifacts: patchCheckpoint.artifacts ?? null,
    });

    if (!patchCheckpoint.hasChanges) {
      const opeyExecutionTurnsThisCycle = cycleTurns.filter(
        (turn) =>
          turn.agentRole === "opey" &&
          (turn.purpose === "implementation" || turn.purpose === "rework"),
      );
      const executionAttemptCount = opeyExecutionTurnsThisCycle.length;
      const maxDevAttempts = Math.max(ticket.maxDevAttempts || 1, 1);
      const canRetryWithRework = executionAttemptCount < maxDevAttempts;
      const details = {
        ticketId: ticket.id,
        purpose: latestOpeyTurn.purpose,
        status: ticket.status,
        executionAttemptCount,
        maxDevAttempts,
        canRetryWithRework,
        hasAnyChanges: patchCheckpoint.hasAnyChanges,
        allChangedFiles: patchCheckpoint.allChangedFiles,
        ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
      };
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled block QA (empty patch)`, details);
      runtimeLog.warning(`${LOG_PREFIX} handleWorkspaceRunsSettled block QA (empty patch)`, details);
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "empty_patch_blocked",
        actorType: "system",
        actorName: "orchestrator",
        summary: "QA handoff blocked because no code changes were detected after Opey execution.",
        payload: {
          ...details,
          patchArtifacts: patchCheckpoint.artifacts ?? null,
        },
      });

      if (canRetryWithRework && ticket.status === "implementing") {
        const reworkPrompt = buildOpeyEmptyPatchReworkPrompt({
          ticket,
          latestOpeyTurnSummary: latestOpeyTurn.responseExcerpt,
          workspaceRunSummaries: recentRuns.map(({ artifact, run }) => ({
            runId: run.id,
            action: String(run.request.action || ""),
            status: run.status,
            summary: run.summary,
            path: artifact.path,
          })),
          bugArtifactPath:
            artifacts.find((artifact) => artifact.artifactType === "bug_md")?.path ?? null,
          patchCheckpoint: {
            hasAnyChanges: patchCheckpoint.hasAnyChanges,
            hasChanges: patchCheckpoint.hasChanges,
            allChangedFiles: patchCheckpoint.allChangedFiles,
            changedFiles: patchCheckpoint.changedFiles,
            ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
            diffStatText: patchCheckpoint.diffStatText,
          },
          attemptNumber: executionAttemptCount + 1,
          maxDevAttempts,
        });
        console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled auto-trigger Opey rework (empty patch)`, {
          ticketId: ticket.id,
          executionAttemptCount,
          maxDevAttempts,
          nextAttemptNumber: executionAttemptCount + 1,
          reworkPromptPreview: reworkPrompt.slice(0, 220),
        });
        await this.eventLogger.logEvent({
          ticketId: ticket.id,
          eventType: "opey_rework_auto_triggered",
          actorType: "system",
          actorName: "orchestrator",
          summary: "Opey rework auto-triggered because patch checkpoint detected no meaningful code changes.",
          payload: {
            executionAttemptCount,
            maxDevAttempts,
            nextAttemptNumber: executionAttemptCount + 1,
            hasAnyChanges: patchCheckpoint.hasAnyChanges,
            ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
          },
        });
        await this.requestOpeyTurn(ticket.id, "rework", reworkPrompt);
        return;
      }

      if (!canRetryWithRework) {
        console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled escalate (empty patch max attempts reached)`, {
          ticketId: ticket.id,
          executionAttemptCount,
          maxDevAttempts,
        });
        await this.eventLogger.logEvent({
          ticketId: ticket.id,
          eventType: "empty_patch_max_attempts_reached",
          actorType: "system",
          actorName: "orchestrator",
          summary: "No meaningful code changes after Opey implementation/rework attempts; escalating to human.",
          payload: {
            executionAttemptCount,
            maxDevAttempts,
            hasAnyChanges: patchCheckpoint.hasAnyChanges,
            allChangedFiles: patchCheckpoint.allChangedFiles,
            ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
          },
        });
        const escalated = this.tryAutoTransition(ticket, "escalated_human", {
          summary: "No meaningful code changes after Opey implementation/rework attempts.",
        });
        if (escalated) {
          await escalated;
        }
      }
      return;
    }

    if (ticket.status === "planning") {
      const implementing = this.tryAutoTransition(ticket, "implementing", {
        summary: "Workspace runs began/settled after Opey planning; moving to implementing.",
      });
      if (implementing) {
        ticket = await implementing;
      }
    }

    if (ticket.status === "implementing") {
      const readyForQa = this.tryAutoTransition(ticket, "ready_for_qa", {
        summary: "Workspace runs settled; ready for Claudy QA review.",
      });
      if (readyForQa) {
        ticket = await readyForQa;
      }
    }

    ticket = await this.requireTicket(ticket.id);
    if (!["ready_for_qa", "qa_testing"].includes(ticket.status)) {
      console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled skip (status not QA-ready)`, {
        ticketId: ticket.id,
        status: ticket.status,
      });
      return;
    }

    const qaPrompt = buildClaudyAutoReviewPrompt({
      ticket,
      latestOpeyTurnSummary: latestOpeyTurn.responseExcerpt,
      deferredActions: event.deferredActions,
      workspaceRunSummaries: recentRuns.map(({ artifact, run }) => ({
        runId: run.id,
        action: String(run.request.action || ""),
        status: run.status,
        summary: run.summary,
        path: artifact.path,
        stepEvidencePreview:
          run.steps
            .slice(-2)
            .flatMap((step) => step.evidence.slice(0, 2))
            .join(" | ")
            .slice(0, 600) || "",
      })),
      bugArtifactPath:
        artifacts.find((artifact) => artifact.artifactType === "bug_md")?.path ?? null,
      patchCheckpoint: {
        changedFiles: patchCheckpoint.changedFiles,
        diffStatText: patchCheckpoint.diffStatText,
        diffTruncated: patchCheckpoint.diffTruncated,
        artifactPaths: patchCheckpoint.artifacts ?? null,
      },
    });

    console.log(`${LOG_PREFIX} handleWorkspaceRunsSettled auto-trigger Claudy review`, {
      ticketId: ticket.id,
      status: ticket.status,
      qaTriggerReason,
      qaPromptPreview: qaPrompt.slice(0, 200),
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "qa_review_auto_triggered",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Claudy auto-triggered after workspace runs settled.",
      payload: {
        qaTriggerReason,
        deferredActions: event.deferredActions,
        finalRunId: event.finalRunId,
        finalStatus: event.finalStatus,
        workspaceRuns: recentRuns.map(({ run }) => ({
          runId: run.id,
          action: run.request.action,
          status: run.status,
        })),
      },
    });
    await this.requestClaudyTurn(ticket.id, "review", qaPrompt);
  }

  private async logPatchCheckpointArtifacts(
    ticketId: string,
    patchCheckpoint: PatchCheckpointResult,
  ): Promise<void> {
    if (!patchCheckpoint.ok || !patchCheckpoint.artifacts) {
      return;
    }

    const artifactSpecs = [
      {
        artifactType: "patch_summary",
        path: patchCheckpoint.artifacts.summaryPath,
      },
      {
        artifactType: "patch_status",
        path: patchCheckpoint.artifacts.statusPath,
      },
      {
        artifactType: "patch_diffstat",
        path: patchCheckpoint.artifacts.diffStatPath,
      },
      {
        artifactType: "patch_diff",
        path: patchCheckpoint.artifacts.diffPath,
      },
    ] as const;

    for (const artifact of artifactSpecs) {
      console.log(`${LOG_PREFIX} logPatchCheckpointArtifacts createArtifact`, {
        ticketId,
        artifactType: artifact.artifactType,
        path: artifact.path,
      });
      await this.ticketStore.createArtifact({
        ticketId,
        artifactType: artifact.artifactType,
        path: artifact.path,
        status: "generated",
        createdByAgent: "system",
      });
    }
  }

  public async requestKeraTurn(
    ticketId: string,
    purpose: "intake" | "planning" | "status_update",
    prompt: string,
  ): Promise<void> {
    // Kera is optional in tests; error if not configured.
    console.log(`${LOG_PREFIX} requestKeraTurn start`, {
      ticketId,
      purpose,
      hasKera: Boolean(this.keraCoordinator),
    });
    if (!this.keraCoordinator) {
      throw new Error(`${LOG_PREFIX} Kera coordinator not configured.`);
    }

    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} requestKeraTurn loaded`, {
      ticketId,
      status: ticket.status,
      cycle: ticket.currentCycle,
    });
    // Execute Kera turn via CLI runner.
    let result: Awaited<ReturnType<KeraCoordinator["runTurn"]>>;
    try {
      console.log(`${LOG_PREFIX} requestKeraTurn running agent`, {
        ticketId,
        purpose,
      });
      result = await this.keraCoordinator.runTurn({
        purpose,
        prompt,
      });
      console.log(`${LOG_PREFIX} requestKeraTurn agent complete`, {
        ticketId,
        purpose,
        hasVerdict: Boolean(result.envelope.verdict),
        requestedActions: result.envelope.requestedActions.length,
      });
    } catch (error) {
      console.log(`${LOG_PREFIX} requestKeraTurn agent failed`, {
        ticketId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleTurnFailure(ticket, "kera", purpose, error);
      return;
    }

    // Record Kera turn in the database.
    const turnIndex = await this.nextTurnIndex(ticket.id, ticket.currentCycle);
    console.log(`${LOG_PREFIX} requestKeraTurn appendTurn`, {
      ticketId,
      turnIndex,
      cycle: ticket.currentCycle,
    });
    await this.ticketStore.appendTurn({
      ticketId: ticket.id,
      cycleNumber: ticket.currentCycle,
      turnIndex,
      agentRole: "kera",
      runtime: "codex_cli",
      purpose,
      promptExcerpt: prompt.slice(0, 500),
      responseExcerpt: result.raw.stdout.slice(0, 500),
      verdict: result.envelope.verdict,
      metadata: {
        needsHuman: result.envelope.needsHuman ?? false,
        nextStateHint: result.envelope.nextStateHint ?? null,
        requestedActions: result.envelope.requestedActions,
      },
    });

    // Log event for the audit trail.
    console.log(`${LOG_PREFIX} requestKeraTurn logEvent`, {
      ticketId,
      purpose,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "kera_turn_recorded",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Kera turn recorded.",
      payload: {
        purpose,
        needsHuman: result.envelope.needsHuman ?? false,
      },
    });

    // Auto-advance ticket status based on the completed Kera turn.
    console.log(`${LOG_PREFIX} requestKeraTurn autoAdvance`, {
      ticketId,
      purpose,
      nextStateHint: result.envelope.nextStateHint ?? null,
      verdict: result.envelope.verdict ?? null,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.autoAdvanceAfterTurn(
      ticket,
      "kera",
      purpose,
      result.envelope.nextStateHint,
      result.envelope.verdict,
      result.envelope.needsHuman,
    );
  }

  public async requestClaudyTurn(
    ticketId: string,
    purpose: "review" | "rework" | "status_update",
    prompt: string,
  ): Promise<void> {
    // Claudy is optional in tests; error if not configured.
    console.log(`${LOG_PREFIX} requestClaudyTurn start`, {
      ticketId,
      purpose,
      hasClaudy: Boolean(this.claudyAgent),
    });
    if (!this.claudyAgent) {
      throw new Error(`${LOG_PREFIX} Claudy agent not configured.`);
    }

    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} requestClaudyTurn loaded`, {
      ticketId,
      status: ticket.status,
      cycle: ticket.currentCycle,
    });
    console.log("4 Calling ensureWorktree")
    const ticketWithWorktree = await this.ensureWorktree(ticket);
    console.log(`${LOG_PREFIX} requestClaudyTurn worktree`, {
      ticketId,
      worktreePath: ticketWithWorktree.worktreePath,
      worktreeBranch: ticketWithWorktree.worktreeBranch,
    });
    // Execute Claudy QA turn via CLI runner.
    let result: Awaited<ReturnType<ClaudyQaAgent["runTurn"]>>;
    try {
      console.log(`${LOG_PREFIX} requestClaudyTurn running agent`, {
        ticketId,
        purpose,
      });
      result = await this.claudyAgent.runTurn(ticketWithWorktree, {
        purpose,
        prompt,
      });
      console.log(`${LOG_PREFIX} requestClaudyTurn agent complete`, {
        ticketId,
        purpose,
        verdict: result.envelope.verdict ?? null,
        requestedActions: result.envelope.requestedActions.length,
      });
    } catch (error) {
      console.log(`${LOG_PREFIX} requestClaudyTurn agent failed`, {
        ticketId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleTurnFailure(ticket, "claudy", purpose, error);
      return;
    }

    const turnIndex = await this.nextTurnIndex(
      ticketWithWorktree.id,
      ticketWithWorktree.currentCycle,
    );
    // Record Claudy turn in the database.
    console.log(`${LOG_PREFIX} requestClaudyTurn appendTurn`, {
      ticketId,
      turnIndex,
      cycle: ticket.currentCycle,
    });
    await this.ticketStore.appendTurn({
      ticketId: ticketWithWorktree.id,
      cycleNumber: ticketWithWorktree.currentCycle,
      turnIndex,
      agentRole: "claudy",
      runtime: "claude_code_cli",
      purpose,
      promptExcerpt: prompt.slice(0, 500),
      responseExcerpt: result.raw.stdout.slice(0, 500),
      verdict: result.envelope.verdict,
      metadata: {
        needsHuman: result.envelope.needsHuman ?? false,
        nextStateHint: result.envelope.nextStateHint ?? null,
        requestedActions: result.envelope.requestedActions,
      },
    });

    // Log event for the audit trail.
    console.log(`${LOG_PREFIX} requestClaudyTurn logEvent`, {
      ticketId,
      purpose,
      verdict: result.envelope.verdict ?? null,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.eventLogger.logEvent({
      ticketId: ticketWithWorktree.id,
      eventType: "claudy_turn_recorded",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Claudy turn recorded.",
      payload: {
        purpose,
        verdict: result.envelope.verdict ?? null,
        needsHuman: result.envelope.needsHuman ?? false,
      },
    });

    // Auto-advance ticket status based on QA verdict/purpose.
    console.log(`${LOG_PREFIX} requestClaudyTurn autoAdvance`, {
      ticketId,
      purpose,
      nextStateHint: result.envelope.nextStateHint ?? null,
      verdict: result.envelope.verdict ?? null,
      needsHuman: result.envelope.needsHuman ?? false,
    });
    await this.autoAdvanceAfterTurn(
      ticketWithWorktree,
      "claudy",
      purpose,
      result.envelope.nextStateHint,
      result.envelope.verdict,
      result.envelope.needsHuman,
    );
  }

  public async scaffoldArtifacts(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} scaffoldArtifacts start`, { ticketId });
    const ticket = await this.requireTicket(ticketId);
    console.log(`${LOG_PREFIX} scaffoldArtifacts loaded`, {
      ticketId,
      status: ticket.status,
      requestType: ticket.requestType,
    });

    // Only allow scaffolding in early phases.
    if (!["requirements_ready", "planning", "implementing"].includes(ticket.status)) {
      throw new Error(
        `${LOG_PREFIX} Ticket ${ticketId} not ready for scaffolding (status=${ticket.status}).`,
      );
    }

    // Artifact service is responsible for writing placeholder docs via workspace runs.
    if (!this.artifactService) {
      throw new Error(`${LOG_PREFIX} Artifact service not configured.`);
    }

    if (!ticket.worktreePath) {
      throw new Error(`${LOG_PREFIX} Ticket ${ticketId} missing worktree path.`);
    }

    // Choose the correct artifact template by request type.
    if (ticket.requestType === "skill") {
      console.log(`${LOG_PREFIX} scaffoldArtifacts skill`, { ticketId });
      await this.artifactService.scaffoldSkillArtifacts(ticket, ticket.worktreePath);
    } else if (ticket.requestType === "feature") {
      console.log(`${LOG_PREFIX} scaffoldArtifacts feature`, { ticketId });
      await this.artifactService.scaffoldFeatureArtifacts(ticket, ticket.worktreePath);
    } else if (ticket.requestType === "bug") {
      console.log(`${LOG_PREFIX} scaffoldArtifacts bug`, { ticketId });
      await this.artifactService.scaffoldBugArtifacts(ticket, ticket.worktreePath);
    } else {
      throw new Error(`${LOG_PREFIX} Unsupported request type: ${ticket.requestType}`);
    }
    return await this.requireTicket(ticketId);
  }

  // Expose current runtime limits (used by UI/tests).
  public getRuntimeBounds(): RuntimeBounds {
    console.log(`${LOG_PREFIX} getRuntimeBounds`, {
      maxActiveTickets: this.runtimeBounds.maxActiveTickets,
      maxRuntimeMinutesPerTicket: this.runtimeBounds.maxRuntimeMinutesPerTicket,
    });
    return { ...this.runtimeBounds };
  }

  // Convenience method to transition a ticket by id.
  public async transitionTicketById(
    ticketId: string,
    nextStatus: EngineeringTicketStatus,
    summary: string,
  ): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} transitionTicketById`, { ticketId, nextStatus });
    const ticket = await this.requireTicket(ticketId);
    return this.transitionTicket(ticket, nextStatus, {
      summary,
      actorType: "system",
      actorName: "orchestrator",
    });
  }

  // Ensure a ticket has a worktree, creating one if missing.
  public async ensureTicketWorktree(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} ensureTicketWorktree`, { ticketId });
    const ticket = await this.requireTicket(ticketId);
    return this.ensureWorktree(ticket);
  }

  // Core transition helper with validation + event logging.
  private async transitionTicket(
    ticket: EngineeringTicket,
    nextStatus: EngineeringTicketStatus,
    context: { summary: string; actorType: "system" | "human"; actorName: string },
  ): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} transitionTicket attempt`, {
      ticketId: ticket.id,
      from: ticket.status,
      to: nextStatus,
    });
    if (!isAllowedTransition(ticket.status, nextStatus)) {
      throw new Error(
        `${LOG_PREFIX} Invalid transition ${ticket.status} -> ${nextStatus}`,
      );
    }

    const updated = await this.ticketStore.updateTicket(
      ticket.id,
      (current) => ({
        ...current,
        status: nextStatus,
      }),
    );

    if (!updated) {
      throw new Error(`${LOG_PREFIX} Ticket ${ticket.id} not found.`);
    }

    console.log(`${LOG_PREFIX} transitionTicket logEvent`, {
      ticketId: ticket.id,
      from: ticket.status,
      to: nextStatus,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "status_transition",
      actorType: context.actorType,
      actorName: context.actorName,
      summary: context.summary,
      payload: {
        fromStatus: ticket.status,
        toStatus: nextStatus,
      },
    });

    // If we're entering PR preparation, attempt to create the PR immediately.
    if (nextStatus === "pr_preparing") {
      console.log(`${LOG_PREFIX} transitionTicket pr_preparing`, {
        ticketId: ticket.id,
      });
      try {
        await this.preparePullRequest(updated);
      } catch (error) {
        await this.handlePrFailure(updated, error);
      }
    }

    return updated;
  }

  // Compute the next turn index for a cycle.
  private async nextTurnIndex(ticketId: string, cycleNumber: number): Promise<number> {
    console.log(`${LOG_PREFIX} nextTurnIndex`, { ticketId, cycleNumber });
    const turns = await this.ticketStore.listTurns(ticketId, 200);
    return turns.filter((t) => t.cycleNumber === cycleNumber).length;
  }

  // Load a ticket or throw a hard error.
  private async requireTicket(ticketId: string): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} requireTicket`, { ticketId });
    const ticket = await this.ticketStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`${LOG_PREFIX} Ticket ${ticketId} not found.`);
    }
    return ticket;
  }

  // Create a worktree if the ticket doesn't already have one.
  private async ensureWorktree(
    ticket: EngineeringTicket,
  ): Promise<EngineeringTicket> {
    console.log(`${LOG_PREFIX} ensureWorktree`, {
      ticketId: ticket.id,
      hasWorktree: Boolean(ticket.worktreePath && ticket.worktreeBranch),
    });
    console.log("ensureWorkTree 1")
    if (ticket.worktreePath && ticket.worktreeBranch) {
      console.log("RETURN WORK TREE")
      return ticket;
    }
console.log("ensureWorkTree 2")
    if (!this.worktreeManager) {
      throw new Error(`${LOG_PREFIX} Worktree manager not configured.`);
    }
    console.log("ensureWorkTree 3")

    // Create new worktree and persist its path + branch.
    const worktreeInfo = await this.worktreeManager.createWorktree(ticket.id);
    console.log("ensureWorkTree 4")
    console.log(`${LOG_PREFIX} ensureWorktree created`, {
      ticketId: ticket.id,
      path: worktreeInfo.path,
      branch: worktreeInfo.branch,
    });
    const updated = await this.ticketStore.updateTicket(ticket.id, (current) => ({
      ...current,
      worktreePath: worktreeInfo.path,
      worktreeBranch: worktreeInfo.branch,
      artifactRootPath: worktreeInfo.path,
    }));
console.log("ensureWorkTree 5")
    if (!updated) {
      console.log("ERROR WORKTREE")
      throw new Error(`${LOG_PREFIX} Ticket ${ticket.id} not found for worktree update.`);
    }
console.log("ensureWorkTree 6")
    // Log event for audit trail.
    await this.eventLogger.logEvent({
      ticketId: updated.id,
      eventType: "worktree_created",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Worktree created for ticket.",
      payload: {
        worktreePath: worktreeInfo.path,
        worktreeBranch: worktreeInfo.branch,
      },
    });
console.log("ensureWorkTree 7")
    return updated;
  }

  // Apply escalation rules based on ticket + turn history.
  private async applyEscalationPolicy(
    ticket: EngineeringTicket,
  ): Promise<void> {
    console.log(`${LOG_PREFIX} applyEscalationPolicy`, {
      ticketId: ticket.id,
      status: ticket.status,
    });
    const byTicket = assessEscalationFromTicket(ticket);
    if (byTicket.shouldEscalate && byTicket.reason) {
      console.log(`${LOG_PREFIX} applyEscalationPolicy ticket-level escalation`, {
        ticketId: ticket.id,
        reason: byTicket.reason,
      });
      await this.escalate(ticket, byTicket.reason);
      return;
    }

    const turns = await this.ticketStore.listTurns(ticket.id, 200);
    const byTurns = assessEscalationFromTurns(ticket, turns, this.runtimeBounds);
    if (byTurns.shouldEscalate && byTurns.reason) {
      console.log(`${LOG_PREFIX} applyEscalationPolicy turn-level escalation`, {
        ticketId: ticket.id,
        reason: byTurns.reason,
      });
      await this.escalate(ticket, byTurns.reason);
    }
  }

  // Escalate a ticket to human review and log the reason.
  private async escalate(ticket: EngineeringTicket, reason: string): Promise<void> {
    console.log(`${LOG_PREFIX} escalate`, { ticketId: ticket.id, reason });
    logEscalation(ticket.id, reason);
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "escalated_to_human",
      actorType: "system",
      actorName: "orchestrator",
      summary: reason,
      payload: {
        status: ticket.status,
        currentCycle: ticket.currentCycle,
        maxCycles: ticket.maxCycles,
      },
    });

    await this.transitionTicket(ticket, "escalated_human", {
      summary: reason,
      actorType: "system",
      actorName: "orchestrator",
    });
  }

  // Infer the next status after a successful agent turn and transition if allowed.
  // Uses the agent's nextStateHint when provided; otherwise falls back to a
  // deterministic mapping from (agent, purpose) → next status.
  private async autoAdvanceAfterTurn(
    ticket: EngineeringTicket,
    agent: "kera" | "opey" | "claudy",
    purpose: string,
    nextStateHint?: string,
    verdict?: string,
    needsHuman?: boolean,
  ): Promise<void> {
    // If the agent explicitly says it needs a human, try to escalate.
    console.log(`${LOG_PREFIX} autoAdvanceAfterTurn`, {
      ticketId: ticket.id,
      agent,
      purpose,
      nextStateHint: nextStateHint ?? null,
      verdict: verdict ?? null,
      needsHuman: Boolean(needsHuman),
      status: ticket.status,
    });
    if (needsHuman) {
      const escalated = this.tryAutoTransition(ticket, "escalated_human", {
        summary: `Auto-escalated after ${agent} ${purpose} turn (needsHuman).`,
      });
      if (escalated) {
        await escalated;
        return;
      }
    }

    // If the QA verdict indicates a block or human needed, escalate when possible.
    if (verdict === "blocked" || verdict === "needs_human") {
      const escalated = this.tryAutoTransition(ticket, "escalated_human", {
        summary: `Auto-escalated after ${agent} ${purpose} turn (verdict=${verdict}).`,
      });
      if (escalated) {
        await escalated;
        return;
      }
    }

    // If the agent explicitly suggested a next state, try that first.
    if (nextStateHint) {
      try {
        const hintStatus = assertValidStatus(nextStateHint);
        if (isAllowedTransition(ticket.status, hintStatus)) {
          await this.transitionTicket(ticket, hintStatus, {
            summary: `Auto-advanced via ${agent} nextStateHint after ${purpose} turn.`,
            actorType: "system",
            actorName: "orchestrator",
          });
          return;
        }
      } catch {
        // Invalid hint — fall through to deterministic mapping.
      }
    }

    // Deterministic fallback: map (current status, agent, purpose, verdict) → next status.
    const nextStatus = this.inferNextStatus(ticket.status, agent, purpose, verdict);
    if (nextStatus) {
      const transitioned = this.tryAutoTransition(ticket, nextStatus, {
        summary: `Auto-advanced after ${agent} ${purpose} turn.`,
      });
      if (transitioned) {
        await transitioned;
      }
    }
  }

  // Deterministic mapping: given where we are and what just happened, where should we go?
  private inferNextStatus(
    currentStatus: EngineeringTicketStatus,
    agent: "kera" | "opey" | "claudy",
    purpose: string,
    verdict?: string,
  ): EngineeringTicketStatus | null {
    // Kera can request clarification.
    if (agent === "kera" && purpose === "intake" && currentStatus === "intake_acknowledged") {
      if (verdict === "needs_human") {
        return "needs_clarification";
      }
    }

    // Kera intake/planning → requirements_ready
    if (agent === "kera" && purpose === "intake" && currentStatus === "intake_acknowledged") {
      return "requirements_ready";
    }

    // Opey planning → implementing
    if (agent === "opey" && purpose === "planning" && currentStatus === "requirements_ready") {
      return "planning";
    }
    if (agent === "opey" && purpose === "planning" && currentStatus === "planning") {
      return "implementing";
    }

    // Opey implementation → ready_for_qa
    if (agent === "opey" && purpose === "implementation" && currentStatus === "implementing") {
      return "ready_for_qa";
    }

    // Opey rework (after QA changes requested) → ready_for_qa
    if (agent === "opey" && purpose === "rework" && currentStatus === "implementing") {
      return "ready_for_qa";
    }

    // Claudy review: ready_for_qa → qa_testing (QA has started reviewing)
    if (agent === "claudy" && purpose === "review" && currentStatus === "ready_for_qa") {
      if (verdict === "approved") {
        return "qa_approved";
      }
      if (verdict === "changes_requested") {
        return "qa_changes_requested";
      }
      return "qa_testing";
    }

    // Claudy review with verdict: qa_testing → qa_approved or qa_changes_requested
    if (agent === "claudy" && purpose === "review" && currentStatus === "qa_testing") {
      if (verdict === "approved") {
        return "qa_approved";
      }
      if (verdict === "changes_requested") {
        return "qa_changes_requested";
      }
    }

    // Claudy rework verdict: if Claudy re-reviews after rework
    if (agent === "claudy" && purpose === "rework" && currentStatus === "qa_testing") {
      if (verdict === "approved") {
        return "qa_approved";
      }
      if (verdict === "changes_requested") {
        return "qa_changes_requested";
      }
    }

    // No deterministic mapping found — don't auto-advance.
    return null;
  }

  private async handleTurnFailure(
    ticket: EngineeringTicket,
    agent: "kera" | "opey" | "claudy",
    purpose: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : "Unknown agent turn error.";

    console.log(`${LOG_PREFIX} handleTurnFailure`, {
      ticketId: ticket.id,
      agent,
      purpose,
      error: message,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "agent_turn_failed",
      actorType: "system",
      actorName: "orchestrator",
      summary: `Turn failed for ${agent} (${purpose}).`,
      payload: {
        agent,
        purpose,
        error: message,
      },
    });

    const transitioned = this.tryAutoTransition(ticket, "escalated_human", {
      summary: `Auto-escalated after ${agent} ${purpose} failure: ${message}`,
    });
    if (transitioned) {
      await transitioned;
    }
  }

  private async preparePullRequest(ticket: EngineeringTicket): Promise<void> {
    console.log(`${LOG_PREFIX} preparePullRequest start`, {
      ticketId: ticket.id,
      hasPrUrl: Boolean(ticket.finalPrUrl),
    });
    if (ticket.finalPrUrl) {
      return;
    }

    if (!this.runStore) {
      throw new Error(`${LOG_PREFIX} Run store not configured for PR creation.`);
    }

    if (!ticket.worktreePath || !ticket.worktreeBranch) {
      throw new Error(`${LOG_PREFIX} Missing worktree path/branch for PR creation.`);
    }

    console.log(`${LOG_PREFIX} preparePullRequest commit`, {
      ticketId: ticket.id,
      branch: ticket.worktreeBranch,
    });
    const commitMessage = `fix: ${ticket.title || ticket.requestSummary || ticket.id}`;
    await this.executeWorkspaceAction(ticket.worktreePath, "commit", {
      message: commitMessage,
      addAll: true,
    });

    console.log(`${LOG_PREFIX} preparePullRequest push`, {
      ticketId: ticket.id,
      branch: ticket.worktreeBranch,
    });
    await this.executeWorkspaceAction(ticket.worktreePath, "push", {
      remote: "origin",
      branch: ticket.worktreeBranch,
    });

    console.log(`${LOG_PREFIX} preparePullRequest github`, {
      ticketId: ticket.id,
      branch: ticket.worktreeBranch,
    });
    const token = resolveGitHubToken();
    const repo = resolveGitHubRepo();
    const baseBranch = await fetchDefaultBranch(token, repo);
    const prEvidence = await this.buildPrBodyEvidence(ticket);
    const prBody = await buildPrBodyFromTemplate(ticket, undefined, prEvidence);
    const prTitle = `Fix: ${ticket.title || ticket.requestSummary || ticket.id}`;
    const pr = await createGitHubPullRequest({
      token,
      repo,
      title: prTitle,
      head: ticket.worktreeBranch,
      base: baseBranch,
      body: prBody,
    });

    const updated = await this.ticketStore.updateTicket(ticket.id, (current) => ({
      ...current,
      finalPrUrl: pr.htmlUrl,
      prCreatedAt: new Date().toISOString(),
    }));

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "pr_created",
      actorType: "system",
      actorName: "orchestrator",
      summary: "PR created on GitHub.",
      payload: {
        prUrl: pr.htmlUrl,
        branch: ticket.worktreeBranch,
      },
    });

    const ticketForTransition = updated ?? ticket;
    await this.transitionTicket(ticketForTransition, "pr_ready", {
      summary: "PR created; ready for review.",
      actorType: "system",
      actorName: "orchestrator",
    });
  }

  private async handlePrFailure(ticket: EngineeringTicket, error: unknown): Promise<void> {
    const message =
      error instanceof Error ? error.message : "Unknown PR creation error.";

    console.log(`${LOG_PREFIX} handlePrFailure`, {
      ticketId: ticket.id,
      error: message,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "pr_creation_failed",
      actorType: "system",
      actorName: "orchestrator",
      summary: "PR creation failed.",
      payload: {
        error: message,
      },
    });

    const transitioned = this.tryAutoTransition(ticket, "escalated_human", {
      summary: `Auto-escalated after PR creation failure: ${message}`,
    });
    if (transitioned) {
      await transitioned;
    }
  }

  private async buildPrBodyEvidence(ticket: EngineeringTicket): Promise<PrBodyEvidence> {
    if (!ticket.worktreePath) {
      return {};
    }

    const artifacts = await this.ticketStore.listArtifacts(ticket.id, 500);
    const latestPatchArtifacts = this.getLatestPatchArtifacts(artifacts);

    let diffStatText = "";
    let changedFiles: string[] = [];
    if (latestPatchArtifacts.diffStatPath) {
      diffStatText = await this.safeReadWorktreeFile(
        ticket.worktreePath,
        latestPatchArtifacts.diffStatPath,
      );
    }
    if (latestPatchArtifacts.summaryPath) {
      const summaryRaw = await this.safeReadWorktreeFile(
        ticket.worktreePath,
        latestPatchArtifacts.summaryPath,
      );
      try {
        const parsed = JSON.parse(summaryRaw) as { changedFiles?: unknown };
        if (Array.isArray(parsed.changedFiles)) {
          changedFiles = parsed.changedFiles
            .filter((file): file is string => typeof file === "string" && file.trim().length > 0)
            .slice(0, 50);
        }
      } catch {
        // Ignore malformed summary JSON; PR creation should still proceed.
      }
    }

    const workspaceRunSummaries = await this.collectWorkspaceRunSummariesForPr(artifacts);

    return {
      patchArtifacts: latestPatchArtifacts,
      changedFiles,
      diffStatText,
      workspaceRunSummaries,
    };
  }

  private getLatestPatchArtifacts(artifacts: Awaited<ReturnType<EngineeringTicketStore["listArtifacts"]>>): {
    summaryPath?: string | null;
    statusPath?: string | null;
    diffStatPath?: string | null;
    diffPath?: string | null;
  } {
    const patchArtifacts = artifacts
      .filter((artifact) => artifact.artifactType.startsWith("patch_"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const pickLatestPath = (artifactType: string): string | null => {
      const match = patchArtifacts.find((artifact) => artifact.artifactType === artifactType);
      return match?.path ?? null;
    };

    return {
      summaryPath: pickLatestPath("patch_summary"),
      statusPath: pickLatestPath("patch_status"),
      diffStatPath: pickLatestPath("patch_diffstat"),
      diffPath: pickLatestPath("patch_diff"),
    };
  }

  private async collectWorkspaceRunSummariesForPr(
    artifacts: Awaited<ReturnType<EngineeringTicketStore["listArtifacts"]>>,
  ): Promise<PrBodyEvidence["workspaceRunSummaries"]> {
    if (!this.runStore) {
      return [];
    }

    const runArtifacts = artifacts
      .filter((artifact) => artifact.artifactType === "workspace_run" && Boolean(artifact.workspaceRunId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);

    const runs = (
      await Promise.all(
        runArtifacts.map(async (artifact) => {
          if (!artifact.workspaceRunId) {
            return null;
          }
          const run = await this.runStore.getRun(artifact.workspaceRunId);
          if (!run) {
            return null;
          }
          return {
            runId: run.id,
            action: String(run.request.action || ""),
            status: run.status,
            summary: String(run.summary || ""),
          };
        }),
      )
    ).filter((run): run is NonNullable<typeof run> => Boolean(run));

    // Prefer command runs in the PR body evidence, but include other recent runs if needed.
    const commandRuns = runs.filter((run) => run.action === "command");
    const selectedRuns = (commandRuns.length > 0 ? commandRuns : runs).slice(0, 10);
    return selectedRuns;
  }

  private async safeReadWorktreeFile(worktreePath: string, relativePath: string): Promise<string> {
    try {
      const filePath = path.join(worktreePath, ...relativePath.split("/"));
      return await fs.readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  private async executeWorkspaceAction(
    workspaceRoot: string,
    action: "commit" | "push",
    args: Record<string, unknown>,
  ): Promise<WorkspaceRun> {
    if (!this.runStore) {
      throw new Error(`${LOG_PREFIX} Run store not configured.`);
    }

    console.log(`${LOG_PREFIX} executeWorkspaceAction`, {
      action,
      workspaceRoot,
    });
    const run = await this.runStore.createRun(
      {
        action,
        args,
      },
      workspaceRoot,
    );

    await executeRunInBackground({
      runStore: this.runStore,
      runId: run.id,
      workspaceRoot,
      fullAuto: true,
    });

    const updatedRun = await this.runStore.getRun(run.id);
    if (!updatedRun) {
      throw new Error(`${LOG_PREFIX} Missing run record after ${action}.`);
    }

    if (updatedRun.status !== "success") {
      throw new Error(
        `${LOG_PREFIX} Workspace action failed: ${action} (${updatedRun.status}).`,
      );
    }

    return updatedRun;
  }

  private tryAutoTransition(
    ticket: EngineeringTicket,
    nextStatus: EngineeringTicketStatus,
    context: { summary: string },
  ): Promise<EngineeringTicket> | null {
    if (!isAllowedTransition(ticket.status, nextStatus)) {
      return null;
    }

    return this.transitionTicket(ticket, nextStatus, {
      summary: context.summary,
      actorType: "system",
      actorName: "orchestrator",
    });
  }

  private async ensureInitialScaffoldArtifacts(
    ticket: EngineeringTicket,
  ): Promise<EngineeringTicket> {
    const artifacts = await this.ticketStore.listArtifacts(ticket.id, 200);
    const expectedArtifactTypes = getInitialScaffoldArtifactTypes(ticket.requestType);
    const hasScaffoldArtifacts = artifacts.some((artifact) =>
      expectedArtifactTypes.includes(artifact.artifactType),
    );

    if (hasScaffoldArtifacts) {
      console.log(`${LOG_PREFIX} ensureInitialScaffoldArtifacts skip (already exists)`, {
        ticketId: ticket.id,
        requestType: ticket.requestType,
        artifactCount: artifacts.length,
      });
      return ticket;
    }

    console.log(`${LOG_PREFIX} ensureInitialScaffoldArtifacts scaffold`, {
      ticketId: ticket.id,
      requestType: ticket.requestType,
    });
    return this.scaffoldArtifacts(ticket.id);
  }

  // Recovery path: if a ticket is already QA-ready when processNextStep runs,
  // auto-trigger Claudy review. The primary Claudy handoff still happens when
  // workspace runs settle.
  private async autoTriggerClaudyIfReady(ticket: EngineeringTicket): Promise<void> {
    if (ticket.status !== "ready_for_qa") {
      return;
    }

    if (!this.claudyAgent) {
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (Claudy not configured)`, {
        ticketId: ticket.id,
        status: ticket.status,
      });
      return;
    }

    const turns = await this.ticketStore.listTurns(ticket.id, 200);
    const cycleTurns = turns.filter((turn) => turn.cycleNumber === ticket.currentCycle);
    const latestOpeyTurn = [...cycleTurns]
      .reverse()
      .find(
        (turn) =>
          turn.agentRole === "opey" &&
          (turn.purpose === "implementation" || turn.purpose === "rework"),
      );

    if (!latestOpeyTurn) {
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (no Opey implementation/rework turn in current cycle)`, {
        ticketId: ticket.id,
        cycle: ticket.currentCycle,
      });
      return;
    }

    const existingClaudyReview = [...cycleTurns]
      .reverse()
      .find(
        (turn) =>
          turn.agentRole === "claudy" &&
          turn.purpose === "review" &&
          new Date(turn.createdAt).getTime() >= new Date(latestOpeyTurn.createdAt).getTime(),
      );
    if (existingClaudyReview) {
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (Claudy already reviewed latest Opey turn)`, {
        ticketId: ticket.id,
        cycle: ticket.currentCycle,
        latestOpeyTurnId: latestOpeyTurn.id,
        claudyTurnId: existingClaudyReview.id,
      });
      return;
    }
console.log("5 Calling ensureWorktree")
    const ticketWithWorktree = await this.ensureWorktree(ticket);
    if (!ticketWithWorktree.worktreePath) {
      const details = {
        ticketId: ticket.id,
        status: ticket.status,
        cycle: ticket.currentCycle,
      };
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (missing worktree path)`, details);
      runtimeLog.error(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (missing worktree path)`, details);
      return;
    }

    const patchCheckpoint = await collectPatchCheckpoint({
      ticketId: ticketWithWorktree.id,
      worktreePath: ticketWithWorktree.worktreePath,
    });
    await this.logPatchCheckpointArtifacts(ticketWithWorktree.id, patchCheckpoint);

    if (!patchCheckpoint.ok) {
      const details = {
        ticketId: ticket.id,
        status: ticket.status,
        errors: patchCheckpoint.errors,
      };
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (patch checkpoint failed)`, details);
      runtimeLog.error(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (patch checkpoint failed)`, details);
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "patch_checkpoint_failed",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Patch checkpoint failed in processNextStep Claudy recovery path; QA handoff blocked.",
        payload: {
          ...details,
          trigger: "processNextStep",
        },
      });
      return;
    }

    if (!patchCheckpoint.hasChanges) {
      const details = {
        ticketId: ticket.id,
        status: ticket.status,
        hasAnyChanges: patchCheckpoint.hasAnyChanges,
        allChangedFiles: patchCheckpoint.allChangedFiles,
        ignoredArtifactPaths: patchCheckpoint.ignoredArtifactPaths,
      };
      console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (no meaningful code changes)`, details);
      runtimeLog.warning(`${LOG_PREFIX} autoTriggerClaudyIfReady skip (no meaningful code changes)`, details);
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "empty_patch_blocked",
        actorType: "system",
        actorName: "orchestrator",
        summary: "Claudy recovery auto-trigger skipped because no meaningful code changes were detected.",
        payload: {
          ...details,
          trigger: "processNextStep",
          patchArtifacts: patchCheckpoint.artifacts ?? null,
        },
      });
      return;
    }

    console.log(`${LOG_PREFIX} autoTriggerClaudyIfReady auto-trigger Claudy execution review`, {
      ticketId: ticket.id,
      status: ticket.status,
      cycle: ticket.currentCycle,
      latestOpeyTurnId: latestOpeyTurn.id,
      changedFiles: patchCheckpoint.changedFiles.length,
    });
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "qa_review_auto_triggered",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Claudy auto-triggered from processNextStep QA-ready recovery path.",
      payload: {
        trigger: "processNextStep",
        latestOpeyTurnId: latestOpeyTurn.id,
        changedFiles: patchCheckpoint.changedFiles,
        patchArtifacts: patchCheckpoint.artifacts ?? null,
      },
    });

    await this.requestClaudyExecutionTurn(ticketWithWorktree.id, patchCheckpoint);
  }

  // Auto-trigger Opey planning when requirements are ready and no plan exists yet.
  // Skip planning entirely - go straight to execution-mode implementation.
  private async autoTriggerOpeyIfReady(ticket: EngineeringTicket): Promise<void> {
    if (ticket.status !== "requirements_ready") {
      return;
    }

    if (!this.opeyAgent) {
      return;
    }

    if (!ticket.worktreePath) {
      console.log(`${LOG_PREFIX} skipping Opey auto-trigger; missing worktreePath`, {
        ticketId: ticket.id,
      });
      return;
    }

    // Guard against duplicate triggers.
    const turns = await this.ticketStore.listTurns(ticket.id, 200);
    const alreadyStarted = turns.some(
      (turn) => turn.agentRole === "opey" &&
        (turn.purpose === "implementation" || turn.purpose === "planning"),
    );
    if (alreadyStarted) {
      return;
    }

    // Transition requirements_ready → implementing (skip planning).
    const implementing = this.tryAutoTransition(ticket, "implementing", {
      summary: "Skipping planning; auto-triggering execution-mode implementation.",
    });
    let current = ticket;
    if (implementing) {
      current = await implementing;
    }

    if (current.status !== "implementing") {
      console.log(`${LOG_PREFIX} autoTriggerOpeyIfReady skip (could not transition to implementing)`, {
        ticketId: current.id,
        status: current.status,
      });
      return;
    }

    const artifacts = await this.ticketStore.listArtifacts(current.id, 200);
    const bugArtifactPath = artifacts.find((a) => a.artifactType === "bug_md")?.path ?? null;
    const artifactList = artifacts.length
      ? artifacts.map((a) => `${a.artifactType}: ${a.path}`).join("; ")
      : "none";

    const prompt = [
      `Request type: ${current.requestType}`,
      `Title: ${current.title}`,
      `Summary: ${current.requestSummary}`,
      `Details: ${current.additionalDetails || "(none)"}`,
      `Bug artifact: ${bugArtifactPath ?? "(none)"}`,
      `Artifacts: ${artifactList}`,
      "",
      "Find the relevant files, make the fix, and run a quick validation if applicable.",
    ].join("\n");

    console.log(`${LOG_PREFIX} auto-triggering Opey execution-mode implementation`, {
      ticketId: current.id,
      artifactCount: artifacts.length,
    });

    await this.requestOpeyTurn(current.id, "implementation", prompt);
  }
}

// Adds a short autonomy prefix so Opey knows it can act without approval.
function buildOpeyAutonomyPrompt(prompt: string): string {
  return [
    "Autonomy mode: do NOT ask for approval. You are authorized to read/write/execute within the ticket worktree.",
    "If required details are missing, make best reasonable assumptions and proceed; note assumptions in the summary.",
    "",
    prompt,
  ].join("\n");
}

function getInitialScaffoldArtifactTypes(
  requestType: EngineeringTicket["requestType"],
): string[] {
  if (requestType === "skill") {
    return ["skill_folder", "skill_md"];
  }
  if (requestType === "feature") {
    return ["feature_folder", "feature_md"];
  }
  return ["bug_folder", "bug_md"];
}

function getRequestedActionsFromTurn(
  metadata: Record<string, unknown>,
): Array<{ action: string; args: Record<string, unknown> }> {
  const raw = metadata.requestedActions;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const action = (item as { action?: unknown }).action;
      const args = (item as { args?: unknown }).args;
      return {
        action: typeof action === "string" ? action : "unknown",
        args:
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {},
      };
    })
    .filter(
      (
        item,
      ): item is {
        action: string;
        args: Record<string, unknown>;
      } => Boolean(item),
    );
}

function buildClaudyAutoReviewPrompt(options: {
  ticket: EngineeringTicket;
  latestOpeyTurnSummary: string;
  deferredActions: Array<{ action: string; reason: string }>;
  workspaceRunSummaries: Array<{
    runId: string;
    action: string;
    status: string;
    summary: string;
    path: string;
    stepEvidencePreview: string;
  }>;
  bugArtifactPath: string | null;
  patchCheckpoint: {
    changedFiles: string[];
    diffStatText: string;
    diffTruncated: boolean;
    artifactPaths: {
      bundleDir: string;
      summaryPath: string;
      statusPath: string;
      diffStatPath: string;
      diffPath: string;
    } | null;
  };
}): string {
  const workspaceRunSummaryText = options.workspaceRunSummaries.length
    ? options.workspaceRunSummaries
        .map(
          (run) =>
            `- ${run.runId} | action=${run.action} | status=${run.status} | path=${run.path || "(none)"} | summary=${run.summary}${run.stepEvidencePreview ? ` | evidence=${run.stepEvidencePreview}` : ""}`,
        )
        .join("\n")
    : "- No workspace runs recorded for this Opey turn.";

  const deferredActionsText = options.deferredActions.length
    ? options.deferredActions
        .map((action) => `- ${action.action}: ${action.reason}`)
        .join("\n")
    : "- None";

  const patchArtifactsText = options.patchCheckpoint.artifactPaths
    ? [
        `- Bundle: ${options.patchCheckpoint.artifactPaths.bundleDir}`,
        `- Summary: ${options.patchCheckpoint.artifactPaths.summaryPath}`,
        `- Status: ${options.patchCheckpoint.artifactPaths.statusPath}`,
        `- DiffStat: ${options.patchCheckpoint.artifactPaths.diffStatPath}`,
        `- Diff: ${options.patchCheckpoint.artifactPaths.diffPath}`,
      ].join("\n")
    : "- (not recorded)";
  const changedFilesText = options.patchCheckpoint.changedFiles.length
    ? options.patchCheckpoint.changedFiles.map((file) => `- ${file}`).join("\n")
    : "- None";
  const diffStatPreview = options.patchCheckpoint.diffStatText.trim()
    ? options.patchCheckpoint.diffStatText.slice(0, 1500)
    : "(empty)";

  return [
    "You are Claudy, the QA reviewer.",
    "Review whether Opey's changes appear to fix the reported bug using the ticket, BUG.md, patch checkpoint artifacts, git diff, and workspace run results.",
    "IMPORTANT: If Opey requested `manualVerify`, that is your review responsibility (LLM QA judgment), not a workspace executor command.",
    "Work inside the ticket worktree to inspect files and diffs as needed.",
    "Use `git diff`, inspect the bug artifact and patch checkpoint artifacts, and check whether the typo/fix is resolved based on code changes and evidence.",
    "If evidence is insufficient, return `changes_requested` or `needs_human` with a specific reason.",
    "",
    `Ticket ID: ${options.ticket.id}`,
    `Request Type: ${options.ticket.requestType}`,
    `Title: ${options.ticket.title}`,
    `Summary: ${options.ticket.requestSummary}`,
    `Additional Details: ${options.ticket.additionalDetails || "(none)"}`,
    `Bug Artifact: ${options.bugArtifactPath ?? "(not found)"}`,
    "",
    "Deferred QA Actions:",
    deferredActionsText,
    "",
    "Patch Checkpoint Artifacts:",
    patchArtifactsText,
    "",
    "Patch Changed Files:",
    changedFilesText,
    "",
    `Patch DiffStat (truncated=${options.patchCheckpoint.diffTruncated ? "yes" : "no"}):`,
    diffStatPreview,
    "",
    "Latest Opey Turn (response excerpt):",
    options.latestOpeyTurnSummary.slice(0, 1500),
    "",
    "Workspace Run Results:",
    workspaceRunSummaryText,
    "",
    "Return ONLY a valid JSON object matching the required schema.",
    "Prefer verdict `approved` only if the bug fix appears correct and no obvious regressions/issues are present in the available evidence.",
  ].join("\n");
}

function buildOpeyImplementationPrompt(options: {
  ticket: EngineeringTicket;
  latestOpeyPlanExcerpt: string;
  deferredActions: Array<{ action: string; reason: string }>;
  workspaceRunSummaries: Array<{
    runId: string;
    action: string;
    status: string;
    summary: string;
    path: string;
  }>;
  bugArtifactPath: string | null;
}): string {
  const workspaceRunSummaryText = options.workspaceRunSummaries.length
    ? options.workspaceRunSummaries
        .slice(0, 6)
        .map((run) => {
          const summary = truncatePromptText(run.summary, 180);
          const pathText = truncatePromptText(run.path || "(none)", 120);
          return `- ${run.runId} | action=${run.action} | status=${run.status} | path=${pathText} | summary=${summary}`;
        })
        .join("\n")
    : "- No planning workspace runs were executed.";

  const deferredActionsText = options.deferredActions.length
    ? options.deferredActions
        .slice(0, 8)
        .map((action) => `- ${action.action}: ${truncatePromptText(action.reason, 220)}`)
        .join("\n")
    : "- None";

  const title = truncatePromptText(options.ticket.title, 200);
  const summary = truncatePromptText(options.ticket.requestSummary, 400);
  const additionalDetails = truncatePromptText(options.ticket.additionalDetails || "(none)", 400);
  const previousPlanExcerpt = truncatePromptText(options.latestOpeyPlanExcerpt, 900);

  return [
    "You are Opey. Produce an implementation turn for this ticket.",
    "Planning/discovery has already run. Now emit CONCRETE executor actions only.",
    "Allowed requestedActions action names in this implementation turn:",
    '- "read", "search", "write", "command", "status"',
    "Do NOT emit semantic placeholders like `applyFix`, `inspectUITextSources`, `locateRenderSource`, `fixTypo`, `verifyUI`, or `manualVerify`.",
    "For file edits, use `write` with explicit `path` and full `content` (or append when appropriate).",
    "For checks, use `command` with allowlisted npm scripts only (e.g., `npm test -- --run`, `npm run build`, `npm run lint`).",
    "Unless you return `needsHuman: true` or `verdict: \"blocked\"`, include at least one concrete `write` action to a non-artifact source file.",
    "Do NOT return read/search/status-only actions for implementation.",
    "Claudy will perform the QA review/verification step after workspace runs settle.",
    "",
    `Ticket ID: ${options.ticket.id}`,
    `Request Type: ${options.ticket.requestType}`,
    `Title: ${title}`,
    `Summary: ${summary}`,
    `Additional Details: ${additionalDetails}`,
    `Bug Artifact: ${options.bugArtifactPath ?? "(not found)"}`,
    "",
    "Previous Opey Plan (response excerpt):",
    previousPlanExcerpt,
    "",
    "Planning Workspace Run Results:",
    workspaceRunSummaryText,
    "",
    "Deferred Planning Actions (not executable as-is):",
    deferredActionsText,
    "",
    "Goal: make the minimal code change that fixes the reported issue at the source of truth, then run the smallest relevant validation command(s).",
    "Return ONLY a valid JSON object matching the required schema.",
  ].join("\n");
}

function buildOpeyEmptyPatchReworkPrompt(options: {
  ticket: EngineeringTicket;
  latestOpeyTurnSummary: string;
  workspaceRunSummaries: Array<{
    runId: string;
    action: string;
    status: string;
    summary: string;
    path: string;
  }>;
  bugArtifactPath: string | null;
  patchCheckpoint: Pick<
    PatchCheckpointResult,
    "hasAnyChanges" | "hasChanges" | "allChangedFiles" | "changedFiles" | "ignoredArtifactPaths" | "diffStatText"
  >;
  attemptNumber: number;
  maxDevAttempts: number;
}): string {
  const workspaceRunSummaryText = options.workspaceRunSummaries.length
    ? options.workspaceRunSummaries
        .slice(0, 8)
        .map((run) => {
          const summary = truncatePromptText(run.summary, 180);
          const pathText = truncatePromptText(run.path || "(none)", 120);
          return `- ${run.runId} | action=${run.action} | status=${run.status} | path=${pathText} | summary=${summary}`;
        })
        .join("\n")
    : "- No workspace runs were recorded.";

  const allChangedFilesText = options.patchCheckpoint.allChangedFiles.length
    ? options.patchCheckpoint.allChangedFiles.map((file) => `- ${file}`).join("\n")
    : "- None";
  const ignoredPathsText = options.patchCheckpoint.ignoredArtifactPaths.length
    ? options.patchCheckpoint.ignoredArtifactPaths.map((file) => `- ${file}`).join("\n")
    : "- None";
  const diffStatPreview = truncatePromptText(options.patchCheckpoint.diffStatText || "(empty)", 800);

  return [
    "You are Opey. Produce a REWORK turn for this ticket.",
    "The previous implementation/rework turn did not produce any meaningful source-code changes.",
    "Patch checkpoint result after your last execution:",
    `- hasAnyChanges=${options.patchCheckpoint.hasAnyChanges}`,
    `- hasMeaningfulChanges=${options.patchCheckpoint.hasChanges}`,
    `- Attempt ${options.attemptNumber} of ${options.maxDevAttempts}`,
    "",
    "Important constraints:",
    '- Allowed requestedActions action names: "read", "search", "write", "command", "status"',
    "- If you cannot safely identify the source file and exact edit, return `needsHuman: true` or `verdict: \"blocked\"` with a specific reason.",
    "- Otherwise, include at least one concrete `write` action to a non-artifact source file.",
    "- Do NOT return read/search/status-only actions.",
    "- Do NOT write to `bugs/` or `patches/`; those are workflow artifacts.",
    "",
    `Ticket ID: ${options.ticket.id}`,
    `Request Type: ${options.ticket.requestType}`,
    `Title: ${truncatePromptText(options.ticket.title, 200)}`,
    `Summary: ${truncatePromptText(options.ticket.requestSummary, 400)}`,
    `Additional Details: ${truncatePromptText(options.ticket.additionalDetails || "(none)", 400)}`,
    `Bug Artifact: ${options.bugArtifactPath ?? "(not found)"}`,
    "",
    "Latest Opey implementation/rework turn (response excerpt):",
    truncatePromptText(options.latestOpeyTurnSummary, 1200),
    "",
    "Latest Workspace Run Results:",
    workspaceRunSummaryText,
    "",
    "Patch Checkpoint All Changed Files:",
    allChangedFilesText,
    "",
    "Patch Checkpoint Ignored Artifact Paths:",
    ignoredPathsText,
    "",
    "Patch DiffStat (truncated preview):",
    diffStatPreview,
    "",
    "Goal: make the minimal source-code change that fixes the reported issue, then run the smallest relevant validation command(s).",
    "Return ONLY a valid JSON object matching the required schema.",
  ].join("\n");
}

function buildOpeyExecutionPrompt(rawPrompt: string): string {
  return [
    "Autonomy mode: do NOT ask for approval. You are authorized to read/write/execute within the ticket worktree.",
    "Make the changes DIRECTLY. Edit the files yourself. Do NOT return JSON.",
    "Do NOT describe what you would do — actually do it.",
    "Read the relevant files, make the edits, and run any quick validation (e.g., type-check, lint) if applicable.",
    "",
    rawPrompt,
  ].join("\n");
}

function buildClaudyExecutionReviewPrompt(options: {
  ticket: EngineeringTicket;
  patchCheckpoint: PatchCheckpointResult;
}): string {
  const changedFilesText = options.patchCheckpoint.changedFiles.length
    ? options.patchCheckpoint.changedFiles.map((f) => `- ${f}`).join("\n")
    : "- None";
  const diffStatPreview = options.patchCheckpoint.diffStatText.trim()
    ? options.patchCheckpoint.diffStatText.slice(0, 2000)
    : "(empty)";

  return [
    "You are Claudy, the QA reviewer.",
    "Inspect the worktree directly to review whether Opey's changes fix the reported issue.",
    "Use `git diff`, read the changed files, and check whether the fix is correct.",
    "",
    `Ticket ID: ${options.ticket.id}`,
    `Request Type: ${options.ticket.requestType}`,
    `Title: ${options.ticket.title}`,
    `Summary: ${options.ticket.requestSummary}`,
    `Additional Details: ${options.ticket.additionalDetails || "(none)"}`,
    "",
    "Changed Files:",
    changedFilesText,
    "",
    "DiffStat:",
    diffStatPreview,
    "",
    "Instructions:",
    "1. Run `git diff` to see the exact changes.",
    "2. Read any relevant source files to verify correctness.",
    "3. Check for obvious regressions or issues.",
    "4. End your response with exactly one of:",
    "   VERDICT: approved",
    "   VERDICT: changes_requested",
    "   VERDICT: blocked",
    "   VERDICT: needs_human",
    "",
    "Do NOT return JSON. Write your review in natural language, ending with the VERDICT line.",
  ].join("\n");
}

function truncatePromptText(input: string | null | undefined, maxChars: number): string {
  if (!input) {
    return "";
  }
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

const TERMINAL_TICKET_STATUSES: ReadonlySet<EngineeringTicketStatus> = new Set([
  "qa_approved",
  "pr_preparing",
  "pr_ready",
  "completed",
  "failed",
  "escalated_human",
  "cancelled",
]);

const TERMINAL_WORKSPACE_RUN_STATUSES = new Set([
  "success",
  "failed",
  "verification_failed",
  "rejected",
]);
