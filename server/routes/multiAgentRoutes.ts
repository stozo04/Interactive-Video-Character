import type { IncomingMessage, ServerResponse } from "node:http";
import { KeraCoordinator } from "../agent/assistant/kera";
import type { EngineeringTicketStore } from "../agent/multiAgent/types";
import { assertValidStatus } from "../agent/multiAgent/statusMachine";
import type { SupabaseChatSessionStore } from "../agent/multiAgent/chatSessionStore";
import { TeamChatRouter } from "../agent/multiAgent/teamChatRouter";
import { MultiAgentOrchestrator } from "../agent/multiAgent/orchestrator";

interface MultiAgentRouteContext {
  ticketStore: EngineeringTicketStore;
  orchestrator: MultiAgentOrchestrator;
  chatStore: SupabaseChatSessionStore;
  teamChatRouter: TeamChatRouter;
}

interface CreateTicketBody {
  requestType?: string;
  title?: string;
  requestSummary?: string;
  additionalDetails?: string;
  source?: string;
  priority?: string;
  isUiRelated?: boolean;
  createdBy?: string;
}

interface KeraTurnBody {
  purpose?: "intake" | "planning" | "status_update";
  prompt?: string;
}

interface OpeyTurnBody {
  purpose?: "planning" | "implementation" | "rework";
  prompt?: string;
}

interface ClaudyTurnBody {
  purpose?: "review" | "rework" | "status_update";
  prompt?: string;
}

interface TicketTransitionBody {
  status?: string;
  summary?: string;
}

interface ChatSessionBody {
  title?: string;
  mode?: "direct_agent" | "team_room";
  ticket_id?: string;
  created_by?: string;
}

interface ChatMessageBody {
  role?: "human" | "system" | "kera" | "opey" | "claudy";
  message_text?: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function routeMultiAgentRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
): Promise<boolean> {
  // Entry point for all `/multi-agent/*` HTTP requests.
  // Returns true if we handled the request, false if another router should handle it.
  if (!req.url) {
    return false;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  // Only handle paths under `/multi-agent/`.
  if (!pathname.startsWith("/multi-agent/")) {
    return false;
  }

  if (req.method === "OPTIONS") {
    // CORS preflight (browser will send this before POST/GET in some cases).
    writeJson(res, 204, { ok: true });
    return true;
  }

  // -----------------------------
  // POST routes (create or mutate)
  // -----------------------------
  if (req.method === "POST" && pathname === "/multi-agent/tickets") {
    await handleCreateTicket(req, res, context);
    return true;
  }

  if (req.method === "POST") {
    // POST /multi-agent/tickets/:id/kera-turn
    const keraTurnMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)\/kera-turn$/);
    if (keraTurnMatch) {
      await handleKeraTurn(req, res, context, keraTurnMatch[1]);
      return true;
    }

    // POST /multi-agent/tickets/:id/opey-turn
    const opeyTurnMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)\/opey-turn$/);
    if (opeyTurnMatch) {
      await handleOpeyTurn(req, res, context, opeyTurnMatch[1]);
      return true;
    }

    // POST /multi-agent/tickets/:id/claudy-turn
    const claudyTurnMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)\/claudy-turn$/);
    if (claudyTurnMatch) {
      await handleClaudyTurn(req, res, context, claudyTurnMatch[1]);
      return true;
    }

    // POST /multi-agent/tickets/:id/transition
    const transitionMatch = pathname.match(
      /^\/multi-agent\/tickets\/([^/]+)\/transition$/,
    );
    if (transitionMatch) {
      await handleTicketTransition(req, res, context, transitionMatch[1]);
      return true;
    }

    // POST /multi-agent/tickets/:id/worktree
    const worktreeMatch = pathname.match(
      /^\/multi-agent\/tickets\/([^/]+)\/worktree$/,
    );
    if (worktreeMatch) {
      await handleEnsureWorktree(req, res, context, worktreeMatch[1]);
      return true;
    }

    // POST /multi-agent/chats
    const chatSessionMatch = pathname === "/multi-agent/chats";
    if (chatSessionMatch) {
      await handleCreateChatSession(req, res, context);
      return true;
    }

    // POST /multi-agent/chats/:id/messages
    const chatMessageMatch = pathname.match(/^\/multi-agent\/chats\/([^/]+)\/messages$/);
    if (chatMessageMatch) {
      await handlePostChatMessage(req, res, context, chatMessageMatch[1]);
      return true;
    }
  }

  // -----------------------------
  // GET routes (read-only)
  // -----------------------------
  if (req.method === "GET" && pathname === "/multi-agent/tickets") {
    const limit = Number(url.searchParams.get("limit") || 25);
    await handleListTickets(res, context, limit);
    return true;
  }

  if (req.method === "GET") {
    // GET /multi-agent/chats
    if (pathname === "/multi-agent/chats") {
      const limit = Number(url.searchParams.get("limit") || 25);
      await handleListChatSessions(res, context, limit);
      return true;
    }

    // GET /multi-agent/tickets/:id/events
    const eventMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)\/events$/);
    if (eventMatch) {
      const limit = Number(url.searchParams.get("limit") || 100);
      await handleListEvents(res, context, eventMatch[1], limit);
      return true;
    }

    // GET /multi-agent/tickets/:id/turns
    const turnsMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)\/turns$/);
    if (turnsMatch) {
      const limit = Number(url.searchParams.get("limit") || 100);
      await handleListTurns(res, context, turnsMatch[1], limit);
      return true;
    }

    // GET /multi-agent/tickets/:id
    const ticketMatch = pathname.match(/^\/multi-agent\/tickets\/([^/]+)$/);
    if (ticketMatch) {
      await handleGetTicket(res, context, ticketMatch[1]);
      return true;
    }

    // GET /multi-agent/chats/:id/messages
    const chatMessagesMatch = pathname.match(/^\/multi-agent\/chats\/([^/]+)\/messages$/);
    if (chatMessagesMatch) {
      const limit = Number(url.searchParams.get("limit") || 100);
      await handleListChatMessages(res, context, chatMessagesMatch[1], limit);
      return true;
    }
  }

  writeJson(res, 404, { error: "Multi-agent route not found." });
  return true;
}

