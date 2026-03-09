// lib/logger.ts
//
// Root logger — works in both Node.js and browser environments.
// Writes to the same `server_runtime_logs` Supabase table as the legacy
// loggers (server/runtimeLogger.ts, src/services/clientLogger.ts).
//
// New code and agent code should import from here.
// Legacy loggers stay in place until Tidy cleans them up.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LogSeverity = "verbose" | "info" | "warning" | "error" | "critical";

interface LogEntry {
  severity: LogSeverity;
  message: string;
  details?: Record<string, unknown>;
  agentName?: string;
  ticketId?: string;
  runId?: string;
  requestId?: string;
  route?: string;
  source?: string;
  processId?: number;
  occurredAt?: string;
}

export interface ScopedLogger {
  verbose(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warning(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
  critical(message: string, details?: Record<string, unknown>): void;
}

export interface RequestScopedLogger {
  log(
    severity: LogSeverity,
    message: string,
    route: string,
    details?: Record<string, unknown>,
  ): void;
}

const TABLE_NAME = "server_runtime_logs";
const LOG_PREFIX = "[Logger]";

const isNode =
  typeof process !== "undefined" && process.versions?.node != null;

function pickString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

class Logger {
  private client: SupabaseClient | null = null;
  private hasWarnedMissingEnv = false;

  // -- Convenience methods (from runtimeLogger) -------------------------

  public verbose(message: string, details?: Record<string, unknown>): void {
    this.emitLocal("verbose", message, details);
    void this.write({ severity: "verbose", message, details });
  }

  public info(message: string, details?: Record<string, unknown>): void {
    this.emitLocal("info", message, details);
    void this.write({ severity: "info", message, details });
  }

  public warning(message: string, details?: Record<string, unknown>): void {
    this.emitLocal("warning", message, details);
    void this.write({ severity: "warning", message, details });
  }

  public error(message: string, details?: Record<string, unknown>): void {
    this.emitLocal("error", message, details);
    void this.write({ severity: "error", message, details });
  }

  public critical(message: string, details?: Record<string, unknown>): void {
    this.emitLocal("critical", message, details);
    void this.write({ severity: "critical", message, details });
  }

  // -- Context logger (from runtimeLogger) ------------------------------

  public fromContext(context: {
    agentName?: string;
    ticketId?: string;
    runId?: string;
    requestId?: string;
    route?: string;
    source?: string;
  }): ScopedLogger {
    const base = {
      agentName: context.agentName,
      ticketId: context.ticketId,
      runId: context.runId,
      requestId: context.requestId,
      route: context.route,
      source: context.source,
    };

    return {
      verbose: (message, details) =>
        void this.write({ severity: "verbose", message, details, ...base }),
      info: (message, details) =>
        void this.write({ severity: "info", message, details, ...base }),
      warning: (message, details) =>
        void this.write({ severity: "warning", message, details, ...base }),
      error: (message, details) =>
        void this.write({ severity: "error", message, details, ...base }),
      critical: (message, details) =>
        void this.write({ severity: "critical", message, details, ...base }),
    };
  }

  // -- Scoped logger (from clientLogger) --------------------------------

  public scoped(scope: string): ScopedLogger {
    return {
      verbose: (msg, details) => this.verbose(`[${scope}] ${msg}`, details),
      info: (msg, details) => this.info(`[${scope}] ${msg}`, details),
      warning: (msg, details) => this.warning(`[${scope}] ${msg}`, details),
      error: (msg, details) => this.error(`[${scope}] ${msg}`, details),
      critical: (msg, details) => this.critical(`[${scope}] ${msg}`, details),
    };
  }

  // -- Request-scoped logger (from clientLogger) ------------------------

  public withRequestId(
    requestId: string,
    source: string = "gemini_service",
  ): RequestScopedLogger {
    return {
      log: (severity, message, route, details) => {
        this.emitLocal(severity, message, details);
        void this.writeWithContext(
          severity,
          message,
          { request_id: requestId, route, source },
          details,
        );
      },
    };
  }

  // -- Core write -------------------------------------------------------

  public async write(entry: LogEntry): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) return;

    try {
      const details = entry.details ?? {};
      const inferredAgentName =
        entry.agentName ??
        pickString(details, ["agentName", "agent_name", "agent"]) ??
        entry.source ??
        pickString(details, ["source"]);
      const inferredTicketId =
        entry.ticketId ?? pickString(details, ["ticketId", "ticket_id"]);
      const inferredRunId =
        entry.runId ?? pickString(details, ["runId", "run_id"]);
      const inferredRequestId =
        entry.requestId ?? pickString(details, ["requestId", "request_id"]);
      const inferredRoute =
        entry.route ?? pickString(details, ["route"]);
      const inferredSource =
        entry.source ?? pickString(details, ["source"]);

      const payload = {
        severity: entry.severity,
        message: entry.message,
        details,
        agent_name: inferredAgentName ?? null,
        ticket_id: inferredTicketId ?? null,
        run_id: inferredRunId ?? null,
        request_id: inferredRequestId ?? null,
        route: inferredRoute ?? null,
        source: inferredSource ?? null,
        process_id: isNode ? process.pid : null,
        occurred_at: entry.occurredAt ?? new Date().toISOString(),
      };

      const { error } = await client.from(TABLE_NAME).insert(payload);
      if (error) {
        console.warn(`${LOG_PREFIX} Failed to write log`, {
          message: error.message,
        });
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Unexpected logging failure`, { error });
    }
  }

  // -- Internals --------------------------------------------------------

  private async writeWithContext(
    severity: LogSeverity,
    message: string,
    context: { request_id: string; route: string; source: string },
    details?: Record<string, unknown>,
  ): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) return;

    try {
      const { error } = await client.from(TABLE_NAME).insert({
        severity,
        message,
        details: details ?? {},
        source: context.source,
        request_id: context.request_id,
        route: context.route,
        process_id: isNode ? process.pid : null,
        occurred_at: new Date().toISOString(),
      });

      if (error) {
        console.warn(`${LOG_PREFIX} Failed to write log`, {
          message: error.message,
        });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Unexpected logging failure`, { err });
    }
  }

