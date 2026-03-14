// server/services/ai/kayleyMcpServer.ts
//
// In-process MCP server that wraps all Kayley domain tools for the Claude Agent SDK.
// Each tool handler delegates to the existing executeMemoryTool() function, preserving
// all Supabase logic, logging, and side effects.
//
// SSE events (tool_start/tool_end) are emitted directly from handlers since they
// run in the parent process (not in the Claude subprocess).

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  executeMemoryTool,
  type MemoryToolName,
  type ToolExecutionContext,
} from "../../../src/services/memoryService";
import {
  RecallMemorySchema,
  RecallUserInfoSchema,
  StoreUserInfoSchema,
  ResolveIdleQuestionSchema,
  ResolveIdleBrowseNoteSchema,
  ToolSuggestionSchema,
  StoreDailyNoteSchema,
  StoreMonthlyNoteSchema,
  RetrieveMonthlyNotesSchema,
  StoreLessonsLearnedSchema,
  MilaNoteSchema,
  RetrieveMilaNotesSchema,
  ReviewPrSchema,
  SubmitPrReviewSchema,
  KayleyPulseSchema,
  DelegateToEngineeringSchema,
  EngineeringTicketStatusSchema,
  SubmitClarificationSchema,
  EmailActionToolSchema,
  EmailActionManageSchema,
  StartBackgroundTaskSchema,
  CheckTaskStatusSchema,
  CancelTaskSchema,
} from "../../../src/services/aiSchema";
import { log } from "../../runtimeLogger";
import { runClassifierShadow } from "../memoryClassifier";
import { getToolDisplayName, sanitizeToolArgs, truncateResultSummary } from "./sseTypes";
import type { SSEToolStartEvent, SSEToolEndEvent } from "./sseTypes";

const runtimeLog = log.fromContext({ source: "kayleyMcpServer" });

// ============================================================================
// Helper: wrap executeMemoryTool as an MCP tool handler
// ============================================================================

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function createToolHandler(
  toolName: MemoryToolName,
  getContext: () => ToolExecutionContext,
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const context = getContext();
    const startedAt = Date.now();
    const callIndex = (context.eventBus as any)?.nextCallIndex?.() ?? 0;

    // SSE: emit tool_start
    if (context.eventBus) {
      const startEvent: SSEToolStartEvent = {
        type: "tool_start",
        toolName,
        toolDisplayName: getToolDisplayName(toolName),
        toolArgs: sanitizeToolArgs(args),
        callIndex,
        timestamp: Date.now(),
      };
      context.eventBus.emit("sse", startEvent);
    }

    try {
      const result = await executeMemoryTool(toolName, args, context);
      const durationMs = Date.now() - startedAt;

      runtimeLog.info("tool_call_summary", {
        tool: toolName,
        status: "success",
        durationMs,
      });

      // SSE: emit tool_end success
      if (context.eventBus) {
        const endEvent: SSEToolEndEvent = {
          type: "tool_end",
          toolName,
          callIndex,
          durationMs,
          success: true,
          resultSummary: truncateResultSummary(result),
          timestamp: Date.now(),
        };
        context.eventBus.emit("sse", endEvent);
      }

      // Memory classifier shadow mode (Stage 1)
      if (toolName === "store_user_info") {
        const { category, key, value } = args as { category: string; key: string; value: string };
        runClassifierShadow({ domain: "user", category, proposed_key: key, proposed_value: value });
      } else if (toolName === "store_self_info" || toolName === "store_character_info") {
        const { category, key, value } = args as { category: string; key: string; value: string };
        runClassifierShadow({ domain: "character", category, proposed_key: key, proposed_value: value });
      }

      const text = typeof result === "string" ? result : JSON.stringify(result);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;

      runtimeLog.error("Tool execution failed", {
        tool: toolName,
        error: errorMsg,
        durationMs,
      });

      // SSE: emit tool_end failure
      if (context.eventBus) {
        const endEvent: SSEToolEndEvent = {
          type: "tool_end",
          toolName,
          callIndex,
          durationMs,
          success: false,
          resultSummary: errorMsg.slice(0, 200),
          timestamp: Date.now(),
        };
        context.eventBus.emit("sse", endEvent);
      }

      return {
        content: [{ type: "text", text: `TOOL_FAILED: ${errorMsg}` }],
        isError: true,
      };
    }
  };
}

