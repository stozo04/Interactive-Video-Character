import { validateCliOutput, type AgentCliRunner, type CliTurnResult, type CliExecutionResult } from "./agentCliRunner";
import { runCliCommand } from "./cliExec";
import { captureCodexDiagnosticsSnapshot } from "./codexDiagnostics";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[CodexCliRunner]";
const runtimeLog = log.fromContext({ source: "codexCliRunner" });
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface CodexRunnerOptions {
  // Which model to use (defaults to gpt-5.2).
  model?: string;
  // Optional temperature override for the CLI.
  temperature?: number;
  // Max time allowed per turn before we kill the process.
  timeoutMs?: number;
}

export interface CodexTurnRunOptions {
  // Ticket id for runtime log correlation.
  ticketId?: string;
  // Ticket worktree/root to run Codex inside.
  cwd?: string;
  // Use Codex's fully non-interactive dangerous mode to avoid approval prompts.
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  // Optional timeout override for a single turn.
  timeoutMs?: number;
}

export class CodexCliRunner implements AgentCliRunner {
  public constructor(private readonly options: CodexRunnerOptions = {}) {}

  public async runTurn(
    prompt: string,
    runOptions: CodexTurnRunOptions = {},
  ): Promise<CliTurnResult> {
    const startedAtIso = new Date().toISOString();
    // Log a short preview for debugging (avoid full prompt spam).
    const model = this.options.model || "gpt-5.2";
    runtimeLog.info(`${LOG_PREFIX} runTurn`, {
      model,
      temperature: this.options.temperature ?? "default",
      ticketId: runOptions.ticketId ?? null,
      cwd: runOptions.cwd ?? process.cwd(),
      executionMode: runOptions.dangerouslyBypassApprovalsAndSandbox
        ? "dangerously_bypass"
        : "full_auto",
      promptPreview: prompt.slice(0, 200),
    });

    // Wrap the prompt with strict JSON-only instructions.
    const wrappedPrompt = buildJsonOnlyPrompt(prompt);

    // On Windows/MINGW, the npm `codex` shim is a POSIX shell script that
    // triggers "stdout is not a tty" when spawned from Node. Using shell: true
    // makes cmd.exe resolve `codex` → `codex.cmd`, bypassing the POSIX shim.
    // See: https://stackoverflow.com/questions/45890339
    const args = ["exec", "--model", model];
    if (runOptions.dangerouslyBypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--full-auto");
    }
    args.push("--color", "never");
    if (runOptions.cwd) {
      args.push("--cd", runOptions.cwd);
    }

    const timeoutMs = runOptions.timeoutMs ?? this.options.timeoutMs ?? 90_000;
    let heartbeatCount = 0;
    const heartbeatTimer = timeoutMs >= HEARTBEAT_INTERVAL_MS
      ? setInterval(() => {
          heartbeatCount += 1;
          runtimeLog.info(`${LOG_PREFIX} runTurn heartbeat`, {
            ticketId: runOptions.ticketId ?? null,
            cwd: runOptions.cwd ?? process.cwd(),
            timeoutMs,
            elapsedMs: heartbeatCount * HEARTBEAT_INTERVAL_MS,
            heartbeatCount,
            promptLength: prompt.length,
          });
        }, HEARTBEAT_INTERVAL_MS)
      : null;
    heartbeatTimer?.unref?.();

    const result = await runCliCommand({
      command: "codex",
      args,
      input: wrappedPrompt,
      cwd: runOptions.cwd,
      shell: true,
      timeoutMs,
    }).finally(() => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    });
    const finishedAtIso = new Date().toISOString();

    runtimeLog.info(`${LOG_PREFIX} runTurn result`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      timeoutMs,
      ticketId: runOptions.ticketId ?? null,
      cwd: runOptions.cwd ?? process.cwd(),
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    // If the CLI times out, return a structured error.
    if (result.timedOut) {
      runtimeLog.warning(`${LOG_PREFIX} runTurn timed out`, {
        ticketId: runOptions.ticketId ?? null,
        cwd: runOptions.cwd ?? process.cwd(),
      });
      await captureCodexDiagnosticsSnapshot({
        reason: "timeout",
        ticketId: runOptions.ticketId,
        cwd: runOptions.cwd ?? process.cwd(),
        startedAtIso,
        finishedAtIso,
        cliExitCode: result.exitCode,
        cliStdout: result.stdout,
        cliStderr: result.stderr,
      });
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        errors: ["Codex CLI timed out."],
        retryable: false,
      };
    }