async function handleCreateTicket(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
): Promise<void> {
  // Creates a ticket from intake data (usually from Kayley or manual admin).
  // This uses the KeraCoordinator to normalize the input and persist it.
  let body: CreateTicketBody;

  try {
    body = await parseJsonBody<CreateTicketBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const coordinator = new KeraCoordinator(
    context.ticketStore,
    context.orchestrator,
  );
  const intake = await coordinator.createTicketFromIntake({
    requestType: body.requestType,
    title: body.title,
    requestSummary: body.requestSummary,
    additionalDetails: body.additionalDetails,
    source: body.source,
    priority: body.priority,
    isUiRelated: body.isUiRelated,
    createdBy: body.createdBy,
  });

  // Return the ticket and whether Kera thinks clarification is needed.
  writeJson(res, 201, {
    ticket: intake.ticket,
    needsClarification: intake.needsClarification,
    message: intake.message,
  });
}

async function handleKeraTurn(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Runs a Kera turn (intake/planning/status_update).
  // Requires a prompt. Orchestrator records the turn.
  let body: KeraTurnBody;

  try {
    body = await parseJsonBody<KeraTurnBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const purpose = body.purpose ?? "status_update";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    writeJson(res, 400, { error: "prompt is required for Kera turn." });
    return;
  }

  await context.orchestrator.requestKeraTurn(ticketId, purpose, prompt);
  // 202 Accepted: work has been queued/started.
  writeJson(res, 202, { ok: true });
}

async function handleOpeyTurn(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Runs an Opey turn (planning/implementation/rework).
  // Requires a prompt. Orchestrator records the turn.
  let body: OpeyTurnBody;

  try {
    body = await parseJsonBody<OpeyTurnBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const purpose = body.purpose ?? "planning";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    writeJson(res, 400, { error: "prompt is required for Opey turn." });
    return;
  }

  await context.orchestrator.requestOpeyTurn(ticketId, purpose, prompt);
  // 202 Accepted: work has been queued/started.
  writeJson(res, 202, { ok: true });
}

async function handleClaudyTurn(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Runs a Claudy QA turn (review/rework/status_update).
  // Requires a prompt. Orchestrator records the turn.
  let body: ClaudyTurnBody;

  try {
    body = await parseJsonBody<ClaudyTurnBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const purpose = body.purpose ?? "review";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    writeJson(res, 400, { error: "prompt is required for Claudy turn." });
    return;
  }

  try {
    await context.orchestrator.requestClaudyTurn(ticketId, purpose, prompt);
    // 202 Accepted: work has been queued/started.
    writeJson(res, 202, { ok: true });
  } catch (error) {
    writeJson(res, 500, {
      error: error instanceof Error ? error.message : "Claudy turn failed.",
    });
  }
}

async function handleTicketTransition(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Manually transitions a ticket to a new status (admin use).
  // We validate the status and require a summary for auditing.
  let body: TicketTransitionBody;

  try {
    body = await parseJsonBody<TicketTransitionBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const status = typeof body.status === "string" ? body.status.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!status) {
    writeJson(res, 400, { error: "status is required for transition." });
    return;
  }

  if (!summary) {
    writeJson(res, 400, { error: "summary is required for transition." });
    return;
  }

  let nextStatus: ReturnType<typeof assertValidStatus>;
  try {
    nextStatus = assertValidStatus(status);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid status.",
    });
    return;
  }

  try {
    const ticket = await context.orchestrator.transitionTicketById(
      ticketId,
      nextStatus,
      summary,
    );
    // Return the updated ticket.
    writeJson(res, 200, { ticket });
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Transition failed.",
    });
  }
}

