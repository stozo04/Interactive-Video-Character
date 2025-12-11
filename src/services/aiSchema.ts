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
  ),

  /**
   * For Tic-Tac-Toe: The cell position (0-8) where AI wants to place its mark.
   * Cell positions: [0,1,2] (top row), [3,4,5] (middle row), [6,7,8] (bottom row)
   */
  game_move: z.number().min(0).max(8).nullable().optional().describe(
    "For Tic-Tac-Toe: cell position (0-8, top-left to bottom-right) for AI's O placement"
  ),

  /**
   * For Tic-Tac-Toe: The cell position (0-8) where the AI sees the USER's X mark from the image.
   * This is critical for syncing game state.
   */
  user_move_detected: z.number().min(0).max(8).nullable().optional().describe(
    "For Tic-Tac-Toe: the cell position (0-8) where the AI sees the USER's X mark from the image."
  ),

  /**
   * Whiteboard action for more complex interactions (guessing, describing, etc.)
   */
  whiteboard_action: z.object({
    type: z.enum(['none', 'mark_cell', 'guess', 'describe', 'draw']).describe(
      "Type of whiteboard action"
    ),
    position: z.number().optional().describe(
      "Cell position for grid-based games (0-8)"
    ),
    guess: z.string().optional().describe(
      "For Pictionary: the AI's guess of what the drawing is"
    ),
    description: z.string().optional().describe(
      "For freeform: AI's description of the drawing"
    ),
    draw_shapes: z.array(z.object({
      shape: z.enum(['line', 'circle', 'rect', 'point', 'path', 'text']),
      x: z.number().describe("Start X coordinate (0-100)"),
      y: z.number().describe("Start Y coordinate (0-100)"),
      x2: z.number().optional().describe("End X (0-100) for lines/rects"),
      y2: z.number().optional().describe("End Y (0-100) for lines/rects"),
      points: z.array(z.object({
        x: z.number(),
        y: z.number()
      })).optional().describe("Array of points for 'path' shape (0-100)"),
      text: z.string().optional().describe("Text content for 'text' shape - USE THIS FOR WRITING NAMES/WORDS!"),
      size: z.number().optional().describe("Size/Radius (0-100) or font size for text"),
      color: z.string().optional().describe("Hex color code or name"),
      filled: z.boolean().optional().describe("If true, fill the shape")
    })).optional().describe("Shapes for AI to draw on the board")
  }).nullable().optional().describe(
    "Whiteboard interaction action"
  )
});

// Infer the TypeScript type from the schema
export type AIActionResponse = z.infer<typeof AIActionResponseSchema>;

// ============================================
// Memory Tool Schemas
// ============================================

/**
 * Schema for the recall_memory tool.
 * Used to search past conversations for relevant context.
 */
export const RecallMemorySchema = z.object({
  query: z.string().describe(
    "Natural language query to search past conversations. " +
    "Examples: 'their name', 'what they do for work', 'their pet', 'favorite food'"
  ),
  timeframe: z.enum(['recent', 'all']).optional().default('all').describe(
    "Search scope: 'recent' (last 7 days) or 'all' (entire history). Default: 'all'"
  )
});

/**
 * Schema for the recall_user_info tool.
 * Used to retrieve stored facts about the user.
 */
export const RecallUserInfoSchema = z.object({
  category: z.enum(['identity', 'preference', 'relationship', 'context', 'all']).describe(
    "Category of information to retrieve: " +
    "'identity' (name, age, job), " +
    "'preference' (likes, dislikes, favorites), " +
    "'relationship' (family, friends), " +
    "'context' (current projects, recent events), " +
    "'all' (everything)"
  ),
  specific_key: z.string().optional().describe(
    "Specific fact key if known (e.g., 'name', 'job', 'favorite_color')"
  )
});

/**
 * Schema for the store_user_info tool.
 * Used to save important information about the user for later recall.
 */
export const StoreUserInfoSchema = z.object({
  category: z.enum(['identity', 'preference', 'relationship', 'context']).describe(
    "Category of the fact being stored"
  ),
  key: z.string().describe(
    "The type of fact (e.g., 'name', 'job', 'favorite_food', 'spouse_name')"
  ),
  value: z.string().describe(
    "The value to store (e.g., 'John', 'Software Engineer', 'Pizza')"
  )
});

