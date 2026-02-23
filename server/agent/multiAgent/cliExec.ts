import { spawn } from "node:child_process";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[CliExec]";
const runtimeLog = log.fromContext({ source: "cliExec" });

// CliExecOptions describes how to run a child process.
export interface CliExecOptions {
  // Command to run (binary name or path).
  command: string;
  // Command-line arguments.
  args: string[];
  // Input to pass to stdin (only used when stdinMode="pipe").
  input: string;
  // How long to wait before killing the process.
  timeoutMs?: number;
  // Whether to pipe or inherit stdin (inherit is used when a TTY is required).
  stdinMode?: "pipe" | "inherit";
  // Whether to spawn inside a shell (rarely needed).
  shell?: boolean;
  // Optional child process working directory.
  cwd?: string;
}

// CliExecResult captures stdout/stderr and exit status.
export interface CliExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// runCliCommand executes a command and collects output safely.
export async function runCliCommand(options: CliExecOptions): Promise<CliExecResult> {
  const { command, args, input, timeoutMs = 60_000 } = options;
  const stdinMode = options.stdinMode ?? "pipe";
  const shell = options.shell ?? false;
  const cwd = options.cwd;

  return new Promise((resolve) => {
    runtimeLog.info(`${LOG_PREFIX} start`, {
      command,
      args,
      stdinMode,
      timeoutMs,
      shell,
      cwd: cwd ?? process.cwd(),
    });

    const child = spawn(command, args, {
      stdio: [stdinMode, "pipe", "pipe"],
      shell,
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutEscalationTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const clearTimers = (): void => {
      clearTimeout(timeout);
      if (timeoutEscalationTimer) {
        clearTimeout(timeoutEscalationTimer);
        timeoutEscalationTimer = null;
      }
    };

    const resolveOnce = (result: CliExecResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      runtimeLog.warning(`${LOG_PREFIX} timeout`, {
        command,
        args,
        timeoutMs,
        pid: child.pid ?? null,
        cwd: cwd ?? process.cwd(),
      });
      terminateChildProcessTree(child.pid);
      try {
        child.kill("SIGKILL");
      } catch (error) {
        runtimeLog.warning(`${LOG_PREFIX} kill failed after timeout`, {
          error: error instanceof Error ? error.message : String(error),
          pid: child.pid ?? null,
        });
      }
      timeoutEscalationTimer = setTimeout(() => {
        runtimeLog.error(`${LOG_PREFIX} close event missing after timeout`, {
          command,
          args,
          pid: child.pid ?? null,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });
        resolveOnce({
          exitCode: null,
          stdout,
          stderr: appendErrorLine(stderr, "Timed out and no close event received after kill."),
          timedOut: true,
        });
      }, 5_000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    let spawnErrored = false;

    child.on("error", (error) => {
      runtimeLog.error(`${LOG_PREFIX} Spawn error`, { error: error.message });
      spawnErrored = true;
      resolveOnce({
        exitCode: null,
        stdout,
        stderr: stderr + `\nSpawn error: ${error.message}`,
        timedOut: false,
      });
    });

    child.stdin?.on("error", (error) => {
      runtimeLog.warning(`${LOG_PREFIX} stdin error`, {
        error: error.message,
        command,
      });
    });

    child.on("close", (code) => {
      if (spawnErrored) return;
      runtimeLog.info(`${LOG_PREFIX} close`, {
        command,
        args,
        exitCode: code,
        timedOut,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        pid: child.pid ?? null,
      });
      resolveOnce({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (stdinMode === "pipe" && input.trim()) {
      child.stdin?.write(input);
    }
    if (stdinMode === "pipe") {
      child.stdin?.end();
    }
  });
}

function terminateChildProcessTree(pid: number | undefined): void {
  if (!pid || process.platform !== "win32") {
    return;
  }

  const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  killer.on("error", (error) => {
    runtimeLog.warning(`${LOG_PREFIX} taskkill failed`, {
      pid,
      error: error.message,
    });
  });
}

function appendErrorLine(current: string, line: string): string {
  if (!current) {
    return line;
  }
  return `${current}\n${line}`;
}