    const validated = validateCliOutput(result.stdout, result.stderr);
    if (!validated.ok) {
      await captureCodexDiagnosticsSnapshot({
        reason: "invalid_json",
        ticketId: runOptions.ticketId,
        cwd: runOptions.cwd ?? process.cwd(),
        startedAtIso,
        finishedAtIso,
        cliExitCode: result.exitCode,
        cliStdout: result.stdout,
        cliStderr: result.stderr,
      });
      return validated;
    }

    if (result.exitCode !== null && result.exitCode !== 0) {
      await captureCodexDiagnosticsSnapshot({
        reason: "abnormal_exit",
        ticketId: runOptions.ticketId,
        cwd: runOptions.cwd ?? process.cwd(),
        startedAtIso,
        finishedAtIso,
        cliExitCode: result.exitCode,
        cliStdout: result.stdout,
        cliStderr: result.stderr,
      });
    }

    return validated;
  }

  // Execution mode: send raw prompt, no JSON wrapping, no envelope validation.
  // The LLM works directly in the worktree (reads, edits, runs tests).
  public async runExecutionTurn(
    prompt: string,
    runOptions: CodexTurnRunOptions = {},
  ): Promise<CliExecutionResult> {
    const model = this.options.model || "gpt-5.2";
    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn`, {
      model,
      ticketId: runOptions.ticketId ?? null,
      cwd: runOptions.cwd ?? process.cwd(),
      promptPreview: prompt.slice(0, 200),
    });

    const args = ["exec", "--model", model];
    if (runOptions.dangerouslyBypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--full-auto");
    }
    args.push("--color", "never");
    if (runOptions.cwd) {
      args.push("--cd", runOptions.cwd);
    }
    // Pass prompt as positional argument so Codex knows the full task upfront
    // and exits after completion (stdin pipe is closed immediately).
    args.push(prompt);

    const timeoutMs = runOptions.timeoutMs ?? this.options.timeoutMs ?? 480_000;
    let heartbeatCount = 0;
    const heartbeatTimer = timeoutMs >= HEARTBEAT_INTERVAL_MS
      ? setInterval(() => {
          heartbeatCount += 1;
          runtimeLog.info(`${LOG_PREFIX} runExecutionTurn heartbeat`, {
            ticketId: runOptions.ticketId ?? null,
            elapsedMs: heartbeatCount * HEARTBEAT_INTERVAL_MS,
            heartbeatCount,
          });
        }, HEARTBEAT_INTERVAL_MS)
      : null;
    heartbeatTimer?.unref?.();

    const result = await runCliCommand({
      command: "codex",
      args,
      input: "",
      cwd: runOptions.cwd,
      shell: true,
      timeoutMs,
    }).finally(() => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    });

    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn result`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ticketId: runOptions.ticketId ?? null,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    if (result.timedOut) {
      runtimeLog.warning(`${LOG_PREFIX} runExecutionTurn timed out`, {
        ticketId: runOptions.ticketId ?? null,
        timeoutMs,
      });
      await captureCodexDiagnosticsSnapshot({
        reason: "timeout",
        ticketId: runOptions.ticketId,
        cwd: runOptions.cwd ?? process.cwd(),
        startedAtIso: new Date().toISOString(),
        finishedAtIso: new Date().toISOString(),
        cliExitCode: result.exitCode,
        cliStdout: result.stdout,
        cliStderr: result.stderr,
      });
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: true,
        errors: ["Codex CLI timed out during execution turn."],
      };
    }

    return {
      ok: result.exitCode === 0 || result.exitCode === null,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
      errors: result.exitCode !== 0 && result.exitCode !== null
        ? [`Codex CLI exited with code ${result.exitCode}.`]
        : [],
    };
  }
}

// Build a strict "JSON-only" prompt so the CLI outputs valid machine-readable JSON.
function buildJsonOnlyPrompt(prompt: string): string {
  return [
    "You must return ONLY a valid JSON object matching the required schema.",
    "Required fields:",
    '- \"summary\": a non-empty string',
    '- \"requestedActions\": an array (use [] when there are no actions)',
    '- Each requestedActions entry must be an object: {\"action\":\"string\",\"args\":{}}',
    "Optional fields (only include when applicable):",
    '- \"nextStateHint\": string',
    '- \"needsHuman\": boolean',
    '- \"verdict\": \"approved\" | \"changes_requested\" | \"blocked\" | \"needs_human\"',
    "Example minimal valid response:",
    '{"summary":"Status update.","requestedActions":[]}',
    "Do not include markdown, backticks, or commentary before or after the JSON object.",
    "If you are unsure, still return a valid JSON object with a summary and empty requestedActions.",
    "",
    prompt,
  ].join("\n");
}
