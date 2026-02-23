import {
  type AgentTurnEnvelope,
  type AgentTurnPurpose,
  type ExecutionTurnResult,
} from "../multiAgent/agentTurnSchemas";
import { CodexCliRunner } from "../multiAgent/codexCliRunner";
import { runTurnWithRepair, type AgentCliRunner } from "../multiAgent/agentCliRunner";
import type { EngineeringTicket } from "../multiAgent/types";
import { log } from "../multiAgent/runtimeLogger";

const LOG_PREFIX = "[OpeyDeveloperAgent]";
const runtimeLog = log.fromContext({ source: "opey" });
const OPEY_PLANNING_TIMEOUT_MS = 200_000;
const OPEY_IMPLEMENTATION_TIMEOUT_MS = 340_000;
const OPEY_EXECUTION_TIMEOUT_MS = 480_000;

// Options for an Opey turn (purpose + prompt).
export interface OpeyTurnOptions {
  purpose: AgentTurnPurpose;
  prompt: string;
}

// Result of an Opey turn (parsed envelope + raw output).
export interface OpeyTurnResult {
  envelope: AgentTurnEnvelope;
  raw: {
    stdout: string;
    stderr: string;
  };
}

// OpeyDeveloperAgent wraps the Codex CLI for developer turns.
export class OpeyDeveloperAgent {
  private readonly runner: CodexCliRunner;

  public constructor(runner?: CodexCliRunner) {
    this.runner = runner ?? new CodexCliRunner();
  }

  // Execution mode: Codex works directly in the worktree (no JSON envelope).
  public async runExecutionTurn(
    ticket: EngineeringTicket,
    options: OpeyExecutionTurnOptions,
  ): Promise<ExecutionTurnResult> {
    if (!ticket.worktreePath) {
      throw new Error(`${LOG_PREFIX} Missing ticket.worktreePath for Opey execution turn.`);
    }

    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn`, {
      purpose: options.purpose,
      ticketId: ticket.id,
      worktreePath: ticket.worktreePath,
      timeoutMs: OPEY_EXECUTION_TIMEOUT_MS,
    });

    const result = await this.runner.runExecutionTurn(options.prompt, {
      ticketId: ticket.id,
      cwd: ticket.worktreePath,
      dangerouslyBypassApprovalsAndSandbox: true,
      timeoutMs: OPEY_EXECUTION_TIMEOUT_MS,
    });

    if (result.timedOut) {
      throw new Error(`${LOG_PREFIX} Execution turn timed out (${OPEY_EXECUTION_TIMEOUT_MS}ms).`);
    }

    if (!result.ok) {
      throw new Error(
        `${LOG_PREFIX} Execution turn failed: ${result.errors.join("; ")}`,
      );
    }

    // Extract a summary from the first ~500 chars of stdout.
    const summary = result.stdout.trim().slice(0, 500) || "(no output)";

    return {
      summary,
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }

  // Structured mode: Codex returns JSON envelope (used for planning).
  public async runTurn(
    ticket: EngineeringTicket,
    options: OpeyTurnOptions,
  ): Promise<OpeyTurnResult> {
    if (!ticket.worktreePath) {
      throw new Error(`${LOG_PREFIX} Missing ticket.worktreePath for Opey turn.`);
    }

    // Log high-level turn info (purpose only).
    const timeoutMs = getOpeyTurnTimeoutMs(options.purpose);
    runtimeLog.info(`${LOG_PREFIX} runTurn`, {
      purpose: options.purpose,
      ticketId: ticket.id,
      worktreePath: ticket.worktreePath,
      timeoutMs,
    });

    const scopedRunner: AgentCliRunner = {
      runTurn: (prompt) =>
        this.runner.runTurn(prompt, {
          ticketId: ticket.id,
          cwd: ticket.worktreePath,
          // Opey runs in the isolated ticket worktree and must not block on
          // approval prompts during non-interactive `codex exec`.
          dangerouslyBypassApprovalsAndSandbox: true,
          timeoutMs,
        }),
    };

    // runTurnWithRepair retries once if JSON is invalid.
    const result = await runTurnWithRepair(
      scopedRunner,
      options.prompt,
      (invalid) =>
        buildRepairPrompt("opey", invalid.errors, invalid.stdout, invalid.stderr),
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

// Options for an Opey execution turn (implementation/rework, no JSON).
export interface OpeyExecutionTurnOptions {
  purpose: "implementation" | "rework";
  prompt: string;
}

function getOpeyTurnTimeoutMs(purpose: AgentTurnPurpose): number {
  if (purpose === "implementation" || purpose === "rework") {
    return OPEY_IMPLEMENTATION_TIMEOUT_MS;
  }
  return OPEY_PLANNING_TIMEOUT_MS;
}

// Build a strict repair prompt when the CLI output is invalid.
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
