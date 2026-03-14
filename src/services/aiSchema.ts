// src/services/aiSchema.ts
import { z } from 'zod';

/**
 * Defines the strict JSON structure the AI service returns.
 *
 * ⚠️ CRITICAL: When adding a new field here, you MUST also add it to:
 *    - normalizeAiResponse() in claudeAgentService.ts
 *    Otherwise the field will be silently stripped out during parsing!
 */
export const AIActionResponseSchema = z.object({
  /**
   * The conversational text response to display in the chat.
   */
  text_response: z
    .string()
    .describe("The conversational text to display in the chat."),

  /**
   * If true, send this response as a voice note (Telegram/WhatsApp) instead of text only.
   * Use for emotional moments, check-ins, goodnight messages, or when a voice feels more personal.
   */
  send_as_voice: z
    .boolean()
    .optional()
    .describe("If true, deliver this response as a Kayley voice note. Use sparingly for emotional/personal moments."),

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
      "The URL scheme to launch an external application when Steven asks to open or launch one. " +
      "Examples: 'slack://', 'spotify:', 'zoommtg://', 'notion://', 'vscode:', 'cursor://', 'msteams:', 'outlook:', 'wt:'. " +
      "Return null when no app launch is requested."
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
    "Category of the fact being stored. Use 'context' for current projects or life events."
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
 * Schema for the review_pr tool.
 * Used to fetch a GitHub PR's metadata, diff, and CI status for Kayley to review.
 */
export const ReviewPrSchema = z.object({
  pr_url: z.string().describe(
    "Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/51"
  ),
  ticket_id: z.string().optional().describe(
    "Engineering ticket ID this PR corresponds to — included for context in the review output."
  ),
});

/**
 * Schema for the kayley_pulse tool.
 * Used to read or trigger a Kayley health dashboard snapshot.
 */
export const KayleyPulseSchema = z.object({
  action: z.enum(["read", "check", "restart"]).describe(
    "Use read to fetch the latest pulse status. Use check to trigger a fresh health check and update pulse-config.json. Use restart to restart a specific service."
  ),
  service: z.enum(["opey", "tidy", "telegram", "server"]).optional().describe("Required when action='restart'. Which service to restart."),
  reason: z.string().optional().describe("Optional short reason for manual checks or restarts."),
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

/**
 * Schema for the email_action tool.
 * Handles pending email actions (archive/reply/dismiss) and new outbound sends.
 */
export const EmailActionToolSchema = z.object({
  action: z.enum(["archive", "reply", "dismiss", "send"]).describe(
    "'archive' removes from inbox, 'reply' responds to an existing message, 'dismiss' marks pending email as ignored, 'send' composes a new outbound email."
  ),
  message_id: z.string().optional().describe(
    "Required for archive/reply/dismiss. Gmail message ID from [PENDING EMAIL ACTION] context."
  ),
  thread_id: z.string().optional().describe(
    "Optional Gmail thread ID for replies."
  ),
  to: z.string().optional().describe(
    "Recipient email address. Required for send. Optional override for reply."
  ),
  subject: z.string().optional().describe(
    "Email subject. Required for send. Optional override for reply."
  ),
  reply_body: z.string().optional().describe(
    "Body content to send. Required for reply and send."
  ),
  draft_id: z.string().optional().describe(
    "For action='send' confirmation: draft id returned from preview response. Required when confirmed=true."
  ),
  confirmed: z.boolean().optional().describe(
    "Required for action='send'. Must be true to actually dispatch the email. " +
    "Omit or set false on the first call — the server will return a preview. " +
    "Only set true after Steven has explicitly approved the draft."
  ),
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
export type ReviewPrArgs = z.infer<typeof ReviewPrSchema>;

/**
 * Schema for the submit_pr_review tool.
 * Called after review_pr once Kayley has formed a verdict.
 */
export const SubmitPrReviewSchema = z.object({
  ticket_id: z.string().describe("Engineering ticket ID the PR belongs to."),
  pr_url: z.string().describe("Full GitHub PR URL — included in feedback message to Steven."),
  verdict: z.enum(["approved", "needs_changes"]).describe(
    "approved: PR looks good, notify Steven. needs_changes: write feedback to ticket and reset it for Opey to fix."
  ),
  feedback: z.string().optional().describe(
    "Required when verdict is needs_changes. Specific, actionable feedback for Opey — what is missing, wrong, or needs to change."
  ),
});
export type SubmitPrReviewArgs = z.infer<typeof SubmitPrReviewSchema>;
export type KayleyPulseArgs = z.infer<typeof KayleyPulseSchema>;
export type DelegateToEngineeringArgs = z.infer<typeof DelegateToEngineeringSchema>;
export type EngineeringTicketStatusArgs = z.infer<typeof EngineeringTicketStatusSchema>;
export type SubmitClarificationArgs = z.infer<typeof SubmitClarificationSchema>;
export type EmailActionToolArgs = z.infer<typeof EmailActionToolSchema>;

/**
 * Schema for the email_action_manage tool.
 * Allows Kayley to bulk-dismiss pending email action rows she no longer needs to act on.
 */
export const EmailActionManageSchema = z.object({
  action: z.enum(["dismiss_pending"]).describe(
    "The management action to perform. 'dismiss_pending' marks pending email action rows as dismissed."
  ),
  action_ids: z.array(z.string()).optional().describe(
    "Optional list of kayley_email_actions row UUIDs to dismiss. If omitted, dismisses ALL pending rows (capped at 50)."
  ),
  message_ids: z.array(z.string()).optional().describe(
    "Optional list of Gmail message IDs to dismiss. Alternative to action_ids."
  ),
});
export type EmailActionManageArgs = z.infer<typeof EmailActionManageSchema>;

export const GmailSearchSchema = z.object({
  query: z.string().describe("Gmail search query"),
  max_results: z.number().optional().describe("Max results, default 5"),
});
export type GmailSearchArgs = z.infer<typeof GmailSearchSchema>;


export const StartBackgroundTaskSchema = z.object({
  command: z.string().describe("Shell command to run in the background."),
  label: z.string().describe("Short human-readable label for the task (e.g., 'Installing PyTorch')."),
  cwd: z.string().optional().describe("Working directory relative to workspace root."),
});
export type StartBackgroundTaskArgs = z.infer<typeof StartBackgroundTaskSchema>;

export const CheckTaskStatusSchema = z.object({
  task_id: z.string().describe("Task ID returned from start_background_task."),
  tail_lines: z.number().optional().describe("Number of recent output lines to return (default 30)."),
});
export type CheckTaskStatusArgs = z.infer<typeof CheckTaskStatusSchema>;

export const CancelTaskSchema = z.object({
  task_id: z.string().describe("Task ID to cancel."),
});
export type CancelTaskArgs = z.infer<typeof CancelTaskSchema>;
