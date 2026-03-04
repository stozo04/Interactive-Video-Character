// server/agent/tidy/orchestrator.ts
//
// Thin Claude Code CLI spawner for Tidy.
// Same mechanics as Opey's orchestrator but pointed at Tidy's SOUL.md
// and stripped of Opey-specific features (self-healing, clarification
// rounds, OpenAI fallback). Tidy's job is simple — keep it simple.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../runtimeLogger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_PREFIX = "[Tidy]";
const CLAUDE_MODEL = "claude-sonnet-4-6";

function loadSoul(): string {
  return fs.readFileSync(path.join(__dirname, "SOUL.md"), "utf-8");
}

/**
 * Spawns Claude Code CLI with Tidy's soul and the given task prompt.
 * Streams output to the logger. Returns full stdout+stderr output on success.
 * Throws on non-zero exit code.
 */
export async function runTidyLoop(taskPrompt: string, workPath: string): Promise<string> {
  log.info(`${LOG_PREFIX} Starting loop`, { source: "tidy/orchestrator.ts", workPath });

  let child: ChildProcess | null = null;
  let promptFile: string | null = null;

  try {
    // Combine soul + task into a single temp file (same approach as Opey —
    // avoids Windows ENAMETOOLONG when passing large prompts via CLI args).
    const fullPrompt = `${loadSoul()}\n\n${taskPrompt}`;
    promptFile = path.join(os.tmpdir(), `tidy-${Date.now()}.md`);
    fs.writeFileSync(promptFile, fullPrompt, "utf-8");

    const bootArg = `Your complete task instructions are in this file — read it before doing anything: ${promptFile}. Execute the cleaning pass described in that file.`;

    // On this machine Claude Code is installed as a standalone .exe (not npm).
    const claudeBin = process.platform === "win32"
      ? "C:\\Users\\gates\\AppData\\Roaming\\Claude\\claude-code\\2.1.34\\claude.exe"
      : "claude";
    const args = [
      "-p",
      "--permission-mode", "acceptEdits",
      "--output-format", "text",
      "--no-session-persistence",
      "--model", CLAUDE_MODEL,
      bootArg,
    ];

    child = spawn(claudeBin, args, {
      cwd: workPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`${LOG_PREFIX} Claude spawned`, {
      source: "tidy/orchestrator.ts",
      pid: child.pid,
      model: CLAUDE_MODEL,
    });

    let output = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} stdout`, {
        source: "tidy/orchestrator.ts",
        chunk: text.slice(0, 2000),
      });
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log.info(`${LOG_PREFIX} stderr`, {
        source: "tidy/orchestrator.ts",
        chunk: text.slice(0, 2000),
      });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.on("close", resolve);
      child!.on("error", reject);
    });

    if (exitCode === 0) {
      log.info(`${LOG_PREFIX} Completed successfully`, {
        source: "tidy/orchestrator.ts",
        outputLength: output.length,
      });
      return output;
    }

    const msg = `Tidy exited with code ${exitCode}. Tail:\n${output.slice(-2000)}`;
    log.error(`${LOG_PREFIX} Loop failed`, {
      source: "tidy/orchestrator.ts",
      exitCode,
      tail: output.slice(-500),
    });
    throw new Error(msg);

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`${LOG_PREFIX} Unexpected error`, { source: "tidy/orchestrator.ts", error: message });
    throw err;
  } finally {
    if (child && !child.killed) child.kill();
    if (promptFile) {
      try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
    }
  }
}
