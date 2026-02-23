import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AGENT_ROLES,
  ARTIFACT_STATUSES,
  REQUEST_TYPES,
  TICKET_EVENT_ACTOR_TYPES,
  TICKET_STATUSES,
  type EngineeringAgentTurn,
  type EngineeringArtifact,
  type EngineeringTicket,
  type EngineeringTicketEvent,
  type EngineeringTicketStatus,
  type EngineeringTicketStore,
} from "./types";

// Supabase table names for multi-agent workflow.
const TICKETS_TABLE = "engineering_tickets";
const EVENTS_TABLE = "engineering_ticket_events";
const TURNS_TABLE = "engineering_agent_turns";
const ARTIFACTS_TABLE = "engineering_artifacts";
const LOG_PREFIX = "[MultiAgentTicketStore]";

interface SupabaseTicketStoreOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

interface EngineeringTicketRow {
  id: string;
  request_type: string;
  title: string;
  request_summary: string;
  additional_details: string;
  source: string;
  status: string;
  priority: string;
  is_ui_related: boolean;
  created_by: string;
  assigned_dev_agent: string | null;
  assigned_qa_agent: string | null;
  current_cycle: number;
  max_cycles: number;
  max_dev_attempts: number;
  artifact_root_path: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  execution_profile: string;
  runtime_limits: unknown;
  final_pr_url: string | null;
  pr_created_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EngineeringTicketEventRow {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_type: string;
  actor_name: string;
  summary: string;
  payload: unknown;
  created_at: string;
}

interface EngineeringAgentTurnRow {
  id: string;
  ticket_id: string;
  cycle_number: number;
  turn_index: number;
  agent_role: string;
  runtime: string;
  purpose: string;
  prompt_excerpt: string;
  response_excerpt: string;
  verdict: string | null;
  metadata: unknown;
  created_at: string;
}

interface EngineeringArtifactRow {
  id: string;
  ticket_id: string;
  artifact_type: string;
  path: string;
  status: string;
  created_by_agent: string;
  workspace_run_id: string | null;
  created_at: string;
  updated_at: string;
}

// SupabaseTicketStore is the persistence layer for tickets, events, turns, artifacts.
export class SupabaseTicketStore implements EngineeringTicketStore {
  private readonly client: SupabaseClient;

  private sequence = 0;

  public constructor(options: SupabaseTicketStoreOptions) {
    // Create a Supabase client with service role credentials (server-side only).
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

  public async createTicket(
    ticket: Omit<
      EngineeringTicket,
      "id" | "createdAt" | "updatedAt" | "runtimeLimits"
    > & { runtimeLimits?: Record<string, unknown> },
  ): Promise<EngineeringTicket> {
    // Generate id + timestamps and persist the ticket.
    const ticketId = this.generateTicketId();
    const now = new Date().toISOString();
    const nextTicket: EngineeringTicket = {
      ...ticket,
      id: ticketId,
      runtimeLimits: ticket.runtimeLimits ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const { error } = await this.client.from(TICKETS_TABLE).insert({
      id: nextTicket.id,
      request_type: nextTicket.requestType,
      title: nextTicket.title,
      request_summary: nextTicket.requestSummary,
      additional_details: nextTicket.additionalDetails,
      source: nextTicket.source,
      status: nextTicket.status,
      priority: nextTicket.priority,
      is_ui_related: nextTicket.isUiRelated,
      created_by: nextTicket.createdBy,
      assigned_dev_agent: nextTicket.assignedDevAgent ?? null,
      assigned_qa_agent: nextTicket.assignedQaAgent ?? null,
      current_cycle: nextTicket.currentCycle,
      max_cycles: nextTicket.maxCycles,
      max_dev_attempts: nextTicket.maxDevAttempts,
      artifact_root_path: nextTicket.artifactRootPath ?? null,
      worktree_path: nextTicket.worktreePath ?? null,
      worktree_branch: nextTicket.worktreeBranch ?? null,
      execution_profile: nextTicket.executionProfile,
      runtime_limits: nextTicket.runtimeLimits,
      final_pr_url: nextTicket.finalPrUrl ?? null,
      pr_created_at: nextTicket.prCreatedAt ?? null,
      failure_reason: nextTicket.failureReason ?? null,
      created_at: nextTicket.createdAt,
      updated_at: nextTicket.updatedAt,
    });

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to create ticket ${ticketId}: ${error.message}`,
      );
    }

    return { ...nextTicket, runtimeLimits: { ...nextTicket.runtimeLimits } };
  }

  // Fetch a single ticket by id.
  public async getTicket(ticketId: string): Promise<EngineeringTicket | null> {
    const { data, error } = await this.client
      .from(TICKETS_TABLE)
      .select("*")
      .eq("id", ticketId)
      .maybeSingle<EngineeringTicketRow>();

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to fetch ticket ${ticketId}: ${error.message}`,
      );
    }

    if (!data) {
      return null;
    }

    return mapTicketRow(data);
  }

