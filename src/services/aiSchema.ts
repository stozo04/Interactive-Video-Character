// src/services/aiSchema.ts
import { z } from 'zod';

/**
 * Defines the strict JSON structure we want ANY AI Service (Grok or Gemini) to return.
 */
export const AIActionResponseSchema = z.object({
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
   */
  action_id: z.string().nullable().describe(
    "The ID of the video action to play, or null if no action is appropriate."
  ),

  /**
   * If the user provided audio input, this field MUST contain the
   * text transcription of what the user said.
   * If the input was text, this can be null or the same as the input.
   */
  user_transcription: z.string().nullable().optional().describe(
    "The transcription of the user's audio input, if applicable."
  )
});

// Infer the TypeScript type from the schema
export type AIActionResponse = z.infer<typeof AIActionResponseSchema>;