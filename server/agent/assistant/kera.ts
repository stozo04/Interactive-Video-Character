import { MultiAgentEventLogger } from "../multiAgent/eventLogger";
import { CodexCliRunner } from "../multiAgent/codexCliRunner";
import { runTurnWithRepair } from "../multiAgent/agentCliRunner";
import type {
  AgentTurnEnvelope,
  AgentTurnPurpose,
} from "../multiAgent/agentTurnSchemas";
import {
  REQUEST_TYPES,
  type EngineeringRequestType,
  type EngineeringTicket,
  type EngineeringTicketStore,
} from "../multiAgent/types";
import { MultiAgentOrchestrator } from "../multiAgent/orchestrator";
import { log } from "../multiAgent/runtimeLogger";

const LOG_PREFIX = "[KeraCoordinator]";
const runtimeLog = log.fromContext({ source: "kera" });

// Incoming intake request fields (mostly optional; we normalize them).
export interface KeraIntakeRequest {
  requestType?: string;
  title?: string;
  requestSummary?: string;
  additionalDetails?: string;
  source?: string;
  priority?: string;
  isUiRelated?: boolean;
  createdBy?: string;
}

// Result returned after creating a ticket from intake.
export interface KeraIntakeResult {
  ticket: EngineeringTicket;
  message: string;
  needsClarification: boolean;
}

// Options for a Kera turn (LLM-generated status/intake update).
export interface KeraTurnOptions {
  purpose: AgentTurnPurpose;
  prompt: string;
}

// Result of a Kera turn (parsed envelope + raw output).
export interface KeraTurnResult {
  envelope: AgentTurnEnvelope;
  raw: {
    stdout: string;
    stderr: string;
  };
}

// KeraCoordinator owns intake normalization + ticket creation.
export class KeraCoordinator {
  private readonly ticketStore: EngineeringTicketStore;
  private orchestrator: MultiAgentOrchestrator | null;
  private readonly eventLogger: MultiAgentEventLogger;
  private readonly runner: CodexCliRunner;

  public constructor(
    ticketStore: EngineeringTicketStore,
    orchestrator?: MultiAgentOrchestrator,
    eventLogger?: MultiAgentEventLogger,
    runner?: CodexCliRunner,
  ) {
    // Store dependencies; orchestrator can be injected later.
    this.ticketStore = ticketStore;
    this.orchestrator = orchestrator ?? null;
    this.eventLogger = eventLogger ?? new MultiAgentEventLogger(ticketStore);
    this.runner = runner ?? new CodexCliRunner();
  }

  // Set orchestrator after construction to resolve circular dependency.
  public setOrchestrator(orchestrator: MultiAgentOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  // Converts raw intake into a normalized ticket and saves it.
  public async createTicketFromIntake(
    intake: KeraIntakeRequest,
  ): Promise<KeraIntakeResult> {
    // Normalize input fields.
    const title = typeof intake.title === "string" ? intake.title.trim() : "";
    const requestSummary =
      typeof intake.requestSummary === "string" ? intake.requestSummary.trim() : "";
    const additionalDetails =
      typeof intake.additionalDetails === "string"
        ? intake.additionalDetails.trim()
        : "";
    const requestType = normalizeRequestType(
      intake.requestType,
      [title, requestSummary, additionalDetails].join(" "),
    );

    // If key fields are missing, we pause and request clarification.
    const needsClarification = !title || !requestSummary;

    // Create the ticket record in the store.
    const ticket = await this.ticketStore.createTicket({
      requestType,
      title,
      requestSummary,
      additionalDetails,
      source: typeof intake.source === "string" ? intake.source : "kayley",
      status: needsClarification ? "needs_clarification" : "created",
      priority: typeof intake.priority === "string" ? intake.priority : "normal",
      isUiRelated: Boolean(intake.isUiRelated),
      createdBy: typeof intake.createdBy === "string" ? intake.createdBy : "kayley",
      assignedDevAgent: undefined,
      assignedQaAgent: undefined,
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      artifactRootPath: undefined,
      worktreePath: undefined,
      worktreeBranch: undefined,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      finalPrUrl: undefined,
      prCreatedAt: undefined,
      failureReason: undefined,
    });

    // Log the creation event for audit trail.
    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "ticket_created",
      actorType: "kera",
      actorName: "kera",
      summary: "Ticket created from intake.",
      payload: {
        requestType: ticket.requestType,
        needsClarification,
      },
    });

