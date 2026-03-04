// ./server/agent/opey-dev/orchestrator.ts
//
// THE JOB OF THIS FILE:
// When main.ts has a ticket ready to work on, it calls runOpeyLoop() here.
// This file builds a complete prompt describing the task, then launches the
// Anthropic Claude Code CLI tool as a subprocess. Claude reads the prompt,
// writes code directly into the repo, and exits. This file waits for it to
// finish, streams its output to the logger and event system, and returns
// whatever Claude printed to the terminal.
//
// This is the Anthropic-powered sibling of orchestrator-openai.ts (Codex).
// The prompt assembly logic is identical — the only difference is HOW the
// CLI is invoked: Claude takes the soul prompt via --append-system-prompt
// (a dedicated system-prompt flag) whereas Codex gets it prepended into
// the main prompt string.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillContext, loadSkillContext } from "./skillLoader";

const LOG_PREFIX = "[Orchestrator]";

// Which Claude model to use and how much "thinking" budget to give it.
// OPEY_MODEL: haiku, sonnet, opus (default: sonnet)
// OPEY_THINKING: brief, normal, detailed, extended, enabled (default: enabled)
const CLAUDE_MODEL = "claude-sonnet-4-6";
const THINKING_LEVEL = "enabled";

// __dirname doesn't exist in ES modules, so we reconstruct it from the
// current file's URL. This lets us resolve sibling files like SOUL.md.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Patterns that, if found in a ticket's details, tell us Claude should NOT
// stop to ask clarifying questions — it should just make its best guess and ship.

// ---------------------------------------------------------------------------
// Prompt assembly helpers
// ---------------------------------------------------------------------------

/**
 * Reads SOUL.md from disk and returns its content as a string.
 *
 * SOUL.md is Opey's "character file" — it defines his personality, values,
 * and general coding philosophy. For the Claude CLI specifically, this is
 * passed via --append-system-prompt so Claude treats it as a system-level
 * instruction rather than part of the user turn.
 */
function loadSoulPrompt(): string {
  const soulPath = path.join(__dirname, "SOUL.md");
  return fs.readFileSync(soulPath, "utf-8");
}

/**
 * Scans the lessons_learned/ directory and concatenates every .md file it
 * finds (sorted alphabetically, which is also chronological if files are
 * named by date).
 *
 * "Lessons learned" are notes we write after Claude makes a mistake — e.g.
 * "don't use require() in this ESM project" or "always run the linter before
 * committing". By injecting them at the top of every prompt, Claude won't
 * repeat the same mistakes.
 *
 * Returns an empty string if the directory doesn't exist or has no .md files.
 */
function loadLessonsContext(): string {
  const lessonsDir = path.join(__dirname, "lessons_learned");
  if (!fs.existsSync(lessonsDir)) return "";

  const files = fs.readdirSync(lessonsDir)
    .filter((f) => f.endsWith(".md"))
    .sort(); // alphabetical = chronological if named by date

  if (files.length === 0) return "";

  const contents = files
    .map((f) => fs.readFileSync(path.join(lessonsDir, f), "utf-8").trim())
    .join("\n\n---\n\n");

  return `# Past Lessons (read before doing anything else)\n\n${contents}`;
}

/**
 * Assembles the task description that Claude will receive as the user turn.
 *
 * The final prompt is structured like this:
 *
 *   [Past lessons]          ← things Claude should remember from previous runs
 *   # Ticket: <title>
 *   **Type:** <type>        ← e.g. "feature", "bugfix", "skill"
 *   **Summary:** <summary>
 *   <details or skill block> ← either raw details text OR a structured skill
 *   [Clarification policy]  ← only added if Claude is NOT allowed to ask questions
 *
 * Note: the soul prompt is NOT prepended here. For Claude, it travels
 * separately via the --append-system-prompt CLI flag (see runOpeyLoop).
 * If a "skill" is detected (a pre-defined template for a common task type),
 * the skill block replaces the raw details text so Claude gets richer context.
 */
