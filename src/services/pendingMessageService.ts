import { supabase } from "./supabaseClient";

const PENDING_MESSAGES_TABLE = "pending_messages";
const LOG_PREFIX = "[PendingMessageService]";

export interface PendingMessage {
  id: string;
  messageText: string;
  messageType: "text" | "photo";
  trigger: string;
  triggerEventId: string | null;
  triggerEventTitle: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

function mapPendingMessageRow(row: any): PendingMessage {
  return {
    id: String(row.id),
    messageText: String(row.message_text || ""),
    messageType: row.message_type === "photo" ? "photo" : "text",
    trigger: String(row.trigger || ""),
    triggerEventId:
      typeof row.trigger_event_id === "string" ? row.trigger_event_id : null,
    triggerEventTitle:
      typeof row.trigger_event_title === "string"
        ? row.trigger_event_title
        : null,
    createdAt: String(row.created_at || new Date().toISOString()),
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

export async function fetchNextPendingMessage(): Promise<PendingMessage | null> {
  const freshnessCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .select("*")
    .is("delivered_at", null)
    .contains("metadata", { source: "cron_scheduler" })
    .gte("created_at", freshnessCutoff)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${LOG_PREFIX} Failed to fetch pending message`, { error });
    return null;
  }

  if (!data?.id) {
    return null;
  }

  return mapPendingMessageRow(data);
}

export async function ackPendingMessageDelivered(id: string): Promise<boolean> {
  const { data: deliveredData, error: deliveredError } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", id)
    .is("delivered_at", null)
    .select("*")
    .maybeSingle();

  if (deliveredError) {
    console.error(`${LOG_PREFIX} Failed to mark pending message delivered`, {
      id,
      deliveredError,
    });
    return false;
  }

  if (!deliveredData?.id) {
    return false;
  }

  return true;
}
