import {
  parseAgentTurnEnvelope,
  type AgentTurnEnvelope,
  type AgentTurnValidationResult,
} from "./agentTurnSchemas";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[AgentCliRunner]";
const runtimeLog = log.fromContext({ source: "agentCliRunner" });

// CliExecutionResult represents the raw result of an execution-mode turn
// (no JSON parsing, no envelope validation — the LLM worked directly).
export interface CliExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errors: string[];
}

// CliTurnResult represents the parsed result of a CLI turn (valid or invalid).
export interface CliTurnResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  envelope?: AgentTurnEnvelope;
  errors: string[];
  // When false, do not attempt JSON-repair retries (e.g., timeout/process failure).
  retryable?: boolean;
}

// AgentCliRunner is the minimal interface our agent runners must implement.
// Each runner takes a prompt and returns a parsed result.
export interface AgentCliRunner {
  runTurn(prompt: string): Promise<CliTurnResult>;
}

// runTurnWithRepair:
// 1) Run the prompt once.
// 2) If JSON is invalid, build a repair prompt and retry.
// 3) Stop after maxRetries.
export async function runTurnWithRepair(
  runner: AgentCliRunner,
  prompt: string,
  buildRepairPrompt: (result: CliTurnResult) => string,
  maxRetries = 1,
): Promise<CliTurnResult> {
  let attempt = 0;
  let result = await runner.runTurn(prompt);

  while (!result.ok && attempt < maxRetries) {
    if (result.retryable === false) {
      runtimeLog.warning(`${LOG_PREFIX} Skipping repair retry (non-retryable failure)`, {
        attempt,
        errors: result.errors,
      });
      break;
    }
    attempt += 1;
    const repairPrompt = buildRepairPrompt(result);
    runtimeLog.info(`${LOG_PREFIX} Retrying with repair prompt`, {
      attempt,
      errors: result.errors,
    });
    result = await runner.runTurn(repairPrompt);
  }

  return result;
}

// validateCliOutput checks that stdout is valid JSON for our envelope schema.
export function validateCliOutput(
  stdout: string,
  stderr: string,
): CliTurnResult {
  const validation: AgentTurnValidationResult = parseAgentTurnEnvelope(stdout);
  if (!validation.ok) {
    const stdoutPreview = stdout.trim().slice(0, 400);
    log.warning(`${LOG_PREFIX} Invalid JSON envelope`, {
      errors: validation.errors,
      stdoutPreview,
      stderrPreview: stderr.slice(0, 400),
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
      source: "agentCliRunner",
    });
    return {
      ok: false,
      stdout,
      stderr,
      errors: validation.errors,
      retryable: true,
    };
  }

  return {
    ok: true,
    stdout,
    stderr,
    envelope: validation.parsed,
    errors: [],
  };
}
