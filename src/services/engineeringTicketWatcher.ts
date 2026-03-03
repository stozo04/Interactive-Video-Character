import { supabase } from "./supabaseClient";

const LOG_PREFIX = "[EngineeringTicketWatcher]";

// Terminal statuses that warrant notifying Kayley
const NOTIFY_STATUSES = new Set(["completed", "failed", "pr_ready"]);

// postgres_changes returns the raw snake_case DB row, not the camelCase EngineeringTicket shape
interface RawTicketRow {
  id: string;
  title: string;
  status: string;
  request_type: string;
  failure_reason: string | null;
  final_pr_url: string | null;
}

export interface TerminatedTicket {
  id: string;
  title: string;
  status: "completed" | "failed" | "pr_ready";
  requestType: string;
  failureReason: string | null;
  finalPrUrl: string | null;
}

/**
 * Subscribes to engineering_tickets UPDATE events via Supabase Realtime.
 * Calls onTerminated when a ticket reaches a terminal status (completed, failed, pr_ready).
 * Returns an unsubscribe function — call it on cleanup.
 */
export function subscribeToTicketUpdates(
  onTerminated: (ticket: TerminatedTicket) => void
): () => void {
  // Prevent double-notifying if the same row fires multiple UPDATE events
  // after reaching a terminal status (e.g. updated_at bumped again)
  const notifiedIds = new Set<string>();

  const channel = supabase
    .channel("engineering-tickets-watch")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "engineering_tickets" },
      (payload) => {
        const row = payload.new as RawTicketRow;

        if (!NOTIFY_STATUSES.has(row.status)) return;
        if (notifiedIds.has(row.id)) return;

        notifiedIds.add(row.id);
        console.log(`${LOG_PREFIX} Ticket reached terminal status`, {
          id: row.id,
          title: row.title,
          status: row.status,
        });

        onTerminated({
          id: row.id,
          title: row.title,
          status: row.status as TerminatedTicket["status"],
          requestType: row.request_type,
          failureReason: row.failure_reason,
          finalPrUrl: row.final_pr_url,
        });
      }
    )
    .subscribe((status) => {
      console.log(`${LOG_PREFIX} Channel status: ${status}`);
    });

  return () => {
    console.log(`${LOG_PREFIX} Unsubscribing`);
    void channel.unsubscribe();
  };
}
