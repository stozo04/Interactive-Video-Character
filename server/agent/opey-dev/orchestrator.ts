// ./server/agent/opey-dev/orchestrator.ts
// The Loop (The Brain) — spawns Claude Code CLI to do the actual work

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[Orchestrator]";

// Control which Claude model and thinking level to use
// OPEY_MODEL: haiku, sonnet, opus (default: haiku)
// OPEY_THINKING: brief, normal, detailed, extended (default: detailed)
const CLAUDE_MODEL = "claude-sonnet-4-6";
const THINKING_LEVEL = "enabled";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function buildTicketPrompt(ticket: any): string {
  const lessonContext = loadLessonsContext();

  const parts = [
    lessonContext || null,
    `# Ticket: ${ticket.title ?? "Untitled"}`,
    ticket.type ? `**Type:** ${ticket.type}` : null,
    ticket.summary ? `**Summary:** ${ticket.summary}` : null,
    ticket.details ?? ticket.description ?? null,
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
    const ticketPrompt = buildTicketPrompt(ticket);

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