  private emitLocal(
    severity: LogSeverity,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const payload = {
      severity,
      message,
      details: details ?? {},
      occurredAt: new Date().toISOString(),
      ...(isNode ? { processId: process.pid } : {}),
    };

    switch (severity) {
      case "verbose":
        console.log(`${LOG_PREFIX} Verbose`, payload);
        break;
      case "info":
        console.log(`${LOG_PREFIX} Info`, payload);
        break;
      case "warning":
        console.warn(`${LOG_PREFIX} Warning`, payload);
        break;
      case "error":
        console.error(`${LOG_PREFIX} Error`, payload);
        break;
      case "critical":
        console.error(`${LOG_PREFIX} Critical`, payload);
        break;
      default:
        console.log(`${LOG_PREFIX} Log`, payload);
        break;
    }
  }

  private getOrCreateClient(): SupabaseClient | null {
    if (this.client) return this.client;

    let url = "";
    let key = "";

    if (isNode) {
      url = process.env.SUPABASE_URL ?? "";
      key =
        process.env.SUPABASE_SERVICE_ROLE_KEY ??
        process.env.SUPABASE_ANON_KEY ??
        "";
    } else {
      // Browser — read from Vite env
      try {
        const env = (import.meta as any).env ?? {};
        url = env.VITE_SUPABASE_URL ?? "";
        key = env.VITE_SUPABASE_ANON_KEY ?? "";
      } catch {
        // import.meta.env not available
      }
    }

    if (!url || !key) {
      if (!this.hasWarnedMissingEnv) {
        console.warn(`${LOG_PREFIX} Supabase env missing; logging disabled.`);
        this.hasWarnedMissingEnv = true;
      }
      return null;
    }

    this.client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return this.client;
  }
}

// Singleton — import { log } from 'lib/logger'
export const log = new Logger();
