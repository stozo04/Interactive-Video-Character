import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LogSeverity = "info" | "warning" | "error" | "critical";

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

const TABLE_NAME = "server_runtime_logs";
const LOG_PREFIX = "[RuntimeLogger]";

class RuntimeLogger {
  private client: SupabaseClient | null;
  private hasWarnedMissingEnv: boolean;

  public constructor() {
    // Delay client creation until first write so startup import order does not
    // disable logging before `.env` is loaded.
    this.client = null;
    this.hasWarnedMissingEnv = false;
  }

  public info(message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "info", message, details });
  }

  public warning(message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "warning", message, details });
  }

  public error(message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "error", message, details });
  }

  public critical(message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "critical", message, details });
  }

  // Convenience helpers (reduce boilerplate).
  public ticketInfo(ticketId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "info", message, details, ticketId });
  }

  public ticketWarning(ticketId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "warning", message, details, ticketId });
  }

  public ticketError(ticketId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "error", message, details, ticketId });
  }

  public ticketCritical(ticketId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "critical", message, details, ticketId });
  }

  public agentInfo(agentName: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "info", message, details, agentName });
  }

  public agentWarning(agentName: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "warning", message, details, agentName });
  }

  public agentError(agentName: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "error", message, details, agentName });
  }

  public runError(runId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "error", message, details, runId });
  }

  public runInfo(runId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "info", message, details, runId });
  }

  public runWarning(runId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "warning", message, details, runId });
  }

  public runCritical(runId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "critical", message, details, runId });
  }

  public requestError(requestId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "error", message, details, requestId });
  }

  public requestInfo(requestId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "info", message, details, requestId });
  }

  public requestWarning(requestId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "warning", message, details, requestId });
  }

  public requestCritical(requestId: string, message: string, details?: Record<string, unknown>): void {
    void this.write({ severity: "critical", message, details, requestId });
  }

  public fromContext(context: {
    agentName?: string;
    ticketId?: string;
    runId?: string;
    requestId?: string;
    route?: string;
    source?: string;
  }): {
    info: (message: string, details?: Record<string, unknown>) => void;
    warning: (message: string, details?: Record<string, unknown>) => void;
    error: (message: string, details?: Record<string, unknown>) => void;
    critical: (message: string, details?: Record<string, unknown>) => void;
  } {
    const base = {
      agentName: context.agentName,
      ticketId: context.ticketId,
      runId: context.runId,
      requestId: context.requestId,
      route: context.route,
      source: context.source,
    };

    return {
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

  public async write(entry: LogEntry): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) {
      return;
    }

    try {
      const details = entry.details ?? {};
      const inferredAgentName =
        entry.agentName ??
        pickString(details, ["agentName", "agent_name", "agent"]) ??
        entry.source ??
        pickString(details, ["source"]);
      const inferredTicketId =
        entry.ticketId ??
        pickString(details, ["ticketId", "ticket_id"]);
      const inferredRunId =
        entry.runId ??
        pickString(details, ["runId", "run_id"]);
      const inferredRequestId =
        entry.requestId ??
        pickString(details, ["requestId", "request_id"]);
      const inferredRoute =
        entry.route ??
        pickString(details, ["route"]);
      const inferredSource =
        entry.source ??
        pickString(details, ["source"]);

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
        process_id: entry.processId ?? process.pid,
        occurred_at: entry.occurredAt ?? null,
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

  private getOrCreateClient(): SupabaseClient | null {
    if (this.client) {
      return this.client;
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const supabaseServiceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      if (!this.hasWarnedMissingEnv) {
        console.warn(`${LOG_PREFIX} Supabase env missing; logging disabled.`);
        this.hasWarnedMissingEnv = true;
      }
      return null;
    }

    this.client = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return this.client;
  }
}

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

// Singleton logger for easy usage: import { log } from "./runtimeLogger"
export const log = new RuntimeLogger();
