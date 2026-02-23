import type { EngineeringTicketEvent, EngineeringTicketStore } from "./types";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[MultiAgentEventLogger]";
const runtimeLog = log.fromContext({ source: "eventLogger" });

// Small helper that writes an event to the ticket store and logs a concise line.
export class MultiAgentEventLogger {
  public constructor(private readonly store: EngineeringTicketStore) {}

  public async logEvent(
    event: Omit<EngineeringTicketEvent, "id" | "createdAt">,
  ): Promise<EngineeringTicketEvent> {
    const record = await this.store.appendEvent(event);
    runtimeLog.info(
      `${LOG_PREFIX} ticket=${record.ticketId} event=${record.eventType} actor=${record.actorType}`,
      {
        ticketId: record.ticketId,
        eventType: record.eventType,
        actorType: record.actorType,
      },
    );
    return record;
  }
}
