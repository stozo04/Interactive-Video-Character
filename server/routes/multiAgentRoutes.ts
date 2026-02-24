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

interface MultiAgentRouterOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
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

  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > maxBytes) {
      throw new Error("Request body exceeds 128KB limit.");
    }
  }

  if (!body.trim()) return {} as T;
  return JSON.parse(body) as T;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export function createMultiAgentRouter(options: MultiAgentRouterOptions) {
  const supabase = createSupabaseClient(options);

  return async function routeMultiAgentRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!req.url) return false;

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith("/multi-agent")) return false;

    if (req.method === "OPTIONS") {
      writeJson(res, 204, { ok: true });
      return true;
    }

    const segments = pathname.split("/").filter(Boolean);

    if (segments.length === 2 && segments[1] === "health" && req.method === "GET") {
      const startedAt = Date.now();
      const { error } = await supabase
        .from("engineering_tickets")
        .select("id", { count: "exact", head: true });

      if (error) {
        log.error(`${LOG_PREFIX} Health check failed`, {
          source: "multiAgentRoutes.ts",
          error: error.message,
        });
        writeJson(res, 503, { ok: false, error: "Supabase unreachable." });
        return true;
      }

      writeJson(res, 200, { ok: true, latencyMs: Date.now() - startedAt });
      return true;
    }

    if (segments.length === 2 && segments[1] === "server" && req.method === "POST") {
      // Sub-routes under /multi-agent/server
      // Currently there's only restart, but we parse sub-segments for future expansion.
    }

    if (segments.length === 3 && segments[1] === "server" && segments[2] === "restart" && req.method === "POST") {
      log.info(`${LOG_PREFIX} Server restart requested via API`, { source: "multiAgentRoutes.ts" });
      writeJson(res, 200, { ok: true, message: "Server restarting..." });

      // Touch a trigger file so tsx watch detects a change and restarts the process.
      res.on("finish", () => {
        const triggerPath = path.join(process.cwd(), "server", ".restart-trigger");
        fs.writeFileSync(triggerPath, String(Date.now()));
      });
      return true;
    }

    if (segments.length === 2 && segments[1] === "tickets") {
      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 25);
        const { data, error } = await supabase
          .from("engineering_tickets")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          log.error(`${LOG_PREFIX} Ticket list failed`, {
            source: "multiAgentRoutes.ts",
            error: error.message,
          });
          writeJson(res, 500, { error: "Failed to list tickets." });
          return true;
        }

        writeJson(res, 200, { tickets: data.map(mapTicketRow) });
        return true;
      }

      if (req.method === "POST") {
        const payload = await parseJsonBody<TicketCreatePayload>(req);
        const requestType =
          payload.requestType ??
          payload.request_type ??
          "feature";

        if (!REQUEST_TYPES.includes(requestType as any)) {
          writeJson(res, 400, { error: "Invalid request_type." });
          return true;
        }

        const requestSummary =
          payload.requestSummary ?? payload.request_summary ?? "";
        if (!requestSummary.trim()) {
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

        const { data, error } = await supabase
          .from("engineering_tickets")
          .insert([insertPayload])
          .select("*")
          .single();

        if (error || !data) {
          log.error(`${LOG_PREFIX} Ticket create failed`, {
            source: "multiAgentRoutes.ts",
            error: error?.message ?? "Missing ticket row",
          });
          writeJson(res, 500, { error: "Failed to create ticket." });
          return true;
        }

        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }
    }

    if (segments.length >= 3 && segments[1] === "tickets") {
      const ticketId = decodeURIComponent(segments[2]);

      if (segments.length === 3 && req.method === "GET") {
        const { data, error } = await supabase
          .from("engineering_tickets")
          .select("*")
          .eq("id", ticketId)
          .single();

        if (error) {
          const status = error.code === "PGRST116" ? 404 : 500;
          writeJson(res, status, { error: "Ticket not found." });
          return true;
        }

        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "transition" && req.method === "POST") {
        const payload = await parseJsonBody<TicketTransitionPayload>(req);
        const status = payload.status?.trim();
        const summary = payload.summary?.trim() ?? "";

        if (!status || !TICKET_STATUSES.includes(status as any)) {
          writeJson(res, 400, { error: "Invalid status." });
          return true;
        }

        const { data, error } = await supabase
          .from("engineering_tickets")
          .update({ status })
          .eq("id", ticketId)
          .select("*")
          .single();

        if (error || !data) {
          writeJson(res, 500, { error: "Failed to transition ticket." });
          return true;
        }

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

        const { error: eventError } = await supabase
          .from("engineering_ticket_events")
          .insert([eventPayload]);

        if (eventError) {
          log.warning(`${LOG_PREFIX} Ticket transition event insert failed`, {
            source: "multiAgentRoutes.ts",
            ticketId,
            error: eventError.message,
          });
        }

        writeJson(res, 200, { ticket: mapTicketRow(data) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "clarify" && req.method === "POST") {
        const payload = await parseJsonBody<ClarifyPayload>(req);
        const mode = payload.mode ?? "answer";

        if (mode !== "answer" && mode !== "figure_it_out") {
          writeJson(res, 400, { error: "mode must be 'answer' or 'figure_it_out'." });
          return true;
        }

        if (mode === "answer" && !payload.response?.trim()) {
          writeJson(res, 400, { error: "response is required when mode is 'answer'." });
          return true;
        }

        // Verify ticket is in needs_clarification status
        const { data: current, error: fetchErr } = await supabase
          .from("engineering_tickets")
          .select("status, clarification_questions, additional_details")
          .eq("id", ticketId)
          .single();

        if (fetchErr || !current) {
          writeJson(res, 404, { error: "Ticket not found." });
          return true;
        }

        if (current.status !== "needs_clarification") {
          writeJson(res, 409, { error: `Ticket is in '${current.status}', not 'needs_clarification'.` });
          return true;
        }

        const questions = current.clarification_questions ?? "(no questions recorded)";
        const answerText = mode === "figure_it_out"
          ? "Use your best judgment and proceed without further questions."
          : payload.response!.trim();

        const clarificationBlock = `\n\n--- CLARIFICATION ---\nOpey asked:\n${questions}\n\nAnswer:\n${answerText}`;
        const updatedDetails = (current.additional_details ?? "") + clarificationBlock;

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
          writeJson(res, 500, { error: "Failed to process clarification response." });
          return true;
        }

        log.info(`${LOG_PREFIX} Clarification answered`, {
          source: "multiAgentRoutes.ts",
          ticketId,
          mode,
        });

        writeJson(res, 200, { ticket: mapTicketRow(updated) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "events" && req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        const { data, error } = await supabase
          .from("engineering_ticket_events")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          writeJson(res, 500, { error: "Failed to load ticket events." });
          return true;
        }

        writeJson(res, 200, { events: data.map(mapEventRow) });
        return true;
      }

      if (segments.length === 4 && segments[3] === "turns" && req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        const { data, error } = await supabase
          .from("engineering_agent_turns")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("turn_index", { ascending: false })
          .limit(limit);

        if (error) {
          writeJson(res, 500, { error: "Failed to load ticket turns." });
          return true;
        }

        writeJson(res, 200, { turns: data.map(mapTurnRow) });
        return true;
      }
    }

    if (segments.length === 2 && segments[1] === "chats") {
      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 25);
        const { data, error } = await supabase
          .from("engineering_chat_sessions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          writeJson(res, 500, { error: "Failed to load chat sessions." });
          return true;
        }

        writeJson(res, 200, { sessions: data.map(mapChatSessionRow) });
        return true;
      }

      if (req.method === "POST") {
        const payload = await parseJsonBody<ChatSessionCreatePayload>(req);
        const title = payload.title?.trim() ?? "";
        const mode = payload.mode ?? "direct_agent";

        if (!title) {
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

        const { data, error } = await supabase
          .from("engineering_chat_sessions")
          .insert([insertPayload])
          .select("*")
          .single();

        if (error || !data) {
          writeJson(res, 500, { error: "Failed to create chat session." });
          return true;
        }

        writeJson(res, 200, { session: mapChatSessionRow(data) });
        return true;
      }
    }

    if (segments.length === 4 && segments[1] === "chats" && segments[3] === "messages") {
      const sessionId = decodeURIComponent(segments[2]);

      if (req.method === "GET") {
        const limit = normalizeLimit(url.searchParams.get("limit"), 100);
        const { data, error } = await supabase
          .from("engineering_chat_messages")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .limit(limit);

        if (error) {
          writeJson(res, 500, { error: "Failed to load chat messages." });
          return true;
        }

        writeJson(res, 200, { messages: data.map(mapChatMessageRow) });
        return true;
      }

      if (req.method === "POST") {
        const payload = await parseJsonBody<ChatMessageCreatePayload>(req);
        const messageText = payload.messageText ?? payload.message_text ?? "";
        const role = payload.role ?? "human";

        if (!messageText.trim()) {
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

        const { data, error } = await supabase
          .from("engineering_chat_messages")
          .insert([insertPayload])
          .select("*")
          .limit(1);

        if (error) {
          writeJson(res, 500, { error: "Failed to post chat message." });
          return true;
        }

        const messages = Array.isArray(data) ? data.map(mapChatMessageRow) : [];
        writeJson(res, 200, { messages });
        return true;
      }
    }

    writeJson(res, 404, { error: "Multi-agent route not found." });
    return true;
  };
}
