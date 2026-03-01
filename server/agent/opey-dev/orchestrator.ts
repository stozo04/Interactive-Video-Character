// ./server/agent/opey-dev/orchestrator.ts
// The Loop (The Brain) — spawns Claude Code CLI to do the actual work

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillContext, loadSkillContext } from "./skillLoader";

const LOG_PREFIX = "[Orchestrator]";

// Control which Claude model and thinking level to use
// OPEY_MODEL: haiku, sonnet, opus (default: haiku)
// OPEY_THINKING: brief, normal, detailed, extended (default: detailed)
const CLAUDE_MODEL = "claude-sonnet-4-6";
const THINKING_LEVEL = "enabled";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NO_QUESTION_MARKERS = [
  /no clarifications?/i,
  /no questions?/i,
  /do not ask questions/i,
  /you can not ask questions/i,
];

function loadSoulPrompt(): string {
  const soulPath = path.join(__dirname, "SOUL.md");
  return fs.readFileSync(soulPath, "utf-8");
}

function loadLessonsContext(): string {
  const lessonsDir = path.join(__dirname, "lessons_learned");
  if (!fs.existsSync(lessonsDir)) return "";

  const files = fs.readdirSync(lessonsDir)
    .filter((f) => f.endsWith(".md"))
    .sort(); // chronological order

  if (files.length === 0) return "";

  const contents = files
    .map((f) => fs.readFileSync(path.join(lessonsDir, f), "utf-8").trim())
    .join("\n\n---\n\n");

  return `# Past Lessons (read before doing anything else)\n\n${contents}`;
}

function buildTicketPrompt(ticket: any, workPath: string): string {
  const lessonContext = loadLessonsContext();
  const normalized = normalizeTicket(ticket);
  const skillContext = loadSkillContext({
    ticketType: normalized.type,
    details: normalized.details,
    workPath,
  });
  const skillBlock = formatSkillContext(skillContext);
  const clarificationPolicy = buildClarificationPolicy(normalized);

  const parts = [
    lessonContext || null,
    `# Ticket: ${normalized.title ?? "Untitled"}`,
    normalized.type ? `**Type:** ${normalized.type}` : null,
    normalized.summary ? `**Summary:** ${normalized.summary}` : null,
    normalized.details && !skillBlock ? normalized.details : null,
    skillBlock || null,
    clarificationPolicy,
  ].filter(Boolean);

  return parts.join("\n\n");
}

export async function runOpeyLoop(ticket: any, workPath: string, log: any): Promise<string> {
  log.info(`${LOG_PREFIX} Opey loop start`, {
    source: "orchestrator.ts",
    ticketId: ticket?.id,
    workPath,
  });

  let child: ChildProcess | null = null;

  try {
    const soulPrompt = loadSoulPrompt();
    const ticketPrompt = buildTicketPrompt(ticket, workPath);

    const args = [
      "-p",
      "--permission-mode", "acceptEdits",
      "--output-format", "text",
      "--no-session-persistence",
      "--model", CLAUDE_MODEL,
      "--thinking", THINKING_LEVEL,
      "--append-system-prompt", soulPrompt,
      ticketPrompt,
    ];

    // On Windows, npm global binaries are .cmd wrappers; bare name fails with ENOENT
    const claudeBin = process.platform === "win32" ? "claude.cmd" : "claude";

    // Spawn claude directly with args array — bypasses shell escaping entirely
    child = spawn(claudeBin, args, {
      cwd: workPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`${LOG_PREFIX} Claude Code spawned`, {
      source: "orchestrator.ts",
      ticketId: ticket?.id,
      pid: child.pid,
      model: CLAUDE_MODEL,
    });

    let output = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} Claude stdout`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} Claude stderr`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on("close", (code) => resolve(code));
      child!.on("error", (err) => reject(err));
    });

    if (exitCode === 0) {
      log.info(`${LOG_PREFIX} Claude Code completed successfully`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        outputLength: output.length,
      });
      return output;
    }

    const tail = output.slice(-2000);
    const msg = `Claude Code exited with code ${exitCode}. Tail:\n${tail}`;
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
    if (child && !child.killed) {
      child.kill();
    }
  }
}

function normalizeTicket(ticket: any): {
  title?: string;
  type?: string;
  summary?: string;
  details?: string;
} {
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

function buildClarificationPolicy(normalized: {
  type?: string;
  details?: string;
}): string | null {
  const type = (normalized.type || "").toLowerCase();
  const details = normalized.details || "";
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
