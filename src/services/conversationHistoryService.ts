import { ChatMessage } from '../types';
import { supabase } from './supabaseClient';

const CONVERSATION_HISTORY_TABLE = 'conversation_history';

interface ConversationHistoryRow {
  id: string;
  message_role: "user" | "model";
  message_text: string;
  action_id?: string | null;
  interaction_id: string; // The Gemini interaction ID
  created_at: string;
}

/**
 * Get the date of the very last interaction (message).
 * Used to calculate "Days since last conversation" for the AI context.
 */
export const getLastInteractionDate = async (): Promise<Date | null> => {
  try {
    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select("created_at")
      .order("created_at", { ascending: false }) // Newest first
      .limit(1);

    if (error) {
      console.error("Failed to fetch last interaction date:", error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return new Date(data[0].created_at);
  } catch (error) {
    console.error("Error getting last interaction date:", error);
    return null;
  }
};

/**
 * Load conversation history for a user
 * Returns messages in chronological order
 */
export const loadConversationHistory = async (): Promise<ChatMessage[]> => {
  try {
    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load conversation history:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Convert database rows to ChatMessage[]
    const messages: ChatMessage[] = (data as ConversationHistoryRow[]).map(
      (row) => ({
        role: row.message_role === "user" ? "user" : "model",
        text: row.message_text,
      })
    );

    console.log(`Loaded ${messages.length} messages from conversation history`);
    return messages;
  } catch (error) {
    console.error("Error loading conversation history:", error);
    return [];
  }
};


/**
 * Append new messages to existing conversation history
 * More efficient than saving the entire history each time
 */
export const appendConversationHistory = async (
  newMessages: ChatMessage[],
  interactionId?: string
): Promise<void> => {
  if (newMessages.length === 0) {
    return;
  }

  try {
    const rows = newMessages.map((msg) => ({
      message_role:
        msg.role === "user" ? "user" : ("model" as "user" | "model"),
      message_text: msg.text,
      action_id: null,
      interaction_id: interactionId || crypto.randomUUID(), // USER REQUIREMENT: Track that id, fallback to GUID
    }));

    const { error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .insert(rows);

    if (error) {
      console.error("Failed to append conversation history:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error appending conversation history:", error);
    // Don't throw - allow conversation to continue
  }
};


/**
 * Get the number of messages sent by or to a user today
 */
export const getTodaysMessageCount = async (): Promise<number> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select("*", { count: "exact", head: true })
      .gte("created_at", today.toISOString());

    if (error) {
      console.error("Failed to get today's message count:", error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error("Error getting today's message count:", error);
    return 0;
  }
};

/**
 * Load conversation history for a user for today only
 */
export const loadTodaysConversationHistory = async (): Promise<
  ChatMessage[]
> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select("*")
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load today's conversation history:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    return (data as ConversationHistoryRow[]).map((row) => ({
      role: row.message_role === "user" ? "user" : "model",
      text: row.message_text,
    }));
  } catch (error) {
    console.error("Error loading today's conversation history:", error);
    return [];
  }
};

/**
 * Get the Interaction ID used for today's conversation
 */
export const getTodaysInteractionId = async (): Promise<string | null> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select("interaction_id")
      .gte("created_at", today.toISOString())
      .not("interaction_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Failed to get today's interaction ID:", error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return (data[0] as any).interaction_id;
  } catch (error) {
    console.error("Error getting today's interaction ID:", error);
    return null;
  }
};

