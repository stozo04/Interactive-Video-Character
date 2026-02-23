import { validateCliOutput, type AgentCliRunner, type CliTurnResult, type CliExecutionResult } from "./agentCliRunner";
import { runCliCommand } from "./cliExec";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[ClaudeCliRunner]";
const runtimeLog = log.fromContext({ source: "claudeCliRunner" });

export interface ClaudeRunnerOptions {
  // Which Claude model to use.
  model?: string;
  // Optional temperature override.
  temperature?: number;
  // Maximum time allowed per turn.
  timeoutMs?: number;
}

export interface ClaudeTurnRunOptions {
  // Ticket id for runtime log correlation.
  ticketId?: string;
  // Ticket worktree/root to run Claude inside.
  cwd?: string;
  // Skip Claude permission prompts (autonomous mode).
  dangerouslySkipPermissions?: boolean;
  // Keep turn bounded and non-interactive.
  maxTurns?: number;
  // Optional per-turn timeout override.
  timeoutMs?: number;
}

export class ClaudeCliRunner implements AgentCliRunner {
  public constructor(private readonly options: ClaudeRunnerOptions = {}) {}

  public async runTurn(
    prompt: string,
    runOptions: ClaudeTurnRunOptions = {},
  ): Promise<CliTurnResult> {
    // Log a short preview for debugging.
    const model = this.options.model || "claude-sonnet-4-6";
    runtimeLog.info(`${LOG_PREFIX} runTurn`, {
      model,
      temperature: this.options.temperature ?? "default",
      ticketId: runOptions.ticketId ?? null,
      cwd: runOptions.cwd ?? process.cwd(),
      executionMode: runOptions.dangerouslySkipPermissions === false
        ? "standard_permissions"
        : "dangerously_skip_permissions",
      maxTurns: runOptions.maxTurns ?? 1,
      promptPreview: prompt.slice(0, 200),
    });

    // Wrap with strict JSON-only instructions.
    const wrappedPrompt = buildJsonOnlyPrompt(prompt);
    const args = [
      "-p",
      wrappedPrompt,
      "--model",
      model,
      "--output-format",
      "text",
      "--max-turns",
      String(runOptions.maxTurns ?? 1),
    ];
    if (runOptions.dangerouslySkipPermissions !== false) {
      args.push("--dangerously-skip-permissions");
    }

    const result = await runCliCommand({
      command: "claude",
      args,
      input: "",
      cwd: runOptions.cwd,
      timeoutMs: runOptions.timeoutMs ?? this.options.timeoutMs ?? 180_000,
    });

    runtimeLog.info(`${LOG_PREFIX} runTurn result`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ticketId: runOptions.ticketId ?? null,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    // Return a structured error on timeout.
    if (result.timedOut) {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        errors: ["Claude CLI timed out."],
        retryable: false,
      };
    }

    // Claude CLI often wraps the response in a JSON envelope.
    // We extract the actual text content before validation.
    const extracted = extractClaudeText(result.stdout);
    if (extracted.error) {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: `${result.stderr}\n${extracted.error}`.trim(),
        errors: [extracted.error],
      };
    }

