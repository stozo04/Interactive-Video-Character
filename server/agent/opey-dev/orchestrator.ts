// ./server/agent/opey-dev/orchestrator.ts
// The Loop (The Brain)

import { executeTool } from "./executor";

export async function runOpeyLoop(ticket: any, workPath: string, log: any) {
  log.info("Opey loop start", {
    source: "orchestrator.ts",
    ticketId: ticket?.id,
    workPath,
  });

  try {
    let isDone = false;
    const history = [
      { role: "system", content: `You are Opey. Resolve: ${ticket.description}` },
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
      const result = await executeTool(response.tool, response.args, workPath);
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
  }
}
