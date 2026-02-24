// ./server/agent/opey-dev/orchestrator.ts
// The Loop (The Brain)

import { executeTool } from "./executor";
import { ProcessManager } from "./processManager";

const TOOL_DESCRIPTIONS = `
## Available Tools

### File & Code Tools
- **read** { path } — Read a file's contents.
- **write** { path, content } — Write content to a file (creates or overwrites).
- **search** { query } — Grep recursively for a string in the workspace.
- **command** { command } — Run a shell command synchronously (60s timeout).

### Background Process Tools
- **bash_bg** { command, workdir? } — Spawn a long-running command in a background PTY. Returns { sessionId }. Use for builds, test suites, dev servers, or coding agents.
- **process_poll** { sessionId } — Check if a background process is still alive. Returns { alive, exitCode }.
- **process_log** { sessionId, offset?, limit? } — Read stdout/stderr output from a background process buffer.
- **process_write** { sessionId, data } — Send raw data to a background process's stdin (no newline).
- **process_submit** { sessionId, data } — Send data + newline to a background process's stdin.
- **process_kill** { sessionId } — Kill a background process.
- **process_list** {} — List all tracked background process sessions.

### Control
- **finish** {} — Signal that your work is complete.
`;

function buildSystemPrompt(taskDescription: string): string {
  return `You are Opey, a senior software engineering agent. Resolve the following task:\n\n${taskDescription}\n\n${TOOL_DESCRIPTIONS}`;
}

export async function runOpeyLoop(ticket: any, workPath: string, log: any) {
  log.info("Opey loop start", {
    source: "orchestrator.ts",
    ticketId: ticket?.id,
    workPath,
  });

  const processManager = new ProcessManager();

  try {
    let isDone = false;
    const history = [
      {
        role: "system",
        content: buildSystemPrompt(ticket.description),
      },
    ];

    while (!isDone) {
      // 1. CALL YOUR LLM HERE (e.g., Claude or OpenAI)
      const response = {
        thought: "I need to check the current version.",
        tool: "read",
        args: { path: "package.json" },
      };

      log.info(`Thought: ${response.thought}`, {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        tool: response.tool,
      });

      if (response.tool === "finish") {
        log.info("Opey loop finished", {
          source: "orchestrator.ts",
          ticketId: ticket?.id,
        });
        isDone = true;
        break;
      }

      // 2. Execute and feed back to history
      const result = await executeTool(response.tool, response.args, workPath, processManager);
      log.info("Tool execution complete", {
        source: "orchestrator.ts",
        ticketId: ticket?.id,
        tool: response.tool,
        resultLength: result?.length ?? 0,
      });
      history.push({ role: "assistant", content: JSON.stringify(response) });
      history.push({ role: "user", content: `Result: ${result}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Opey loop failed", {
      source: "orchestrator.ts",
      ticketId: ticket?.id,
      error: message,
    });
    throw err;
  } finally {
    processManager.cleanup();
  }
}
