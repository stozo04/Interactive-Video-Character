// ./server/agent/opey-dev/orchestrator-openai.ts
// OpenAI Codex CLI version — spawns `codex` as a subprocess, mirrors Claude orchestrator

import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillContext, loadSkillContext } from "./skillLoader";

const LOG_PREFIX = "[Orchestrator-Codex]";

// OPEY_MODEL: codex model to use (default: codex)
const CODEX_MODEL = "gpt-5.2-codex";

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
  log.info(`${LOG_PREFIX} Opey loop start (Codex CLI)`, {
    source: "orchestrator-openai.ts",
    ticketId: ticket?.id,
    workPath,
    model: CODEX_MODEL,
  });

  let child: ChildProcess | null = null;

  try {
    const soulPrompt = loadSoulPrompt();
    const ticketPrompt = buildTicketPrompt(ticket, workPath);
    const fullPrompt = `${soulPrompt}\n\n${ticketPrompt}`;

    const args = [
      "exec",
      "-m", CODEX_MODEL,
      "--dangerously-bypass-approvals-and-sandbox", // already isolated in a git worktree
      "--ephemeral",   // don't persist session files
      "--color", "never", // clean logs
      fullPrompt,
    ];

    // On Windows, npm global binaries are .cmd wrappers which Node can't spawn
    // directly (EINVAL). Instead, resolve the actual JS entry point and run it
    // with `node`, bypassing the .cmd entirely — no shell, no escaping issues.
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

    child = spawn(spawnCmd, spawnArgs, {
      cwd: workPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`${LOG_PREFIX} Codex CLI spawned`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      pid: child.pid,
      model: CODEX_MODEL,
    });

    let output = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} Codex stdout`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} Codex stderr`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        chunk: text.slice(0, 2000),
      });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on("close", (code) => resolve(code));
      child!.on("error", (err) => reject(err));
    });

    if (exitCode === 0) {
      log.info(`${LOG_PREFIX} Codex CLI completed successfully`, {
        source: "orchestrator-openai.ts",
        ticketId: ticket?.id,
        outputLength: output.length,
      });
      return output;
    }

    const tail = output.slice(-2000);
    const msg = `Codex CLI exited with code ${exitCode}. Tail:\n${tail}`;
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
