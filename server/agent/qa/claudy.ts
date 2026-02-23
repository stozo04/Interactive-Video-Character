import {
  type AgentTurnEnvelope,
  type AgentTurnPurpose,
  type ExecutionTurnResult,
  parseVerdictFromText,
} from "../multiAgent/agentTurnSchemas";
import { ClaudeCliRunner } from "../multiAgent/claudeCliRunner";
import { runTurnWithRepair, type AgentCliRunner } from "../multiAgent/agentCliRunner";
import type { EngineeringTicket } from "../multiAgent/types";
import { log } from "../multiAgent/runtimeLogger";

const LOG_PREFIX = "[ClaudyQaAgent]";
const runtimeLog = log.fromContext({ source: "claudy" });
const CLAUDY_EXECUTION_TIMEOUT_MS = 300_000;

// Options for a Claudy execution turn (review, no JSON).
export interface ClaudyExecutionTurnOptions {
  purpose: "review";
  prompt: string;
}

export interface ClaudyTurnOptions {
  // The reason for this turn (e.g., planning review, implementation review, etc.).
  purpose: AgentTurnPurpose;
  // The full prompt sent to the Claudy CLI runner.
  prompt: string;
}

export interface ClaudyTurnResult {
  // Parsed JSON envelope that matches the expected agent schema.
  envelope: AgentTurnEnvelope;
  // Raw stdout/stderr from the CLI for debugging.
  raw: {
    stdout: string;
    stderr: string;
  };
}

export class ClaudyQaAgent {
  // The CLI runner that actually calls the Claude CLI binary.
  private readonly runner: ClaudeCliRunner;

  public constructor(runner?: ClaudeCliRunner) {
    this.runner = runner ?? new ClaudeCliRunner();
  }

  // Execution mode: Claude inspects the worktree directly (no JSON envelope).
  public async runExecutionTurn(
    ticket: EngineeringTicket,
    options: ClaudyExecutionTurnOptions,
  ): Promise<ExecutionTurnResult> {
    if (!ticket.worktreePath) {
      throw new Error(`${LOG_PREFIX} Missing ticket.worktreePath for Claudy execution turn.`);
    }

    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn`, {
      purpose: options.purpose,
      ticketId: ticket.id,
      worktreePath: ticket.worktreePath,
      timeoutMs: CLAUDY_EXECUTION_TIMEOUT_MS,
    });

    const result = await this.runner.runExecutionTurn(options.prompt, {
      ticketId: ticket.id,
      cwd: ticket.worktreePath,
      dangerouslySkipPermissions: true,
      maxTurns: 5,
      timeoutMs: CLAUDY_EXECUTION_TIMEOUT_MS,
    });

    if (result.timedOut) {
      throw new Error(`${LOG_PREFIX} Execution turn timed out (${CLAUDY_EXECUTION_TIMEOUT_MS}ms).`);
    }

    if (!result.ok) {
      throw new Error(
        `${LOG_PREFIX} Execution turn failed: ${result.errors.join("; ")}`,
      );
    }

    const summary = result.stdout.trim().slice(0, 500) || "(no output)";
    const verdict = parseVerdictFromText(result.stdout);

    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn verdict`, {
      ticketId: ticket.id,
      verdict: verdict ?? "none",
      summaryPreview: summary.slice(0, 200),
    });

    return {
      summary,
      verdict,
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }

  // Structured mode: Claude returns JSON envelope (used for planning reviews).
  public async runTurn(
    ticket: EngineeringTicket,
    options: ClaudyTurnOptions,
  ): Promise<ClaudyTurnResult> {
    if (!ticket.worktreePath) {
      throw new Error(`${LOG_PREFIX} Missing ticket.worktreePath for Claudy turn.`);
    }

    // High-level structured log for observability.
    runtimeLog.info(`${LOG_PREFIX} runTurn`, {
      purpose: options.purpose,
      ticketId: ticket.id,
      worktreePath: ticket.worktreePath,
    });

    const scopedRunner: AgentCliRunner = {
      runTurn: (prompt) =>
        this.runner.runTurn(prompt, {
          ticketId: ticket.id,
          cwd: ticket.worktreePath,
          dangerouslySkipPermissions: true,
          maxTurns: 1,
        }),
    };

    // runTurnWithRepair does:
    // 1) Runs the CLI once with the provided prompt.
    // 2) Validates the JSON response against the expected schema.
    // 3) If invalid, it retries once using a "repair prompt" that tells the model
    //    to return valid JSON only.
    const result = await runTurnWithRepair(
      scopedRunner,
      options.prompt,
      (invalid) =>
        buildRepairPrompt("claudy", invalid.errors, invalid.stdout, invalid.stderr),
      1,
    );
    if (!result.ok || !result.envelope) {
      // If still invalid after repair, we surface a hard failure.
      throw new Error(
        `${LOG_PREFIX} Invalid turn response: ${result.errors.join("; ")}`,
      );
    }

    // Return both the parsed envelope and raw logs for downstream auditing.
    return {
      envelope: result.envelope,
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }
}

function buildRepairPrompt(
  role: string,
  errors: string[],
  stdout: string,
  stderr: string,
): string {
  // This prompt is intentionally strict and short to avoid non-JSON output.
  return [
    `You returned invalid JSON for the ${role} turn.`,
    `Errors: ${errors.join("; ")}`,
    "Return ONLY a valid JSON object matching the required schema.",
    "Do not include markdown or commentary.",
    `Previous stdout (truncated): ${stdout.slice(0, 400)}`,
    `Previous stderr (truncated): ${stderr.slice(0, 200)}`,
  ].join("\n");
}
