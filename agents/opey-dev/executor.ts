// agents/opey-dev/executor.ts
// Tool Execution (The Hands)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../lib/logger";
import type { ProcessManager } from "./processManager";

export async function executeTool(
  action: string,
  args: any,
  worktreePath: string,
  processManager?: ProcessManager,
): Promise<string> {
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

      // --- Background process tools ---

      case 'bash_bg': {
        requireProcessManager(processManager);
        const workdir = args?.workdir
          ? path.resolve(worktreePath, args.workdir)
          : worktreePath;
        log.warning("Tool bash_bg requested", {
          source: "executor.ts",
          action,
          command: args?.command,
          workdir,
        });
        const sessionId = processManager!.spawn(args.command, workdir);
        return JSON.stringify({ sessionId });
      }
      case 'process_poll': {
        requireProcessManager(processManager);
        log.info("Tool process_poll requested", {
          source: "executor.ts",
          action,
          sessionId: args?.sessionId,
        });
        const status = processManager!.poll(args.sessionId);
        return JSON.stringify(status);
      }
      case 'process_log': {
        requireProcessManager(processManager);
        log.info("Tool process_log requested", {
          source: "executor.ts",
          action,
          sessionId: args?.sessionId,
        });
        return processManager!.getLog(args.sessionId, args?.offset, args?.limit);
      }
      case 'process_write': {
        requireProcessManager(processManager);
        log.info("Tool process_write requested", {
          source: "executor.ts",
          action,
          sessionId: args?.sessionId,
        });
        processManager!.write(args.sessionId, args.data);
        return "OK";
      }
      case 'process_submit': {
        requireProcessManager(processManager);
        log.info("Tool process_submit requested", {
          source: "executor.ts",
          action,
          sessionId: args?.sessionId,
        });
        processManager!.submit(args.sessionId, args.data);
        return "OK";
      }
      case 'process_kill': {
        requireProcessManager(processManager);
        log.warning("Tool process_kill requested", {
          source: "executor.ts",
          action,
          sessionId: args?.sessionId,
        });
        processManager!.kill(args.sessionId);
        return "OK";
      }
      case 'process_list': {
        requireProcessManager(processManager);
        log.info("Tool process_list requested", {
          source: "executor.ts",
          action,
        });
        const sessions = processManager!.list();
        return JSON.stringify(sessions);
      }

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

function requireProcessManager(pm: ProcessManager | undefined): asserts pm is ProcessManager {
  if (!pm) {
    const msg = "ProcessManager is required for background process tools but was not provided";
    log.error(msg, { source: "executor.ts" });
    throw new Error(msg);
  }
}
