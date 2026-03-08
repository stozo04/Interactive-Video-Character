import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REQUEST_TYPES, TICKET_STATUSES } from "../agent/opey-dev/types";
import { log } from "../runtimeLogger";

const LOG_PREFIX = "[MultiAgentRoutes]";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type JsonRecord = Record<string, unknown>;

interface OpeyStatusSnapshot {
  alive: boolean;
  currentTicketId: string | undefined;
  lastPollAt: number;
}

interface MultiAgentRouterOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  opey?: {
    getStatus: () => OpeyStatusSnapshot;
    restart: () => void;
  };
}

interface TicketCreatePayload {
  request_type?: string;
  requestType?: string;
  title?: string;
  request_summary?: string;
  requestSummary?: string;
  additional_details?: string;
  additionalDetails?: string;
  source?: string;
  status?: string;
  priority?: string;
  is_ui_related?: boolean;
  isUiRelated?: boolean;
  created_by?: string;
  createdBy?: string;
  runtime_limits?: JsonRecord;
  runtimeLimits?: JsonRecord;
}

interface TicketTransitionPayload {
  status?: string;
  summary?: string;
  actor_name?: string;
  actorName?: string;
}

interface ClarifyPayload {
  response?: string;
  mode?: "answer" | "figure_it_out";
}

interface ChatSessionCreatePayload {
  title?: string;
  mode?: "direct_agent" | "team_room";
  ticket_id?: string;
  ticketId?: string;
  created_by?: string;
  createdBy?: string;
}

interface ChatMessageCreatePayload {
  role?: "human" | "system" | "kera" | "opey" | "claudy";
  message_text?: string;
  messageText?: string;
  metadata?: JsonRecord;
}

function createSupabaseClient(options: MultiAgentRouterOptions): SupabaseClient {
  return createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

function normalizeLimit(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, 1), 500);
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

function createId(): string {
  return crypto.randomUUID();
}

