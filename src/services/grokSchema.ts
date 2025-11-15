// src/services/grokSchema.ts
import { z } from 'zod';

/**
 * Defines the strict JSON structure we want Grok to return.
 */
export const GrokActionResponseSchema = z.object({
  /**
   * The conversational text response to display in the chat.
   */
  text_response: z.string().describe(
    "The conversational text to display in the chat."
  ),

  /**
   * The video action to play.
   * This MUST be null unless the user's intent *strongly*
   * matches one of the available actions.
   * We use z.string() here because action IDs are dynamic UUIDs.
   */
  action_id: z.string().nullable().describe(
    "The ID of the video action to play, or null if no action is appropriate."
  )
});

// Infer the TypeScript type from the schema
export type GrokActionResponse = z.infer<typeof GrokActionResponseSchema>;