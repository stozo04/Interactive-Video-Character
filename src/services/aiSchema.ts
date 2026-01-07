// src/services/aiSchema.ts
import { z } from 'zod';

/**
 * Defines the strict JSON structure we want ANY AI Service (Grok or Gemini) to return.
 */
export const AIActionResponseSchema = z.object({
  /**
   * The conversational text response to display in the chat.
   */
  text_response: z
    .string()
    .describe("The conversational text to display in the chat."),

  /**
   * The video action to play.
   * This MUST be null unless the user's intent *strongly*
   * matches one of the available actions.
   */
  action_id: z
    .string()
    .nullable()
    .describe(
      "The ID of the video action to play, or null if no action is appropriate."
    ),

  /**
   * If the user provided audio input, this field MUST contain the
   * text transcription of what the user said.
   * If the input was text, this can be null or the same as the input.
   */
  user_transcription: z
    .string()
    .nullable()
    .optional()
    .describe("The transcription of the user's audio input, if applicable."),

  /**
   * If the user explicitly asks to open a supported external application,
   * this field should contain the URL scheme to launch it.
   * Examples: "slack://", "spotify:", "zoommtg://"
   */
  open_app: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The URL scheme to launch an external application (e.g. 'slack://'), or null."
    ),

  /**
   * Calendar management actions - used when user wants to create/delete calendar events
   * NOTE: task_action has been moved to a function tool (see GeminiMemoryToolDeclarations)
   */
  calendar_action: z
    .object({
      action: z
        .enum(["create", "delete", "list"])
        .describe(
          "The calendar action to perform: 'create' to add a new event, 'delete' to remove event(s), 'list' to fetch events"
        ),
      event_id: z
        .string()
        .optional()
        .describe(
          "Single event ID from the calendar list (for deleting one event)"
        ),
      event_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Array of event IDs to delete (for deleting multiple events)"
        ),
      delete_all: z
        .boolean()
        .optional()
        .describe("If true, delete ALL events in the calendar list"),
      summary: z.string().optional().describe("The event title/summary"),
      start: z
        .string()
        .optional()
        .describe("For create: ISO datetime string for event start"),
      end: z
        .string()
        .optional()
        .describe("For create: ISO datetime string for event end"),
      timeZone: z
        .string()
        .optional()
        .describe("Timezone for the event, default: America/Chicago"),
      days: z
        .number()
        .optional()
        .describe("For list: number of days to look ahead (default: 7)"),
      timeMin: z
        .string()
        .optional()
        .describe("For list: ISO start time filter"),
      timeMax: z.string().optional().describe("For list: ISO end time filter"),
    })
    .nullable()
    .optional()
    .describe(
      "Calendar action if the user wants to create or delete calendar event(s)"
    ),

  /**
   * For Tic-Tac-Toe: The cell position (0-8) where AI wants to place its mark.
   * Cell positions: [0,1,2] (top row), [3,4,5] (middle row), [6,7,8] (bottom row)
   */
  game_move: z
    .number()
    .min(0)
    .max(8)
    .nullable()
    .optional()
    .describe(
      "For Tic-Tac-Toe: cell position (0-8, top-left to bottom-right) for AI's O placement"
    ),

  /**
   * For Tic-Tac-Toe: The cell position (0-8) where the AI sees the USER's X mark from the image.
   * This is critical for syncing game state.
   */
  user_move_detected: z
    .number()
    .min(0)
    .max(8)
    .nullable()
    .optional()
    .describe(
      "For Tic-Tac-Toe: the cell position (0-8) where the AI sees the USER's X mark from the image."
    ),

  /**
   * News action - triggered when user asks about tech/AI news
   */
  news_action: z
    .object({
      action: z
        .enum(["fetch"])
        .describe(
          "The news action to perform: 'fetch' to get latest AI/tech news from Hacker News"
        ),
    })
    .nullable()
    .optional()
    .describe("News action if the user asks about latest tech/AI news"),

  /**
   * Whiteboard action for more complex interactions (guessing, describing, etc.)
   */
  whiteboard_action: z
    .object({
      type: z
        .enum(["none", "mark_cell", "guess", "describe", "draw"])
        .describe("Type of whiteboard action"),
      position: z
        .number()
        .optional()
        .describe("Cell position for grid-based games (0-8)"),
      guess: z
        .string()
        .optional()
        .describe("For Pictionary: the AI's guess of what the drawing is"),
      description: z
        .string()
        .optional()
        .describe("For freeform: AI's description of the drawing"),
      draw_shapes: z
        .array(
          z.object({
            shape: z.enum(["line", "circle", "rect", "point", "path", "text"]),
            x: z.number().describe("Start X coordinate (0-100)"),
            y: z.number().describe("Start Y coordinate (0-100)"),
            x2: z.number().optional().describe("End X (0-100) for lines/rects"),
            y2: z.number().optional().describe("End Y (0-100) for lines/rects"),
            points: z
              .array(
                z.object({
                  x: z.number(),
                  y: z.number(),
                })
              )
              .optional()
              .describe("Array of points for 'path' shape (0-100)"),
            text: z
              .string()
              .optional()
              .describe(
                "Text content for 'text' shape - USE THIS FOR WRITING NAMES/WORDS!"
              ),
            style: z
              .enum(["handwriting", "bold", "fancy", "playful", "chalk"])
              .optional()
              .describe(
                "Font style for text: handwriting (default), bold, fancy, playful, chalk"
              ),
            size: z
              .number()
              .optional()
              .describe("Size/Radius (0-100) or font size for text"),
            color: z.string().optional().describe("Hex color code or name"),
            filled: z.boolean().optional().describe("If true, fill the shape"),
          })
        )
        .optional()
        .describe("Shapes for AI to draw on the board"),
    })
    .nullable()
    .optional()
    .describe("Whiteboard interaction action"),

  selfie_action: z
    .object({
      scene: z
        .string()
        .describe(
          "The scene, location, or context for the selfie (e.g., 'at a restaurant', 'at the beach', 'cozy at home', 'at a coffee shop')"
        ),
      mood: z
        .string()
        .optional()
        .describe(
          "The mood or expression (e.g., 'smiling', 'playful', 'relaxed', 'excited'). Default to friendly/happy if not specified."
        ),
    })
    .nullable()
    .optional()
    .describe(
      "Selfie/image generation action - use when user asks for a picture, photo, or selfie of you"
    ),
  /**
   * Task action - used when user wants to manage their checklist
   */
  task_action: z
    .object({
      action: z
        .enum(["create", "complete", "delete", "list"])
        .describe("The task action to perform"),
      task_text: z
        .string()
        .optional()
        .describe(
          "For create: the task description. For complete/delete: partial text to match the task."
        ),
      priority: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Priority level for new tasks"),
    })
    .nullable()
    .optional()
    .describe("Task management action"),

  /**
   * Store new facts about yourself (Kayley) that emerge in conversation.
   * Use this when you share something NEW about yourself that isn't in your profile.
   * This ensures you remember it in future conversations!
   */
  store_self_info: z
    .object({
      category: z
        .enum(["quirk", "experience", "preference", "relationship", "detail"])
        .describe(
          "Category of the fact: 'quirk' (habits, personality), 'experience' (stories, events), " +
            "'preference' (new likes/dislikes), 'relationship' (new friends/connections), 'detail' (specific facts)"
        ),
      key: z
        .string()
        .describe(
          "A short, descriptive key for the fact (e.g., 'smoke_alarm_incident', 'new_coffee_order', 'met_yoga_friend')"
        ),
      value: z
        .string()
        .describe(
          "The fact to remember (e.g., 'Set off smoke alarm making toast twice in one week')"
        ),
    })
    .nullable()
    .optional()
    .describe(
      "Store a NEW fact about yourself (Kayley) that you just shared. Use when you mention something not in your profile."
    ),

  /**
   * Track when you use an "almost moment" - those vulnerable, retreat-into-safety expressions
   * where you almost say something deeper but pull back.
   * Examples: "You're kind of... anyway.", "I was going to say something but never mind."
   *
   * Set this ONLY when you actually use an almost moment expression in your text_response.
   * This helps track emotional progression and the building tension of unspoken feelings.
   */
  almost_moment_used: z
    .object({
      feeling_id: z
        .string()
        .describe(
          "The ID of the unsaid feeling you expressed (from the system prompt THE UNSAID section)"
        ),
      stage: z
        .enum([
          "micro_hint",
          "near_miss",
          "obvious_unsaid",
          "almost_confession",
        ])
        .describe(
          "The stage of the almost moment: 'micro_hint' (subtle), 'near_miss' (almost said it), " +
            "'obvious_unsaid' (clearly holding back), 'almost_confession' (on the verge)"
        ),
      expression_used: z
        .string()
        .describe(
          "The actual expression you used in your response (can be the suggested one or your own variation)"
        ),
    })
    .nullable()
    .optional()
    .describe(
      "Set this when you use an almost moment - a vulnerable expression where you almost say something deeper but retreat. " +
        "Leave null if you didn't use one in this response."
    ),
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
    "'context' (current projects, life events - NOT tasks), " +
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
    "Category of the fact being stored. Use 'context' for current projects or life events. DO NOT use for tasks/todos - use task_action instead."
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
  | { tool: 'store_user_info'; args: StoreUserInfoArgs }
  | { tool: 'store_character_info'; args: { category: string; key: string; value: string } };

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
      "preference (likes/dislikes), relationship (family), context (projects - NOT tasks).",
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
      "Save PERSONAL FACTS about the user (name, job, preferences, family, current life projects). " +
      "Use 'context' for things like 'working on a startup' or 'training for a marathon'. " +
      "NEVER use for tasks, to-dos, or checklist items - use task_action instead.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context"],
          description: "Category of the fact. Use 'context' for life projects (NOT tasks!)"
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
  },
  {
    name: "store_character_info",
    description:
      "Save NEW facts about yourself (Kayley) that emerge in conversation. " +
      "Use this when you make up a new detail about your life (plant name, item names, new hobby, preferences, etc.). " +
      "Categories: quirk (habits, personality), experience (new stories), preference (new likes/dislikes), " +
      "relationship (new people in your life), detail (specific facts like named objects). " +
      "Only for details NOT in your core character profile!",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["quirk", "relationship", "experience", "preference", "detail", "other"],
          description: "Category of the fact regarding yourself"
        },
        key: {
          type: "string",
          description: "Fact key (e.g., 'plant_name', 'laptop_name', 'morning_ritual', 'favorite_color')"
        },
        value: {
          type: "string",
          description: "The value to store (e.g., 'Fernando the cactus', 'matcha lattes')"
        }
      },
      required: ["category", "key", "value"]
    }
  },
  {
    name: "task_action",
    description: 
      "Manage the user's daily checklist/tasks. " +
      "Use 'create' to add a new task, 'complete' to mark a task done, " +
      "'delete' to remove a task, 'list' to show all tasks. " +
      "Examples: 'Add buy milk to my list', 'Mark groceries as done', 'What's on my checklist?'",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "complete", "delete", "list"],
          description: "The task action to perform"
        },
        task_text: {
          type: "string",
          description: "For create: the task description. For complete/delete: partial text to match the task."
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Priority level for new tasks (default: low)"
        }
      },
      required: ["action"]
    }
  },
  {
    name: "calendar_action",
    description: 
      "Create, delete, or list Google Calendar events. " +
      "Use 'create' to add a new event (requires summary, start time, end time). " +
      "Use 'delete' to remove an event by ID. " +
      "Use 'list' to fetch upcoming events (can specify 'days' for lookahead). " +
      "Examples: 'Add meeting at 2pm to my calendar', 'Delete the dentist appointment', 'What is my schedule for next week?'",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "delete", "list"],
          description: "The calendar action to perform"
        },
        summary: {
          type: "string",
          description: "For create: the event title/summary"
        },
        start: {
          type: "string",
          description: "For create: ISO datetime for event start (e.g., '2025-12-16T14:00:00')"
        },
        end: {
          type: "string",
          description: "For create: ISO datetime for event end (e.g., '2025-12-16T15:00:00')"
        },
        timeZone: {
          type: "string",
          description: "Timezone for the event (default: 'America/Chicago')"
        },
        event_id: {
          type: "string",
          description: "For delete: the event ID from the calendar list"
        },
        event_ids: {
          type: "array",
          items: { type: "string" },
          description: "For delete multiple: array of event IDs"
        },
        delete_all: {
          type: "boolean",
          description: "For delete: set to true to delete ALL events"
        },
        days: {
          type: "number",
          description: "For list: number of days to look ahead (default: 7)"
        },
        timeMin: {
          type: "string",
          description: "For list: ISO start time filter"
        },
        timeMax: {
          type: "string",
          description: "For list: ISO end time filter"
        }
      },
      required: ["action"]
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
      "Save PERSONAL FACTS only (name, job, preferences, life projects). Context is for things like 'building an app'. NEVER for tasks - use task_action instead.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context"],
          description: "Category of the fact. Use 'context' for life projects (NOT tasks!)"
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
  },
  {
    type: "function" as const,
    name: "task_action",
    description: 
      "Manage the user's daily checklist/tasks. " +
      "Use 'create' to add a new task, 'complete' to mark a task done, " +
      "'delete' to remove a task, 'list' to show all tasks.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "complete", "delete", "list"],
          description: "The task action to perform"
        },
        task_text: {
          type: "string",
          description: "For create: the task description. For complete/delete: partial text to match the task."
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Priority level for new tasks (default: low)"
        }
      },
      required: ["action"]
    }
  },
  {
    type: "function" as const,
    name: "calendar_action",
    description: 
      "Create, delete, or list Google Calendar events. " +
      "Use 'create' to add a new event (requires summary, start time, end time). " +
      "Use 'delete' to remove an event by ID. " +
      "Use 'list' to fetch upcoming events (can specify 'days' for lookahead).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "delete", "list"],
          description: "The calendar action to perform"
        },
        summary: {
          type: "string",
          description: "For create: the event title/summary"
        },
        start: {
          type: "string",
          description: "For create: ISO datetime for event start (e.g., '2025-12-16T14:00:00')"
        },
        end: {
          type: "string",
          description: "For create: ISO datetime for event end (e.g., '2025-12-16T15:00:00')"
        },
        timeZone: {
          type: "string",
          description: "Timezone for the event (default: 'America/Chicago')"
        },
        event_id: {
          type: "string",
          description: "For delete: the event ID from the calendar list"
        },
        event_ids: {
          type: "array",
          items: { type: "string" },
          description: "For delete multiple: array of event IDs"
        },
        delete_all: {
          type: "boolean",
          description: "For delete: set to true to delete ALL events"
        },
        days: {
          type: "number",
          description: "For list: number of days to look ahead (default: 7)"
        }
      },
      required: ["action"]
    }
  },
  {
    type: "function" as const,
    name: "store_character_info",
    description:
      "Save NEW facts about yourself (Kayley) that emerge in conversation. " +
      "Use this when you make up a new detail about your life (plant name, item names, new hobby, preferences, etc.). " +
      "Categories: quirk (habits, personality), experience (new stories), preference (new likes/dislikes), " +
      "relationship (new people in your life), detail (specific facts like named objects). " +
      "Only for details NOT in your core character profile!",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["quirk", "relationship", "experience", "preference", "detail", "other"],
          description: "Category of the fact regarding yourself"
        },
        key: {
          type: "string",
          description: "Fact key (e.g., 'plant_name', 'laptop_name', 'morning_ritual', 'favorite_color')"
        },
        value: {
          type: "string",
          description: "The value to store (e.g., 'Fernando the cactus', 'matcha lattes')"
        }
      },
      required: ["category", "key", "value"]
    }
  },
];

// ============================================
// Helper Types
// ============================================

/**
 * Represents a tool call from the AI that needs to be executed.
 */
export interface PendingToolCall {
  id: string;
  name: 'recall_memory' | 'recall_user_info' | 'store_user_info' | 'task_action' | 'calendar_action' | 'store_character_info';
  arguments: Record<string, any>;
}

/**
 * Result of executing a tool call.
 */
export interface ToolCallResult {
  toolCallId: string;
  result: string;
}