// ============================================================================
// Inline Zod schemas for tools that don't have exported schemas
// ============================================================================

const StoreSelfInfoShape = {
  category: z.enum(["quirk", "relationship", "experience", "preference", "detail", "other"]),
  key: z.string(),
  value: z.string(),
};

const StoreCharacterInfoShape = {
  observation: z.string(),
};

const ResolveOpenLoopShape = {
  topic: z.string(),
  resolution_type: z.enum(["resolved", "dismissed"]),
  reason: z.string().optional(),
};

const CreateLifeStorylineShape = {
  title: z.string(),
  category: z.enum(["work", "personal", "family", "social", "creative"]),
  storylineType: z.enum(["project", "opportunity", "challenge", "relationship", "goal"]),
  initialAnnouncement: z.string(),
  stakes: z.string(),
  userInvolvement: z.enum(["none", "aware", "supportive", "involved", "central"]).optional(),
  emotionalTone: z.string().optional(),
  emotionalIntensity: z.number().optional(),
};

const CreateOpenLoopShape = {
  loopType: z.enum(["pending_event", "emotional_followup", "commitment_check", "curiosity_thread"]),
  topic: z.string(),
  suggestedFollowUp: z.string(),
  timeframe: z.enum(["immediate", "today", "tomorrow", "this_week", "soon", "later"]),
  salience: z.number(),
  eventDateTime: z.string().optional(),
};

const RecallCharacterProfileShape = {
  section: z.enum([
    "background", "interests", "relationships", "challenges",
    "quirks", "goals", "preferences", "anecdotes", "routines", "full",
  ]),
  reason: z.string().optional(),
};

const GoogleTaskActionShape = {
  action: z.enum(["create", "complete", "delete", "list", "reopen"]),
  title: z.string().optional(),
  taskId: z.string().optional(),
  tasklistId: z.string().optional(),
  includeCompleted: z.boolean().optional(),
  max: z.number().optional(),
};

const GoogleCliShape = {
  command: z.string(),
};

const QueryDatabaseShape = {
  query: z.string(),
  reason: z.string(),
};

const CalendarActionShape = {
  action: z.enum(["create", "update", "delete", "list"]),
  summary: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  timeZone: z.string().optional(),
  event_id: z.string().optional(),
  event_ids: z.array(z.string()).optional(),
  delete_all: z.boolean().optional(),
  days: z.number().optional(),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
};

const MakePromiseShape = {
  promiseType: z.enum([
    "send_selfie", "share_update", "follow_up",
    "send_content", "reminder", "send_voice_note",
  ]),
  description: z.string(),
  dueWithin: z.enum(["1h", "today", "tomorrow", "this_week"]).optional(),
};

const ResolveXTweetShape = {
  id: z.string(),
  status: z.enum(["approved", "rejected"]),
  rejection_reason: z.string().optional(),
};

const PostXTweetShape = {
  text: z.string(),
  intent: z.string().optional(),
  include_selfie: z.boolean().optional(),
  selfie_scene: z.string().optional(),
};

const ResolveXMentionShape = {
  id: z.string(),
  status: z.enum(["approve", "reply", "skip"]),
  reply_text: z.string().optional(),
};

const ListActiveTasksShape = {};

const RetrieveDailyNotesShape = {};

const RetrieveLessonsLearnedShape = {};

// ============================================================================
// Tool description map (reused from GeminiMemoryToolDeclarations)
// ============================================================================

