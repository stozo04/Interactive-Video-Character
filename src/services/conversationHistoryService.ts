import { ChatMessage } from '../types';
import { supabase } from './supabaseClient';

const CONVERSATION_HISTORY_TABLE = 'conversation_history';

interface ConversationHistoryRow {
  id: string;
  user_id: string;
  message_role: 'user' | 'model';
  message_text: string;
  action_id?: string | null;
  created_at: string;
}

/**
 * Save conversation history for a user
 * This should be called when leaving/closing a character session
 */
export const saveConversationHistory = async (
  userId: string,
  messages: ChatMessage[]
): Promise<void> => {
  if (messages.length === 0) {
    return; // Nothing to save
  }

  try {
    // Convert ChatMessage[] to database format
    const rows = messages.map((msg) => ({
      user_id: userId,
      message_role: msg.role === 'user' ? 'user' : 'model' as 'user' | 'model',
      message_text: msg.text,
      action_id: null, // Can be enhanced later to track which action was triggered
    }));

    // Insert all messages in a batch
    const { error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .insert(rows);

    if (error) {
      console.error('Failed to save conversation history:', error);
      throw error;
    }

    console.log(`Saved ${messages.length} messages to conversation history`);
  } catch (error) {
    console.error('Error saving conversation history:', error);
    // Don't throw - we don't want to block the user from leaving
  }
};

/**
 * Load conversation history for a user
 * Returns messages in chronological order
 */
export const loadConversationHistory = async (
  userId: string
): Promise<ChatMessage[]> => {
  try {
    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load conversation history:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Convert database rows to ChatMessage[]
    const messages: ChatMessage[] = (data as ConversationHistoryRow[]).map((row) => ({
      role: row.message_role === 'user' ? 'user' : 'model',
      text: row.message_text,
    }));

    console.log(`Loaded ${messages.length} messages from conversation history`);
    return messages;
  } catch (error) {
    console.error('Error loading conversation history:', error);
    return [];
  }
};

/**
 * Append new messages to existing conversation history
 * More efficient than saving the entire history each time
 */
export const appendConversationHistory = async (
  userId: string,
  newMessages: ChatMessage[]
): Promise<void> => {
  if (newMessages.length === 0) {
    return;
  }

  try {
    const rows = newMessages.map((msg) => ({
      user_id: userId,
      message_role: msg.role === 'user' ? 'user' : 'model' as 'user' | 'model',
      message_text: msg.text,
      action_id: null,
    }));

    const { error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .insert(rows);

    if (error) {
      console.error('Failed to append conversation history:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error appending conversation history:', error);
    // Don't throw - allow conversation to continue
  }
};

/**
 * Clear conversation history for a user
 * Useful for starting fresh
 */
export const clearConversationHistory = async (
  userId: string
): Promise<void> => {
  try {
    const { error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to clear conversation history:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error clearing conversation history:', error);
    throw error;
  }
};