async function handleEnsureWorktree(
  _req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Ensures a worktree exists for this ticket (creates one if missing).
  const ticket = await context.orchestrator.ensureTicketWorktree(ticketId);
  writeJson(res, 200, { ticket });
}

async function handleCreateChatSession(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
): Promise<void> {
  // Creates a new direct agent or team chat session for this ticket.
  let body: ChatSessionBody;

  try {
    body = await parseJsonBody<ChatSessionBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const mode = body.mode === "team_room" ? "team_room" : "direct_agent";
  const createdBy =
    typeof body.created_by === "string" ? body.created_by.trim() : "admin";

  if (!title) {
    writeJson(res, 400, { error: "title is required for chat session." });
    return;
  }

  const session = await context.teamChatRouter.createSession({
    title,
    mode,
    ticketId: typeof body.ticket_id === "string" ? body.ticket_id : undefined,
    createdBy,
  });

  // Return the created chat session.
  writeJson(res, 201, { session });
}

async function handleListChatSessions(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  limit: number,
): Promise<void> {
  // Lists recent chat sessions (admin view).
  const sessions = await context.teamChatRouter.listSessions(limit);
  writeJson(res, 200, { sessions });
}

async function handlePostChatMessage(
  req: IncomingMessage,
  res: ServerResponse,
  context: MultiAgentRouteContext,
  sessionId: string,
): Promise<void> {
  // Posts a message into a chat session (direct agent or team room).
  let body: ChatMessageBody;

  try {
    body = await parseJsonBody<ChatMessageBody>(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body.",
    });
    return;
  }

  const messageText = typeof body.message_text === "string" ? body.message_text.trim() : "";
  if (!messageText) {
    writeJson(res, 400, { error: "message_text is required." });
    return;
  }

  const role = body.role ?? "human";
  const messages = await context.teamChatRouter.postMessage({
    sessionId,
    role,
    messageText,
  });

  // Return updated message list for the session.
  writeJson(res, 200, { messages });
}

async function handleListChatMessages(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  sessionId: string,
  limit: number,
): Promise<void> {
  // Lists recent messages for a given chat session.
  const messages = await context.teamChatRouter.listMessages(sessionId, limit);
  writeJson(res, 200, { messages });
}

async function handleGetTicket(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
): Promise<void> {
  // Fetch a single ticket by id.
  const ticket = await context.ticketStore.getTicket(ticketId);
  if (!ticket) {
    writeJson(res, 404, { error: `Ticket not found: ${ticketId}` });
    return;
  }

  writeJson(res, 200, { ticket });
}

async function handleListTickets(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  limit: number,
): Promise<void> {
  // List tickets (most recent first).
  const tickets = await context.ticketStore.listTickets(limit);
  writeJson(res, 200, { tickets });
}

async function handleListEvents(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
  limit: number,
): Promise<void> {
  // List ticket events (audit trail).
  const events = await context.ticketStore.listEvents(ticketId, limit);
  writeJson(res, 200, { events });
}

async function handleListTurns(
  res: ServerResponse,
  context: MultiAgentRouteContext,
  ticketId: string,
  limit: number,
): Promise<void> {
  // List agent turns (Kera/Opey/Claudy turns).
  const turns = await context.ticketStore.listTurns(ticketId, limit);
  writeJson(res, 200, { turns });
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  // Stream and parse JSON, with a safety size cap.
  const maxBytes = 1024 * 256;
  let body = "";

  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > maxBytes) {
      throw new Error("Request body exceeds 256KB limit.");
    }
  }

  if (!body.trim()) {
    return {} as T;
  }

  return JSON.parse(body) as T;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  // Helper to send JSON responses with CORS headers.
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}