const TOOL_DESCRIPTIONS: Record<string, string> = {
  recall_memory: "Search past conversations with the user to find relevant context.",
  recall_user_info: "Retrieve stored facts about the user by category.",
  store_user_info: "Save personal facts about the user (name, job, preferences, family). Never store transient current_* keys.",
  store_self_info: "Save new facts about yourself (Kayley) that emerge in conversation.",
  store_character_info: "Record an observation about Steven's behavioral patterns.",
  recall_character_profile: "Retrieve a section of your own character profile.",
  calendar_action: "Create, update, delete, or list Google Calendar events.",
  google_task_action: "Create, complete, delete, list, or reopen Google Tasks.",
  google_cli: "Run a general gogcli command for Google services (read-only for exploratory queries).",
  email_action: "Handle email actions: archive, reply, dismiss, or send new emails.",
  email_action_manage: "Bulk-dismiss pending email action rows.",
  store_daily_note: "Append a short bullet to today's daily notes.",
  retrieve_daily_notes: "Retrieve all daily notes.",
  store_monthly_note: "Append a detailed note to the current month's notes.",
  retrieve_monthly_notes: "Retrieve monthly notes for a specific month.",
  store_lessons_learned: "Append a lesson learned to today's lessons.",
  retrieve_lessons_learned: "Retrieve all lessons learned.",
  mila_note: "Append a milestone note about Mila.",
  retrieve_mila_notes: "Retrieve Mila milestone notes for a specific month.",
  resolve_idle_question: "Update the status of an idle curiosity question.",
  resolve_idle_browse_note: "Mark an idle browsing note as shared.",
  tool_suggestion: "Create or mark a tool suggestion as shared.",
  make_promise: "Create a trackable promise to the user.",
  resolve_open_loop: "Resolve or dismiss an open conversational loop.",
  create_open_loop: "Create a new open loop for follow-up.",
  create_life_storyline: "Create a new life event storyline.",
  resolve_x_tweet: "Approve or reject a pending tweet draft.",
  post_x_tweet: "Post a new tweet to X/Twitter.",
  resolve_x_mention: "Handle a pending X/Twitter mention.",
  review_pr: "Fetch a GitHub PR's metadata, diff, and CI status for review.",
  submit_pr_review: "Submit a PR review verdict (approved or needs_changes).",
  delegate_to_engineering: "Create an engineering ticket for Opey.",
  get_engineering_ticket_status: "Fetch engineering ticket status.",
  submit_clarification: "Submit Steven's answer to Opey's clarifying questions.",
  kayley_pulse: "Read, check, or restart Kayley system services.",
  query_database: "Run a read-only SQL query against the database.",
  start_background_task: "Run a shell command as a background task.",
  check_task_status: "Check progress of a running background task.",
  cancel_task: "Cancel a running background task.",
  list_active_tasks: "List all active background tasks.",
};

// ============================================================================
// Factory: create MCP server with per-request context
// ============================================================================

/**
 * Creates a fresh MCP server config bound to a specific request context.
 * Called once per agent turn so tool handlers can access eventBus, conversationLogId, etc.
 */