function mapTicketRow(row: any): JsonRecord {
  return {
    id: row.id,
    requestType: row.request_type,
    title: row.title,
    requestSummary: row.request_summary,
    additionalDetails: row.additional_details,
    source: row.source,
    status: row.status,
    priority: row.priority,
    isUiRelated: row.is_ui_related,
    createdBy: row.created_by,
    assignedDevAgent: row.assigned_dev_agent ?? undefined,
    assignedQaAgent: row.assigned_qa_agent ?? undefined,
    currentCycle: row.current_cycle,
    maxCycles: row.max_cycles,
    maxDevAttempts: row.max_dev_attempts,
    artifactRootPath: row.artifact_root_path ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    worktreeBranch: row.worktree_branch ?? undefined,
    executionProfile: row.execution_profile,
    runtimeLimits: row.runtime_limits ?? {},
    finalPrUrl: row.final_pr_url ?? undefined,
    prCreatedAt: row.pr_created_at ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    clarificationQuestions: row.clarification_questions ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: any): JsonRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorName: row.actor_name,
    summary: row.summary,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

function mapTurnRow(row: any): JsonRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    cycleNumber: row.cycle_number,
    turnIndex: row.turn_index,
    agentRole: row.agent_role,
    runtime: row.runtime,
    purpose: row.purpose,
    promptExcerpt: row.prompt_excerpt,
    responseExcerpt: row.response_excerpt,
    verdict: row.verdict ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapChatSessionRow(row: any): JsonRecord {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    ticketId: row.ticket_id ?? undefined,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChatMessageRow(row: any): JsonRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    messageText: row.message_text,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 1024 * 128;
  let body = "";

  log.info("Parsing JSON request body", {
    source: "MultiAgentRouter",
    maxBytes,
  });

  try {
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > maxBytes) {
        const error = "Request body exceeds 128KB limit.";
        log.error(error, {
          source: "MultiAgentRouter",
          bodyLength: body.length,
          maxBytes,
        });
        throw new Error(error);
      }
    }

    log.info("Request body received successfully", {
      source: "MultiAgentRouter",
      bodyLength: body.length,
      isEmpty: !body.trim(),
    });

    if (!body.trim()) {
      return {} as T;
    }

    const parsed = JSON.parse(body) as T;
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      log.error("JSON parse error - invalid JSON syntax", {
        source: "MultiAgentRouter",
        error: err.message,
        bodyLength: body.length,
      });
    } else {
      log.error("Unexpected error parsing request body", {
        source: "MultiAgentRouter",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  log.info("Writing JSON response", {
    source: "MultiAgentRouter",
    statusCode,
    payloadType: typeof payload,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as any).join(", ") : undefined,
  });

  try {
    Object.entries(JSON_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.statusCode = statusCode;
    const jsonString = JSON.stringify(payload);
    res.end(jsonString);
  } catch (err) {
    log.error("Error writing JSON response", {
      source: "MultiAgentRouter",
      statusCode,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function createMultiAgentRouter(options: MultiAgentRouterOptions) {
  const supabase = createSupabaseClient(options);
  const { opey } = options;

  return async function routeMultiAgentRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!req.url) {
      log.warning("Multi-agent route request received with missing URL", {
        source: "MultiAgentRouter",
        method: req.method,
      });
      return false;
    }

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    log.info("Multi-agent route request received", {
      source: "MultiAgentRouter",
      method: req.method,
      pathname,
    });

    if (!pathname.startsWith("/multi-agent")) {
      log.info("Request does not match /multi-agent prefix, skipping", {
        source: "MultiAgentRouter",
        pathname,
      });
      return false;
    }

    if (req.method === "OPTIONS") {
      log.info("Handling CORS preflight request", {
        source: "MultiAgentRouter",
        pathname,
      });
      writeJson(res, 204, { ok: true });
      return true;
    }

    const segments = pathname.split("/").filter(Boolean);
    log.info("Route segments parsed", {
      source: "MultiAgentRouter",
      segmentCount: segments.length,
      segments: segments.join("/"),
    });

    if (segments.length === 2 && segments[1] === "health" && req.method === "GET") {
      log.info("Health check request received", {
        source: "MultiAgentRouter",
        route: "/multi-agent/health",
      });

      const startedAt = Date.now();
      log.info("Querying Supabase for health check", {
        source: "MultiAgentRouter",
        table: "engineering_tickets",
      });

      const { error } = await supabase
        .from("engineering_tickets")
        .select("id", { count: "exact", head: true });

      if (error) {
        const latencyMs = Date.now() - startedAt;
        log.error("Health check failed - Supabase unreachable", {
          source: "MultiAgentRouter",
          error: error.message,
          errorCode: error.code,
          latencyMs,
        });
        writeJson(res, 503, { ok: false, error: "Supabase unreachable." });
        return true;
      }

      const latencyMs = Date.now() - startedAt;
      log.info("Health check passed", {
        source: "MultiAgentRouter",
        latencyMs,
        ok: true,
      });
      writeJson(res, 200, { ok: true, latencyMs });
      return true;
    }

    if (segments.length === 2 && segments[1] === "server" && req.method === "POST") {
      // Sub-routes under /multi-agent/server
      // Currently there's only restart, but we parse sub-segments for future expansion.
    }

    if (segments.length === 3 && segments[1] === "server" && segments[2] === "restart" && req.method === "POST") {
      log.info("Server restart requested via API", {
        source: "MultiAgentRouter",
        route: "/multi-agent/server/restart",
      });

      writeJson(res, 200, { ok: true, message: "Server restarting..." });

      // Touch a trigger file so tsx watch detects a change and restarts the process.
      res.on("finish", () => {
        try {
          const triggerPath = path.join(process.cwd(), "server", ".restart-trigger");
          log.info("Writing restart trigger file", {
            source: "MultiAgentRouter",
            triggerPath,
          });
          fs.writeFileSync(triggerPath, String(Date.now()));
          log.info("Restart trigger file written successfully", {
            source: "MultiAgentRouter",
            triggerPath,
          });
        } catch (err) {
          log.error("Failed to write restart trigger file", {
            source: "MultiAgentRouter",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      return true;
    }

    // GET /multi-agent/opey/health
    if (segments.length === 3 && segments[1] === "opey" && segments[2] === "health" && req.method === "GET") {
      if (!opey) {
        writeJson(res, 503, { ok: false, error: "Opey is not running." });
        return true;
      }
      const status = opey.getStatus();
      writeJson(res, 200, { ok: true, ...status });
      return true;
    }

    // POST /multi-agent/opey/restart
    if (segments.length === 3 && segments[1] === "opey" && segments[2] === "restart" && req.method === "POST") {
      if (!opey) {
        writeJson(res, 503, { ok: false, error: "Opey is not running." });
        return true;
      }
      opey.restart();
      log.info("Opey poll loop restarted via API", { source: "MultiAgentRouter" });
      writeJson(res, 200, { ok: true, message: "Opey poll loop restarted." });
      return true;
    }

    if (segments.length === 2 && segments[1] === "tickets") {
      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 25);
        log.info("Fetching ticket list", {
          source: "MultiAgentRouter",
          route: "/multi-agent/tickets",
          method: "GET",
          limit,
        });

        const { data, error } = await supabase
          .from("engineering_tickets")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          log.error("Failed to fetch ticket list from database", {
            source: "MultiAgentRouter",
            error: error.message,
            errorCode: error.code,
            limit,
          });
          writeJson(res, 500, { error: "Failed to list tickets." });
          return true;
        }

        log.info("Ticket list fetched successfully", {
          source: "MultiAgentRouter",
          ticketCount: data?.length ?? 0,
          limit,
        });
        writeJson(res, 200, { tickets: data.map(mapTicketRow) });
        return true;
      }

      if (req.method === "POST") {
        log.info("Creating new ticket", {
          source: "MultiAgentRouter",
          route: "/multi-agent/tickets",
          method: "POST",
        });

        const payload = await parseJsonBody<TicketCreatePayload>(req);
        const requestType =
          payload.requestType ??
          payload.request_type ??
          "feature";

        log.info("Ticket creation request parsed", {
          source: "MultiAgentRouter",
          requestType,
          hasTitle: !!payload.title,
          hasSummary: !!(payload.requestSummary ?? payload.request_summary),
        });

        if (!REQUEST_TYPES.includes(requestType as any)) {
          log.warning("Invalid request_type for ticket creation", {
            source: "MultiAgentRouter",
            requestType,
            validTypes: REQUEST_TYPES.join(", "),
          });
          writeJson(res, 400, { error: "Invalid request_type." });
          return true;
        }

        const requestSummary =
          payload.requestSummary ?? payload.request_summary ?? "";
        if (!requestSummary.trim()) {
          log.warning("request_summary is missing or empty", {
            source: "MultiAgentRouter",
          });
          writeJson(res, 400, { error: "request_summary is required." });
          return true;
        }

        const insertPayload = {
          id: createId(),
          request_type: requestType,
          title: payload.title ?? "",
          request_summary: requestSummary,
          additional_details:
            payload.additionalDetails ?? payload.additional_details ?? "",
          source: payload.source ?? "manual",
          status: payload.status ?? "created",
          priority: payload.priority ?? "normal",
          is_ui_related: parseBoolean(
            payload.isUiRelated ?? payload.is_ui_related,
            false,
          ),
          created_by: payload.createdBy ?? payload.created_by ?? "",
          runtime_limits: payload.runtimeLimits ?? payload.runtime_limits ?? {},
        };

        log.info("Inserting ticket into database", {
          source: "MultiAgentRouter",
          ticketId: insertPayload.id,
          requestType,
          status: insertPayload.status,
          priority: insertPayload.priority,
          source: insertPayload.source,
        });

        const { data, error } = await supabase
          .from("engineering_tickets")
          .insert([insertPayload])
          .select("*")
          .single();

        if (error || !data) {
          log.error("Failed to create ticket in database", {
            source: "MultiAgentRouter",
            ticketId: insertPayload.id,
            error: error?.message ?? "Missing ticket row",
            errorCode: error?.code,
          });
          writeJson(res, 500, { error: "Failed to create ticket." });
          return true;
        }

        log.info("Ticket created successfully", {
          source: "MultiAgentRouter",
          ticketId: data.id,
          requestType: data.request_type,
          status: data.status,
        });
        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }
    }

    if (segments.length >= 3 && segments[1] === "tickets") {
      const ticketId = decodeURIComponent(segments[2]);
      log.info("Ticket-specific request received", {
        source: "MultiAgentRouter",
        ticketId,
        segmentLength: segments.length,
        operation: segments[3] ?? "get_detail",
      });

      if (segments.length === 3 && req.method === "GET") {
        log.info("Fetching ticket details", {
          source: "MultiAgentRouter",
          ticketId,
          route: `/multi-agent/tickets/${ticketId}`,
        });

        const { data, error } = await supabase
          .from("engineering_tickets")
          .select("*")
          .eq("id", ticketId)
          .single();

        if (error) {
          const status = error.code === "PGRST116" ? 404 : 500;
          log.warning("Failed to fetch ticket detail", {
            source: "MultiAgentRouter",
            ticketId,
            errorCode: error.code,
            status,
            message: error.message,
          });
          writeJson(res, status, { error: "Ticket not found." });
          return true;
        }

        log.info("Ticket detail fetched successfully", {
          source: "MultiAgentRouter",
          ticketId: data.id,
          status: data.status,
          requestType: data.request_type,
        });
        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "transition" && req.method === "POST") {
        log.info("Ticket transition request received", {
          source: "MultiAgentRouter",
          ticketId,
          route: `/multi-agent/tickets/${ticketId}/transition`,
        });

        const payload = await parseJsonBody<TicketTransitionPayload>(req);
        const status = payload.status?.trim();
        const summary = payload.summary?.trim() ?? "";

        log.info("Ticket transition payload parsed", {
          source: "MultiAgentRouter",
          ticketId,
          requestedStatus: status,
          hasSummary: !!summary,
          actorName: payload.actorName ?? payload.actor_name ?? "admin_ui",
        });

        if (!status || !TICKET_STATUSES.includes(status as any)) {
          log.warning("Invalid status in ticket transition request", {
            source: "MultiAgentRouter",
            ticketId,
            status,
            validStatuses: TICKET_STATUSES.join(", "),
          });
          writeJson(res, 400, { error: "Invalid status." });
          return true;
        }

        log.info("Updating ticket status in database", {
          source: "MultiAgentRouter",
          ticketId,
          newStatus: status,
        });

        const { data, error } = await supabase
          .from("engineering_tickets")
          .update({ status })
          .eq("id", ticketId)
          .select("*")
          .single();

        if (error || !data) {
          log.error("Failed to update ticket status in database", {
            source: "MultiAgentRouter",
            ticketId,
            newStatus: status,
            error: error?.message ?? "Missing ticket row",
            errorCode: error?.code,
          });
          writeJson(res, 500, { error: "Failed to transition ticket." });
          return true;
        }

        log.info("Ticket status updated successfully", {
          source: "MultiAgentRouter",
          ticketId: data.id,
          oldStatus: data.status,
          newStatus: status,
        });

        const actorName = payload.actorName ?? payload.actor_name ?? "admin_ui";
        const eventPayload = {
          id: createId(),
          ticket_id: ticketId,
          event_type: "status_transition",
          actor_type: "human",
          actor_name: actorName,
          summary,
          payload: { status },
        };

        log.info("Recording ticket transition event", {
          source: "MultiAgentRouter",
          ticketId,
          eventId: eventPayload.id,
          eventType: "status_transition",
          actor: actorName,
        });

        const { error: eventError } = await supabase
          .from("engineering_ticket_events")
          .insert([eventPayload]);

        if (eventError) {
          log.warning("Failed to insert ticket transition event", {
            source: "MultiAgentRouter",
            ticketId,
            eventId: eventPayload.id,
            error: eventError.message,
            errorCode: eventError.code,
          });
        } else {
          log.info("Ticket transition event recorded successfully", {
            source: "MultiAgentRouter",
            ticketId,
            eventId: eventPayload.id,
          });
        }

        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "clarify" && req.method === "POST") {
        log.info("Clarification response request received", {
          source: "MultiAgentRouter",
          ticketId,
          route: `/multi-agent/tickets/${ticketId}/clarify`,
        });

        const payload = await parseJsonBody<ClarifyPayload>(req);
        const mode = payload.mode ?? "answer";

        log.info("Clarification payload parsed", {
          source: "MultiAgentRouter",
          ticketId,
          mode,
          hasResponse: !!payload.response?.trim(),
        });

        if (mode !== "answer" && mode !== "figure_it_out") {
          log.warning("Invalid clarification mode", {
            source: "MultiAgentRouter",
            ticketId,
            mode,
            validModes: ["answer", "figure_it_out"],
          });
          writeJson(res, 400, { error: "mode must be 'answer' or 'figure_it_out'." });
          return true;
        }

        if (mode === "answer" && !payload.response?.trim()) {
          log.warning("response missing for answer mode", {
            source: "MultiAgentRouter",
            ticketId,
            mode,
          });
          writeJson(res, 400, { error: "response is required when mode is 'answer'." });
          return true;
        }

        log.info("Fetching current ticket to verify needs_clarification status", {
          source: "MultiAgentRouter",
          ticketId,
        });

        // Verify ticket is in needs_clarification status
        const { data: current, error: fetchErr } = await supabase
          .from("engineering_tickets")
          .select("status, clarification_questions, additional_details")
          .eq("id", ticketId)
          .single();

        if (fetchErr || !current) {
          log.warning("Failed to fetch ticket for clarification", {
            source: "MultiAgentRouter",
            ticketId,
            error: fetchErr?.message ?? "Ticket not found",
          });
          writeJson(res, 404, { error: "Ticket not found." });
          return true;
        }

        if (current.status !== "needs_clarification") {
          log.warning("Ticket is not in needs_clarification status", {
            source: "MultiAgentRouter",
            ticketId,
            currentStatus: current.status,
            expectedStatus: "needs_clarification",
          });
          writeJson(res, 409, { error: `Ticket is in '${current.status}', not 'needs_clarification'.` });
          return true;
        }

        const questions = current.clarification_questions ?? "(no questions recorded)";
        const answerText = mode === "figure_it_out"
          ? "Use your best judgment and proceed without further questions."
          : payload.response!.trim();

        const clarificationBlock = `\n\n--- CLARIFICATION ---\nOpey asked:\n${questions}\n\nAnswer:\n${answerText}`;
        const updatedDetails = (current.additional_details ?? "") + clarificationBlock;

        log.info("Updating ticket with clarification response", {
          source: "MultiAgentRouter",
          ticketId,
          mode,
          clarificationBlockLength: clarificationBlock.length,
          answerLength: answerText.length,
        });

        const { data: updated, error: updateErr } = await supabase
          .from("engineering_tickets")
          .update({
            additional_details: updatedDetails,
            clarification_questions: null,
            status: "created",
            updated_at: new Date().toISOString(),
          })
          .eq("id", ticketId)
          .select("*")
          .single();

        if (updateErr || !updated) {
          log.error("Failed to update ticket with clarification response", {
            source: "MultiAgentRouter",
            ticketId,
            mode,
            error: updateErr?.message ?? "Missing ticket row",
            errorCode: updateErr?.code,
          });
          writeJson(res, 500, { error: "Failed to process clarification response." });
          return true;
        }

        log.info("Clarification response processed successfully", {
          source: "MultiAgentRouter",
          ticketId,
          mode,
          newStatus: updated.status,
        });

        writeJson(res, 200, { ticket: mapTicketRow(updated) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "events" && req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        log.info("Fetching ticket events", {
          source: "MultiAgentRouter",
          ticketId,
          route: `/multi-agent/tickets/${ticketId}/events`,
          limit,
        });

        const { data, error } = await supabase
          .from("engineering_ticket_events")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          log.error("Failed to fetch ticket events", {
            source: "MultiAgentRouter",
            ticketId,
            error: error.message,
            errorCode: error.code,
            limit,
          });
          writeJson(res, 500, { error: "Failed to load ticket events." });
          return true;
        }

        log.info("Ticket events fetched successfully", {
          source: "MultiAgentRouter",
          ticketId,
          eventCount: data?.length ?? 0,
          limit,
        });
        writeJson(res, 200, { events: data.map(mapEventRow) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "turns" && req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        log.info("Fetching ticket agent turns", {
          source: "MultiAgentRouter",
          ticketId,
          route: `/multi-agent/tickets/${ticketId}/turns`,
          limit,
        });

        const { data, error } = await supabase
          .from("engineering_agent_turns")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("turn_index", { ascending: false })
          .limit(limit);

        if (error) {
          log.error("Failed to fetch ticket turns", {
            source: "MultiAgentRouter",
            ticketId,
            error: error.message,
            errorCode: error.code,
            limit,
          });
          writeJson(res, 500, { error: "Failed to load ticket turns." });
          return true;
        }

        log.info("Ticket turns fetched successfully", {
          source: "MultiAgentRouter",
          ticketId,
          turnCount: data?.length ?? 0,
          limit,
        });
        writeJson(res, 200, { turns: data.map(mapTurnRow) });
        return true;
      }
    }

    if (segments.length === 2 && segments[1] === "chats") {
      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 25);
        log.info("Fetching chat sessions list", {
          source: "MultiAgentRouter",
          route: "/multi-agent/chats",
          method: "GET",
          limit,
        });

        const { data, error } = await supabase
          .from("engineering_chat_sessions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          log.error("Failed to fetch chat sessions", {
            source: "MultiAgentRouter",
            error: error.message,
            errorCode: error.code,
            limit,
          });
          writeJson(res, 500, { error: "Failed to load chat sessions." });
          return true;
        }

        log.info("Chat sessions list fetched successfully", {
          source: "MultiAgentRouter",
          sessionCount: data?.length ?? 0,
          limit,
        });
        writeJson(res, 200, { sessions: data.map(mapChatSessionRow) });
        return true;
      }

      if (req.method === "POST") {
        log.info("Creating new chat session", {
          source: "MultiAgentRouter",
          route: "/multi-agent/chats",
          method: "POST",
        });

        const payload = await parseJsonBody<ChatSessionCreatePayload>(req);
        const title = payload.title?.trim() ?? "";
        const mode = payload.mode ?? "direct_agent";

        log.info("Chat session creation payload parsed", {
          source: "MultiAgentRouter",
          title,
          mode,
          hasTicketId: !!(payload.ticketId ?? payload.ticket_id),
          createdBy: payload.createdBy ?? payload.created_by ?? "",
        });

        if (!title) {
          log.warning("Chat session creation missing required title", {
            source: "MultiAgentRouter",
          });
          writeJson(res, 400, { error: "title is required." });
          return true;
        }

        const insertPayload = {
          id: createId(),
          title,
          mode,
          ticket_id: payload.ticketId ?? payload.ticket_id ?? null,
          created_by: payload.createdBy ?? payload.created_by ?? "",
        };

        log.info("Inserting chat session into database", {
          source: "MultiAgentRouter",
          sessionId: insertPayload.id,
          title,
          mode,
          ticketId: insertPayload.ticket_id,
        });

        const { data, error } = await supabase
          .from("engineering_chat_sessions")
          .insert([insertPayload])
          .select("*")
          .single();

        if (error || !data) {
          log.error("Failed to create chat session in database", {
            source: "MultiAgentRouter",
            sessionId: insertPayload.id,
            error: error?.message ?? "Missing session row",
            errorCode: error?.code,
          });
          writeJson(res, 500, { error: "Failed to create chat session." });
          return true;
        }

        log.info("Chat session created successfully", {
          source: "MultiAgentRouter",
          sessionId: data.id,
          title: data.title,
          mode: data.mode,
        });
        writeJson(res, 200, { session: mapChatSessionRow(data) });
        return true;
      }
    }

    if (segments.length === 4 && segments[1] === "chats" && segments[3] === "messages") {
      const sessionId = decodeURIComponent(segments[2]);
      log.info("Chat message request received", {
        source: "MultiAgentRouter",
        sessionId,
        method: req.method,
        route: `/multi-agent/chats/${sessionId}/messages`,
      });

      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        log.info("Fetching chat messages", {
          source: "MultiAgentRouter",
          sessionId,
          limit,
        });

        const { data, error } = await supabase
          .from("engineering_chat_messages")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .limit(limit);

        if (error) {
          log.error("Failed to fetch chat messages", {
            source: "MultiAgentRouter",
            sessionId,
            error: error.message,
            errorCode: error.code,
            limit,
          });
          writeJson(res, 500, { error: "Failed to load chat messages." });
          return true;
        }

        log.info("Chat messages fetched successfully", {
          source: "MultiAgentRouter",
          sessionId,
          messageCount: data?.length ?? 0,
          limit,
        });
        writeJson(res, 200, { messages: data.map(mapChatMessageRow) });
        return true;
      }

      if (req.method === "POST") {
        log.info("Creating new chat message", {
          source: "MultiAgentRouter",
          sessionId,
        });

        const payload = await parseJsonBody<ChatMessageCreatePayload>(req);
        const messageText = payload.messageText ?? payload.message_text ?? "";
        const role = payload.role ?? "human";

        log.info("Chat message payload parsed", {
          source: "MultiAgentRouter",
          sessionId,
          role,
          messageLength: messageText.length,
          hasMetadata: !!payload.metadata && Object.keys(payload.metadata).length > 0,
        });

        if (!messageText.trim()) {
          log.warning("Chat message creation missing required message_text", {
            source: "MultiAgentRouter",
            sessionId,
          });
          writeJson(res, 400, { error: "message_text is required." });
          return true;
        }

        const insertPayload = {
          id: createId(),
          session_id: sessionId,
          role,
          message_text: messageText,
          metadata: payload.metadata ?? {},
        };

        log.info("Inserting chat message into database", {
          source: "MultiAgentRouter",
          sessionId,
          messageId: insertPayload.id,
          role,
          messageLength: messageText.length,
        });

        const { data, error } = await supabase
          .from("engineering_chat_messages")
          .insert([insertPayload])
          .select("*")
          .limit(1);

        if (error) {
          log.error("Failed to create chat message in database", {
            source: "MultiAgentRouter",
            sessionId,
            messageId: insertPayload.id,
            error: error.message,
            errorCode: error.code,
          });
          writeJson(res, 500, { error: "Failed to post chat message." });
          return true;
        }

        const messages = Array.isArray(data) ? data.map(mapChatMessageRow) : [];
        log.info("Chat message created successfully", {
          source: "MultiAgentRouter",
          sessionId,
          messageId: insertPayload.id,
          role,
        });
        writeJson(res, 200, { messages });
        return true;
      }
    }

    log.warning("Multi-agent route not found", {
      source: "MultiAgentRouter",
      method: req.method,
      pathname: url.pathname,
      segments: segments.join("/"),
    });
    writeJson(res, 404, { error: "Multi-agent route not found." });
    return true;
  };
}