    let updatedTicket = ticket;
    if (!needsClarification && this.orchestrator) {
      // Auto-start the ticket if details are sufficient.
      updatedTicket = await this.orchestrator.startTicket(ticket.id);
      try {
        // Continue deterministic orchestration so intake-created tickets do not
        // stall at `intake_acknowledged` when they bypass the created-ticket watcher.
        updatedTicket = await this.orchestrator.processNextStep(ticket.id);
      } catch (error) {
        runtimeLog.warning(`${LOG_PREFIX} post-intake processNextStep failed.`, {
          ticketId: ticket.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (!needsClarification && !this.orchestrator) {
      runtimeLog.warning(`${LOG_PREFIX} orchestrator unavailable; skipping startTicket.`, {
        ticketId: ticket.id,
      });
    }

    if (needsClarification) {
      // Record a clarification event so it is visible in the audit trail.
      await this.eventLogger.logEvent({
        ticketId: ticket.id,
        eventType: "requirements_clarification_requested",
        actorType: "kera",
        actorName: "kera",
        summary: "Missing title or request summary. Clarification requested.",
        payload: {
          missingTitle: !title,
          missingSummary: !requestSummary,
        },
      });
    }

    // Helpful summary log for debugging.
    runtimeLog.info(`${LOG_PREFIX} ticket created`, {
      ticketId: updatedTicket.id,
      requestType: updatedTicket.requestType,
      needsClarification,
      status: updatedTicket.status,
    });

    return {
      ticket: updatedTicket,
      message: buildIntakeMessage(updatedTicket, needsClarification),
      needsClarification,
    };
  }

  // Run a Kera LLM turn (status update, planning note, etc.).
  public async runTurn(
    options: KeraTurnOptions,
  ): Promise<KeraTurnResult> {
    runtimeLog.info(`${LOG_PREFIX} runTurn`, {
      purpose: options.purpose,
    });

    // runTurnWithRepair will retry once if the CLI returns invalid JSON.
    const result = await runTurnWithRepair(
      this.runner,
      options.prompt,
      (invalid) =>
        buildRepairPrompt("kera", invalid.errors, invalid.stdout, invalid.stderr),
      1,
    );
    if (!result.ok || !result.envelope) {
      throw new Error(
        `${LOG_PREFIX} Invalid turn response: ${result.errors.join("; ")}`,
      );
    }

    return {
      envelope: result.envelope,
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }
}

// Build a strict repair prompt when the JSON output is invalid.
function buildRepairPrompt(
  role: string,
  errors: string[],
  stdout: string,
  stderr: string,
): string {
  return [
    `You returned invalid JSON for the ${role} turn.`,
    `Errors: ${errors.join("; ")}`,
    "Return ONLY a valid JSON object matching the required schema.",
    "Do not include markdown or commentary.",
    `Previous stdout (truncated): ${stdout.slice(0, 400)}`,
    `Previous stderr (truncated): ${stderr.slice(0, 200)}`,
  ].join("\n");
}

// Guess a request type if not explicitly provided.
function normalizeRequestType(
  rawType: string | undefined,
  contextText: string,
): EngineeringRequestType {
  if (rawType && REQUEST_TYPES.includes(rawType as EngineeringRequestType)) {
    return rawType as EngineeringRequestType;
  }

  const haystack = contextText.toLowerCase();
  if (haystack.includes("bug") || haystack.includes("error") || haystack.includes("fix")) {
    return "bug";
  }
  if (haystack.includes("skill") || haystack.includes("tool")) {
    return "skill";
  }

  return "feature";
}

// Friendly message to return to the caller after intake.
function buildIntakeMessage(
  ticket: EngineeringTicket,
  needsClarification: boolean,
): string {
  const statusLine = `Ticket ${ticket.id} is now ${ticket.status}.`;
  if (!needsClarification) {
    return `${statusLine} Engineering intake acknowledged.`;
  }

  return `${statusLine} Clarification needed before implementation can begin.`;
}
