import type { WorkspaceRun, WorkspaceRunRequest, WorkspaceRunStore } from "./runStore";
import { WorkspaceRunEventHub } from "./runEvents";

export class ObservableRunStore implements WorkspaceRunStore {
  public constructor(
    private readonly innerStore: WorkspaceRunStore,
    private readonly eventHub: WorkspaceRunEventHub,
  ) {}

  public async createRun(
    request: WorkspaceRunRequest,
    workspaceRoot: string,
  ): Promise<WorkspaceRun> {
    const run = await this.innerStore.createRun(request, workspaceRoot);
    this.eventHub.publish({
      type: "run_created",
      run,
      runId: run.id,
      timestamp: new Date().toISOString(),
    });
    return run;
  }

  public async getRun(runId: string): Promise<WorkspaceRun | null> {
    return this.innerStore.getRun(runId);
  }

  public async listRuns(limit = 25): Promise<WorkspaceRun[]> {
    return this.innerStore.listRuns(limit);
  }

  public async getRunCount(): Promise<number> {
    return this.innerStore.getRunCount();
  }

  public async updateRun(
    runId: string,
    updater: (current: WorkspaceRun) => WorkspaceRun,
  ): Promise<WorkspaceRun | null> {
    const run = await this.innerStore.updateRun(runId, updater);
    if (run) {
      this.eventHub.publish({
        type: "run_updated",
        run,
        runId: run.id,
        timestamp: new Date().toISOString(),
      });
    }
    return run;
  }
}