  // List most recent tickets (default limit 25).
  public async listTickets(limit = 25): Promise<EngineeringTicket[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(TICKETS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(normalizedLimit)
      .returns<EngineeringTicketRow[]>();

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to list tickets: ${error.message}`);
    }

    return (data || []).map((row) => mapTicketRow(row));
  }

  // List tickets filtered by status (oldest first so we process FIFO).
  public async listTicketsByStatus(
    status: EngineeringTicketStatus,
    limit = 25,
  ): Promise<EngineeringTicket[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(TICKETS_TABLE)
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(normalizedLimit)
      .returns<EngineeringTicketRow[]>();

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to list tickets by status ${status}: ${error.message}`,
      );
    }

    return (data || []).map((row) => mapTicketRow(row));
  }

  // Update a ticket using a functional updater for safety.
  public async updateTicket(
    ticketId: string,
    updater: (current: EngineeringTicket) => EngineeringTicket,
  ): Promise<EngineeringTicket | null> {
    const current = await this.getTicket(ticketId);
    if (!current) {
      return null;
    }

    const candidate = updater({ ...current, runtimeLimits: { ...current.runtimeLimits } });
    const next: EngineeringTicket = {
      ...candidate,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      runtimeLimits: { ...candidate.runtimeLimits },
    };

    const { error } = await this.client.from(TICKETS_TABLE).upsert(
      {
        id: next.id,
        request_type: next.requestType,
        title: next.title,
        request_summary: next.requestSummary,
        additional_details: next.additionalDetails,
        source: next.source,
        status: next.status,
        priority: next.priority,
        is_ui_related: next.isUiRelated,
        created_by: next.createdBy,
        assigned_dev_agent: next.assignedDevAgent ?? null,
        assigned_qa_agent: next.assignedQaAgent ?? null,
        current_cycle: next.currentCycle,
        max_cycles: next.maxCycles,
        max_dev_attempts: next.maxDevAttempts,
        artifact_root_path: next.artifactRootPath ?? null,
        worktree_path: next.worktreePath ?? null,
        worktree_branch: next.worktreeBranch ?? null,
        execution_profile: next.executionProfile,
        runtime_limits: next.runtimeLimits,
        final_pr_url: next.finalPrUrl ?? null,
        pr_created_at: next.prCreatedAt ?? null,
        failure_reason: next.failureReason ?? null,
        created_at: next.createdAt,
        updated_at: next.updatedAt,
      },
      { onConflict: "id" },
    );

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to update ticket ${ticketId}: ${error.message}`,
      );
    }

    return { ...next, runtimeLimits: { ...next.runtimeLimits } };
  }

  // Append a ticket event (audit trail).
  public async appendEvent(
    event: Omit<EngineeringTicketEvent, "id" | "createdAt">,
  ): Promise<EngineeringTicketEvent> {
    const eventId = this.generateEventId();
    const createdAt = new Date().toISOString();
    const nextEvent: EngineeringTicketEvent = {
      ...event,
      id: eventId,
      createdAt,
    };

    const { error } = await this.client.from(EVENTS_TABLE).insert({
      id: nextEvent.id,
      ticket_id: nextEvent.ticketId,
      event_type: nextEvent.eventType,
      actor_type: nextEvent.actorType,
      actor_name: nextEvent.actorName,
      summary: nextEvent.summary,
      payload: nextEvent.payload,
      created_at: nextEvent.createdAt,
    });

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to append event ${eventId}: ${error.message}`,
      );
    }

    return { ...nextEvent, payload: { ...nextEvent.payload } };
  }

  // List recent events for a ticket (newest first).
  public async listEvents(
    ticketId: string,
    limit = 100,
  ): Promise<EngineeringTicketEvent[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(EVENTS_TABLE)
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit)
      .returns<EngineeringTicketEventRow[]>();

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to list events for ${ticketId}: ${error.message}`,
      );
    }

    return (data || []).map((row) => mapEventRow(row));
  }

  // Append an agent turn (Kera/Opey/Claudy).
  public async appendTurn(
    turn: Omit<EngineeringAgentTurn, "id" | "createdAt">,
  ): Promise<EngineeringAgentTurn> {
    const turnId = this.generateTurnId();
    const createdAt = new Date().toISOString();
    const nextTurn: EngineeringAgentTurn = {
      ...turn,
      id: turnId,
      createdAt,
    };

    const { error } = await this.client.from(TURNS_TABLE).insert({
      id: nextTurn.id,
      ticket_id: nextTurn.ticketId,
      cycle_number: nextTurn.cycleNumber,
      turn_index: nextTurn.turnIndex,
      agent_role: nextTurn.agentRole,
      runtime: nextTurn.runtime,
      purpose: nextTurn.purpose,
      prompt_excerpt: nextTurn.promptExcerpt,
      response_excerpt: nextTurn.responseExcerpt,
      verdict: nextTurn.verdict ?? null,
      metadata: nextTurn.metadata,
      created_at: nextTurn.createdAt,
    });

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to append turn ${turnId}: ${error.message}`,
      );
    }

    return { ...nextTurn, metadata: { ...nextTurn.metadata } };
  }

  // List turns in order (ascending by turn index).
  public async listTurns(
    ticketId: string,
    limit = 100,
  ): Promise<EngineeringAgentTurn[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(TURNS_TABLE)
      .select("*")
      .eq("ticket_id", ticketId)
      .order("turn_index", { ascending: true })
      .limit(normalizedLimit)
      .returns<EngineeringAgentTurnRow[]>();

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to list turns for ${ticketId}: ${error.message}`,
      );
    }

    return (data || []).map((row) => mapTurnRow(row));
  }

  // Create a new artifact record (e.g., workspace run or template doc).
  public async createArtifact(
    artifact: Omit<EngineeringArtifact, "id" | "createdAt" | "updatedAt">,
  ): Promise<EngineeringArtifact> {
    const artifactId = this.generateArtifactId();
    const now = new Date().toISOString();
    const nextArtifact: EngineeringArtifact = {
      ...artifact,
      id: artifactId,
      createdAt: now,
      updatedAt: now,
    };

    const { error } = await this.client.from(ARTIFACTS_TABLE).insert({
      id: nextArtifact.id,
      ticket_id: nextArtifact.ticketId,
      artifact_type: nextArtifact.artifactType,
      path: nextArtifact.path,
      status: nextArtifact.status,
      created_by_agent: nextArtifact.createdByAgent,
      workspace_run_id: nextArtifact.workspaceRunId ?? null,
      created_at: nextArtifact.createdAt,
      updated_at: nextArtifact.updatedAt,
    });

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to create artifact ${artifactId}: ${error.message}`,
      );
    }

    return { ...nextArtifact };
  }

  // List artifacts for a ticket (newest first).
  public async listArtifacts(
    ticketId: string,
    limit = 100,
  ): Promise<EngineeringArtifact[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data, error } = await this.client
      .from(ARTIFACTS_TABLE)
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit)
      .returns<EngineeringArtifactRow[]>();

    if (error) {
      throw new Error(
        `${LOG_PREFIX} Failed to list artifacts for ${ticketId}: ${error.message}`,
      );
    }

    return (data || []).map((row) => mapArtifactRow(row));
  }

  // Id helpers (simple timestamp-based ids).
  private generateTicketId(): string {
    this.sequence += 1;
    return `ticket_${Date.now()}_${this.sequence}`;
  }

  private generateEventId(): string {
    this.sequence += 1;
    return `event_${Date.now()}_${this.sequence}`;
  }

  private generateTurnId(): string {
    this.sequence += 1;
    return `turn_${Date.now()}_${this.sequence}`;
  }

  private generateArtifactId(): string {
    this.sequence += 1;
    return `artifact_${Date.now()}_${this.sequence}`;
  }
}