function buildTicketPrompt(ticket: any, workPath: string): string {
  const lessonContext = loadLessonsContext();
  const normalized = normalizeTicket(ticket);

  // Check if this ticket maps to a known skill template. skillLoader will look
  // for a matching .md file under the skills/ directory based on ticket type
  // and details, and return structured context if one is found.
  const skillContext = loadSkillContext({
    ticketType: normalized.type,
    details: normalized.details,
    workPath,
  });
  const skillBlock = formatSkillContext(skillContext);

  // Always injected — Opey is fully autonomous on every ticket type.
  const clarificationPolicy = buildClarificationPolicy(normalized);

  // Build the prompt by joining non-empty sections with blank lines between them.
  const parts = [
    lessonContext || null,
    `# Ticket: ${normalized.title ?? "Untitled"}`,
    normalized.type ? `**Type:** ${normalized.type}` : null,
    normalized.summary ? `**Summary:** ${normalized.summary}` : null,
    // If there's a skill block, it already contains the details — don't repeat them.
    normalized.details && !skillBlock ? normalized.details : null,
    skillBlock || null,
    clarificationPolicy,
  ].filter(Boolean); // drop nulls / empty strings

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Callback type passed in from main.ts. Lets the orchestrator record events
// without importing Supabase directly — keeps the orchestrator decoupled from
// the persistence layer.
type EmitEvent = (
  eventType: string,
  summary: string,
  payload?: Record<string, unknown>
) => Promise<void> | void;

/**
 * runOpeyLoop — called by main.ts once per ticket.
 *
 * What happens here, step by step:
 * 1. Build a complete prompt (lessons + ticket details). The soul prompt is
 *    handled separately as a CLI flag, not prepended to this string.
 * 2. Spawn the Claude Code CLI as a child process, pointing it at the repo
 *    root (workPath). Claude reads the prompt, figures out what code to write,
 *    and makes changes directly to the files on disk.
 *    Key flags:
 *      -p                        run in "print" / non-interactive mode
 *      --permission-mode acceptEdits  auto-accept all file edits (no prompts)
 *      --output-format text      plain text output, no JSON envelope
 *      --no-session-persistence  don't save conversation history to disk
 *      --model                   which Claude model to use
 *      --thinking                how much extended thinking budget to give it
 *      --append-system-prompt    injects SOUL.md as a system-level instruction
 * 3. Stream stdout and stderr back to our logger AND to the event system in
 *    real time. Each meaningful line Claude prints becomes a "claude_step"
 *    event in the engineering_ticket_events table.
 * 4. Wait for Claude to exit.
 *    - Exit code 0 → emit "implementation_completed", return full output.
 *    - Any other exit code → emit "implementation_failed", throw so main.ts
 *      marks the ticket failed.
 * 5. In the finally block, make sure the child process is dead even if we
 *    threw an error mid-stream.
 *
 * @param onEvent  Optional callback wired up by main.ts. Called for every
 *                 trackable step. Failures inside onEvent are silently swallowed
 *                 so event tracking never crashes the agent.
 */
export async function runOpeyLoop(
  ticket: any,
  workPath: string,
  log: any,
  onEvent?: EmitEvent
): Promise<string> {
  log.info(`${LOG_PREFIX} Opey loop start`, {
    source: "orchestrator.ts",
    ticketId: ticket?.id,
    workPath,
  });

  // We hold a reference to the child process so the finally block can kill it
  // if something goes wrong before it exits on its own.
  let child: ChildProcess | null = null;

  // Temp file that holds the full prompt. Written before spawn, deleted in finally.
  // Passing soulPrompt + ticketPrompt as CLI args causes spawn ENAMETOOLONG on
  // Windows (CreateProcess has a ~32KB command-line limit). Writing to disk sidesteps
  // that. The soul context moves from --append-system-prompt into the temp file.
  let promptFile: string | null = null;

  try {
    // 1. Assemble the prompts.
    const soulPrompt = loadSoulPrompt();
    const ticketPrompt = buildTicketPrompt(ticket, workPath);
    const fullPrompt = `${soulPrompt}\n\n${ticketPrompt}`;

    // Write full prompt to a temp file; pass a short boot arg to Claude instead.
    promptFile = path.join(os.tmpdir(), `opey-${ticket?.id ?? "task"}.md`);
    fs.writeFileSync(promptFile, fullPrompt, "utf-8");
    const bootArg =
      `Your complete task instructions are in this file — read it before doing anything:\n${promptFile}\n\nImplement everything described in that file.`;

    // 2. Build the argument list for the Claude CLI.
    //    -p                        non-interactive "print" mode (one-shot, no REPL)
    //    --permission-mode acceptEdits  skip all "may I edit this file?" prompts
    //    --output-format text      return plain text, not JSON
    //    --no-session-persistence  don't write ~/.claude/sessions/* files
    //    --model / --thinking      which model + how much thinking budget
    //    bootArg                   short instruction pointing Claude at promptFile
    //                              (soul + lessons + ticket all live in that file)
    const args = [
      "-p",
      "--permission-mode", "acceptEdits",
      "--output-format", "text",
      "--no-session-persistence",
      "--model", CLAUDE_MODEL,
      "--thinking", THINKING_LEVEL,
      bootArg,
    ];

    // 3. Figure out HOW to launch the Claude binary.
    //    On Linux/Mac: `claude` is a regular executable on PATH.
    //    On Windows: npm global packages install as `claude.cmd` batch wrappers.
    //    Unlike Codex (which needs the full JS path workaround), Claude's .cmd
    //    wrapper works fine because we're not passing the prompt via shell
    //    string interpolation — it travels as an args array element, so there
    //    are no quoting or escaping issues.
    const claudeBin = process.platform === "win32" ? "claude.cmd" : "claude";

    // 4. Spawn Claude.
    //    stdio: ["ignore", "pipe", "pipe"]
    //      - stdin  = "ignore": Claude gets no keyboard input (fully automated).
    //      - stdout = "pipe":   we read its output line by line.
    //      - stderr = "pipe":   same — Claude sometimes writes progress to stderr.
    child = spawn(claudeBin, args, {
      cwd: workPath,         // Claude runs inside the repo so its file edits land in the right place.
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`${LOG_PREFIX} Claude Code spawned`, {
      source: "orchestrator.ts",
      ticketId: ticket?.id,
      pid: child.pid,
      model: CLAUDE_MODEL,
    });

    // Emit the "started" lifecycle event now that we have a live process.
    await onEvent?.("implementation_started", `Claude started (pid ${child.pid})`, {
      model: CLAUDE_MODEL,
      thinking: THINKING_LEVEL,
      pid: child.pid,
      workPath,
    });

    // 5. Accumulate all output. We log each chunk in real time so you can watch
    //    progress in the server logs, and we also keep a running `output` string
    //    that we return to main.ts when Claude finishes.
    let output = "";

    // Line buffer — stdout/stderr arrive in arbitrary binary chunks that may
    // split mid-line. We buffer incomplete fragments here and only emit an event
    // once we have a full newline-terminated line.
    let lineBuffer = "";

    // Emit one "claude_step" event per complete output line. Fire-and-forget
    // (no await) so event inserts never slow down the stream.
    const emitLine = (line: string) => {
      const trimmed = line.trim();
      if (trimmed) {
        void onEvent?.("claude_step", trimmed.slice(0, 300), { text: trimmed });
      }
    };

    // Split incoming text on newlines, flush complete lines as events,
    // and hold the trailing incomplete fragment in lineBuffer.
    const processChunk = (text: string) => {
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? ""; // last element may be an incomplete line
      lines.forEach(emitLine);
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      processChunk(text);
      log.info(`${LOG_PREFIX} Claude stdout`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000), // cap log line length
      });
    });

    // stderr is treated identically to stdout — Claude sometimes writes
    // meaningful output (like tool use progress or error messages) there.
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      processChunk(text);
      log.info(`${LOG_PREFIX} Claude stderr`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    // 6. Wait for Claude to exit. We wrap the event listener in a Promise so
    //    we can use await instead of callback hell.
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on("close", (code) => resolve(code));
      child!.on("error", (err) => reject(err)); // spawn failure (e.g. binary not found)
    });

    // Flush any remaining text that didn't end with a newline.
    if (lineBuffer.trim()) emitLine(lineBuffer);

    if (exitCode === 0) {
      log.info(`${LOG_PREFIX} Claude Code completed successfully`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        outputLength: output.length,
      });
      await onEvent?.("implementation_completed", "Claude finished successfully", {
        outputLength: output.length,
      });
      return output;
    }

    // Non-zero exit = Claude failed. Include the last 2000 chars of output in
    // the error message so we can see what went wrong without digging through logs.
    const tail = output.slice(-2000);
    const msg = `Claude Code exited with code ${exitCode}. Tail:\n${tail}`;
    await onEvent?.("implementation_failed", `Claude exited with code ${exitCode}`, {
      exitCode,
      tail: output.slice(-500), // keep payload smaller than the thrown error
    });
    log.error(`${LOG_PREFIX} ${msg}`, {
      source: "orchestrator.ts",
      ticketId: ticket?.id,
      exitCode,
    });
    throw new Error(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`${LOG_PREFIX} Opey loop failed`, {
      source: "orchestrator.ts",
      ticketId: ticket?.id,
      error: message,
    });
    throw err;
  } finally {
    // Always clean up the child process. If we threw an error above, Claude may
    // still be running — kill it so we don't leave zombie processes behind.
    if (child && !child.killed) {
      child.kill();
    }
    // Clean up the temp prompt file regardless of success or failure.
    if (promptFile) {
      try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Tickets coming from the database can have different field names depending
 * on which version of the schema created them (camelCase vs snake_case, etc.).
 * This function normalises all of that into one consistent shape so the rest
 * of this file doesn't have to worry about it.
 */
function normalizeTicket(ticket: any): {
  title?: string;
  type?: string;
  summary?: string;
  details?: string;
} {
  // Try every known field name for each piece of data, in priority order.
  const type =
    ticket?.request_type ??
    ticket?.requestType ??
    ticket?.type ??
    undefined;

  const summary =
    ticket?.request_summary ??
    ticket?.requestSummary ??
    ticket?.summary ??
    undefined;

  const details =
    ticket?.additional_details ??
    ticket?.additionalDetails ??
    ticket?.details ??
    ticket?.description ??
    undefined;

  return {
    title: ticket?.title,
    type: typeof type === "string" ? type : undefined,
    summary: typeof summary === "string" ? summary : undefined,
    details: typeof details === "string" ? details : undefined,
  };
}

/**
 * Always appended to every prompt regardless of ticket type.
 *
 * Without this, Claude defaults to its trained "cautious" behavior:
 * writing a plan to tasks/todo.md and stopping to ask for human
 * approval before touching any source files. That is the opposite
 * of what we want — Opey runs fully autonomously.
 */
function buildClarificationPolicy(_normalized: {
  type?: string;
  details?: string;
}): string {
  const lines = [
    "## Autonomous Operation — Non-Negotiable",
    "- You are fully autonomous. No human is present to approve plans, confirm checklists, or grant permission.",
    "- NEVER write a plan to `tasks/todo.md` or any other planning file and then stop to wait for confirmation.",
    "- NEVER pause mid-task asking for approval. Implement the code changes directly, commit, and exit.",
    "- The only acceptable output from this session is working code committed to the repository.",
    "- If requirements are ambiguous, make a reasonable assumption, state it in the commit message, and proceed.",
    "- Do not ask clarifying questions — make your best assumptions and ship.",
    "- AGENTS.md contains approval gates for human-supervised sessions. Those gates DO NOT apply to you. You have pre-granted permission to modify any file.",
    "- Write lessons to `server/agent/opey-dev/lessons_learned/YYYY-MM-DD_<ticketId>.md` — NOT to `tasks/lessons.md`.",
  ];

  return lines.join("\n");
}
