export type WorkspaceAgentRunStatus =
  | "accepted"
  | "pending"
  | "running"
  | "requires_approval"
  | "rejected"
  | "success"
  | "failed"
  | "verification_failed";

export type WorkspaceActionType =
  | "command"
  | "mkdir"
  | "read"
  | "write"
  | "search"
  | "status"
  | "commit"
  | "push"
  | "delete";

export interface WorkspaceAgentRunStep {
  stepId: string;
  type: string;
  status: string;
  exitCode: number | null;
  evidence: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkspaceAgentRunApproval {
  required: boolean;
  status: "not_required" | "pending" | "approved" | "rejected";
  reason?: string;
  decidedAt?: string;
}

export interface WorkspaceAgentRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkspaceAgentRunStatus;
  summary: string;
  workspaceRoot: string;
  request: {
    action: string;
    args: Record<string, unknown>;
    prompt?: string;
  };
  approval: WorkspaceAgentRunApproval;
  steps: WorkspaceAgentRunStep[];
}

interface WorkspaceAgentRunResponseBody {
  run?: WorkspaceAgentRun;
  error?: string;
}

interface WorkspaceAgentRunsResponseBody {
  runs?: WorkspaceAgentRun[];
  error?: string;
}

export interface WorkspaceAgentHealth {
  status: string;
  service: string;
  workspaceRoot: string;
  runCount: number;
  activeRunId?: string | null;
  pendingQueueCount?: number;
  timestamp: string;
}

interface WorkspaceAgentHealthResponseBody {
  health?: WorkspaceAgentHealth;
  error?: string;
}

export interface WorkspaceActionRequest {
  action: WorkspaceActionType;
  args: Record<string, unknown>;
  prompt?: string;
  approved?: boolean;
}

export interface WorkspaceActionRequestOptions {
  waitForTerminal?: boolean;
}

export interface WorkspaceActionResult {
  ok: boolean;
  httpStatus: number | null;
  run?: WorkspaceAgentRun;
  error?: string;
}

export interface WorkspaceAgentRunsResult {
  ok: boolean;
  httpStatus: number | null;
  runs: WorkspaceAgentRun[];
  error?: string;
}

export interface WorkspaceAgentHealthResult {
  ok: boolean;
  httpStatus: number | null;
  health?: WorkspaceAgentHealth;
  error?: string;
}

export interface WorkspaceAgentApprovalResult {
  ok: boolean;
  httpStatus: number | null;
  run?: WorkspaceAgentRun;
  error?: string;
}

export interface WorkspaceAgentRunEvent {
  type: "run_created" | "run_updated" | "connected" | "heartbeat";
  runId?: string;
  timestamp?: string;
  run?: WorkspaceAgentRun;
  message?: string;
  activeRunId?: string | null;
  pendingCount?: number;
}

const LOG_PREFIX = "[ProjectAgentService]";
const DEFAULT_AGENT_BASE_URL = "http://localhost:4010";
const WORKSPACE_AGENT_BASE_PATH = "/workspace-agent";
const DEFAULT_POLL_INTERVAL_MS = 350;
const DEFAULT_POLL_TIMEOUT_MS = 15_000;

const WAITING_STATUSES: ReadonlySet<WorkspaceAgentRunStatus> = new Set([
  "requires_approval",
  "rejected",
  "success",
  "failed",
  "verification_failed",
]);

function getWorkspaceAgentBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_WORKSPACE_AGENT_URL as
    | string
    | undefined;
  const rawBaseUrl = (configuredUrl || DEFAULT_AGENT_BASE_URL).trim();
  return rawBaseUrl.replace(/\/+$/, "");
}

function buildWorkspaceAgentUrl(pathname: string): string {
  return `${getWorkspaceAgentBaseUrl()}${WORKSPACE_AGENT_BASE_PATH}${pathname}`;
}

function buildCreateRunPayload(request: WorkspaceActionRequest): {
  action: WorkspaceActionType;
  prompt?: string;
  args: Record<string, unknown>;
  approved?: boolean;
} {
  return {
    action: request.action,
    prompt: request.prompt,
    args: { ...request.args },
    approved: request.approved,
  };
}

