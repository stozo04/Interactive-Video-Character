// ./server/agent/opey-dev/main.ts
// Entry point (The Boss)

import { SupabaseTicketStore } from "./ticketStore";
import { WorktreeManager } from "./worktreeManager";
import { runOpeyLoop } from "./orchestrator";
import { log } from "../../runtimeLogger";
import { createPullRequest } from "./githubOps";

async function main() {
  log.info("Main start", { source: "main.ts", cwd: process.cwd() });
  try {
    const store = new SupabaseTicketStore(
      process.env.SB_URL!,
      process.env.SB_KEY!,
    );
    const manager = new WorktreeManager(process.cwd());

    log.info("Fetching next ticket", { source: "main.ts" });
    const ticket = await store.getNextTicket(); // Status = 'created'
    if (!ticket) {
      log.info("No work found", { source: "main.ts" });
      return;
    }

    log.info("Creating worktree", { source: "main.ts", ticketId: ticket.id });
    const { workPath } = manager.create(ticket.id);

    try {
      log.info("Updating status to implementing", {
        source: "main.ts",
        ticketId: ticket.id,
      });
      await store.updateStatus(ticket.id, "implementing");

      log.info("Starting Opey loop", {
        source: "main.ts",
        ticketId: ticket.id,
        workPath,
      });
      await runOpeyLoop(ticket, workPath, log);

      log.info("Creating pull request", {
        source: "main.ts",
        ticketId: ticket.id,
      });
      const prUrl = await createPullRequest(workPath, ticket);

      log.info("Updating status to completed (with PR)", {
        source: "main.ts",
        ticketId: ticket.id,
        prUrl,
      });
      await store.updateStatus(ticket.id, "completed", { prUrl: prUrl });

      log.info(`Mission accomplished! PR: ${prUrl}`, {
        source: "main.ts",
        ticketId: ticket.id,
      });
      await store.updateStatus(ticket.id, "completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error("Main workflow failed", {
        source: "main.ts",
        ticketId: ticket.id,
        error: message,
      });
      await store.updateStatus(ticket.id, "failed", {
        failureReason: message,
      });
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.critical("Fatal failure in main", { source: "main.ts", error: message });
    throw err;
  }
}

main();
