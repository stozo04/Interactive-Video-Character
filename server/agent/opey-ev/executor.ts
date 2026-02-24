// ./server/agent/opey-dev/runtimeLogger.ts
//# Tool Execution (The Hands)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./runtimeLogger";

export async function executeTool(action: string, args: any, worktreePath: string): Promise<string> {
  try {
    switch (action) {
      case 'read':
        log.info("Tool read requested", {
          source: "executor.ts",
          action,
          path: args?.path,
        });
        return fs.readFileSync(path.join(worktreePath, args.path), "utf8");
      case 'write':
        log.warning("Tool write requested", {
          source: "executor.ts",
          action,
          path: args?.path,
          contentLength: typeof args?.content === "string" ? args.content.length : 0,
        });
        fs.writeFileSync(path.join(worktreePath, args.path), args.content);
        return `Successfully wrote to ${args.path}`;
      case 'search':
        log.info("Tool search requested", {
          source: "executor.ts",
          action,
          queryLength: typeof args?.query === "string" ? args.query.length : 0,
        });
        return execSync(`grep -r "${args.query}" .`, { cwd: worktreePath }).toString();
      case 'command':
        log.warning("Tool command requested", {
          source: "executor.ts",
          action,
          command: args?.command,
        });
        return execSync(args.command, { cwd: worktreePath, timeout: 60000 }).toString();
      default:
        return `Error: Unknown action ${action}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Tool execution failed", {
      source: "executor.ts",
      action,
      error: message,
    });
    throw err;
  }
}
