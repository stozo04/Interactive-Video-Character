// agents/opey-dev/processManager.ts
// Background Process Manager (The Dock)

import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import { log } from "../../lib/logger";
import type { ProcessSession, ProcessSessionStatus } from "./types";

const LOG_PREFIX = "[ProcessManager]";
const DEFAULT_BUFFER_CAP = 512 * 1024; // 500KB per session
const DEAD_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface InternalSession {
  pty: pty.IPty;
  outputBuffer: string;
  alive: boolean;
  exitCode: number | null;
  command: string;
  workdir: string;
  startedAt: string;
}

export class ProcessManager {
  private sessions = new Map<string, InternalSession>();
  private bufferCap: number;
  private deadTtlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { bufferCap?: number; deadTtlMs?: number }) {
    this.bufferCap = opts?.bufferCap ?? DEFAULT_BUFFER_CAP;
    this.deadTtlMs = opts?.deadTtlMs ?? DEAD_SESSION_TTL_MS;

    // Periodic sweep of dead sessions past TTL
    this.cleanupTimer = setInterval(() => this.sweepDead(), this.deadTtlMs);
    // Don't let the timer keep the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Spawn a background PTY process. Returns the sessionId. */
  spawn(command: string, workdir: string): string {
    const sessionId = randomUUID();
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    log.info(`${LOG_PREFIX} Spawning background process`, {
      source: "processManager.ts",
      sessionId,
      command,
      workdir,
    });

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: workdir,
      env: process.env as Record<string, string>,
    });

    const session: InternalSession = {
      pty: ptyProcess,
      outputBuffer: "",
      alive: true,
      exitCode: null,
      command,
      workdir,
      startedAt: new Date().toISOString(),
    };

    ptyProcess.onData((data: string) => {
      session.outputBuffer += data;
      // Ring buffer: trim from the front when over cap
      if (session.outputBuffer.length > this.bufferCap) {
        session.outputBuffer = session.outputBuffer.slice(-this.bufferCap);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.alive = false;
      session.exitCode = exitCode;
      log.info(`${LOG_PREFIX} Process exited`, {
        source: "processManager.ts",
        sessionId,
        exitCode,
      });
    });

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /** Check whether a session is still alive. */
  poll(sessionId: string): ProcessSessionStatus {
    const session = this.getSession(sessionId);
    return {
      sessionId,
      alive: session.alive,
      exitCode: session.exitCode,
    };
  }

  /** Read output from a session's buffer. */
  getLog(sessionId: string, offset?: number, limit?: number): string {
    const session = this.getSession(sessionId);
    const start = offset ?? 0;
    const end = limit != null ? start + limit : undefined;
    return session.outputBuffer.slice(start, end);
  }

  /** Write raw data to the process stdin (no newline appended). */
  write(sessionId: string, data: string): void {
    const session = this.getSession(sessionId);
    if (!session.alive) {
      throw new Error(`Session ${sessionId} is not alive`);
    }
    session.pty.write(data);
  }

  /** Write data + newline to the process stdin. */
  submit(sessionId: string, data: string): void {
    this.write(sessionId, data + "\n");
  }

  /** Kill a running session. */
  kill(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session.alive) {
      log.info(`${LOG_PREFIX} Killing process`, {
        source: "processManager.ts",
        sessionId,
      });
      session.pty.kill();
      session.alive = false;
    }
  }

  /** List all tracked sessions. */
  list(): ProcessSession[] {
    const result: ProcessSession[] = [];
    for (const [sessionId, s] of this.sessions) {
      result.push({
        sessionId,
        command: s.command,
        workdir: s.workdir,
        alive: s.alive,
        exitCode: s.exitCode,
        startedAt: s.startedAt,
      });
    }
    return result;
  }

  /** Kill all sessions and stop the cleanup timer. */
  cleanup(): void {
    log.info(`${LOG_PREFIX} Cleaning up all sessions`, {
      source: "processManager.ts",
      sessionCount: this.sessions.size,
    });

    for (const [sessionId, session] of this.sessions) {
      if (session.alive) {
        try {
          session.pty.kill();
        } catch {
          // Best-effort cleanup
        }
        session.alive = false;
      }
    }
    this.sessions.clear();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private getSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No session found with id: ${sessionId}`);
    }
    return session;
  }

  /** Remove dead sessions that have been sitting past their TTL. */
  private sweepDead(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (!session.alive) {
        const startedAt = new Date(session.startedAt).getTime();
        if (now - startedAt > this.deadTtlMs) {
          this.sessions.delete(sessionId);
        }
      }
    }
  }
}
