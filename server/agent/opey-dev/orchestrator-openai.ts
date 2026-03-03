// ./server/agent/opey-dev/orchestrator-openai.ts
//
// THE JOB OF THIS FILE:
// When main.ts has a ticket ready to work on, it calls runOpeyLoop() here.
// This file builds a complete prompt describing the task, then launches the
// OpenAI Codex CLI tool as a subprocess. Codex reads the prompt, writes code
// directly into the repo, and exits. This file just waits for it to finish
// and returns whatever Codex printed to the terminal.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillContext, loadSkillContext } from "./skillLoader";

const LOG_PREFIX = "[Orchestrator-Codex]";

// Which Codex model to use when spawning the CLI.
const CODEX_MODEL = "gpt-5.2-codex";

// __dirname doesn't exist in ES modules, so we reconstruct it from the
// current file's URL. This lets us resolve sibling files like SOUL.md.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Patterns that, if found in a ticket's details, tell us Codex should NOT
// stop to ask clarifying questions — it should just make its best guess and ship.
const NO_QUESTION_MARKERS = [
  /no clarifications?/i,
  /no questions?/i,
  /do not ask questions/i,
  /you can not ask questions/i,
];

// ---------------------------------------------------------------------------
// Prompt assembly helpers
// ---------------------------------------------------------------------------

