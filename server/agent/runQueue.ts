import type { WorkspaceRunStatus } from "./runStore";

const TERMINAL_STATUSES: ReadonlySet<WorkspaceRunStatus> = new Set([
  "success",
  "failed",
  "verification_failed",
  "rejected",
]);

export class WorkspaceRunQueue {
  private activeRunId: string | null = null;

  private pendingRunIds: string[] = [];

  public enqueue(runId: string): string | null {
    if (!this.activeRunId) {
      this.activeRunId = runId;
      return runId;
    }

    if (this.activeRunId === runId || this.pendingRunIds.includes(runId)) {
      return null;
    }

    this.pendingRunIds.push(runId);
    return null;
  }

  public resolveRunStatus(runId: string, status: WorkspaceRunStatus): string | null {
    if (this.activeRunId !== runId) {
      return null;
    }

    if (!TERMINAL_STATUSES.has(status)) {
      // includes requires_approval and running states; keep queue blocked
      return null;
    }

    this.activeRunId = null;
    const nextRunId = this.pendingRunIds.shift() || null;
    if (nextRunId) {
      this.activeRunId = nextRunId;
    }
    return nextRunId;
  }

  public getActiveRunId(): string | null {
    return this.activeRunId;
  }

  public getPendingCount(): number {
    return this.pendingRunIds.length;
  }
}