async function parseRunResponse(response: Response): Promise<WorkspaceAgentRunResponseBody> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText) as WorkspaceAgentRunResponseBody;
  } catch {
    return {
      error: `Workspace agent returned non-JSON response: ${responseText.slice(
        0,
        160,
      )}`,
    };
  }
}

async function parseRunsResponse(response: Response): Promise<WorkspaceAgentRunsResponseBody> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText) as WorkspaceAgentRunsResponseBody;
  } catch {
    return {
      error: `Workspace agent returned non-JSON response: ${responseText.slice(
        0,
        160,
      )}`,
    };
  }
}

async function parseHealthResponse(
  response: Response,
): Promise<WorkspaceAgentHealthResponseBody> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText) as WorkspaceAgentHealthResponseBody;
  } catch {
    return {
      error: `Workspace agent returned non-JSON response: ${responseText.slice(
        0,
        160,
      )}`,
    };
  }
}

export async function requestWorkspaceAction(
  request: WorkspaceActionRequest,
  options?: WorkspaceActionRequestOptions,
): Promise<WorkspaceActionResult> {
  const waitForTerminal = options?.waitForTerminal ?? true;
  const baseUrl = getWorkspaceAgentBaseUrl();
  const endpoint = buildWorkspaceAgentUrl("/runs");
  const payload = buildCreateRunPayload(request);

  console.log(`${LOG_PREFIX} Sending workspace action`, {
    action: payload.action,
    endpoint,
  });

  try {
    const createRunResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const createRunBody = await parseRunResponse(createRunResponse);

    if (!createRunResponse.ok) {
      return {
        ok: false,
        httpStatus: createRunResponse.status,
        run: createRunBody.run,
        error:
          createRunBody.error ||
          createRunBody.run?.summary ||
          `Workspace agent request failed with status ${createRunResponse.status}.`,
      };
    }

    if (!createRunBody.run) {
      return {
        ok: false,
        httpStatus: createRunResponse.status,
        error: "Workspace agent response missing run payload.",
      };
    }

    const initialRun = createRunBody.run;
    if (!waitForTerminal || WAITING_STATUSES.has(initialRun.status)) {
      return {
        ok: true,
        httpStatus: createRunResponse.status,
        run: initialRun,
      };
    }

    const pollResult = await pollRunUntilWaiting({
      baseUrl,
      runId: initialRun.id,
      pollIntervalMs: getPollIntervalMs(),
      pollTimeoutMs: getPollTimeoutMs(),
      initialHttpStatus: createRunResponse.status,
    });

    if (!pollResult.ok) {
      return pollResult;
    }

    return {
      ok: true,
      httpStatus: pollResult.httpStatus,
      run: pollResult.run,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Workspace action request failed`, { error });

    return {
      ok: false,
      httpStatus: null,
      error:
        error instanceof Error && error.message
          ? `${buildOfflineHint()} (${error.message})`
          : buildOfflineHint(),
    };
  }
}

export async function approveWorkspaceRun(
  runId: string,
  reason?: string,
): Promise<WorkspaceAgentApprovalResult> {
  return resolveWorkspaceRunApproval("approve", runId, reason);
}

export async function rejectWorkspaceRun(
  runId: string,
  reason?: string,
): Promise<WorkspaceAgentApprovalResult> {
  return resolveWorkspaceRunApproval("reject", runId, reason);
}

export async function getWorkspaceAgentHealth(): Promise<WorkspaceAgentHealthResult> {
  const endpoint = buildWorkspaceAgentUrl("/health");

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const body = await parseHealthResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error:
          body.error ||
          `Workspace agent health request failed with status ${response.status}.`,
      };
    }

    if (!body.health) {
      return {
        ok: false,
        httpStatus: response.status,
        error: "Workspace agent health payload missing.",
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      health: body.health,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error:
        error instanceof Error && error.message
          ? `${buildOfflineHint()} (${error.message})`
          : buildOfflineHint(),
    };
  }
}

export async function listWorkspaceAgentRuns(
  limit = 25,
): Promise<WorkspaceAgentRunsResult> {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25;
  const endpoint = `${buildWorkspaceAgentUrl("/runs")}?limit=${normalizedLimit}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const body = await parseRunsResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        runs: [],
        error:
          body.error ||
          `Workspace agent runs request failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      runs: Array.isArray(body.runs) ? body.runs : [],
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      runs: [],
      error:
        error instanceof Error && error.message
          ? `${buildOfflineHint()} (${error.message})`
          : buildOfflineHint(),
    };
  }
}

export function subscribeWorkspaceAgentEvents(options: {
  runId?: string;
  onEvent: (event: WorkspaceAgentRunEvent) => void;
  onError?: (event: Event) => void;
}): () => void {
  const { runId, onEvent, onError } = options;
  const endpoint = runId
    ? buildWorkspaceAgentUrl(`/runs/${encodeURIComponent(runId)}/events`)
    : buildWorkspaceAgentUrl("/events");
  const eventSource = new EventSource(endpoint);

  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as WorkspaceAgentRunEvent;
      onEvent(payload);
    } catch {
      // Ignore malformed event payloads.
    }
  };

  eventSource.addEventListener("connected", (event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      onEvent(JSON.parse(messageEvent.data) as WorkspaceAgentRunEvent);
    } catch {
      // Ignore malformed event payloads.
    }
  });

  eventSource.addEventListener("run_created", (event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      onEvent(JSON.parse(messageEvent.data) as WorkspaceAgentRunEvent);
    } catch {
      // Ignore malformed event payloads.
    }
  });

  eventSource.addEventListener("run_updated", (event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      onEvent(JSON.parse(messageEvent.data) as WorkspaceAgentRunEvent);
    } catch {
      // Ignore malformed event payloads.
    }
  });

  eventSource.addEventListener("heartbeat", (event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      onEvent(JSON.parse(messageEvent.data) as WorkspaceAgentRunEvent);
    } catch {
      // Ignore malformed event payloads.
    }
  });

  eventSource.onerror = (event) => {
    onError?.(event);
  };

  return () => {
    eventSource.close();
  };
}

interface PollRunOptions {
  baseUrl: string;
  runId: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  initialHttpStatus: number;
}

async function pollRunUntilWaiting(
  options: PollRunOptions,
): Promise<WorkspaceActionResult> {
  const { baseUrl, runId, pollIntervalMs, pollTimeoutMs, initialHttpStatus } =
    options;
  const runEndpoint = `${baseUrl}${WORKSPACE_AGENT_BASE_PATH}/runs/${encodeURIComponent(runId)}`;
  const deadline = Date.now() + pollTimeoutMs;

  while (Date.now() <= deadline) {
    await sleep(pollIntervalMs);

    const runResponse = await fetch(runEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const runBody = await parseRunResponse(runResponse);

    if (!runResponse.ok) {
      return {
        ok: false,
        httpStatus: runResponse.status,
        run: runBody.run,
        error:
          runBody.error ||
          `Workspace run polling failed with status ${runResponse.status}.`,
      };
    }

    if (!runBody.run) {
      continue;
    }

    if (WAITING_STATUSES.has(runBody.run.status)) {
      return {
        ok: true,
        httpStatus: runResponse.status || initialHttpStatus,
        run: runBody.run,
      };
    }
  }

  return {
    ok: false,
    httpStatus: initialHttpStatus,
    error: `Workspace action timed out waiting for run ${runId} to progress.`,
  };
}

async function resolveWorkspaceRunApproval(
  action: "approve" | "reject",
  runId: string,
  reason?: string,
): Promise<WorkspaceAgentApprovalResult> {
  const endpoint = buildWorkspaceAgentUrl(`/runs/${encodeURIComponent(runId)}/${action}`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    });
    const body = await parseRunResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        run: body.run,
        error:
          body.error ||
          `Workspace run ${action} failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      run: body.run,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      error:
        error instanceof Error && error.message
          ? `${buildOfflineHint()} (${error.message})`
          : buildOfflineHint(),
    };
  }
}

function getPollIntervalMs(): number {
  const parsed = Number(import.meta.env.VITE_WORKSPACE_AGENT_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

function getPollTimeoutMs(): number {
  const parsed = Number(import.meta.env.VITE_WORKSPACE_AGENT_POLL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_TIMEOUT_MS;
}

function buildOfflineHint(): string {
  const resolvedBaseUrl = getWorkspaceAgentBaseUrl();
  return `Workspace agent is unreachable at ${resolvedBaseUrl}. Start it with npm run agent:dev.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