// Row mappers: convert raw Supabase rows into strongly typed objects.
function mapTicketRow(row: EngineeringTicketRow): EngineeringTicket {
  return {
    id: String(row.id),
    requestType: asRequestType(row.request_type),
    title: typeof row.title === "string" ? row.title : "",
    requestSummary: typeof row.request_summary === "string" ? row.request_summary : "",
    additionalDetails:
      typeof row.additional_details === "string" ? row.additional_details : "",
    source: typeof row.source === "string" ? row.source : "",
    status: asTicketStatus(row.status),
    priority: typeof row.priority === "string" ? row.priority : "normal",
    isUiRelated: Boolean(row.is_ui_related),
    createdBy: typeof row.created_by === "string" ? row.created_by : "",
    assignedDevAgent:
      typeof row.assigned_dev_agent === "string" ? row.assigned_dev_agent : undefined,
    assignedQaAgent:
      typeof row.assigned_qa_agent === "string" ? row.assigned_qa_agent : undefined,
    currentCycle: Number.isFinite(row.current_cycle) ? row.current_cycle : 0,
    maxCycles: Number.isFinite(row.max_cycles) ? row.max_cycles : 2,
    maxDevAttempts: Number.isFinite(row.max_dev_attempts) ? row.max_dev_attempts : 2,
    artifactRootPath:
      typeof row.artifact_root_path === "string" ? row.artifact_root_path : undefined,
    worktreePath:
      typeof row.worktree_path === "string" ? row.worktree_path : undefined,
    worktreeBranch:
      typeof row.worktree_branch === "string" ? row.worktree_branch : undefined,
    executionProfile:
      typeof row.execution_profile === "string" ? row.execution_profile : "",
    runtimeLimits: isPlainObject(row.runtime_limits) ? row.runtime_limits : {},
    finalPrUrl:
      typeof row.final_pr_url === "string" ? row.final_pr_url : undefined,
    prCreatedAt: toOptionalIsoString(row.pr_created_at),
    failureReason:
      typeof row.failure_reason === "string" ? row.failure_reason : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEventRow(row: EngineeringTicketEventRow): EngineeringTicketEvent {
  return {
    id: String(row.id),
    ticketId: typeof row.ticket_id === "string" ? row.ticket_id : "",
    eventType: typeof row.event_type === "string" ? row.event_type : "",
    actorType: asActorType(row.actor_type),
    actorName: typeof row.actor_name === "string" ? row.actor_name : "",
    summary: typeof row.summary === "string" ? row.summary : "",
    payload: isPlainObject(row.payload) ? row.payload : {},
    createdAt: toIsoString(row.created_at),
  };
}

function mapTurnRow(row: EngineeringAgentTurnRow): EngineeringAgentTurn {
  return {
    id: String(row.id),
    ticketId: typeof row.ticket_id === "string" ? row.ticket_id : "",
    cycleNumber: Number.isFinite(row.cycle_number) ? row.cycle_number : 0,
    turnIndex: Number.isFinite(row.turn_index) ? row.turn_index : 0,
    agentRole: asAgentRole(row.agent_role),
    runtime: typeof row.runtime === "string" ? row.runtime : "",
    purpose: typeof row.purpose === "string" ? row.purpose : "",
    promptExcerpt:
      typeof row.prompt_excerpt === "string" ? row.prompt_excerpt : "",
    responseExcerpt:
      typeof row.response_excerpt === "string" ? row.response_excerpt : "",
    verdict: typeof row.verdict === "string" ? row.verdict : undefined,
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    createdAt: toIsoString(row.created_at),
  };
}

function mapArtifactRow(row: EngineeringArtifactRow): EngineeringArtifact {
  return {
    id: String(row.id),
    ticketId: typeof row.ticket_id === "string" ? row.ticket_id : "",
    artifactType: typeof row.artifact_type === "string" ? row.artifact_type : "",
    path: typeof row.path === "string" ? row.path : "",
    status: asArtifactStatus(row.status),
    createdByAgent:
      typeof row.created_by_agent === "string" ? row.created_by_agent : "",
    workspaceRunId:
      typeof row.workspace_run_id === "string" ? row.workspace_run_id : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

// Normalizers ensure we always return a valid enum value.
function asRequestType(raw: string): EngineeringTicket["requestType"] {
  return REQUEST_TYPES.includes(raw as EngineeringTicket["requestType"])
    ? (raw as EngineeringTicket["requestType"])
    : "feature";
}

function asTicketStatus(raw: string): EngineeringTicketStatus {
  return TICKET_STATUSES.includes(raw as EngineeringTicketStatus)
    ? (raw as EngineeringTicketStatus)
    : "created";
}

function asActorType(raw: string): EngineeringTicketEvent["actorType"] {
  return TICKET_EVENT_ACTOR_TYPES.includes(raw as EngineeringTicketEvent["actorType"])
    ? (raw as EngineeringTicketEvent["actorType"])
    : "system";
}

function asAgentRole(raw: string): EngineeringAgentTurn["agentRole"] {
  return AGENT_ROLES.includes(raw as EngineeringAgentTurn["agentRole"])
    ? (raw as EngineeringAgentTurn["agentRole"])
    : "opey";
}

function asArtifactStatus(raw: string): EngineeringArtifact["status"] {
  return ARTIFACT_STATUSES.includes(raw as EngineeringArtifact["status"])
    ? (raw as EngineeringArtifact["status"])
    : "draft";
}

// Safely convert unknown timestamps to ISO strings.
function toIsoString(value: unknown): string {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toOptionalIsoString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Prevent tiny or huge limits from breaking queries.
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
