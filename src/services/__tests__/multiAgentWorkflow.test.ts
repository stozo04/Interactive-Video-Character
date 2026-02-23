import { describe, expect, it, vi } from "vitest";
import * as multiAgentService from "../../multiAgentService";
import {
  isAllowedTransition,
} from "../../../server/agent/multiAgent/statusMachine";
import {
  assessEscalationFromTurns,
} from "../../../server/agent/multiAgent/escalationPolicy";
import { DEFAULT_RUNTIME_BOUNDS } from "../../../server/agent/multiAgent/runtimeBounds";
import {
  parseAgentTurnEnvelope,
} from "../../../server/agent/multiAgent/agentTurnSchemas";
import { runTurnWithRepair } from "../../../server/agent/multiAgent/agentCliRunner";
import { WorkspaceRunQueue } from "../../../server/agent/runQueue";
import { InMemoryRunStore } from "../../../server/agent/runStore";
import { WorkspaceRunLinker } from "../../../server/agent/multiAgent/workspaceRunLinker";
import { MultiAgentOrchestrator } from "../../../server/agent/multiAgent/orchestrator";
import { KeraCoordinator } from "../../../server/agent/assistant/kera";
import { assertValidStatus } from "../../../server/agent/multiAgent/statusMachine";
import { assessEscalationFromTicket } from "../../../server/agent/multiAgent/escalationPolicy";
import { executeToolCall } from "../../memoryService";

vi.mock("../../multiAgentService", () => ({
  createEngineeringTicket: vi.fn(),
  getEngineeringTicket: vi.fn(),
  listEngineeringTickets: vi.fn(),
}));
import type {
  EngineeringAgentTurn,
  EngineeringArtifact,
  EngineeringTicket,
  EngineeringTicketEvent,
  EngineeringTicketStore,
} from "../../../server/agent/multiAgent/types";

class InMemoryTicketStore implements EngineeringTicketStore {
  private tickets = new Map<string, EngineeringTicket>();
  private events: EngineeringTicketEvent[] = [];
  private turns: EngineeringAgentTurn[] = [];
  private artifacts: EngineeringArtifact[] = [];
  private sequence = 0;

