export type WorkspaceRunStatus =
  | "accepted"
  | "pending"
  | "running"
  | "requires_approval"
  | "rejected"
  | "success"
  | "failed"
  | "verification_failed";

export type WorkspaceRunStepType =
  | "policy_check"
  | "approval"
  | "mkdir"
  | "read"
  | "write"
  | "search"
  | "status"
  | "commit"
  | "push"
  | "delete"
  | "gif"
  | "verify";

export type WorkspaceRunStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "verification_failed";

export interface WorkspaceRunStep {
  stepId: string;
  type: WorkspaceRunStepType;
  status: WorkspaceRunStepStatus;
  exitCode: number | null;
  evidence: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkspaceRunRequest {
  action: string;
  args: Record<string, unknown>;
  prompt?: string;
}

export type WorkspaceRunApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";

export interface WorkspaceRunApproval {
  required: boolean;
  status: WorkspaceRunApprovalStatus;
  reason?: string;
  decidedAt?: string;
}

export interface WorkspaceRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkspaceRunStatus;
  summary: string;
  workspaceRoot: string;
  request: WorkspaceRunRequest;
  approval: WorkspaceRunApproval;
  steps: WorkspaceRunStep[];
}

export interface WorkspaceRunStore {
  createRun(
    request: WorkspaceRunRequest,
    workspaceRoot: string,
  ): Promise<WorkspaceRun>;
  getRun(runId: string): Promise<WorkspaceRun | null>;
  listRuns(limit?: number): Promise<WorkspaceRun[]>;
  getRunCount(): Promise<number>;
  updateRun(
    runId: string,
    updater: (current: WorkspaceRun) => WorkspaceRun,
  ): Promise<WorkspaceRun | null>;
}

export class InMemoryRunStore implements WorkspaceRunStore {
  private runs = new Map<string, WorkspaceRun>();

  private sequence = 0;

  public async createRun(
    request: WorkspaceRunRequest,
    workspaceRoot: string,
  ): Promise<WorkspaceRun> {
    const runId = this.generateRunId();
    const now = new Date().toISOString();
    const run: WorkspaceRun = {
      id: runId,
      createdAt: now,
      updatedAt: now,
      status: "accepted",
      summary: "Run accepted and queued for execution.",
      workspaceRoot,
      request: {
        action: request.action,
        args: { ...request.args },
        prompt: request.prompt,
      },
      approval: {
        required: false,
        status: "not_required",
      },
      steps: [],
    };

    this.runs.set(runId, run);
    return cloneRun(run);
  }

  public async getRun(runId: string): Promise<WorkspaceRun | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }
    return cloneRun(run);
  }

  public async listRuns(limit = 25): Promise<WorkspaceRun[]> {
    const normalizedLimit = normalizeLimit(limit);

    return Array.from(this.runs.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, normalizedLimit)
      .map((run) => cloneRun(run));
  }

  public async getRunCount(): Promise<number> {
    return this.runs.size;
  }

  public async updateRun(
    runId: string,
    updater: (current: WorkspaceRun) => WorkspaceRun,
  ): Promise<WorkspaceRun | null> {
    const current = this.runs.get(runId);
    if (!current) {
      return null;
    }

    const candidate = updater(cloneRun(current));
    const next: WorkspaceRun = {
      ...candidate,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      request: {
        action: candidate.request.action,
        args: { ...candidate.request.args },
        prompt: candidate.request.prompt,
      },
      approval: {
        required: candidate.approval.required,
        status: candidate.approval.status,
        reason: candidate.approval.reason,
        decidedAt: candidate.approval.decidedAt,
      },
      steps: candidate.steps.map((step) => ({
        ...step,
        evidence: [...step.evidence],
      })),
    };

    this.runs.set(runId, next);
    return cloneRun(next);
  }

  private generateRunId(): string {
    this.sequence += 1;
    return `run_${Date.now()}_${this.sequence}`;
  }
}

function cloneRun(run: WorkspaceRun): WorkspaceRun {
  return {
    ...run,
    request: {
      action: run.request.action,
      args: { ...run.request.args },
      prompt: run.request.prompt,
    },
    approval: {
      required: run.approval.required,
      status: run.approval.status,
      reason: run.approval.reason,
      decidedAt: run.approval.decidedAt,
    },
    steps: run.steps.map((step) => ({
      ...step,
      evidence: [...step.evidence],
    })),
  };
}

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