export function createKayleyMcpServer(getContext: () => ToolExecutionContext) {
  const h = (name: MemoryToolName) => createToolHandler(name, getContext);
  const desc = (name: string) => TOOL_DESCRIPTIONS[name] || `Execute ${name}`;

  return createSdkMcpServer({
    name: "kayley",
    version: "1.0.0",
    tools: [
      // Memory tools
      tool("recall_memory", desc("recall_memory"), RecallMemorySchema.shape, h("recall_memory")),
      tool("recall_user_info", desc("recall_user_info"), RecallUserInfoSchema.shape, h("recall_user_info")),
      tool("store_user_info", desc("store_user_info"), StoreUserInfoSchema.shape, h("store_user_info")),
      tool("store_self_info", desc("store_self_info"), StoreSelfInfoShape, h("store_self_info")),
      tool("store_character_info", desc("store_character_info"), StoreCharacterInfoShape, h("store_character_info")),
      tool("recall_character_profile", desc("recall_character_profile"), RecallCharacterProfileShape, h("recall_character_profile")),

      // Calendar & Google tools
      tool("calendar_action", desc("calendar_action"), CalendarActionShape, h("calendar_action")),
      tool("google_task_action", desc("google_task_action"), GoogleTaskActionShape, h("google_task_action")),
      tool("google_cli", desc("google_cli"), GoogleCliShape, h("google_cli")),

      // Email tools
      tool("email_action", desc("email_action"), EmailActionToolSchema.shape, h("email_action")),
      tool("email_action_manage", desc("email_action_manage"), EmailActionManageSchema.shape, h("email_action_manage")),

      // Notes tools
      tool("store_daily_note", desc("store_daily_note"), StoreDailyNoteSchema.shape, h("store_daily_note")),
      tool("retrieve_daily_notes", desc("retrieve_daily_notes"), RetrieveDailyNotesShape, h("retrieve_daily_notes")),
      tool("store_monthly_note", desc("store_monthly_note"), StoreMonthlyNoteSchema.shape, h("store_monthly_note")),
      tool("retrieve_monthly_notes", desc("retrieve_monthly_notes"), RetrieveMonthlyNotesSchema.shape, h("retrieve_monthly_notes")),
      tool("store_lessons_learned", desc("store_lessons_learned"), StoreLessonsLearnedSchema.shape, h("store_lessons_learned")),
      tool("retrieve_lessons_learned", desc("retrieve_lessons_learned"), RetrieveLessonsLearnedShape, h("retrieve_lessons_learned")),
      tool("mila_note", desc("mila_note"), MilaNoteSchema.shape, h("mila_note")),
      tool("retrieve_mila_notes", desc("retrieve_mila_notes"), RetrieveMilaNotesSchema.shape, h("retrieve_mila_notes")),

      // Idle / loop tools
      tool("resolve_idle_question", desc("resolve_idle_question"), ResolveIdleQuestionSchema.shape, h("resolve_idle_question")),
      tool("resolve_idle_browse_note", desc("resolve_idle_browse_note"), ResolveIdleBrowseNoteSchema.shape, h("resolve_idle_browse_note")),
      tool("resolve_open_loop", desc("resolve_open_loop"), ResolveOpenLoopShape, h("resolve_open_loop")),
      tool("create_open_loop", desc("create_open_loop"), CreateOpenLoopShape, h("create_open_loop")),
      tool("create_life_storyline", desc("create_life_storyline"), CreateLifeStorylineShape, h("create_life_storyline")),

      // Promise & suggestion tools
      tool("make_promise", desc("make_promise"), MakePromiseShape, h("make_promise")),
      tool("tool_suggestion", desc("tool_suggestion"), ToolSuggestionSchema.shape, h("tool_suggestion")),

      // X/Twitter tools
      tool("resolve_x_tweet", desc("resolve_x_tweet"), ResolveXTweetShape, h("resolve_x_tweet")),
      tool("post_x_tweet", desc("post_x_tweet"), PostXTweetShape, h("post_x_tweet")),
      tool("resolve_x_mention", desc("resolve_x_mention"), ResolveXMentionShape, h("resolve_x_mention")),

      // Engineering tools
      tool("review_pr", desc("review_pr"), ReviewPrSchema.shape, h("review_pr")),
      tool("submit_pr_review", desc("submit_pr_review"), SubmitPrReviewSchema.shape, h("submit_pr_review")),
      tool("delegate_to_engineering", desc("delegate_to_engineering"), DelegateToEngineeringSchema.shape, h("delegate_to_engineering")),
      tool("get_engineering_ticket_status", desc("get_engineering_ticket_status"), EngineeringTicketStatusSchema.shape, h("get_engineering_ticket_status")),
      tool("submit_clarification", desc("submit_clarification"), SubmitClarificationSchema.shape, h("submit_clarification")),

      // System tools
      tool("kayley_pulse", desc("kayley_pulse"), KayleyPulseSchema.shape, h("kayley_pulse")),
      tool("query_database", desc("query_database"), QueryDatabaseShape, h("query_database")),

      // Background task tools
      tool("start_background_task", desc("start_background_task"), StartBackgroundTaskSchema.shape, h("start_background_task")),
      tool("check_task_status", desc("check_task_status"), CheckTaskStatusSchema.shape, h("check_task_status")),
      tool("cancel_task", desc("cancel_task"), CancelTaskSchema.shape, h("cancel_task")),
      tool("list_active_tasks", desc("list_active_tasks"), ListActiveTasksShape, h("list_active_tasks")),
    ],
  });
}