  public async createTicket(
    ticket: Omit<
      EngineeringTicket,
      "id" | "createdAt" | "updatedAt" | "runtimeLimits"
    > & { runtimeLimits?: Record<string, unknown> },
  ): Promise<EngineeringTicket> {
    const id = this.nextId("ticket");
    const now = new Date().toISOString();
    const record: EngineeringTicket = {
      ...ticket,
      id,
      runtimeLimits: ticket.runtimeLimits ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(id, record);
    return { ...record, runtimeLimits: { ...record.runtimeLimits } };
  }

  public async getTicket(ticketId: string): Promise<EngineeringTicket | null> {
    const ticket = this.tickets.get(ticketId);
    return ticket ? { ...ticket, runtimeLimits: { ...ticket.runtimeLimits } } : null;
  }

  public async listTickets(limit = 25): Promise<EngineeringTicket[]> {
    return Array.from(this.tickets.values()).slice(0, limit);
  }

  public async listTicketsByStatus(
    status: EngineeringTicket["status"],
    limit = 25,
  ): Promise<EngineeringTicket[]> {
    return Array.from(this.tickets.values())
      .filter((ticket) => ticket.status === status)
      .slice(0, limit);
  }

  public async updateTicket(
    ticketId: string,
    updater: (current: EngineeringTicket) => EngineeringTicket,
  ): Promise<EngineeringTicket | null> {
    const current = this.tickets.get(ticketId);
    if (!current) {
      return null;
    }
    const next = updater({ ...current, runtimeLimits: { ...current.runtimeLimits } });
    const updated: EngineeringTicket = {
      ...next,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      runtimeLimits: { ...next.runtimeLimits },
    };
    this.tickets.set(ticketId, updated);
    return { ...updated, runtimeLimits: { ...updated.runtimeLimits } };
  }

  public async appendEvent(
    event: Omit<EngineeringTicketEvent, "id" | "createdAt">,
  ): Promise<EngineeringTicketEvent> {
    const id = this.nextId("event");
    const createdAt = new Date().toISOString();
    const record: EngineeringTicketEvent = { ...event, id, createdAt };
    this.events.push(record);
    return { ...record, payload: { ...record.payload } };
  }

  public async listEvents(ticketId: string): Promise<EngineeringTicketEvent[]> {
    return this.events.filter((event) => event.ticketId === ticketId);
  }

  public async appendTurn(
    turn: Omit<EngineeringAgentTurn, "id" | "createdAt">,
  ): Promise<EngineeringAgentTurn> {
    const id = this.nextId("turn");
    const createdAt = new Date().toISOString();
    const record: EngineeringAgentTurn = { ...turn, id, createdAt };
    this.turns.push(record);
    return { ...record, metadata: { ...record.metadata } };
  }

  public async listTurns(ticketId: string): Promise<EngineeringAgentTurn[]> {
    return this.turns.filter((turn) => turn.ticketId === ticketId);
  }

  public async createArtifact(
    artifact: Omit<EngineeringArtifact, "id" | "createdAt" | "updatedAt">,
  ): Promise<EngineeringArtifact> {
    const id = this.nextId("artifact");
    const now = new Date().toISOString();
    const record: EngineeringArtifact = {
      ...artifact,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.artifacts.push(record);
    return { ...record };
  }

  public async listArtifacts(ticketId: string): Promise<EngineeringArtifact[]> {
    return this.artifacts.filter((artifact) => artifact.ticketId === ticketId);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }
}

describe("Multi-agent status transitions", () => {
  it("allows documented transitions and blocks invalid ones", () => {
    expect(isAllowedTransition("created", "intake_acknowledged")).toBe(true);
    expect(isAllowedTransition("created", "qa_testing")).toBe(false);
  });
});

describe("Escalation policy guardrails", () => {
  it("escalates when turn caps are exceeded", () => {
    const ticket: EngineeringTicket = {
      id: "ticket_1",
      requestType: "feature",
      title: "Test",
      requestSummary: "Test summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const turns: EngineeringAgentTurn[] = Array.from({ length: 9 }, (_, index) => ({
      id: `turn_${index}`,
      ticketId: ticket.id,
      cycleNumber: 0,
      turnIndex: index,
      agentRole: "opey",
      runtime: "codex_cli",
      purpose: "implementation",
      promptExcerpt: "prompt",
      responseExcerpt: "response",
      metadata: {},
      createdAt: new Date().toISOString(),
    }));

    const result = assessEscalationFromTurns(ticket, turns, DEFAULT_RUNTIME_BOUNDS);
    expect(result.shouldEscalate).toBe(true);
  });

  it("escalates when cycle limit is reached", () => {
    const ticket: EngineeringTicket = {
      id: "ticket_cycle",
      requestType: "feature",
      title: "Cycle",
      requestSummary: "Cycle summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 2,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = assessEscalationFromTicket(ticket);
    expect(result.shouldEscalate).toBe(true);
  });
});

describe("Agent turn parsing", () => {
  it("accepts valid Claudy verdicts", () => {
    const payload = JSON.stringify({
      summary: "Looks good",
      requestedActions: [],
      verdict: "approved",
    });

    const result = parseAgentTurnEnvelope(payload);
    expect(result.ok).toBe(true);
    expect(result.parsed?.verdict).toBe("approved");
  });

  it("rejects invalid verdict values", () => {
    const payload = JSON.stringify({
      summary: "Nope",
      requestedActions: [],
      verdict: "maybe",
    });

    const result = parseAgentTurnEnvelope(payload);
    expect(result.ok).toBe(false);
  });
});

describe("Workspace run linking", () => {
  it("creates workspace runs and records artifacts", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_2",
      requestType: "skill",
      title: "Test Skill",
      requestSummary: "Test summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      { action: "mkdir", args: { path: "skills/test" } },
    ]);

    expect(result.links.length).toBe(1);
    expect(runQueue.getActiveRunId()).toBe(result.links[0].runId);
  });

  it("does not duplicate runs for identical requested actions", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_3",
      requestType: "feature",
      title: "Test Feature",
      requestSummary: "Summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const actions = [{ action: "status", args: {} }];
    const first = await linker.linkRequestedActions(ticket, "/tmp/worktree", actions);
    const second = await linker.linkRequestedActions(ticket, "/tmp/worktree", actions);

    expect(first.links.length).toBe(1);
    expect(second.links.length).toBe(0);
  });

  it("captures requested path when provided", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_path",
      requestType: "bug",
      title: "Test Bug",
      requestSummary: "Summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      { action: "write", args: { path: "bugs/test/BUG.md", content: "x" } },
    ]);

    expect(result.links[0].path).toBe("bugs/test/BUG.md");
  });

  it("translates runTests into an allowlisted command workspace run", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_run_tests",
      requestType: "bug",
      title: "Run tests",
      requestSummary: "Validate bug fix",
      additionalDetails: "",
      source: "manual",
      status: "planning",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      {
        action: "runTests",
        args: { goal: "Run the repo tests for validation." },
      },
    ]);

    const run = await runStore.getRun(result.links[0].runId);
    expect(run?.request.action).toBe("command");
    expect(run?.request.args.command).toBe("npm test -- --run");
    expect(run?.request.args.originalAction).toBe("runTests");
  });

  it("defers manualVerify to Claudy QA instead of creating a workspace run", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_manual_verify",
      requestType: "bug",
      title: "Manual verify",
      requestSummary: "QA handoff",
      additionalDetails: "",
      source: "manual",
      status: "planning",
      priority: "normal",
      isUiRelated: true,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      {
        action: "manualVerify",
        args: { steps: ["Check UI header"] },
      },
    ]);

    expect(result.links.length).toBe(0);
    expect(result.deferredActions.length).toBe(1);
    expect(result.deferredActions[0].action).toBe("manualVerify");
    expect(runQueue.getActiveRunId()).toBeNull();
  });

  it("defers semantic implementation placeholders until Opey emits concrete actions", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_semantic_impl",
      requestType: "bug",
      title: "Semantic action defer",
      requestSummary: "Prevent unsupported placeholder actions from failing executor",
      additionalDetails: "",
      source: "manual",
      status: "planning",
      priority: "normal",
      isUiRelated: true,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      { action: "searchRepo", args: { path: ".", query: "Admin Dashboardd" } },
      { action: "inspectUITextSources", args: { areas: ["header"] } },
      { action: "applyFix", args: { goal: "Fix typo" } },
    ]);

    expect(result.links.length).toBe(1);
    expect(result.links[0].action).toBe("search");
    expect(result.deferredActions.map((action) => action.action)).toEqual([
      "inspectUITextSources",
      "applyFix",
    ]);
  });

  it("translates common Opey shell_command actions into executor-supported actions", async () => {
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });
    const ticket: EngineeringTicket = {
      id: "ticket_shell_command_translation",
      requestType: "bug",
      title: "Shell command translation",
      requestSummary: "Normalize Opey shell_command outputs",
      additionalDetails: "",
      source: "manual",
      status: "planning",
      priority: "normal",
      isUiRelated: true,
      createdBy: "test",
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await linker.linkRequestedActions(ticket, "/tmp/worktree", [
      {
        action: "shell_command",
        args: { command: "Get-Content bugs/my-bug/BUG.md" },
      },
      {
        action: "shell_command",
        args: { command: 'rg -n "Admin Dashboardd" .' },
      },
      {
        action: "shell_command",
        args: { command: "npm test -- --run" },
      },
    ]);

    const runs = await Promise.all(result.links.map((link) => runStore.getRun(link.runId)));
    expect(runs.map((run) => run?.request.action)).toEqual(["read", "search", "command"]);
    expect(runs[0]?.request.args.path).toBe("bugs/my-bug/BUG.md");
    expect(runs[1]?.request.args.query).toBe("Admin Dashboardd");
    expect(runs[2]?.request.args.command).toBe("npm test -- --run");
  });
});

