import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type WorkspaceRun,
  type WorkspaceRunApproval,
  type WorkspaceRunApprovalStatus,
  type WorkspaceRunRequest,
  type WorkspaceRunStatus,
  type WorkspaceRunStep,
  type WorkspaceRunStepStatus,
  type WorkspaceRunStepType,
  type WorkspaceRunStore,
} from "./runStore";

const RUNS_TABLE = "workspace_agent_runs";
const STEPS_TABLE = "workspace_agent_run_steps";
const LOG_PREFIX = "[SupabaseRunStore]";

const RUN_STATUSES: ReadonlySet<WorkspaceRunStatus> = new Set([
  "accepted",
  "pending",
  "running",
  "requires_approval",
  "rejected",
  "success",
  "failed",
  "verification_failed",
]);

const APPROVAL_STATUSES: ReadonlySet<WorkspaceRunApprovalStatus> = new Set([
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

const STEP_STATUSES: ReadonlySet<WorkspaceRunStepStatus> = new Set([
  "pending",
  "running",
  "success",
  "failed",
  "verification_failed",
]);

const STEP_TYPES: ReadonlySet<WorkspaceRunStepType> = new Set([
  "policy_check",
  "approval",
  "mkdir",
  "read",
  "write",
  "search",
  "status",
  "commit",
  "push",
  "delete",
  "verify",
]);

interface SupabaseRunStoreOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

interface WorkspaceRunRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  summary: string;
  workspace_root: string;
  request: unknown;
  approval: unknown;
}

interface WorkspaceRunStepRow {
  run_id: string;
  step_id: string;
  step_index: number;
  type: string;
  status: string;
  exit_code: number | null;
  evidence: unknown;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export class SupabaseRunStore implements WorkspaceRunStore {
  private readonly client: SupabaseClient;

  private sequence = 0;

  public constructor(options: SupabaseRunStoreOptions) {
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

    const sanitizedRun = sanitizeRun(run);
    const { error } = await this.client.from(RUNS_TABLE).insert({
      id: sanitizedRun.id,
      created_at: sanitizedRun.createdAt,
      updated_at: sanitizedRun.updatedAt,
      status: sanitizedRun.status,
      summary: sanitizedRun.summary,
      workspace_root: sanitizedRun.workspaceRoot,
      request: sanitizedRun.request,
      approval: sanitizedRun.approval,
    });

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to create run ${runId}: ${error.message}`);
    }

    return cloneRun(sanitizedRun);
  }

  public async getRun(runId: string): Promise<WorkspaceRun | null> {
    const { data: runRow, error: runError } = await this.client
      .from(RUNS_TABLE)
      .select("*")
      .eq("id", runId)
      .maybeSingle<WorkspaceRunRow>();

    if (runError) {
      throw new Error(
        `${LOG_PREFIX} Failed to fetch run ${runId}: ${runError.message}`,
      );
    }

    if (!runRow) {
      return null;
    }

    const { data: stepRows, error: stepError } = await this.client
      .from(STEPS_TABLE)
      .select("*")
      .eq("run_id", runId)
      .order("step_index", { ascending: true })
      .returns<WorkspaceRunStepRow[]>();

    if (stepError) {
      throw new Error(
        `${LOG_PREFIX} Failed to fetch steps for run ${runId}: ${stepError.message}`,
      );
    }

    return mapRunRowToRun(runRow, stepRows || []);
  }

  public async listRuns(limit = 25): Promise<WorkspaceRun[]> {
    const normalizedLimit = normalizeLimit(limit);
    const { data: runRows, error: runError } = await this.client
      .from(RUNS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(normalizedLimit)
      .returns<WorkspaceRunRow[]>();

    if (runError) {
      throw new Error(`${LOG_PREFIX} Failed to list runs: ${runError.message}`);
    }

    if (!runRows || runRows.length === 0) {
      return [];
    }

    const runIds = runRows.map((row) => row.id);
    const { data: stepRows, error: stepError } = await this.client
      .from(STEPS_TABLE)
      .select("*")
      .in("run_id", runIds)
      .order("run_id", { ascending: true })
      .order("step_index", { ascending: true })
      .returns<WorkspaceRunStepRow[]>();

    if (stepError) {
      throw new Error(`${LOG_PREFIX} Failed to list run steps: ${stepError.message}`);
    }

    const stepsByRunId = new Map<string, WorkspaceRunStepRow[]>();
    (stepRows || []).forEach((stepRow) => {
      const bucket = stepsByRunId.get(stepRow.run_id);
      if (bucket) {
        bucket.push(stepRow);
        return;
      }
      stepsByRunId.set(stepRow.run_id, [stepRow]);
    });

    return runRows.map((runRow) => {
      const relatedSteps = stepsByRunId.get(runRow.id) || [];
      return mapRunRowToRun(runRow, relatedSteps);
    });
  }

  public async getRunCount(): Promise<number> {
    const { count, error } = await this.client
      .from(RUNS_TABLE)
      .select("id", { count: "exact", head: true });

    if (error) {
      throw new Error(`${LOG_PREFIX} Failed to count runs: ${error.message}`);
    }

    return count || 0;
  }

  public async updateRun(
    runId: string,
    updater: (current: WorkspaceRun) => WorkspaceRun,
  ): Promise<WorkspaceRun | null> {
    const currentRun = await this.getRun(runId);
    if (!currentRun) {
      return null;
    }

    const candidateRun = updater(cloneRun(currentRun));
    const nextRun = sanitizeRun({
      ...candidateRun,
      id: currentRun.id,
      createdAt: currentRun.createdAt,
      updatedAt: new Date().toISOString(),
      request: {
        action: candidateRun.request.action,
        args: { ...candidateRun.request.args },
        prompt: candidateRun.request.prompt,
      },
      steps: candidateRun.steps.map((step) => ({
        ...step,
        evidence: [...step.evidence],
      })),
    });

    const { error: runWriteError } = await this.client.from(RUNS_TABLE).upsert(
      {
        id: nextRun.id,
        created_at: nextRun.createdAt,
        updated_at: nextRun.updatedAt,
        status: nextRun.status,
        summary: nextRun.summary,
        workspace_root: nextRun.workspaceRoot,
        request: nextRun.request,
        approval: nextRun.approval,
      },
      { onConflict: "id" },
    );

    if (runWriteError) {
      throw new Error(
        `${LOG_PREFIX} Failed to update run ${runId}: ${runWriteError.message}`,
      );
    }

    const { error: deleteStepsError } = await this.client
      .from(STEPS_TABLE)
      .delete()
      .eq("run_id", runId);

    if (deleteStepsError) {
      throw new Error(
        `${LOG_PREFIX} Failed to clear steps for run ${runId}: ${deleteStepsError.message}`,
      );
    }

    if (nextRun.steps.length > 0) {
      const stepRows = nextRun.steps.map((step, stepIndex) => ({
        run_id: runId,
        step_id: step.stepId,
        step_index: stepIndex,
        type: step.type,
        status: step.status,
        exit_code: step.exitCode,
        evidence: step.evidence,
        error: step.error || null,
        started_at: step.startedAt || null,
        finished_at: step.finishedAt || null,
      }));

      const { error: insertStepsError } = await this.client
        .from(STEPS_TABLE)
        .insert(stepRows);

      if (insertStepsError) {
        throw new Error(
          `${LOG_PREFIX} Failed to write steps for run ${runId}: ${insertStepsError.message}`,
        );
      }
    }

    return cloneRun(nextRun);
  }

  private generateRunId(): string {
    this.sequence += 1;
    return `run_${Date.now()}_${this.sequence}`;
  }
}

function mapRunRowToRun(
  runRow: WorkspaceRunRow,
  stepRows: WorkspaceRunStepRow[],
): WorkspaceRun {
  return {
    id: String(runRow.id),
    createdAt: toIsoString(runRow.created_at),
    updatedAt: toIsoString(runRow.updated_at),
    status: asRunStatus(runRow.status),
    summary: typeof runRow.summary === "string" ? runRow.summary : "",
    workspaceRoot:
      typeof runRow.workspace_root === "string" ? runRow.workspace_root : "",
    request: parseRequest(runRow.request),
    approval: parseApproval(runRow.approval),
    steps: stepRows.map((stepRow) => mapStepRowToStep(stepRow)),
  };
}

function mapStepRowToStep(stepRow: WorkspaceRunStepRow): WorkspaceRunStep {
  return {
    stepId: typeof stepRow.step_id === "string" ? stepRow.step_id : "unknown",
    type: asStepType(stepRow.type),
    status: asStepStatus(stepRow.status),
    exitCode: Number.isInteger(stepRow.exit_code) ? stepRow.exit_code : null,
    evidence: parseEvidence(stepRow.evidence),
    error: typeof stepRow.error === "string" ? stepRow.error : undefined,
    startedAt: toOptionalIsoString(stepRow.started_at),
    finishedAt: toOptionalIsoString(stepRow.finished_at),
  };
}

function parseRequest(raw: unknown): WorkspaceRunRequest {
  if (!isPlainObject(raw)) {
    return {
      action: "unknown",
      args: {},
    };
  }

  const actionValue = raw.action;
  const argsValue = raw.args;
  const promptValue = raw.prompt;

  return {
    action: typeof actionValue === "string" ? actionValue : "unknown",
    args: isPlainObject(argsValue) ? argsValue : {},
    prompt: typeof promptValue === "string" ? promptValue : undefined,
  };
}

function parseEvidence(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => (typeof entry === "string" ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

function asRunStatus(raw: string): WorkspaceRunStatus {
  return RUN_STATUSES.has(raw as WorkspaceRunStatus)
    ? (raw as WorkspaceRunStatus)
    : "failed";
}

function asStepStatus(raw: string): WorkspaceRunStepStatus {
  return STEP_STATUSES.has(raw as WorkspaceRunStepStatus)
    ? (raw as WorkspaceRunStepStatus)
    : "failed";
}

function asStepType(raw: string): WorkspaceRunStepType {
  return STEP_TYPES.has(raw as WorkspaceRunStepType)
    ? (raw as WorkspaceRunStepType)
    : "read";
}

function sanitizeRun(run: WorkspaceRun): WorkspaceRun {
  return {
    ...run,
    summary: redactSensitiveText(run.summary),
    request: {
      action: run.request.action,
      args: sanitizeRecord(run.request.args),
      prompt: run.request.prompt
        ? redactSensitiveText(run.request.prompt)
        : undefined,
    },
    approval: {
      required: run.approval.required,
      status: run.approval.status,
      reason: run.approval.reason
        ? redactSensitiveText(run.approval.reason)
        : undefined,
      decidedAt: run.approval.decidedAt,
    },
    steps: run.steps.map((step) => ({
      ...step,
      error: step.error ? redactSensitiveText(step.error) : undefined,
      evidence: step.evidence.map((entry) => redactSensitiveText(entry)),
    })),
  };
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(record).map(([key, value]) => [
    key,
    sanitizeUnknown(value),
  ]);
  return Object.fromEntries(entries);
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (isPlainObject(value)) {
    return sanitizeRecord(value);
  }

  return value;
}

function redactSensitiveText(input: string): string {
  let redacted = input;

  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*[:=]\s*['"]?([^\s'"]+)/gi,
    "$1=[REDACTED]",
  );
  redacted = redacted.replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, "[REDACTED_API_KEY]");
  redacted = redacted.replace(
    /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    "Bearer [REDACTED]",
  );

  return redacted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function parseApproval(raw: unknown): WorkspaceRunApproval {
  if (!isPlainObject(raw)) {
    return {
      required: false,
      status: "not_required",
    };
  }

  const required = raw.required;
  const status = raw.status;
  const reason = raw.reason;
  const decidedAt = raw.decidedAt;

  return {
    required: typeof required === "boolean" ? required : false,
    status: asApprovalStatus(typeof status === "string" ? status : ""),
    reason: typeof reason === "string" ? reason : undefined,
    decidedAt: toOptionalIsoString(decidedAt),
  };
}

function asApprovalStatus(raw: string): WorkspaceRunApprovalStatus {
  return APPROVAL_STATUSES.has(raw as WorkspaceRunApprovalStatus)
    ? (raw as WorkspaceRunApprovalStatus)
    : "not_required";
}
