import { MultiAgentOrchestrator } from "./orchestrator";
import { type EngineeringTicketStore } from "./types";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[MultiAgentIntakeWatcher]";
const runtimeLog = log.fromContext({ source: "intakeWatcher" });
const DEFAULT_TICK_MS = 15_000;
const DEFAULT_MAX_PER_TICK = 10;

interface IntakeWatcherOptions {
  // Ticket store used to query tickets in `created` status.
  ticketStore: EngineeringTicketStore;
  // Orchestrator used to advance tickets.
  orchestrator: MultiAgentOrchestrator;
  // How often to poll for new tickets.
  tickMs?: number;
  // Maximum number of tickets to process per tick.
  maxPerTick?: number;
  // Friendly id for log traces.
  watcherId?: string;
}

interface StartedIntakeWatcher {
  stop: () => void;
}

class IntakeWatcher {
  private readonly ticketStore: EngineeringTicketStore;
  private readonly orchestrator: MultiAgentOrchestrator;
  private readonly tickMs: number;
  private readonly maxPerTick: number;
  private readonly watcherId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  public constructor(options: IntakeWatcherOptions) {
    this.ticketStore = options.ticketStore;
    this.orchestrator = options.orchestrator;
    this.tickMs = Math.max(5_000, options.tickMs ?? DEFAULT_TICK_MS);
    this.maxPerTick = Math.max(1, options.maxPerTick ?? DEFAULT_MAX_PER_TICK);
    this.watcherId = options.watcherId || `intake_${process.pid}`;
  }

  public start(): void {
    // Start a repeating timer (no-op if already started).
    if (this.timer) {
      return;
    }

    runtimeLog.info(`${LOG_PREFIX} Starting`, {
      tickMs: this.tickMs,
      maxPerTick: this.maxPerTick,
      watcherId: this.watcherId,
    });

    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);

    // Run one tick immediately on start.
    void this.tick();
  }

  public stop(): void {
    // Stop the repeating timer cleanly.
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    runtimeLog.info(`${LOG_PREFIX} Stopped`, { watcherId: this.watcherId });
  }

  private async tick(): Promise<void> {
    // Prevent overlapping ticks.
    if (this.isTicking) {
      return;
    }

    this.isTicking = true;
    try {
      const createdTickets = await this.ticketStore.listTicketsByStatus(
        "created",
        this.maxPerTick,
      );
      const qaApprovedTickets = await this.ticketStore.listTicketsByStatus(
        "qa_approved",
        this.maxPerTick,
      );

      if (createdTickets.length === 0 && qaApprovedTickets.length === 0) {
        return;
      }

      runtimeLog.info(`${LOG_PREFIX} Processing tickets`, {
        createdCount: createdTickets.length,
        qaApprovedCount: qaApprovedTickets.length,
        watcherId: this.watcherId,
      });

      for (const ticket of createdTickets) {
        try {
          // Start and immediately process the next step for each new ticket.
          await this.orchestrator.startTicket(ticket.id);
          await this.orchestrator.processNextStep(ticket.id);
        } catch (error) {
          runtimeLog.error(`${LOG_PREFIX} Ticket intake failed`, {
            ticketId: ticket.id,
            watcherId: this.watcherId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const ticket of qaApprovedTickets) {
        try {
          runtimeLog.info(`${LOG_PREFIX} Processing qa_approved ticket`, {
            ticketId: ticket.id,
            watcherId: this.watcherId,
          });
          await this.orchestrator.processNextStep(ticket.id);
        } catch (error) {
          runtimeLog.error(`${LOG_PREFIX} QA-approved ticket processing failed`, {
            ticketId: ticket.id,
            watcherId: this.watcherId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      runtimeLog.error(`${LOG_PREFIX} Tick failed`, {
        watcherId: this.watcherId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isTicking = false;
    }
  }
}

export function startIntakeWatcher(
  options: IntakeWatcherOptions,
): StartedIntakeWatcher {
  const watcher = new IntakeWatcher(options);
  watcher.start();
  return {
    stop: () => watcher.stop(),
  };
}
