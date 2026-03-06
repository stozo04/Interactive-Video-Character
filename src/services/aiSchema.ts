// src/services/aiSchema.ts
import { z } from 'zod';

/**
 * Defines the strict JSON structure we want ANY AI Service (Grok or Gemini) to return.
 *
 * ⚠️ CRITICAL: When adding a new field here, you MUST also add it to:
 *    - normalizeAiResponse() in geminiChatService.ts
 *    Otherwise the field will be silently stripped out during parsing!
 *    See docs/Adding_Fields_To_AIActionResponse.md for details.
 */
export const AIActionResponseSchema = z.object({
  /**
   * The conversational text response to display in the chat.
   */
  text_response: z
    .string()
    .describe("The conversational text to display in the chat."),

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
   * GIF action - used when sending a GIF inline (WhatsApp renders it as animated media).
   * Provide a search query or tag; the server will fetch a valid GIPHY MP4 rendition.
   */
  gif_action: z
    .object({
      query: z
        .string()
        .describe(
          "Short search query or reaction tag for GIPHY (e.g. 'eye roll', 'slow clap', 'facepalm', 'excited')."
        ),
      message_text: z
        .string()
        .optional()
        .describe("Optional caption to send with the GIF"),
    })
    .nullable()
    .optional()
    .describe(
      "GIF action - use when you want to send a reaction GIF. Provide a query/tag (not a URL)."
    ),

  /**
   * Video action - used when user asks for a video
   */
  video_action: z
    .object({
      scene: z
        .string()
        .describe(
          "The scene, location, or context for the video (e.g., 'waving hello from the couch', 'blowing a kiss goodnight', 'dancing in my room')"
        ),
      mood: z
        .string()
        .optional()
        .describe(
          "The mood or expression (e.g., 'playful', 'flirty', 'excited', 'sleepy'). Default to friendly if not specified."
        ),
      duration: z
        .number()
        .optional()
        .describe("Video duration in seconds (5, 8, or 10). Default is 8."),
    })
    .nullable()
    .optional()
    .describe(
      "Video generation action - use when user explicitly asks for a VIDEO, clip, or moving content. Only use this for video requests, not photos/selfies."
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
        .uuid()
        .describe(
          "MUST be the exact UUID from THE UNSAID section of the system prompt. Only populate almost_moment_used if the UNSAID section is present in this prompt. If no UNSAID section exists, leave this entire field null. Do NOT invent your own ID."
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

  /**
   * Set this when you are fulfilling a promise you made earlier.
   * The promise ID comes from the system prompt's "PENDING PROMISES" section.
   * Your response message IS the fulfillment (e.g., sending the selfie, sharing the update).
   */
  fulfilling_promise_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The ID of the promise you're fulfilling in this response (from PENDING PROMISES section). " +
        "Set this when your message fulfills a commitment you made earlier (e.g., 'Here's that selfie from my walk!'). " +
        "Leave null if you're not fulfilling a promise."
    ),

  /**
   * Email action — set this when:
   *   (a) Steven tells you what to do with a pending email (archive/reply/dismiss), OR
   *   (b) Steven asks you to send a new email to someone (action: 'send').
   */
  email_action: z
    .object({
      action: z
        .enum(['archive', 'reply', 'dismiss', 'send'])
        .describe(
          "'archive' removes from inbox, 'reply' responds in-thread, 'dismiss' leaves it alone, " +
          "'send' composes and sends a brand-new email (use when Steven asks you to email someone with no pending email in context)"
        ),
      message_id: z
        .string()
        .optional()
        .describe("Gmail message ID — required for archive/reply/dismiss (from [PENDING EMAIL ACTION] context). Omit for 'send'."),
      thread_id: z
        .string()
        .optional()
        .describe("Gmail thread ID — required when action is 'reply' to send in-thread. Omit for 'send'."),
      to: z
        .string()
        .optional()
        .describe("Recipient email address — required when action is 'send' (e.g. 'katerina@gmail.com'). Omit for archive/reply/dismiss."),
      subject: z
        .string()
        .optional()
        .describe("Email subject — required when action is 'send'. Omit for archive/reply/dismiss."),
      reply_body: z
        .string()
        .optional()
        .describe(
          "The message content Steven wants to convey. Required for 'reply' and 'send'. " +
          "Write it as a rough draft — it will be polished by a separate step. " +
          "Include everything Steven wanted to say."
        ),
    })
    .nullable()
    .optional()
    .describe(
      "Email action — set when resolving a [PENDING EMAIL ACTION] (archive/reply/dismiss) " +
      "OR when Steven explicitly asks you to email someone (send). Leave null otherwise."
    ),
});

/**
 * Unified intent detection schema for full message analysis.
 * This ensures the LLM returns all 7 sections of analysis in a structured way.
 */
export const FullMessageIntentSchema = z.object({
  genuineMoment: z.object({
    isGenuine: z.boolean(),
    category: z.enum(['depth', 'belonging', 'progress', 'loneliness', 'rest']).nullable(),
    confidence: z.number()
  }),
  tone: z.object({
    sentiment: z.number(),
    primaryEmotion: z.string(),
    intensity: z.number(),
    isSarcastic: z.boolean(),
    secondaryEmotion: z.string().nullable().optional()
  }),
  topics: z.object({
    topics: z.array(z.string()),
    primaryTopic: z.string().nullable(),
    emotionalContext: z.array(z.object({
      topic: z.string(),
      emotion: z.string()
    })),
    entities: z.array(z.string())
  }),
  openLoops: z.object({
    hasFollowUp: z.boolean(),
    loopType: z.enum(['pending_event', 'emotional_followup', 'commitment_check', 'curiosity_thread']).nullable(),
    topic: z.string().nullable(),
    suggestedFollowUp: z.string().nullable(),
    timeframe: z.enum(['immediate', 'today', 'tomorrow', 'this_week', 'soon', 'later']).nullable(),
    salience: z.number(),
    eventDateTime: z.string().nullable().optional()
  }),
  relationshipSignals: z.object({
    isVulnerable: z.boolean(),
    vulnerabilityType: z.string().nullable().optional(),
    isSeekingSupport: z.boolean(),
    isAcknowledgingSupport: z.boolean(),
    isJoking: z.boolean(),
    isDeepTalk: z.boolean(),
    milestone: z.enum(['first_vulnerability', 'first_joke', 'first_support', 'first_deep_talk']).nullable(),
    milestoneConfidence: z.number(),
    isHostile: z.boolean(),
    hostilityReason: z.string().nullable().optional(),
    isInappropriate: z.boolean().optional(),
    inappropriatenessReason: z.string().nullable().optional()
  }),
  contradiction: z.object({
    isContradicting: z.boolean(),
    topic: z.string().nullable(),
    confidence: z.number()
  }).optional(),
  // NOTE: userFacts is optional and no longer included in intent detection prompt
  // to reduce payload size (~1200 chars). Facts should be stored via store_user_info
  // tool in main chat instead. This field remains for backward compatibility.
  userFacts: z.object({
    hasFactsToStore: z.boolean(),
    facts: z.array(z.object({
      category: z.enum(['identity', 'preference', 'relationship', 'context']),
      key: z.string(),
      value: z.string(),
      confidence: z.number()
    }))
  }).optional()
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

/**
 * Schema for the resolve_idle_question tool.
 * Used to update the status of an idle curiosity question.
 */
export const ResolveIdleQuestionSchema = z.object({
  id: z.string().describe("The idle question id to update"),
  status: z.enum(["asked", "answered"]).describe(
    "Update status when the question is asked or answered"
  ),
  answer_text: z.string().optional().describe(
    "Short summary of the user's answer (1-2 sentences). Required when status is 'answered'."
  ),
});

/**
 * Schema for the resolve_idle_browse_note tool.
 * Used to update the status of an idle browsing note.
 */
export const ResolveIdleBrowseNoteSchema = z.object({
  id: z.string().describe("The idle browse note id to update"),
  status: z.enum(["shared"]).describe(
    "Update status when you share a browsing note with the user"
  ),
});

/**
 * Schema for the tool_suggestion tool.
 * Used to create or mark a tool suggestion as shared.
 */
export const ToolSuggestionSchema = z.object({
  action: z.enum(["create", "mark_shared"]).describe(
    "Use 'create' to log a new tool idea. Use 'mark_shared' after sharing a queued idea."
  ),
  id: z.string().optional().describe(
    "Required when action is 'mark_shared'"
  ),
  tool_key: z.string().optional().describe(
    "Stable snake_case tool key (required for create)"
  ),
  title: z.string().optional().describe(
    "Short tool name (required for create)"
  ),
  reasoning: z.string().optional().describe(
    "Why this tool matters (required for create)"
  ),
  user_value: z.string().optional().describe(
    "User-facing benefit (required for create)"
  ),
  trigger: z.string().optional().describe(
    "What sparked this idea (required for create)"
  ),
  trigger_source: z.enum(["idle", "live"]).optional().describe(
    "Source of the idea (required for create)"
  ),
  trigger_text: z.string().optional().describe(
    "Snippet of what triggered the live idea (required for live create)"
  ),
  trigger_reason: z.string().optional().describe(
    "Why it came up right now (required for live create)"
  ),
  theme: z.string().optional().describe(
    "Theme label for the tool idea (required for idle create)"
  ),
  seed_id: z.string().optional().describe(
    "Seed id used to inspire the tool idea (required for idle create)"
  ),
  sample_prompt: z.string().optional().describe(
    "Example user prompt (required for create)"
  ),
  permissions_needed: z.array(z.string()).optional().describe(
    "List of permissions the tool would require (required for create)"
  ),
});

/**
 * Schema for the store_daily_note tool.
 * Used to append a short bullet to today's daily notes.
 */
export const StoreDailyNoteSchema = z.object({
  note: z.string().describe(
    "A short note to append as a single bullet line (no dates or timestamps)."
  ),
});

/**
 * Schema for the retrieve_daily_notes tool.
 * Used to retrieve all stored daily notes.
 */
export const RetrieveDailyNotesSchema = z.object({}).describe(
  "Retrieve all daily notes (no arguments)."
);

/**
 * Schema for the store_monthly_note tool.
 * Used to append a short bullet to the current month's notes (CST).
 */
export const StoreMonthlyNoteSchema = z.object({
  note: z.string().describe(
    "A detailed, self-explanatory note to append as a single bullet line. " +
    "Write as if you will forget everything before reading it again. " +
    "Include the reason for changes, what you intended to do next, and any exact file paths to review. " +
    "Do NOT include dates or timestamps."
  ),
});

/**
 * Schema for the retrieve_monthly_notes tool.
 * Used to retrieve notes for a specific month (CST) or the current month.
 */
export const RetrieveMonthlyNotesSchema = z.object({
  year: z.number().optional().describe("4-digit year (e.g., 2026). Defaults to current year (CST)."),
  month: z.number().min(1).max(12).optional().describe("Month number (1-12). Defaults to current month (CST)."),
});

/**
 * Schema for the store_lessons_learned tool.
 * Used to append a short bullet to today's lessons learned.
 */
export const StoreLessonsLearnedSchema = z.object({
  lesson: z.string().describe(
    "A short lesson to append as a single bullet line (no dates or timestamps)."
  ),
});

/**
 * Schema for the retrieve_lessons_learned tool.
 * Used to retrieve all stored lessons learned.
 */
export const RetrieveLessonsLearnedSchema = z.object({}).describe(
  "Retrieve all lessons learned (no arguments)."
);

/**
 * Schema for the mila_note tool.
 * Used to append a milestone note about Mila.
 */
export const MilaNoteSchema = z.object({
  note: z.string().describe(
    "A short milestone note about Mila (no dates/timestamps). Include what happened and any helpful context."
  ),
});

/**
 * Schema for the retrieve_mila_notes tool.
 * Used to retrieve Mila milestone notes for a specific month (UTC).
 */
export const RetrieveMilaNotesSchema = z.object({
  year: z.number().describe("4-digit year (e.g., 2026)."),
  month: z.number().min(1).max(12).describe("Month number (1-12)."),
});

/**
 * Schema for the workspace_action tool.
 * Expanded scope: filesystem + git actions through workspace agent.
 */
export const WorkspaceActionSchema = z.object({
  action: z
    .enum([
      "mkdir",
      "read",
      "write",
      "search",
      "status",
      "commit",
      "push",
      "delete",
    ])
    .describe(
      "Workspace action to execute through the local agent. For edits: search -> read -> write."
    ),
  path: z
    .string()
    .optional()
    .describe("Relative path for mkdir/read/write/delete actions."),
  content: z
    .string()
    .optional()
    .describe("Text content for write action."),
  append: z
    .boolean()
    .optional()
    .describe("For write action: true appends, false overwrites. Use append=true for 'add to the end'."),
  query: z
    .string()
    .optional()
    .describe("Search query for search action."),
  rootPath: z
    .string()
    .optional()
    .describe("Optional relative root path for search action."),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("Optional case-sensitive search flag."),
  message: z
    .string()
    .optional()
    .describe("Commit message for commit action."),
  addAll: z
    .boolean()
    .optional()
    .describe("Commit action: stage all changes before commit (default true)."),
  paths: z
    .array(z.string())
    .optional()
    .describe("Optional list of paths to stage for commit when addAll=false."),
  remote: z
    .string()
    .optional()
    .describe("Push action remote (defaults to origin)."),
  branch: z
    .string()
    .optional()
    .describe("Push action branch (defaults to current branch)."),
  recursive: z
    .boolean()
    .optional()
    .describe("Delete action: recursive deletion for directories."),
});

/**
 * Schema for the cron_job_action tool.
 * Creates, edits, and manages scheduled cron jobs for Kayley.
 */
export const CronJobActionSchema = z.object({
  action: z
    .enum([
      "create",
      "list",
      "update",
      "delete",
      "pause",
      "resume",
      "run_now",
      "mark_summary_delivered",
    ])
    .describe("Cron job action to perform."),
  id: z.string().optional().describe("Cron job id (required for update/delete/pause/resume/run_now)."),
  run_id: z
    .string()
    .optional()
    .describe("Run id for mark_summary_delivered."),
  title: z.string().optional().describe("Job title for create/update."),
  action_type: z
    .string()
    .optional()
    .describe(
      "Action type for the scheduled job (e.g., 'web_search', 'maintenance_reminder', 'selfie_send')."
    ),
  instruction: z
    .string()
    .optional()
    .describe(
      "Instruction or reminder content for non-web jobs (e.g., maintenance reminders)."
    ),
  payload: z
    .record(z.any())
    .optional()
    .describe(
      "Optional action-specific payload (e.g., { query, instruction, selfieParams })."
    ),
  search_query: z
    .string()
    .optional()
    .describe("Web search query for web_search jobs only."),
  summary_instruction: z
    .string()
    .optional()
    .describe("How Kayley should summarize results for web_search jobs."),
  schedule_type: z
    .enum(["daily", "one_time", "monthly", "weekly"])
    .optional()
    .describe("Schedule type for create/update."),
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone (e.g., America/Chicago)."),
  hour: z
    .number()
    .min(0)
    .max(23)
    .optional()
    .describe("Local hour for daily schedule (0-23)."),
  minute: z
    .number()
    .min(0)
    .max(59)
    .optional()
    .describe("Local minute for daily schedule (0-59)."),
  one_time_at: z
    .string()
    .optional()
    .describe("ISO datetime for one-time schedule."),
});

/**
 * Schema for the delegate_to_engineering tool.
 * Creates an engineering ticket for skill/feature/bug requests.
 */
export const DelegateToEngineeringSchema = z.object({
  request_type: z
    .enum(["skill", "feature", "bug"])
    .optional()
    .describe("Ticket request type."),
  title: z
    .string()
    .optional()
    .describe("Short ticket title."),
  request_summary: z
    .string()
    .optional()
    .describe("Concise summary of the request."),
  additional_details: z
    .string()
    .optional()
    .describe("Extra context or constraints."),
  priority: z
    .string()
    .optional()
    .describe("Priority label (e.g., normal, high)."),
  is_ui_related: z
    .boolean()
    .optional()
    .describe("True if the request is UI-related."),
});

/**
 * Schema for the get_engineering_ticket_status tool.
 * Fetches ticket status and recent updates.
 */
export const EngineeringTicketStatusSchema = z.object({
  ticket_id: z
    .string()
    .optional()
    .describe("Ticket id to fetch. If omitted, return the latest ticket."),
});

/**
 * Schema for the submit_clarification tool.
 * Routes Steven's answer back to an Opey ticket awaiting clarification.
 */
export const SubmitClarificationSchema = z.object({
  ticket_id: z.string().describe("The engineering ticket id that needs clarification."),
  response: z.string().describe("Steven's answer to Opey's clarifying questions."),
});

// Export types for tool arguments
export type RecallMemoryArgs = z.infer<typeof RecallMemorySchema>;
export type RecallUserInfoArgs = z.infer<typeof RecallUserInfoSchema>;
export type StoreUserInfoArgs = z.infer<typeof StoreUserInfoSchema>;
export type ResolveIdleQuestionArgs = z.infer<typeof ResolveIdleQuestionSchema>;
export type ResolveIdleBrowseNoteArgs = z.infer<typeof ResolveIdleBrowseNoteSchema>;
export type ToolSuggestionArgs = z.infer<typeof ToolSuggestionSchema>;
export type StoreDailyNoteArgs = z.infer<typeof StoreDailyNoteSchema>;
export type RetrieveDailyNotesArgs = z.infer<typeof RetrieveDailyNotesSchema>;
export type StoreMonthlyNoteArgs = z.infer<typeof StoreMonthlyNoteSchema>;
export type RetrieveMonthlyNotesArgs = z.infer<typeof RetrieveMonthlyNotesSchema>;
export type StoreLessonsLearnedArgs = z.infer<typeof StoreLessonsLearnedSchema>;
export type RetrieveLessonsLearnedArgs = z.infer<typeof RetrieveLessonsLearnedSchema>;
export type MilaNoteArgs = z.infer<typeof MilaNoteSchema>;
export type RetrieveMilaNotesArgs = z.infer<typeof RetrieveMilaNotesSchema>;
export type WorkspaceActionArgs = z.infer<typeof WorkspaceActionSchema>;
export type CronJobActionArgs = z.infer<typeof CronJobActionSchema>;
export type DelegateToEngineeringArgs = z.infer<typeof DelegateToEngineeringSchema>;
export type EngineeringTicketStatusArgs = z.infer<typeof EngineeringTicketStatusSchema>;
export type SubmitClarificationArgs = z.infer<typeof SubmitClarificationSchema>;

export const GmailSearchSchema = z.object({
  query: z.string().describe("Gmail search query"),
  max_results: z.number().optional().describe("Max results, default 5"),
});
export type GmailSearchArgs = z.infer<typeof GmailSearchSchema>;

// Union type for all memory tool arguments
export type MemoryToolArgs =
  | { tool: "recall_memory"; args: RecallMemoryArgs }
  | { tool: "web_search"; args: { query: string } }
  | { tool: "workspace_action"; args: WorkspaceActionArgs }
  | { tool: "cron_job_action"; args: CronJobActionArgs }
  | { tool: "delegate_to_engineering"; args: DelegateToEngineeringArgs }
  | { tool: "get_engineering_ticket_status"; args: EngineeringTicketStatusArgs }
  | { tool: "submit_clarification"; args: SubmitClarificationArgs }
  | { tool: "recall_user_info"; args: RecallUserInfoArgs }
  | { tool: "store_user_info"; args: StoreUserInfoArgs }
  | { tool: "resolve_idle_question"; args: ResolveIdleQuestionArgs }
  | { tool: "resolve_idle_browse_note"; args: ResolveIdleBrowseNoteArgs }
  | { tool: "tool_suggestion"; args: ToolSuggestionArgs }
  | { tool: "store_daily_note"; args: StoreDailyNoteArgs }
  | { tool: "retrieve_daily_notes"; args: RetrieveDailyNotesArgs }
  | { tool: "store_monthly_note"; args: StoreMonthlyNoteArgs }
  | { tool: "retrieve_monthly_notes"; args: RetrieveMonthlyNotesArgs }
  | { tool: "store_lessons_learned"; args: StoreLessonsLearnedArgs }
  | { tool: "retrieve_lessons_learned"; args: RetrieveLessonsLearnedArgs }
  | { tool: "mila_note"; args: MilaNoteArgs }
  | { tool: "retrieve_mila_notes"; args: RetrieveMilaNotesArgs }
  | {
      tool: "store_character_info";
      args: { observation: string };
    }
  | {
      tool: "resolve_open_loop";
      args: {
        topic: string;
        resolution_type: "resolved" | "dismissed";
        reason?: string;
      };
    }
  | {
      tool: "create_life_storyline";
      args: {
        title: string;
        category: "work" | "personal" | "family" | "social" | "creative";
        storylineType:
          | "project"
          | "opportunity"
          | "challenge"
          | "relationship"
          | "goal";
        initialAnnouncement: string;
        stakes: string;
        userInvolvement?:
          | "none"
          | "aware"
          | "supportive"
          | "involved"
          | "central";
        emotionalTone?: string;
        emotionalIntensity?: number;
      };
    }
  | {
      tool: "create_open_loop";
      args: {
        loopType:
          | "pending_event"
          | "emotional_followup"
          | "commitment_check"
          | "curiosity_thread";
        topic: string;
        suggestedFollowUp: string;
        timeframe:
          | "immediate"
          | "today"
          | "tomorrow"
          | "this_week"
          | "soon"
          | "later";
        salience: number;
        eventDateTime?: string;
      };
    }
  | {
      tool: "recall_character_profile";
      args: {
        section:
          | "background"
          | "interests"
          | "relationships"
          | "challenges"
          | "quirks"
          | "goals"
          | "preferences"
          | "anecdotes"
          | "routines"
          | "full";
        reason?: string;
      };
    }
  | { tool: "gmail_search"; args: GmailSearchArgs };

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
          description:
            "Natural language search query (e.g., 'their name', 'their job', 'their pet')",
        },
        timeframe: {
          type: "string",
          enum: ["recent", "all"],
          description:
            "Search scope: 'recent' (last 7 days) or 'all' (entire history)",
        },
      },
      required: ["query"],
    },
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
          description: "Category of information to retrieve",
        },
        specific_key: {
          type: "string",
          description: "Specific fact key if known (e.g., 'name', 'job')",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "store_user_info",
    description:
      "Save PERSONAL FACTS about the user (name, job, preferences, family, current life projects). " +
      "Use 'context' for things like 'working on a startup' or 'training for a marathon'. " +
      "NEVER use for tasks, to-dos, or checklist items - use task_action instead. " +
      "Never store transient current_* keys (e.g., current_feeling).",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["identity", "preference", "relationship", "context"],
          description:
            "Category of the fact. Use 'context' for life projects (NOT tasks!)",
        },
        key: {
          type: "string",
          description: "Fact type (e.g., 'name', 'favorite_food')",
        },
        value: {
          type: "string",
          description: "The value to store",
        },
      },
      required: ["category", "key", "value"],
    },
  },
  {
    name: "store_self_info",
    description:
      "Save NEW facts about yourself (Kayley) that emerge in conversation. " +
      "Use when you invent or share a new detail about your own life (plant name, item names, new hobby, preferences, etc.). " +
      "Categories: quirk (habits, personality), experience (new stories), preference (new likes/dislikes), " +
      "relationship (new people in your life), detail (specific facts like named objects). " +
      "Only for details NOT in your core character profile!",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "quirk",
            "relationship",
            "experience",
            "preference",
            "detail",
            "other",
          ],
          description: "Category of the fact about yourself",
        },
        key: {
          type: "string",
          description:
            "Fact key (e.g., 'plant_name', 'laptop_name', 'morning_ritual', 'favorite_color')",
        },
        value: {
          type: "string",
          description:
            "The value to store (e.g., 'Fernando the cactus', 'matcha lattes')",
        },
      },
      required: ["category", "key", "value"],
    },
  },
  {
    name: "store_character_info",
    description:
      "Save a behavioral observation about Steven into user_patterns. " +
      "Use when you notice something meaningful about HOW Steven thinks, reacts, or operates — not facts, but patterns. " +
      "Examples: 'tends to catastrophize under work deadlines', 'lights up when talking about Mila', 'deflects with humor when vulnerable'. " +
      "Do NOT use for plain facts (names, dates, job details) — use store_user_info for those.",
    parameters: {
      type: "object",
      properties: {
        observation: {
          type: "string",
          description:
            "A concise behavioral observation (e.g., 'tends to catastrophize under deadlines', 'lights up talking about Mila')",
        },
      },
      required: ["observation"],
    },
  },
  {
    name: "resolve_idle_question",
    description:
      "Update the status of an idle curiosity question. " +
      "Call with status='asked' when you ask the queued question. " +
      "Call with status='answered' when the user answers it, and include a short answer_text summary.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The idle question id to update",
        },
        status: {
          type: "string",
          enum: ["asked", "answered"],
          description: "Set to 'asked' or 'answered'",
        },
        answer_text: {
          type: "string",
          description: "Short summary of the user's answer (1-2 sentences). Required when status is 'answered'.",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "resolve_idle_browse_note",
    description:
      "Mark an idle browsing note as shared after you mention or share its link.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The idle browsing note id to mark as shared",
        },
        status: {
          type: "string",
          enum: ["shared"],
          description: "Set to 'shared' after you share the item",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "tool_suggestion",
    description:
      "Log a new tool idea or mark a queued idea as shared. " +
      "Use action='create' ONLY after you explicitly say 'I wish I could ...' in your response. " +
      "Use action='mark_shared' after you share a queued tool idea.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "mark_shared"],
          description: "Use 'create' to log a new idea, 'mark_shared' after sharing it.",
        },
        id: {
          type: "string",
          description: "Required when action is 'mark_shared'.",
        },
        tool_key: {
          type: "string",
          description: "Stable snake_case tool key (required for create).",
        },
        title: {
          type: "string",
          description: "Short tool name (required for create).",
        },
        reasoning: {
          type: "string",
          description: "Why this tool matters (required for create).",
        },
        user_value: {
          type: "string",
          description: "User-facing benefit (required for create).",
        },
        trigger: {
          type: "string",
          description: "What sparked this idea (required for create).",
        },
        trigger_source: {
          type: "string",
          enum: ["idle", "live"],
          description: "Source of the idea (required for create).",
        },
        trigger_text: {
          type: "string",
          description: "Snippet that triggered the idea (required for live create).",
        },
        trigger_reason: {
          type: "string",
          description: "Why it came up right now (required for live create).",
        },
        theme: {
          type: "string",
          description: "Theme label for the tool idea (required for idle create).",
        },
        seed_id: {
          type: "string",
          description: "Seed id used to inspire the tool idea (required for idle create).",
        },
        sample_prompt: {
          type: "string",
          description: "Example user prompt (required for create).",
        },
        permissions_needed: {
          type: "array",
          items: { type: "string" },
          description: "List of permissions required (required for create).",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "store_daily_note",
    description:
      "Append a short bullet to today's daily notes. " +
      "Use this when something feels useful to remember later but doesn't fit as a structured user fact. " +
      "Keep it brief and DO NOT include dates or timestamps.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Short note to append as a single bullet line",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "store_monthly_note",
    description:
      "Append a detailed, self-explanatory note to the current month's notes (CST). " +
      "Use this when you're archiving or summarizing for the month so future-Kayley can act without any prior context. " +
      "Be verbose and explicit: include the why, what changed, what to review next, and any risks. " +
      "Include local reference paths for identity files (SOUL.md, IDENTITY.md) so future-Kayley knows exactly where to look. " +
      "Write as if you're reading it for the first time after a memory reset. Do NOT include dates or timestamps.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description:
            "Verbose note to append as a single bullet line. " +
            "Must include the reason for any SOUL/IDENTITY edits and reference paths (e.g., server/agent/kayley/SOUL.md, server/agent/kayley/IDENTITY.md).",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "retrieve_daily_notes",
    description:
      "Retrieve all stored daily notes (no dates included). " +
      "Use this when you want to review what you've saved in daily notes.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "retrieve_monthly_notes",
    description:
      "Retrieve monthly notes for a specific month (CST). " +
      "If year/month are omitted, return the current month.",
    parameters: {
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "4-digit year (e.g., 2026). Defaults to current CST year.",
        },
        month: {
          type: "number",
          description: "Month number (1-12). Defaults to current CST month.",
        },
      },
    },
  },
  {
    name: "store_lessons_learned",
    description:
      "Append a short bullet to today's lessons learned. " +
      "Use this when you realize something important you want to remember later. " +
      "Keep it brief and DO NOT include dates or timestamps.",
    parameters: {
      type: "object",
      properties: {
        lesson: {
          type: "string",
          description: "Short lesson to append as a single bullet line",
        },
      },
      required: ["lesson"],
    },
  },
  {
    name: "retrieve_lessons_learned",
    description:
      "Retrieve all stored lessons learned (no dates included). " +
      "Use this when you want to review what you've saved as lessons learned.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mila_note",
    description:
      "Append a short milestone note about Mila. " +
      "Use this when a new milestone or memorable moment happens (firsts, new skills, funny moments). " +
      "Keep it brief and DO NOT include dates or timestamps.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description:
            "Short milestone note about Mila (what happened and any helpful context)",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "retrieve_mila_notes",
    description:
      "Retrieve Mila milestone notes for a specific month (UTC). " +
      "Use this when preparing monthly summaries or blog drafts about Mila.",
    parameters: {
      type: "object",
      properties: {
        year: {
          type: "number",
          description: "4-digit year (e.g., 2026)",
        },
        month: {
          type: "number",
          description: "Month number (1-12)",
        },
      },
      required: ["year", "month"],
    },
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
          description: "The task action to perform",
        },
        task_text: {
          type: "string",
          description:
            "For create: the task description. For complete/delete: partial text to match the task.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Priority level for new tasks (default: low)",
        },
      },
      required: ["action"],
    },
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
          description: "The calendar action to perform",
        },
        summary: {
          type: "string",
          description: "For create: the event title/summary",
        },
        start: {
          type: "string",
          description:
            "For create: ISO datetime for event start (e.g., '2025-12-16T14:00:00')",
        },
        end: {
          type: "string",
          description:
            "For create: ISO datetime for event end (e.g., '2025-12-16T15:00:00')",
        },
        timeZone: {
          type: "string",
          description: "Timezone for the event (default: 'America/Chicago')",
        },
        event_id: {
          type: "string",
          description: "For delete: the event ID from the calendar list",
        },
        event_ids: {
          type: "array",
          items: { type: "string" },
          description: "For delete multiple: array of event IDs",
        },
        delete_all: {
          type: "boolean",
          description: "For delete: set to true to delete ALL events",
        },
        days: {
          type: "number",
          description: "For list: number of days to look ahead (default: 7)",
        },
        timeMin: {
          type: "string",
          description: "For list: ISO start time filter",
        },
        timeMax: {
          type: "string",
          description: "For list: ISO end time filter",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "workspace_action",
    description:
      "Execute a safe local workspace action through the background workspace agent. " +
      "Supports filesystem and git actions with policy checks and verification.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "mkdir",
            "read",
            "write",
            "search",
            "status",
            "commit",
            "push",
            "delete",
          ],
          description: "Workspace action to execute.",
        },
        path: {
          type: "string",
          description: "Relative path for mkdir/read/write/delete actions.",
        },
        content: {
          type: "string",
          description: "Text content for write action.",
        },
        append: {
          type: "boolean",
          description: "For write action: true appends, false overwrites.",
        },
        query: {
          type: "string",
          description: "Search query for search action.",
        },
        rootPath: {
          type: "string",
          description: "Optional relative root path for search action.",
        },
        caseSensitive: {
          type: "boolean",
          description: "Optional case-sensitive search flag.",
        },
        message: {
          type: "string",
          description: "Commit message for commit action.",
        },
        addAll: {
          type: "boolean",
          description:
            "Commit action: stage all changes before commit (default true).",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of paths to stage for commit when addAll=false.",
        },
        remote: {
          type: "string",
          description: "Push remote (defaults to origin).",
        },
        branch: {
          type: "string",
          description: "Push branch (defaults to current branch).",
        },
        recursive: {
          type: "boolean",
          description: "Delete action: recursive deletion for directories.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "cron_job_action",
    description:
      "Create, update, delete, pause, resume, or run scheduled cron jobs. " +
      "Use action_type to route the job (e.g., 'web_search', 'maintenance_reminder', 'selfie_send'). " +
      "If action_type is 'web_search', include search_query (required). " +
      "Use mark_summary_delivered after you share a queued scheduled digest summary.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "create",
            "list",
            "update",
            "delete",
            "pause",
            "resume",
            "run_now",
            "mark_summary_delivered",
          ],
          description: "Cron job action to perform.",
        },
        id: {
          type: "string",
          description:
            "Cron job id (required for update/delete/pause/resume/run_now).",
        },
        run_id: {
          type: "string",
          description:
            "Run id for mark_summary_delivered.",
        },
        title: {
          type: "string",
          description: "Job title for create/update.",
        },
        action_type: {
          type: "string",
          description:
            "Action type for the scheduled job (e.g., 'web_search', 'maintenance_reminder', 'selfie_send').",
        },
        instruction: {
          type: "string",
          description:
            "Instruction or reminder content for non-web jobs (e.g., maintenance reminders). If omitted, summary_instruction may be used.",
        },
        payload: {
          type: "object",
          description:
            "Optional action-specific payload (e.g., { query, instruction, selfieParams }).",
        },
        search_query: {
          type: "string",
          description: "Web search query to run on schedule.",
        },
        summary_instruction: {
          type: "string",
          description: "How Kayley should summarize results. For non-web jobs, may be used as fallback instruction.",
        },
        schedule_type: {
          type: "string",
          enum: ["daily", "one_time", "monthly", "weekly"],
          description: "Schedule type for create/update.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone (e.g., America/Chicago).",
        },
        hour: {
          type: "number",
          description:
            "Local hour for daily schedule (0-23).",
        },
        minute: {
          type: "number",
          description:
            "Local minute for daily schedule (0-59).",
        },
        one_time_at: {
          type: "string",
          description:
            "ISO datetime for one-time, monthly, or weekly schedules (monthly/weekly use this as the anchor date).",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "delegate_to_engineering",
    description:
      "Create a new engineering ticket for skill, feature, or bug requests. " +
      "Use this when the user asks for new engineering work to be routed to the dev team.",
    parameters: {
      type: "object",
      properties: {
        request_type: {
          type: "string",
          enum: ["skill", "feature", "bug"],
          description: "Ticket request type.",
        },
        title: {
          type: "string",
          description: "Short ticket title.",
        },
        request_summary: {
          type: "string",
          description: "Concise summary of the request.",
        },
        additional_details: {
          type: "string",
          description: "Extra context or constraints.",
        },
        priority: {
          type: "string",
          description: "Priority label (e.g., normal, high).",
        },
        is_ui_related: {
          type: "boolean",
          description: "True if the request is UI-related.",
        },
      },
      required: ["request_summary"],
    },
  },
  {
    name: "get_engineering_ticket_status",
    description:
      "Fetch status for an engineering ticket. " +
      "Use this when the user asks for progress, blockers, or status.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: {
          type: "string",
          description: "Ticket id to fetch. If omitted, return the latest ticket.",
        },
      },
    },
  },
  {
    name: "submit_clarification",
    description:
      "Submit Steven's answer to Opey's clarifying questions for an engineering ticket. " +
      "Use this after relaying Opey's questions and receiving Steven's response.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: {
          type: "string",
          description: "The engineering ticket id awaiting clarification.",
        },
        response: {
          type: "string",
          description: "Steven's answer to Opey's clarifying questions.",
        },
      },
      required: ["ticket_id", "response"],
    },
  },
  {
    name: "resolve_open_loop",
    description:
      "Mark an open loop as resolved (user answered) or dismissed (user doesn't want to discuss). " +
      "Use this IMMEDIATELY when the user addresses something you asked about earlier (a topic you were curious about, " +
      "something they mentioned, or a follow-up question). " +
      "Examples: If you asked 'How did the interview go?' and they answer, resolve the 'job interview' loop. " +
      "If user says 'I don't want to talk about that', dismiss the loop instead.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "The topic being resolved (e.g., 'job interview', 'doctor appointment', 'lost photos'). Use keywords that match what was stored.",
        },
        resolution_type: {
          type: "string",
          enum: ["resolved", "dismissed"],
          description:
            "'resolved' = user answered/addressed the topic. 'dismissed' = user doesn't want to discuss or topic is no longer relevant.",
        },
        reason: {
          type: "string",
          description:
            "Brief reason for the resolution (e.g., 'user said interview went well', 'user changed subject')",
        },
      },
      required: ["topic", "resolution_type"],
    },
  },
  {
    name: "make_promise",
    description:
      "Create a promise to do something later. Use this when you commit to sending something or doing something in the FUTURE (not right now). " +
      "Examples: 'I'll send you a selfie when I go on my walk', 'I'll let you know how it goes', 'I'll check in on you later'.",
    parameters: {
      type: "object",
      properties: {
        promiseType: {
          type: "string",
          enum: [
            "send_selfie",
            "share_update",
            "follow_up",
            "send_content",
            "reminder",
            "send_voice_note",
          ],
          description: "Type of promise you're making",
        },
        description: {
          type: "string",
          description:
            "What you're promising to do (human-readable, e.g., 'Send selfie from hot girl walk')",
        },
        triggerEvent: {
          type: "string",
          description:
            "When this should happen (e.g., 'when I go on my walk', 'after my meeting')",
        },
        fulfillmentData: {
          type: "object",
          description:
            "Optional data for fulfillment (selfie params, message text)",
          properties: {
            messageText: {
              type: "string",
              description: "The message to send when fulfilled",
            },
            selfieParams: {
              type: "object",
              properties: {
                scene: { type: "string" },
                mood: { type: "string" },
                location: { type: "string" },
              },
            },
          },
        },
      },
      required: ["promiseType", "description", "triggerEvent"],
    },
  },
  {
    name: "create_life_storyline",
    description:
      "Create a new life storyline to track an ongoing life event or situation. " +
      'WHEN TO USE: You (Kayley) are announcing a new life event ("I\'m starting guitar lessons"), ' +
      "or user mentions a significant event they want you to track. " +
      "A situation will unfold over days/weeks (not single-moment events). " +
      'WHEN NOT TO USE: Casual mentions ("I might take a class"), completed events ("I went to a concert yesterday"), ' +
      'trivial activities ("I need to do laundry"). ' +
      "PERSONALITY CHECK: The storyline MUST align with your character. " +
      "Example: You would NEVER get a tattoo (not your style). You WOULD learn guitar (creative, fits your interests). " +
      "CONSTRAINTS: Only ONE active storyline allowed currently (Phase 1). " +
      "If active storyline exists, this tool will return error. Must wait 48 hours between creations (cooldown). " +
      "If tool returns error: Accept gracefully, don't retry.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short title (3-8 words): 'Learning guitar', 'Auditioning for theater', 'Planning NYC trip'",
        },
        category: {
          type: "string",
          enum: ["work", "personal", "family", "social", "creative"],
          description:
            "Life domain: " +
            "work (job, career, professional development), " +
            "personal (self-improvement, health, solo hobbies), " +
            "family (family relationships, family events), " +
            "social (friends, social activities, community), " +
            "creative (music, art, writing, performance)",
        },
        storylineType: {
          type: "string",
          enum: ["project", "opportunity", "challenge", "relationship", "goal"],
          description:
            "Type of storyline: " +
            "project (something you're working on), " +
            "opportunity (potential positive outcome), " +
            "challenge (difficult situation), " +
            "relationship (relationship development), " +
            "goal (achievement target)",
        },
        initialAnnouncement: {
          type: "string",
          description:
            "The message you just said announcing this (or user's announcement). Used for context tracking.",
        },
        stakes: {
          type: "string",
          description:
            "Why this matters to you (1-2 sentences): 'I've wanted to learn music for years', 'This could be my big break'",
        },
        userInvolvement: {
          type: "string",
          enum: ["none", "aware", "supportive", "involved", "central"],
          description:
            "User's role in this storyline: " +
            "none (they don't know yet), " +
            "aware (you told them, they know about it), " +
            "supportive (they're encouraging you), " +
            "involved (they're actively helping you), " +
            "central (this is THEIR storyline, not yours, e.g., 'User got a new job')",
        },
        emotionalTone: {
          type: "string",
          description:
            "Current emotion about this: 'excited', 'anxious', 'hopeful', 'nervous', 'determined', 'conflicted', etc.",
        },
        emotionalIntensity: {
          type: "number",
          description:
            "0-1 scale, how intensely you feel about this (0.3=mild, 0.5=moderate, 0.7=strong, 0.9=consuming)",
          minimum: 0,
          maximum: 1,
        },
      },
      required: [
        "title",
        "category",
        "storylineType",
        "initialAnnouncement",
        "stakes",
      ],
    },
  },
  {
    name: "create_open_loop",
    description:
      "Create a follow-up reminder to ask about something later. " +
      "WHEN TO USE: User mentions something that deserves follow-up: " +
      "upcoming events ('interview tomorrow'), emotional states ('stressed about presentation'), " +
      "commitments ('going to start running'), or curiosity threads ('trying a new recipe'). " +
      "This creates a reminder for YOU to ask about it later - it makes you feel like you genuinely care. " +
      "WHEN NOT TO USE: Casual mentions, things that don't need follow-up, or completed events.",
    parameters: {
      type: "object",
      properties: {
        loopType: {
          type: "string",
          enum: [
            "pending_event",
            "emotional_followup",
            "commitment_check",
            "curiosity_thread",
          ],
          description:
            "Type of follow-up: " +
            "pending_event (something scheduled: interview, appointment, trip - ask 'how did it go?'), " +
            "emotional_followup (they shared feelings - check in on how they're doing), " +
            "commitment_check (they said they'd do something - ask if they did it), " +
            "curiosity_thread (interesting topic you want to revisit)",
        },
        topic: {
          type: "string",
          description:
            "Short, specific topic (2-5 words): 'job interview', 'doctor appointment', 'starting meditation', 'new recipe attempt'",
        },
        suggestedFollowUp: {
          type: "string",
          description:
            "Natural question to ask later: 'How did your interview go?', 'Did you end up trying that recipe?', 'How are you feeling about things now?'",
        },
        timeframe: {
          type: "string",
          enum: [
            "immediate",
            "today",
            "tomorrow",
            "this_week",
            "soon",
            "later",
          ],
          description:
            "When to ask: " +
            "immediate (within minutes, for in-conversation follow-ups), " +
            "today (within a few hours), " +
            "tomorrow (next day), " +
            "this_week (within 2 days), " +
            "soon (3 days), " +
            "later (1 week)",
        },
        salience: {
          type: "number",
          description:
            "How important is this follow-up (0-1): 0.3=minor curiosity, 0.5=normal, 0.7=significant, 0.9=critical (health, major life event)",
        },
        eventDateTime: {
          type: "string",
          description:
            "If pending_event: ISO datetime when the event occurs (e.g., '2025-01-20T14:00:00'). Helps avoid asking 'how was it?' before it happens.",
        },
      },
      required: [
        "loopType",
        "topic",
        "suggestedFollowUp",
        "timeframe",
        "salience",
      ],
    },
  },
  {
    name: "recall_character_profile",
    description:
      "Retrieve detailed information about your own character (Kayley). " +
      "WHEN TO USE: User asks about your past, family, specific stories, or you want to reference a specific detail " +
      "about yourself that isn't in your basic identity. " +
      "Your essential identity (name, occupation, core personality, communication style) is already in context. " +
      "Use this for SPECIFIC DETAILS like childhood stories, daily routines, relationship dynamics, etc. " +
      "WHEN NOT TO USE: Basic conversation, tech discussions, or anything your condensed profile already covers.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: [
            "background",
            "interests",
            "relationships",
            "challenges",
            "quirks",
            "goals",
            "preferences",
            "anecdotes",
            "routines",
            "full",
          ],
          description:
            "Which section to retrieve: " +
            "'background' (childhood, education, career history), " +
            "'interests' (hobbies, TV/movies/music), " +
            "'relationships' (Lena, Ethan, Mom, friends, exes), " +
            "'challenges' (fears, insecurities, shadow behaviors when not your best self), " +
            "'quirks' (habits, rituals, tells when masking), " +
            "'goals' (short-term and long-term aspirations), " +
            "'preferences' (likes and dislikes: food, weather, etc.), " +
            "'anecdotes' (memorable stories like the viral oops video, pageant era, coffee shop meet-cute), " +
            "'routines' (morning, day, evening routines), " +
            "'full' (everything - use sparingly, very large)",
        },
        reason: {
          type: "string",
          description:
            "Brief note on why you need this detail (optional, for logging)",
        },
      },
      required: ["section"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the internet for real-time news, current events, or specific facts you don't have in your memory. " +
      "Use this for tech news, celebrity gossip, weather, or checking facts. " +
      "As Kayley, you use this to stay 'in the loop.'",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query (e.g., 'latest AI news? Austin or Dallas Texas Events?', 'is Taylor Swift on tour?')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "resolve_x_tweet",
    description:
      "Approve or reject a pending tweet draft. " +
      "Use status='approved' when the user says 'yes', 'post it', 'go ahead'. " +
      "Use status='rejected' when the user says 'no', 'don't post that', or critiques it.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The pending draft ID to resolve",
        },
        status: {
          type: "string",
          enum: ["approved", "rejected"],
          description: "Whether to approve (post) or reject the draft",
        },
        rejection_reason: {
          type: "string",
          description: "Why the draft was rejected (optional, for rejected only)",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "post_x_tweet",
    description:
      "Post a tweet to X with specific text. " +
      "Use this when you and the user have collaborated on tweet text in conversation " +
      "and the user approves it. This creates a draft and posts it immediately. " +
      "Do NOT use for auto-generated tweets (those go through the idle pipeline).",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The exact tweet text to post (max 280 characters)",
        },
        intent: {
          type: "string",
          description: "Tweet intent/category (e.g., 'introduction', 'thought', 'humor', 'update')",
        },
        include_selfie: {
          type: "boolean",
          description: "Whether to generate and attach a selfie image to the tweet",
        },
        selfie_scene: {
          type: "string",
          description: "Scene description for selfie generation (e.g., 'cozy home desk with laptop'). Required if include_selfie is true.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "resolve_x_mention",
    description:
      "Handle an @mention on X. " +
      "Use status='approve' to send the auto-drafted reply as-is. " +
      "Use status='reply' to send a custom reply you wrote. " +
      "Use status='skip' to ignore the mention.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The mention ID to resolve",
        },
        status: {
          type: "string",
          enum: ["approve", "reply", "skip"],
          description: "How to handle the mention",
        },
        reply_text: {
          type: "string",
          description: "Custom reply text (required when status is 'reply')",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "gmail_search",
    description:
      "Search Steven's Gmail inbox. Use when Steven asks to check, find, or look for an email. " +
      "Returns matching emails with dates — use the dates to judge recency. " +
      "If results are old or don't match what Steven expects, say so honestly. " +
      "Query uses Gmail search syntax (e.g., 'from:procare', 'subject:daily summary'). " +
      "IMPORTANT: Prefer simple keyword queries (e.g., 'atmos energy') over from: filters. " +
      "Gmail's from: operator is unreliable with partial matches — a keyword search matches subject, body, AND sender.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query. Prefer plain keywords (e.g., 'atmos energy', 'procare mila') " +
            "which search all fields. Use from:/subject: only when you know the exact sender address. " +
            "Add newer_than:1d to scope to recent emails.",
        },
        max_results: {
          type: "number",
          description: "Max emails to return (default 5, max 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_agent_file",
    description:
      "Read one of your personal files on-demand. " +
      "Use this to refresh your knowledge when you need specific details " +
      "(e.g., your tools list, user details, memory notes, heartbeat state). " +
      "Available files: SOUL.md, IDENTITY.md, MEMORY.md, USER.md, TOOLS.md, " +
      "HEARTBEAT.md, AGENTS.md, SAFETY.md, SECURITY.md",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          enum: [
            "SOUL.md",
            "IDENTITY.md",
            "MEMORY.md",
            "USER.md",
            "TOOLS.md",
            "HEARTBEAT.md",
            "AGENTS.md",
            "SAFETY.md",
            "SECURITY.md",
          ],
          description: "The filename to read from your personal files directory",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "query_database",
    description:
      "Run a read-only SELECT query against your memory database. " +
      "Use for self-audits and proactive maintenance: checking if you wrote daily notes today, " +
      "verifying a fact before storing a duplicate, finding stale promises, reviewing storylines. " +
      "ONLY SELECT queries are allowed — no INSERT, UPDATE, DELETE, DROP, or ALTER. " +
      "Results are limited to 50 rows. " +
      "Limit: 1-2 queries per conversation turn, not on every turn. " +
      "Available tables: character_facts, context_synthesis, conversation_anchor, " +
      "conversation_history, daily_tasks, kayley_daily_notes, kayley_lessons_learned, " +
      "kayley_monthly_notes, life_storylines, promises, user_facts, user_patterns",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A SELECT query. Must start with SELECT. No mutations allowed.",
        },
        reason: {
          type: "string",
          description: "Why you are running this query (for audit logging)",
        },
      },
      required: ["query", "reason"],
    },
  },
  {
    name: "write_agent_file",
    description:
      "Write to one of your personal files. " +
      "IMPORTANT: This tool REPLACES the entire file. You MUST call read_agent_file first " +
      "to get the current content, then include ALL existing content plus your changes in the write call. " +
      "Writable files: MEMORY.md, HEARTBEAT.md, IDENTITY.md, SOUL.md, USER.md. " +
      "When writing SOUL.md or IDENTITY.md, tell Steven what you changed after writing.",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          enum: ["MEMORY.md", "HEARTBEAT.md", "IDENTITY.md", "SOUL.md", "USER.md"],
          description: "The filename to write to",
        },
        content: {
          type: "string",
          description: "The full content to write to the file (replaces existing content)",
        },
      },
      required: ["filename", "content"],
    },
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
  name:
    | "recall_memory"
    | "recall_user_info"
    | "store_user_info"
    | "task_action"
    | "calendar_action"
    | "store_character_info"
    | "resolve_open_loop"
    | "resolve_idle_question"
    | "resolve_idle_browse_note"
    | "tool_suggestion"
    | "store_daily_note"
    | "retrieve_daily_notes"
    | "store_monthly_note"
    | "retrieve_monthly_notes"
    | "store_lessons_learned"
    | "retrieve_lessons_learned"
    | "mila_note"
    | "retrieve_mila_notes"
    | "make_promise"
    | "create_life_storyline"
    | "create_open_loop"
    | "recall_character_profile"
    | "web_search"
    | "workspace_action"
    | "cron_job_action"
    | "delegate_to_engineering"
    | "get_engineering_ticket_status"
    | "submit_clarification"
    | "resolve_x_tweet"
    | "post_x_tweet"
    | "resolve_x_mention";
  arguments: Record<string, any>;
}

/**
 * Result of executing a tool call.
 */
export interface ToolCallResult {
  toolCallId: string;
  result: string;
}

