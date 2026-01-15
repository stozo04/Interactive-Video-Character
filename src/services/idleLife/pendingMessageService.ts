/**
 * Pending Message Service
 *
 * Manages messages waiting for the user when they return from absence.
 * These are the "rare gift" messages that make Kayley feel alive:
 * - Calendar-aware messages ("Hope your interview went well!")
 * - Random gift messages (selfies or thoughts, max once per day)
 *
 * Key principle: These are RARE and SPECIAL. Not spam.
 */

import { supabase } from '../supabaseClient';

// ============================================================================
// Types
// ============================================================================

export type MessageTrigger = "calendar" | "gift" | "urgent" | "promise";
export type MessageType = "text" | "photo";
export type MessagePriority = "low" | "normal" | "high";
const USER_ID = import.meta.env.VITE_USER_ID;
export interface PendingMessage {
  id: string;
  messageText: string;
  messageType: MessageType;
  selfieUrl?: string;
  trigger: MessageTrigger;
  triggerEventId?: string;
  triggerEventTitle?: string;
  priority: MessagePriority;
  createdAt: Date;
  deliveredAt?: Date;
  reaction?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePendingMessageInput {
  messageText: string;
  messageType?: MessageType;
  selfieUrl?: string;
  trigger: MessageTrigger;
  triggerEventId?: string;
  triggerEventTitle?: string;
  priority?: MessagePriority;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const PENDING_MESSAGES_TABLE = "pending_messages";

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new pending message for a user.
 * This will be shown when they return to the app.
 */
export async function createPendingMessage(
  input: CreatePendingMessageInput
): Promise<PendingMessage> {
  const id = crypto.randomUUID();
  const now = new Date();

  const message: PendingMessage = {
    id,
    messageText: input.messageText,
    messageType: input.messageType || "text",
    selfieUrl: input.selfieUrl,
    trigger: input.trigger,
    triggerEventId: input.triggerEventId,
    triggerEventTitle: input.triggerEventTitle,
    priority: input.priority || "normal",
    createdAt: now,
    metadata: input.metadata,
  };

  const { error } = await supabase.from(PENDING_MESSAGES_TABLE).insert({
    id: message.id,
    message_text: message.messageText,
    message_type: message.messageType,
    selfie_url: message.selfieUrl,
    trigger: message.trigger,
    trigger_event_id: message.triggerEventId,
    trigger_event_title: message.triggerEventTitle,
    priority: message.priority,
    created_at: message.createdAt.toISOString(),
    metadata: message.metadata || {},
  });

  if (error) {
    console.error("[PendingMessage] Error creating message:", error);
    throw error;
  }

  console.log(`[PendingMessage] Created ${message.trigger} message`);
  return message;
}

/**
 * Get the next undelivered message for a user.
 * Returns the highest priority message, or null if none waiting.
 */
export async function getUndeliveredMessage(): Promise<PendingMessage | null> {
  console.log("pendingMessageService: getUndeliveredMessage");
  const { data, error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .select("*")
    .is("delivered_at", null)
    .order("priority", { ascending: false }) // high > normal > low
    .order("created_at", { ascending: true }) // oldest first
    .limit(1);

  if (error) {
    console.error(
      "[PendingMessage] Error fetching undelivered message:",
      error
    );
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return mapRowToMessage(data[0]);
}

/**
 * Check if there's any undelivered message waiting.
 */
export async function hasUndeliveredMessage(): Promise<boolean> {
  console.log("pendingMessageService: hasUndeliveredMessage");
  const { count, error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .select("id", { count: "exact", head: true })
    .is("delivered_at", null);

  if (error) {
    console.error(
      "[PendingMessage] Error checking undelivered messages:",
      error
    );
    return false;
  }

  return (count || 0) > 0;
}

/**
 * Check if there's an undelivered message for a specific trigger and event.
 * Used to avoid duplicate promise deliveries.
 */
export async function hasUndeliveredMessageForTriggerEvent(
  trigger: MessageTrigger,
  triggerEventId: string
): Promise<boolean> {
  if (!triggerEventId) return false;

  const { count, error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .select("id", { count: "exact", head: true })
    .is("delivered_at", null)
    .eq("trigger", trigger)
    .eq("trigger_event_id", triggerEventId);

  if (error) {
    console.error(
      "[PendingMessage] Error checking trigger event messages:",
      error
    );
    return false;
  }

  return (count || 0) > 0;
}

/**
 * Mark a message as delivered (shown to user).
 */
export async function markMessageDelivered(messageId: string): Promise<void> {
  console.log("pendingMessageService: markMessageDelivered");
  const { error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", messageId);

  if (error) {
    console.error(
      "[PendingMessage] Error marking message as delivered:",
      error
    );
    throw error;
  }

  console.log(`[PendingMessage] Marked message ${messageId} as delivered`);
}

/**
 * Record the user's reaction to a message.
 */
export async function recordMessageReaction(
  messageId: string,
  reaction: "positive" | "neutral" | "negative"
): Promise<void> {
  console.log("pendingMessageService: recordMessageReaction");
  const { error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .update({ reaction })
    .eq("id", messageId);

  if (error) {
    console.error("[PendingMessage] Error recording reaction:", error);
  }
}

/**
 * Get all undelivered messages for a user (for display purposes).
 */
export async function getAllUndeliveredMessages(): Promise<PendingMessage[]> {
  console.log("pendingMessageService: getAllUndeliveredMessages");
  const { data, error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .select("*")
    .is("delivered_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      "[PendingMessage] Error fetching all undelivered messages:",
      error
    );
    return [];
  }

  return (data || []).map(mapRowToMessage);
}

/**
 * Clean up old delivered messages.
 * Called periodically to keep the table small.
 */
export async function cleanupDeliveredMessages(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { error } = await supabase
    .from(PENDING_MESSAGES_TABLE)
    .delete()
    .not("delivered_at", "is", null)
    .lt("delivered_at", sevenDaysAgo.toISOString());

  if (error) {
    console.error("[PendingMessage] Error cleaning up old messages:", error);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapRowToMessage(row: Record<string, unknown>): PendingMessage {
  return {
    id: row.id as string,
    messageText: row.message_text as string,
    messageType: row.message_type as MessageType,
    selfieUrl: row.selfie_url as string | undefined,
    trigger: row.trigger as MessageTrigger,
    triggerEventId: row.trigger_event_id as string | undefined,
    triggerEventTitle: row.trigger_event_title as string | undefined,
    priority: row.priority as MessagePriority,
    createdAt: new Date(row.created_at as string),
    deliveredAt: row.delivered_at
      ? new Date(row.delivered_at as string)
      : undefined,
    reaction: row.reaction as string | undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}
