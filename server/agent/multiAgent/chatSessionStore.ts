import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase table names for team chat sessions/messages.
const SESSIONS_TABLE = "engineering_chat_sessions";
const MESSAGES_TABLE = "engineering_chat_messages";
const LOG_PREFIX = "[ChatSessionStore]";

// ChatSessionMode defines how the chat should behave.
export type ChatSessionMode = "direct_agent" | "team_room";
export type ChatMessageRole = "human" | "system" | "kera" | "opey" | "claudy";

// Chat session record stored in Supabase.
export interface EngineeringChatSession {
  id: string;
  title: string;
  mode: ChatSessionMode;
  ticketId?: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Individual chat message stored in Supabase.
export interface EngineeringChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  messageText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface SupabaseChatSessionStoreOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

interface ChatSessionRow {
  id: string;
  title: string;
  mode: string;
  ticket_id: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  message_text: string;
  metadata: unknown;
  created_at: string;
}

// SupabaseChatSessionStore persists chat sessions and messages.
export class SupabaseChatSessionStore {
  private readonly client: SupabaseClient;
  private sequence = 0;

  public constructor(options: SupabaseChatSessionStoreOptions) {
    // Create server-side Supabase client.
    this.client = createClient(
      options.supabaseUrl,
      options.supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  public async createSession(input: {
    title: string;
    mode: ChatSessionMode;
    ticketId?: string;
    createdBy: string;
  }): Promise<EngineeringChatSession> {
    // Generate id + timestamps and insert new session.
    const id = this.generateId("chat");
    const now = new Date().toISOString();
    const session: EngineeringChatSession = {
      id,
      title: input.title,
      mode: input.mode,
      ticketId: input.ticketId,
      status: "open",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    const { error } = await this.client.from(SESSIONS_TABLE).insert({
      id: session.id,
      title: session.title,
      mode: session.mode,
      ticket_id: session.ticketId ?? null,
      status: session.status,
      created_by: session.createdBy,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to create session: ${error.message}`);
    }

    return { ...session };
  }

  // List recent chat sessions (newest first).
  public async listSessions(limit = 25): Promise<EngineeringChatSession[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(SESSIONS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(normalizedLimit)
      .returns<ChatSessionRow[]>();

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to list sessions: ${error.message}`);
    }

    return (data || []).map((row) => mapSessionRow(row));
  }

  // Fetch a single chat session by id.
  public async getSession(sessionId: string): Promise<EngineeringChatSession | null> {
    const { data, error } = await this.client
      .from(SESSIONS_TABLE)
      .select("*")
      .eq("id", sessionId)
      .maybeSingle<ChatSessionRow>();

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to fetch session: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapSessionRow(data);
  }

  // Append a new message to a session.
  public async addMessage(input: {
    sessionId: string;
    role: ChatMessageRole;
    messageText: string;
    metadata?: Record<string, unknown>;
  }): Promise<EngineeringChatMessage> {
    const id = this.generateId("msg");
    const now = new Date().toISOString();
    const message: EngineeringChatMessage = {
      id,
      sessionId: input.sessionId,
      role: input.role,
      messageText: input.messageText,
      metadata: input.metadata ?? {},
      createdAt: now,
    };

    const { error } = await this.client.from(MESSAGES_TABLE).insert({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      message_text: message.messageText,
      metadata: message.metadata,
      created_at: message.createdAt,
    });

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to add message: ${error.message}`);
    }

    return { ...message, metadata: { ...message.metadata } };
  }

  // List messages for a session in chronological order.
  public async listMessages(
    sessionId: string,
    limit = 100,
  ): Promise<EngineeringChatMessage[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(MESSAGES_TABLE)
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(normalizedLimit)
      .returns<ChatMessageRow[]>();

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to list messages: ${error.message}`);
    }

    return (data || []).map((row) => mapMessageRow(row));
  }

  // Simple id generator (timestamp + sequence).
  private generateId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${Date.now()}_${this.sequence}`;
  }
}

// Row mappers for Supabase results.
function mapSessionRow(row: ChatSessionRow): EngineeringChatSession {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    mode: row.mode === "team_room" ? "team_room" : "direct_agent",
    ticketId: typeof row.ticket_id === "string" ? row.ticket_id : undefined,
    status: typeof row.status === "string" ? row.status : "open",
    createdBy: typeof row.created_by === "string" ? row.created_by : "",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMessageRow(row: ChatMessageRow): EngineeringChatMessage {
  return {
    id: String(row.id),
    sessionId: typeof row.session_id === "string" ? row.session_id : "",
    role: asMessageRole(row.role),
    messageText: typeof row.message_text === "string" ? row.message_text : "",
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    createdAt: toIsoString(row.created_at),
  };
}

// Normalize message roles to supported values.
function asMessageRole(raw: string): ChatMessageRole {
  if (raw === "kera" || raw === "opey" || raw === "claudy") {
    return raw;
  }
  if (raw === "system") {
    return "system";
  }
  return "human";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Convert unknown timestamps into ISO strings safely.
function toIsoString(value: unknown): string {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// Prevent extreme limits from breaking queries.
function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 25;
  }

  const safeLimit = Math.floor(limit);
  if (safeLimit <= 0) {
    return 25;
  }

  return Math.min(safeLimit, 200);
}