/**
 * Reads SOUL.md from disk and returns its content as a string.
 *
 * SOUL.md is Opey's "character file" — it defines his personality, values,
 * and general coding philosophy. It goes at the very top of every prompt so
 * Codex always has that context before seeing the actual ticket.
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
 * "Lessons learned" are notes we write after Codex makes a mistake — e.g.
 * "don't use require() in this ESM project" or "always run the linter before
 * committing". By injecting them at the top of every prompt, Codex won't
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
 * Assembles the full task description that Codex will receive.
 *
 * The final prompt is structured like this:
 *
 *   [Past lessons]          ← things Codex should remember from previous runs
 *   # Ticket: <title>
 *   **Type:** <type>        ← e.g. "feature", "bugfix", "skill"
 *   **Summary:** <summary>
 *   <details or skill block> ← either raw details text OR a structured skill
 *   [Clarification policy]  ← only added if Codex is NOT allowed to ask questions
 *
 * If a "skill" is detected (a pre-defined template for a common task type),
 * the skill block replaces the raw details text so Codex gets richer context.
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

  // Only inject the clarification policy section if needed (e.g. skill tickets
  // or tickets whose details explicitly say "no questions").
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
 * 1. Build a complete prompt (soul + lessons + ticket details).
 * 2. Spawn the Codex CLI as a child process, pointing it at the repo root
 *    (workPath). Codex will read the prompt, figure out what code to write,
 *    and make changes directly to the files on disk.
 * 3. Stream stdout and stderr back to our logger AND to the event system in
 *    real time. Each meaningful line Codex prints becomes a "codex_step" event
 *    in the engineering_ticket_events table.
 * 4. Wait for Codex to exit.
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
  log.info(`${LOG_PREFIX} Opey loop start (Codex CLI)`, {
    source: "orchestrator-openai.ts",
    ticketId: ticket?.id,
    workPath,
    model: CODEX_MODEL,
  });

  // We hold a reference to the child process so the finally block can kill it
  // if something goes wrong before it exits on its own.
  let child: ChildProcess | null = null;

  // Temp file that holds the full prompt. Written before spawn, deleted in finally.
  // Passing fullPrompt as a CLI arg causes spawn ENAMETOOLONG on Windows because
  // CreateProcess has a ~32KB command-line limit. Writing it to disk sidesteps that.
  let promptFile: string | null = null;

  try {
    // 1. Assemble the prompt.
    const soulPrompt = loadSoulPrompt();
    const ticketPrompt = buildTicketPrompt(ticket, workPath);
    const fullPrompt = `${soulPrompt}\n\n${ticketPrompt}`;

    // Write full prompt to a temp file; pass a short boot arg to Codex instead.
    promptFile = path.join(os.tmpdir(), `opey-${ticket?.id ?? "task"}.md`);
    fs.writeFileSync(promptFile, fullPrompt, "utf-8");
    const bootArg =
      `Your complete task instructions are in this file — read it before doing anything:\n${promptFile}\n\nImplement everything described in that file.`;

    // 2. Build the argument list for the Codex CLI.
    //    - "exec" tells Codex to run a one-shot task (no interactive session).
    //    - "--dangerously-bypass-approvals-and-sandbox": Codex normally asks
    //      permission before editing files. We skip that because this server
    //      already controls what branch it runs on, and we want fully automated runs.
    //    - "--ephemeral": don't write session files to disk between runs.
    //    - "--color never": strip ANSI colour codes so our logs are readable.
    //    - The last argument is a short boot instruction pointing at promptFile.
    const args = [
      "exec",
      "-m", CODEX_MODEL,
      "--dangerously-bypass-approvals-and-sandbox",
      "--ephemeral",
      "--color", "never",
      bootArg,
    ];

    // 3. Figure out HOW to launch the Codex binary.
    //
    //    On Linux/Mac: `codex` is a regular executable on PATH — spawn it directly.
    //
    //    On Windows: npm global packages are installed as `.cmd` batch file wrappers.
    //    Node's spawn() can't run .cmd files directly without { shell: true }, but
    //    shell:true introduces quoting/escaping nightmares with the long prompt string.
    //    Instead, we find the actual JavaScript entry point inside node_modules and
    //    run it with `node` directly — no shell involved, no escaping issues.
    let spawnCmd: string;
    let spawnArgs: string[];
    if (process.platform === "win32") {
      const npmRoot = execSync("npm root -g").toString().trim();
      const codexScript = path.join(npmRoot, "@openai", "codex", "bin", "codex.js");
      spawnCmd = "node";
      spawnArgs = [codexScript, ...args];
    } else {
      spawnCmd = "codex";
      spawnArgs = args;
    }

    // 4. Spawn Codex.
    //    stdio: ["ignore", "pipe", "pipe"]
    //      - stdin  = "ignore": Codex gets no keyboard input (fully automated).
    //      - stdout = "pipe":   we read its output line by line.
    //      - stderr = "pipe":   same — Codex sometimes writes progress to stderr.
    child = spawn(spawnCmd, spawnArgs, {
      cwd: workPath,        // Codex runs inside the repo so its file edits land in the right place.
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`${LOG_PREFIX} Codex CLI spawned`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      pid: child.pid,
      model: CODEX_MODEL,
    });

    // Emit the "started" lifecycle event now that we have a live process.
    await onEvent?.("implementation_started", `Codex started (pid ${child.pid})`, {
      model: CODEX_MODEL,
      pid: child.pid,
      workPath,
    });

    // 5. Accumulate all output. We log each chunk in real time so you can watch
    //    progress in the server logs, and we also keep a running `output` string
    //    that we return to main.ts when Codex finishes.
    let output = "";

    // Line buffer — stdout/stderr arrive in arbitrary binary chunks that may
    // split mid-line. We buffer incomplete fragments here and only emit an event
    // once we have a full newline-terminated line.
    let lineBuffer = "";

    // Emit one "codex_step" event per complete output line. Fire-and-forget
    // (no await) so event inserts never slow down the stream.
    const emitLine = (line: string) => {
      const trimmed = line.trim();
      if (trimmed) {
        void onEvent?.("codex_step", trimmed.slice(0, 300), { text: trimmed });
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
      log.info(`${LOG_PREFIX} Codex stdout`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000), // cap log line length
      });
    });

    // stderr is treated identically to stdout — some Codex versions write
    // meaningful output (like "thinking…" or error messages) there.
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      processChunk(text);
      log.info(`${LOG_PREFIX} Codex stderr`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    // 6. Wait for Codex to exit. We wrap the event listener in a Promise so
    //    we can use await instead of callback hell.
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on("close", (code) => resolve(code));
      child!.on("error", (err) => reject(err)); // spawn failure (e.g. binary not found)
    });

    // Flush any remaining text that didn't end with a newline.
    if (lineBuffer.trim()) emitLine(lineBuffer);

    if (exitCode === 0) {
      log.info(`${LOG_PREFIX} Codex CLI completed successfully`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        outputLength: output.length,
      });
      await onEvent?.("implementation_completed", "Codex finished successfully", {
        outputLength: output.length,
      });
      return output;
    }

    // Non-zero exit = Codex failed. Include the last 2000 chars of output in
    // the error message so we can see what went wrong without digging through logs.
    const tail = output.slice(-2000);
    const msg = `Codex CLI exited with code ${exitCode}. Tail:\n${tail}`;
    await onEvent?.("implementation_failed", `Codex exited with code ${exitCode}`, {
      exitCode,
      tail: output.slice(-500), // keep payload smaller than the thrown error
    });
    log.error(`${LOG_PREFIX} ${msg}`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      exitCode,
    });
    throw new Error(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`${LOG_PREFIX} Opey loop failed`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      error: message,
    });
    throw err;
  } finally {
    // Always clean up the child process. If we threw an error above, Codex may
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
 * Decides whether to append a "do not ask questions" policy to the prompt.
 *
 * Codex defaults to asking clarifying questions when requirements are
 * ambiguous. For certain ticket types (like "skill" tasks, which are
 * pre-defined templates) or when the ticket explicitly says not to ask,
 * we want Codex to just make reasonable assumptions and ship something.
 *
 * Returns a formatted markdown section string if the policy applies,
 * or null if Codex should use its default (questions allowed) behaviour.
 */
function buildClarificationPolicy(normalized: {
  type?: string;
  details?: string;
}): string | null {
  const type = (normalized.type || "").toLowerCase();
  const details = normalized.details || "";

  // "skill" tickets are pre-defined tasks — no ambiguity, no questions needed.
  // Otherwise, check if the details text explicitly forbids questions.
  const noQuestions =
    type === "skill" || NO_QUESTION_MARKERS.some((pattern) => pattern.test(details));

  if (!noQuestions) return null;

  return [
    "## Clarification Policy",
    "- Do not ask questions.",
    "- If any requirement is ambiguous, make reasonable assumptions and proceed.",
    "- Prefer shipping a best-effort implementation over requesting clarification.",
  ].join("\n");
}
