import type { WorkspaceRun } from "./runStore";

export type WorkspaceRunEventType = "run_created" | "run_updated";

export interface WorkspaceRunEvent {
  type: WorkspaceRunEventType;
  run: WorkspaceRun;
  runId: string;
  timestamp: string;
}

type Listener = (event: WorkspaceRunEvent) => void;

export class WorkspaceRunEventHub {
  private listeners = new Map<number, Listener>();

  private sequence = 0;

  public publish(event: WorkspaceRunEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("[WorkspaceRunEventHub] Listener crashed", { error });
      }
    });
  }

  public subscribe(listener: Listener): () => void {
    this.sequence += 1;
    const id = this.sequence;
    this.listeners.set(id, listener);

    return () => {
      this.listeners.delete(id);
    };
  }
}
