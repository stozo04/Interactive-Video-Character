export type EngineeringTicketStatus =
  | "created"
  | "intake_acknowledged"
  | "needs_clarification"
  | "requirements_ready"
  | "planning"
  | "implementing"
  | "ready_for_qa"
  | "qa_testing"
  | "qa_changes_requested"
  | "qa_approved"
  | "pr_preparing"
  | "pr_ready"
  | "completed"
  | "failed"
  | "escalated_human"
  | "cancelled";

export type EngineeringRequestType = "skill" | "feature" | "bug";

export interface EngineeringTicket {
  id: string;
  requestType: EngineeringRequestType;
  title: string;
  requestSummary: string;
  additionalDetails: string;
  source: string;
  status: EngineeringTicketStatus;
  priority: string;
  isUiRelated: boolean;
  createdBy: string;
  assignedDevAgent?: string;
  assignedQaAgent?: string;
  currentCycle: number;
  maxCycles: number;
  maxDevAttempts: number;
  artifactRootPath?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  executionProfile: string;
  runtimeLimits: Record<string, unknown>;
  finalPrUrl?: string;
  prCreatedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringTicketEvent {
  id: string;
  ticketId: string;
  eventType: string;
  actorType: string;
  actorName: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EngineeringAgentTurn {
  id: string;
  ticketId: string;
  cycleNumber: number;
  turnIndex: number;
  agentRole: string;
  runtime: string;
  purpose: string;
  promptExcerpt: string;
  responseExcerpt: string;
  verdict?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EngineeringChatSession {
  id: string;
  title: string;
  mode: "direct_agent" | "team_room";
  ticketId?: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringChatMessage {
  id: string;
  sessionId: string;
  role: "human" | "system" | "kera" | "opey" | "claudy";
  messageText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface TicketListResponseBody {
  tickets?: EngineeringTicket[];
  error?: string;
}

interface ChatSessionsResponseBody {
  sessions?: EngineeringChatSession[];
  error?: string;
}

interface ChatMessagesResponseBody {
  messages?: EngineeringChatMessage[];
  error?: string;
}

interface TicketResponseBody {
  ticket?: EngineeringTicket;
  error?: string;
}

interface TicketEventsResponseBody {
  events?: EngineeringTicketEvent[];
  error?: string;
}

interface TicketTurnsResponseBody {
  turns?: EngineeringAgentTurn[];
  error?: string;
}

interface TicketTransitionResponseBody {
  ticket?: EngineeringTicket;
  error?: string;
}

interface TicketCreateResponseBody {
  ticket?: EngineeringTicket;
  needsClarification?: boolean;
  message?: string;
  error?: string;
}

export interface MultiAgentTicketsResult {
  ok: boolean;
  httpStatus: number | null;
  tickets: EngineeringTicket[];
  error?: string;
}

export interface MultiAgentTicketResult {
  ok: boolean;
  httpStatus: number | null;
  ticket?: EngineeringTicket;
  error?: string;
}

export interface MultiAgentEventsResult {
  ok: boolean;
  httpStatus: number | null;
  events: EngineeringTicketEvent[];
  error?: string;
}

export interface MultiAgentTurnsResult {
  ok: boolean;
  httpStatus: number | null;
  turns: EngineeringAgentTurn[];
  error?: string;
}

export interface MultiAgentChatSessionsResult {
  ok: boolean;
  httpStatus: number | null;
  sessions: EngineeringChatSession[];
  error?: string;
}

export interface MultiAgentChatMessagesResult {
  ok: boolean;
  httpStatus: number | null;
  messages: EngineeringChatMessage[];
  error?: string;
}

export interface MultiAgentChatSessionResult {
  ok: boolean;
  httpStatus: number | null;
  session?: EngineeringChatSession;
  error?: string;
}

export interface MultiAgentHealthResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs?: number;
  error?: string;
}

export interface MultiAgentCreateTicketResult {
  ok: boolean;
  httpStatus: number | null;
  ticket?: EngineeringTicket;
  needsClarification?: boolean;
  message?: string;
  error?: string;
}

const LOG_PREFIX = "[MultiAgentService]";
const DEFAULT_AGENT_BASE_URL = "http://localhost:4010";

function getBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_WORKSPACE_AGENT_URL as string | undefined;
  if (configuredUrl && configuredUrl.trim()) {
    return configuredUrl.trim().replace(/\/+$/, "");
  }

  if (import.meta.env.DEV) {
    return "";
  }

  const rawBaseUrl = DEFAULT_AGENT_BASE_URL.trim();
  return rawBaseUrl.replace(/\/+$/, "");
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: `Multi-agent returned non-JSON response: ${text.slice(0, 160)}` } as T;
  }
}

export interface ServerRestartResult {
  ok: boolean;
  httpStatus: number | null;
  message?: string;
  error?: string;
}

export async function restartServer(): Promise<ServerRestartResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/server/restart`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await parseResponse<{ ok?: boolean; message?: string; error?: string }>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: body.error || `Server restart failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      message: body.message,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Server restart failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function listEngineeringTickets(limit = 25): Promise<MultiAgentTicketsResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25;
  const endpoint = `${getBaseUrl()}/multi-agent/tickets?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<TicketListResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        tickets: [],
        error: body.error || `Ticket list failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      tickets: Array.isArray(body.tickets) ? body.tickets : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket list failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      tickets: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function getMultiAgentHealth(): Promise<MultiAgentHealthResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/health`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<{ ok?: boolean; latencyMs?: number; error?: string }>(
      response,
    );

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: body.error || `Health check failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : undefined,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Health check failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function getEngineeringTicket(
  ticketId: string,
): Promise<MultiAgentTicketResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/tickets/${encodeURIComponent(ticketId)}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<TicketResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: body.error || `Ticket fetch failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      ticket: body.ticket,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket fetch failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function listEngineeringTicketEvents(
  ticketId: string,
  limit = 100,
): Promise<MultiAgentEventsResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  const endpoint = `${getBaseUrl()}/multi-agent/tickets/${encodeURIComponent(
    ticketId,
  )}/events?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<TicketEventsResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        events: [],
        error: body.error || `Ticket events failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      events: Array.isArray(body.events) ? body.events : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket events failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      events: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function listEngineeringTicketTurns(
  ticketId: string,
  limit = 100,
): Promise<MultiAgentTurnsResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  const endpoint = `${getBaseUrl()}/multi-agent/tickets/${encodeURIComponent(
    ticketId,
  )}/turns?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<TicketTurnsResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        turns: [],
        error: body.error || `Ticket turns failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      turns: Array.isArray(body.turns) ? body.turns : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket turns failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      turns: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function transitionEngineeringTicket(
  ticketId: string,
  status: EngineeringTicketStatus,
  summary: string,
): Promise<MultiAgentTicketResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/tickets/${encodeURIComponent(
    ticketId,
  )}/transition`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, summary }),
    });
    const body = await parseResponse<TicketTransitionResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error:
          body.error ||
          `Ticket transition failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      ticket: body.ticket,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket transition failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function createEngineeringTicket(payload: {
  requestType?: EngineeringRequestType;
  title?: string;
  requestSummary?: string;
  additionalDetails?: string;
  source?: string;
  priority?: string;
  isUiRelated?: boolean;
  createdBy?: string;
}): Promise<MultiAgentCreateTicketResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/tickets`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await parseResponse<TicketCreateResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error:
          body.error ||
          `Ticket creation failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      ticket: body.ticket,
      needsClarification: body.needsClarification,
      message: body.message,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Ticket creation failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function listChatSessions(
  limit = 25,
): Promise<MultiAgentChatSessionsResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25;
  const endpoint = `${getBaseUrl()}/multi-agent/chats?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<ChatSessionsResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        sessions: [],
        error: body.error || `Chat session list failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Chat session list failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      sessions: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function createChatSession(payload: {
  title: string;
  mode: "direct_agent" | "team_room";
  ticketId?: string;
  createdBy?: string;
}): Promise<MultiAgentChatSessionResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/chats`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        mode: payload.mode,
        ticket_id: payload.ticketId,
        created_by: payload.createdBy,
      }),
    });
    const body = await parseResponse<{ session?: EngineeringChatSession; error?: string }>(
      response,
    );

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: body.error || `Chat session create failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      session: body.session,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Chat session create failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function listChatMessages(
  sessionId: string,
  limit = 100,
): Promise<MultiAgentChatMessagesResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  const endpoint = `${getBaseUrl()}/multi-agent/chats/${encodeURIComponent(
    sessionId,
  )}/messages?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse<ChatMessagesResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        messages: [],
        error: body.error || `Chat messages failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      messages: Array.isArray(body.messages) ? body.messages : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Chat messages failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      messages: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}

export async function postChatMessage(input: {
  sessionId: string;
  role?: "human" | "system" | "kera" | "opey" | "claudy";
  messageText: string;
}): Promise<MultiAgentChatMessagesResult> {
  const endpoint = `${getBaseUrl()}/multi-agent/chats/${encodeURIComponent(
    input.sessionId,
  )}/messages`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: input.role,
        message_text: input.messageText,
      }),
    });
    const body = await parseResponse<ChatMessagesResponseBody>(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        messages: [],
        error: body.error || `Chat message failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      messages: Array.isArray(body.messages) ? body.messages : [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Chat message failed`, { error });
    return {
      ok: false,
      httpStatus: null,
      messages: [],
      error: "Multi-agent service is unreachable.",
    };
  }
}
