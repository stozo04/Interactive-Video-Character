// Supported ticket types (what kind of work is requested).
export const REQUEST_TYPES = ["skill", "feature", "bug"] as const;
export type EngineeringRequestType = (typeof REQUEST_TYPES)[number];

// Full status enum for the ticket lifecycle.
export const TICKET_STATUSES = [
  "created",
  "intake_acknowledged",
  "needs_clarification",
  "requirements_ready",
  "planning",
  "implementing",
  "ready_for_qa",
  "qa_testing",
  "qa_changes_requested",
  "qa_approved",
  "pr_preparing",
  "pr_ready",
  "completed",
  "failed",
  "escalated_human",
  "cancelled",
] as const;
export type EngineeringTicketStatus = (typeof TICKET_STATUSES)[number];

// Who can emit events in the audit trail.
export const TICKET_EVENT_ACTOR_TYPES = [
  "system",
  "kera",
  "opey",
  "claudy",
  "human",
] as const;
export type EngineeringTicketActorType =
  (typeof TICKET_EVENT_ACTOR_TYPES)[number];

// Agent roles used in turn logs.
export const AGENT_ROLES = ["kera", "opey", "claudy"] as const;
export type EngineeringAgentRole = (typeof AGENT_ROLES)[number];

// Artifact status lifecycle.
export const ARTIFACT_STATUSES = [
  "draft",
  "generated",
  "validated",
  "rejected",
  "final",
] as const;
export type EngineeringArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

// Core ticket record stored in Supabase.
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

// Audit trail event record for a ticket.
export interface EngineeringTicketEvent {
  id: string;
  ticketId: string;
  eventType: string;
  actorType: EngineeringTicketActorType;
  actorName: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// Single agent turn (Kera/Opey/Claudy response).
export interface EngineeringAgentTurn {
  id: string;
  ticketId: string;
  cycleNumber: number;
  turnIndex: number;
  agentRole: EngineeringAgentRole;
  runtime: string;
  purpose: string;
  promptExcerpt: string;
  responseExcerpt: string;
  verdict?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Artifact record (docs, workspace runs, etc.).
export interface EngineeringArtifact {
  id: string;
  ticketId: string;
  artifactType: string;
  path: string;
  status: EngineeringArtifactStatus;
  createdByAgent: string;
  workspaceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

// Background process session record.
export interface ProcessSession {
  sessionId: string;
  command: string;
  workdir: string;
  alive: boolean;
  exitCode: number | null;
  startedAt: string;
}

// Poll result for a background process session.
export interface ProcessSessionStatus {
  sessionId: string;
  alive: boolean;
  exitCode: number | null;
}

// Store interface for tickets, events, turns, and artifacts.
export interface EngineeringTicketStore {
  createTicket(
    ticket: Omit<
      EngineeringTicket,
      "id" | "createdAt" | "updatedAt" | "runtimeLimits"
    > & {
      runtimeLimits?: Record<string, unknown>;
    },
  ): Promise<EngineeringTicket>;
  getTicket(ticketId: string): Promise<EngineeringTicket | null>;
  listTickets(limit?: number): Promise<EngineeringTicket[]>;
  listTicketsByStatus(
    status: EngineeringTicketStatus,
    limit?: number,
  ): Promise<EngineeringTicket[]>;
  updateTicket(
    ticketId: string,
    updater: (current: EngineeringTicket) => EngineeringTicket,
  ): Promise<EngineeringTicket | null>;
  appendEvent(
    event: Omit<EngineeringTicketEvent, "id" | "createdAt">,
  ): Promise<EngineeringTicketEvent>;
  listEvents(ticketId: string, limit?: number): Promise<EngineeringTicketEvent[]>;
  appendTurn(
    turn: Omit<EngineeringAgentTurn, "id" | "createdAt">,
  ): Promise<EngineeringAgentTurn>;
  listTurns(ticketId: string, limit?: number): Promise<EngineeringAgentTurn[]>;
  createArtifact(
    artifact: Omit<EngineeringArtifact, "id" | "createdAt" | "updatedAt">,
  ): Promise<EngineeringArtifact>;
  listArtifacts(
    ticketId: string,
    limit?: number,
  ): Promise<EngineeringArtifact[]>;
}