// Export types for tool arguments
export type RecallMemoryArgs = z.infer<typeof RecallMemorySchema>;
export type RecallUserInfoArgs = z.infer<typeof RecallUserInfoSchema>;
export type StoreUserInfoArgs = z.infer<typeof StoreUserInfoSchema>;

// Union type for all memory tool arguments
export type MemoryToolArgs = 
  | { tool: 'recall_memory'; args: RecallMemoryArgs }
  | { tool: 'recall_user_info'; args: RecallUserInfoArgs }
  | { tool: 'store_user_info'; args: StoreUserInfoArgs };

// ============================================
// Function Declarations for AI Providers
// ============================================

/**
 * Gemini/Google AI function declarations format.
 * Used in the tools configuration for Gemini API.
 */
export const GeminiMemoryToolDeclarations = [
  {
    name: "recall_memory",
    description: 
      "Search past conversations with the user to find relevant context. " +
      "Use this when you need to remember something discussed before, " +
      "or when the user references a past topic. Examples: 'Do you remember when...', " +
      "'What did I tell you about...', or context-dependent questions.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query (e.g., 'their name', 'their job', 'their pet')"
        },
        timeframe: {
          type: "string",
          enum: ["recent", "all"],
          description: "Search scope: 'recent' (last 7 days) or 'all' (entire history)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "recall_user_info",
    description: 
      "Retrieve stored facts about the user. " +
      "Use this to personalize responses, greet the user by name, " +
      "or reference known preferences. Categories: identity (name, job), " +
      "preference (likes/dislikes), relationship (family), context (current projects).",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context", "all"],
          description: "Category of information to retrieve"
        },
        specific_key: {
          type: "string",
          description: "Specific fact key if known (e.g., 'name', 'job')"
        }
      },
      required: ["category"]
    }
  },
  {
    name: "store_user_info",
    description: 
      "Save important information about the user for later recall. " +
      "Use this when the user shares personal details like their name, " +
      "job, preferences, family info, or current projects. " +
      "This helps you remember them in future conversations.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context"],
          description: "Category of the fact"
        },
        key: {
          type: "string",
          description: "Fact type (e.g., 'name', 'favorite_food')"
        },
        value: {
          type: "string",
          description: "The value to store"
        }
      },
      required: ["category", "key", "value"]
    }
  }
];

/**
 * OpenAI/ChatGPT function declarations format.
 * Used in the tools configuration for OpenAI Responses API.
 * Note: The Responses API uses a flatter format than Chat Completions API.
 */
export const OpenAIMemoryToolDeclarations = [
  {
    type: "function" as const,
    name: "recall_memory",
    description: 
      "Search past conversations with the user to find relevant context. " +
      "Use this when you need to remember something discussed before, " +
      "or when the user references a past topic.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query"
        },
        timeframe: {
          type: "string",
          enum: ["recent", "all"],
          description: "Search scope: 'recent' or 'all'"
        }
      },
      required: ["query"]
    }
  },
  {
    type: "function" as const,
    name: "recall_user_info",
    description: 
      "Retrieve stored facts about the user to personalize responses.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context", "all"],
          description: "Category of information to retrieve"
        },
        specific_key: {
          type: "string",
          description: "Specific fact key if known"
        }
      },
      required: ["category"]
    }
  },
  {
    type: "function" as const,
    name: "store_user_info",
    description: 
      "Save important information about the user for later recall.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context"],
          description: "Category of the fact"
        },
        key: {
          type: "string",
          description: "Fact type (e.g., 'name', 'favorite_food')"
        },
        value: {
          type: "string",
          description: "The value to store"
        }
      },
      required: ["category", "key", "value"]
    }
  }
];

// ============================================
// Helper Types
// ============================================

/**
 * Represents a tool call from the AI that needs to be executed.
 */
export interface PendingToolCall {
  id: string;
  name: 'recall_memory' | 'recall_user_info' | 'store_user_info';
  arguments: Record<string, any>;
}

/**
 * Result of executing a tool call.
 */
export interface ToolCallResult {
  toolCallId: string;
  result: string;
}