describe("Kera intake", () => {
  it("creates a clarification-needed ticket when summary is missing", async () => {
    const store = new InMemoryTicketStore();
    const orchestrator = new MultiAgentOrchestrator({ ticketStore: store });
    const kera = new KeraCoordinator(store, orchestrator);

    const result = await kera.createTicketFromIntake({
      title: "Missing summary",
      requestSummary: "",
    });

    expect(result.needsClarification).toBe(true);
    expect(result.ticket.status).toBe("needs_clarification");
  });
});

describe("Orchestrator intake bootstrap", () => {
  it("creates worktree + bug scaffold when processing an intake-acknowledged bug ticket", async () => {
    const store = new InMemoryTicketStore();
    const fakeWorktreeManager = {
      createWorktree: vi.fn(async (ticketId: string) => ({
        path: `/tmp/.worktrees/${ticketId}`,
        branch: `ticket/${ticketId}`,
      })),
    };
    const fakeArtifactService = {
      scaffoldBugArtifacts: vi.fn(async () => []),
    };

    const ticket = await store.createTicket({
      requestType: "bug",
      title: "Admin Dashboard Typo Fix",
      requestSummary: "Remove the extra d in Admin Dashboardd",
      additionalDetails: "",
      source: "kayley",
      status: "intake_acknowledged",
      priority: "normal",
      isUiRelated: true,
      createdBy: "kayley",
      assignedDevAgent: undefined,
      assignedQaAgent: undefined,
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      artifactRootPath: undefined,
      worktreePath: undefined,
      worktreeBranch: undefined,
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      finalPrUrl: undefined,
      prCreatedAt: undefined,
      failureReason: undefined,
    });

    const orchestrator = new MultiAgentOrchestrator({
      ticketStore: store,
      worktreeManager: fakeWorktreeManager as any,
      artifactService: fakeArtifactService as any,
    });

    const updated = await orchestrator.processNextStep(ticket.id);

    expect(updated.status).toBe("requirements_ready");
    expect(updated.worktreePath).toBe(`/tmp/.worktrees/${ticket.id}`);
    expect(updated.worktreeBranch).toBe(`ticket/${ticket.id}`);
    expect(updated.artifactRootPath).toBe(`/tmp/.worktrees/${ticket.id}`);
    expect(fakeWorktreeManager.createWorktree).toHaveBeenCalledOnce();
    expect(fakeArtifactService.scaffoldBugArtifacts).toHaveBeenCalledOnce();
  });
});