    return validateCliOutput(extracted.text ?? result.stdout, result.stderr);
  }

  // Execution mode: send raw prompt, no JSON wrapping, no envelope validation.
  // The LLM inspects the worktree directly (git diff, reads files, etc.).
  public async runExecutionTurn(
    prompt: string,
    runOptions: ClaudeTurnRunOptions = {},
  ): Promise<CliExecutionResult> {
    const model = this.options.model || "claude-sonnet-4-6";
    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn`, {
      model,
      ticketId: runOptions.ticketId ?? null,
      cwd: runOptions.cwd ?? process.cwd(),
      maxTurns: runOptions.maxTurns ?? 5,
      promptPreview: prompt.slice(0, 200),
    });

    const args = [
      "-p",
      prompt,
      "--model",
      model,
      "--output-format",
      "text",
      "--max-turns",
      String(runOptions.maxTurns ?? 5),
    ];
    if (runOptions.dangerouslySkipPermissions !== false) {
      args.push("--dangerously-skip-permissions");
    }

    const timeoutMs = runOptions.timeoutMs ?? this.options.timeoutMs ?? 300_000;
    const result = await runCliCommand({
      command: "claude",
      args,
      input: "",
      cwd: runOptions.cwd,
      timeoutMs,
    });

    runtimeLog.info(`${LOG_PREFIX} runExecutionTurn result`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ticketId: runOptions.ticketId ?? null,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    if (result.timedOut) {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: true,
        errors: ["Claude CLI timed out during execution turn."],
      };
    }

    // Extract text through the Claude wrapper handling (same as structured mode).
    const extracted = extractClaudeText(result.stdout);
    const stdout = extracted.text ?? result.stdout;

    return {
      ok: result.exitCode === 0 || result.exitCode === null,
      stdout,
      stderr: extracted.error
        ? `${result.stderr}\n${extracted.error}`.trim()
        : result.stderr,
      timedOut: false,
      errors: [
        ...(extracted.error ? [extracted.error] : []),
        ...(result.exitCode !== 0 && result.exitCode !== null
          ? [`Claude CLI exited with code ${result.exitCode}.`]
          : []),
      ],
    };
  }
}

// Extract the actual agent JSON text from Claude CLI wrapper output.
// If parsing fails or no text is found, return an error so we can surface it clearly.
function extractClaudeText(stdout: string): { text?: string; error?: string } {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) {
    return { text: trimmed };
  }

  try {
    const outer = JSON.parse(trimmed) as Record<string, unknown>;
    if (looksLikeEnvelope(outer)) {
      return { text: trimmed };
    }

    const extracted = extractTextFromClaudePayload(outer);
    if (extracted) {
      return { text: extracted };
    }

    const subtype =
      typeof outer.subtype === "string" ? outer.subtype : "unknown_subtype";
    return {
      error: `Claude CLI returned wrapper JSON without text content (subtype=${subtype}).`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Failed to parse Claude CLI JSON wrapper: ${error.message}`
          : "Failed to parse Claude CLI JSON wrapper.",
    };
  }
}

function extractTextFromClaudePayload(payload: Record<string, unknown>): string | null {
  // Common shape: { content: [{ type: "text", text: "..." }, ...] }
  const content = payload.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter((text) => text.trim().length > 0);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  // Alternate shape: { message: { content: [{ text: "..." }] } }
  const message = payload.message;
  if (message && typeof message === "object" && "content" in message) {
    const messageContent = (message as { content?: unknown }).content;
    if (Array.isArray(messageContent)) {
      const texts = messageContent
        .map((part) => {
          if (part && typeof part === "object" && "text" in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .filter((text) => text.trim().length > 0);
      if (texts.length > 0) {
        return texts.join("\n");
      }
    }
  }

  // Fallbacks: some wrappers include a direct string field.
  const directTextFields = ["result", "output", "output_text", "text"];
  for (const key of directTextFields) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function looksLikeEnvelope(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.summary === "string" &&
    Array.isArray(payload.requestedActions)
  );
}

// Build a strict "JSON-only" prompt so the CLI outputs valid machine-readable JSON.
// Mirrors the Codex runner's prompt structure for consistency.
function buildJsonOnlyPrompt(prompt: string): string {
  return [
    "You must return ONLY a valid JSON object matching the required schema.",
    "Required fields:",
    '- "summary": a non-empty string',
    '- "requestedActions": an array (use [] when there are no actions)',
    '- Each requestedActions entry must be an object: {"action":"string","args":{}}',
    "Optional fields (only include when applicable):",
    '- "nextStateHint": string',
    '- "needsHuman": boolean',
    '- "verdict": "approved" | "changes_requested" | "blocked" | "needs_human"',
    "Example minimal valid response:",
    '{"summary":"Status update.","requestedActions":[]}',
    "Do not include markdown, backticks, or commentary before or after the JSON object.",
    "If you are unsure, still return a valid JSON object with a summary and empty requestedActions.",
    "",
    prompt,
  ].join("\n");
}
