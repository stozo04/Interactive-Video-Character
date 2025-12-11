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
  ),

  /**
   * If the user explicitly asks to open a supported external application,
   * this field should contain the URL scheme to launch it.
   * Examples: "slack://", "spotify:", "zoommtg://"
   */
  open_app: z.string().nullable().optional().describe(
    "The URL scheme to launch an external application (e.g. 'slack://'), or null."
  ),

  /**
   * Task management actions - used when user wants to interact with their daily checklist
   */
  task_action: z.object({
    action: z.enum(['create', 'complete', 'delete', 'list']).nullable().describe(
      "The task action to perform: 'create' to add a new task, 'complete' to mark done, 'delete' to remove, 'list' to show all tasks, or null for no task action"
    ),
    task_text: z.string().optional().describe(
      "The text of the task to create, or partial text to match for complete/delete actions"
    ),
    task_id: z.string().optional().describe(
      "The specific task ID if known"
    ),
    priority: z.enum(['low', 'medium', 'high']).optional().describe(
      "Priority level for new tasks"
    )
  }).nullable().optional().describe(
    "Task management action if the user wants to interact with their checklist"
  ),

  /**
   * Calendar management actions - used when user wants to create/delete calendar events
   */
  calendar_action: z.object({
    action: z.enum(['create', 'delete']).describe(
      "The calendar action to perform: 'create' to add a new event, 'delete' to remove event(s)"
    ),
    event_id: z.string().optional().describe(
      "Single event ID from the calendar list (for deleting one event)"
    ),
    event_ids: z.array(z.string()).optional().describe(
      "Array of event IDs to delete (for deleting multiple events)"
    ),
    delete_all: z.boolean().optional().describe(
      "If true, delete ALL events in the calendar list"
    ),
    summary: z.string().optional().describe(
      "The event title/summary"
    ),
    start: z.string().optional().describe(
      "For create: ISO datetime string for event start"
    ),
    end: z.string().optional().describe(
      "For create: ISO datetime string for event end"
    ),
    timeZone: z.string().optional().describe(
      "Timezone for the event, default: America/Chicago"
    )
  }).nullable().optional().describe(
    "Calendar action if the user wants to create or delete calendar event(s)"
  )
});

// Infer the TypeScript type from the schema
export type AIActionResponse = z.infer<typeof AIActionResponseSchema>;