describe("Kera full workflow (intake + transition + turn)", () => {
  it("creates ticket, transitions, logs events, and records turn", async () => {
    const store = new InMemoryTicketStore();
    const createSpy = vi.spyOn(store, "createTicket");
    const updateSpy = vi.spyOn(store, "updateTicket");
    const eventSpy = vi.spyOn(store, "appendEvent");
    const turnSpy = vi.spyOn(store, "appendTurn");

    const fakeRunner = {
      async runTurn() {
        return {
          ok: true,
          stdout: JSON.stringify({
            summary: "Status update",
            requestedActions: [],
          }),
          stderr: "",
          envelope: {
            summary: "Status update",
            requestedActions: [],
          },
          errors: [],
        };
      },
    };

    const orchestrator = new MultiAgentOrchestrator({
      ticketStore: store,
    });
    const kera = new KeraCoordinator(store, orchestrator, undefined, fakeRunner as any);
    const orchestratorWithKera = new MultiAgentOrchestrator({
      ticketStore: store,
      keraCoordinator: kera,
    });

    const intake = await kera.createTicketFromIntake({
      title: "Add onboarding",
      requestSummary: "Create onboarding flow",
      requestType: "feature",
    });

    expect(createSpy).toHaveBeenCalled();
    expect(intake.ticket.status).toBe("intake_acknowledged");

    await orchestratorWithKera.requestKeraTurn(
      intake.ticket.id,
      "status_update",
      "Provide a status update.",
    );

    const events = await store.listEvents(intake.ticket.id);
    const turns = await store.listTurns(intake.ticket.id);

    expect(updateSpy).toHaveBeenCalled();
    expect(eventSpy).toHaveBeenCalled();
    expect(turnSpy).toHaveBeenCalled();
    expect(events.some((event) => event.eventType === "ticket_created")).toBe(true);
    expect(events.some((event) => event.eventType === "kera_turn_recorded")).toBe(true);
    expect(turns.length).toBe(1);
  });
});

describe("Kayley delegate_to_engineering tool", () => {
  it("creates a ticket via multi-agent service and returns summary", async () => {
    const createEngineeringTicket = vi.mocked(
      multiAgentService.createEngineeringTicket,
    );
    createEngineeringTicket.mockResolvedValue({
      ok: true,
      ticket: {
        id: "ticket_abc",
        requestType: "feature",
        title: "New Feature",
        requestSummary: "Add a new flow",
        additionalDetails: "",
        source: "kayley",
        status: "created",
        priority: "normal",
        isUiRelated: false,
        createdBy: "kayley",
        currentCycle: 0,
        maxCycles: 2,
        maxDevAttempts: 2,
        executionProfile: "dangerous_bounded",
        runtimeLimits: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      needsClarification: false,
      message: "Ticket created",
    });

    const result = await executeToolCall(
      {
        tool: "delegate_to_engineering",
        args: {
          request_type: "feature",
          title: "New Feature",
          request_summary: "Add a new flow",
        },
      },
      {
        toolCallId: "tool_1",
        name: "delegate_to_engineering",
        arguments: {},
      },
      {},
    );

    expect(createEngineeringTicket).toHaveBeenCalledOnce();
    expect(result.result).toContain("ticket_abc");
    expect(result.result).toContain("feature");
  });
});

describe("Kayley get_engineering_ticket_status tool", () => {
  it("returns status for a specific ticket id", async () => {
    const getEngineeringTicket = vi.mocked(multiAgentService.getEngineeringTicket);
    getEngineeringTicket.mockResolvedValue({
      ok: true,
      ticket: {
        id: "ticket_status",
        requestType: "bug",
        title: "Bug",
        requestSummary: "Fix crash",
        additionalDetails: "",
        source: "kayley",
        status: "qa_testing",
        priority: "normal",
        isUiRelated: false,
        createdBy: "kayley",
        currentCycle: 0,
        maxCycles: 2,
        maxDevAttempts: 2,
        executionProfile: "dangerous_bounded",
        runtimeLimits: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const result = await executeToolCall(
      {
        tool: "get_engineering_ticket_status",
        args: {
          ticket_id: "ticket_status",
        },
      },
      {
        toolCallId: "tool_2",
        name: "get_engineering_ticket_status",
        arguments: {},
      },
      {},
    );

    expect(getEngineeringTicket).toHaveBeenCalledOnce();
    expect(result.result).toContain("ticket_status");
    expect(result.result).toContain("qa_testing");
  });
});

describe("Opey linking via orchestrator", () => {
  it("records workspace run artifacts and events", async () => {
    const store = new InMemoryTicketStore();
    const runStore = new InMemoryRunStore();
    const runQueue = new WorkspaceRunQueue();
    const linker = new WorkspaceRunLinker({ runStore, runQueue });

    const ticket = await store.createTicket({
      requestType: "feature",
      title: "Test",
      requestSummary: "Summary",
      additionalDetails: "",
      source: "manual",
      status: "implementing",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      assignedDevAgent: undefined,
      assignedQaAgent: undefined,
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      artifactRootPath: undefined,
      worktreePath: "/tmp/worktree",
      worktreeBranch: "ticket/test",
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      finalPrUrl: undefined,
      prCreatedAt: undefined,
      failureReason: undefined,
    });

    const fakeOpey = {
      async runTurn() {
        return {
          envelope: {
            summary: "Do work",
            requestedActions: [{ action: "status", args: {} }],
          },
          raw: { stdout: "{}", stderr: "" },
        };
      },
    } as any;

    const orchestrator = new MultiAgentOrchestrator({
      ticketStore: store,
      workspaceRunLinker: linker,
      opeyAgent: fakeOpey,
    });

    await orchestrator.requestOpeyTurn(ticket.id, "implementation", "prompt");

    const events = await store.listEvents(ticket.id);
    const artifacts = await store.listArtifacts(ticket.id);
    expect(events.some((event) => event.eventType === "workspace_runs_linked")).toBe(true);
    expect(artifacts.some((artifact) => artifact.artifactType === "workspace_run")).toBe(true);
  });
});

describe("Opey to Claudy workflow", () => {
  it("records Opey and Claudy turns in order", async () => {
    const store = new InMemoryTicketStore();

    const ticket = await store.createTicket({
      requestType: "feature",
      title: "Review Flow",
      requestSummary: "Add a review path",
      additionalDetails: "",
      source: "manual",
      status: "ready_for_qa",
      priority: "normal",
      isUiRelated: false,
      createdBy: "test",
      assignedDevAgent: undefined,
      assignedQaAgent: undefined,
      currentCycle: 0,
      maxCycles: 2,
      maxDevAttempts: 2,
      artifactRootPath: undefined,
      worktreePath: "/tmp/worktree",
      worktreeBranch: "ticket/review",
      executionProfile: "dangerous_bounded",
      runtimeLimits: {},
      finalPrUrl: undefined,
      prCreatedAt: undefined,
      failureReason: undefined,
    });

    const fakeOpey = {
      async runTurn() {
        return {
          envelope: {
            summary: "Implemented changes",
            requestedActions: [],
          },
          raw: { stdout: "{}", stderr: "" },
        };
      },
    } as any;

    const fakeClaudy = {
      async runTurn() {
        return {
          envelope: {
            summary: "Review complete",
            requestedActions: [],
            verdict: "approved",
          },
          raw: { stdout: "{}", stderr: "" },
        };
      },
    } as any;

    const orchestrator = new MultiAgentOrchestrator({
      ticketStore: store,
      opeyAgent: fakeOpey,
      claudyAgent: fakeClaudy,
    });

    await orchestrator.requestOpeyTurn(ticket.id, "implementation", "Implement changes.");
    await orchestrator.requestClaudyTurn(ticket.id, "review", "Review the change.");

    const turns = await store.listTurns(ticket.id);
    expect(turns.length).toBe(2);
    expect(turns[0].agentRole).toBe("opey");
    expect(turns[1].agentRole).toBe("claudy");
    expect(turns[1].verdict).toBe("approved");
  });
});

describe("CLI repair + bounds helpers", () => {
  it("retries once with repair prompt on invalid output", async () => {
    let calls = 0;
    const runner = {
      async runTurn() {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            stdout: "not json",
            stderr: "",
            errors: ["invalid json"],
          };
        }
        return {
          ok: true,
          stdout: '{"summary":"ok","requestedActions":[]}',
          stderr: "",
          envelope: {
            summary: "ok",
            requestedActions: [],
          },
          errors: [],
        };
      },
    };

    const result = await runTurnWithRepair(
      runner as any,
      "prompt",
      () => "repair",
      1,
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("assertValidStatus throws on invalid status", () => {
    expect(() => assertValidStatus("bogus")).toThrow();
    expect(assertValidStatus("created")).toBe("created");
  });
});
