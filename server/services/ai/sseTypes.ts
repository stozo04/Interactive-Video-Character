// server/services/ai/sseTypes.ts
//
// SSE event type definitions for the /agent/message/stream endpoint.
// Used by turnEventBus (server) and agentClient (browser).

// ============================================================================
// Event Types
// ============================================================================

export type SSEEventType =
  | 'turn_start'
  | 'tool_start'
  | 'tool_end'
  | 'action_start'
  | 'action_end'
  | 'turn_complete'
  | 'turn_error';

// ============================================================================
// Event Payloads
// ============================================================================

export interface SSETurnStartEvent {
  type: 'turn_start';
  timestamp: number;
}

export interface SSEToolStartEvent {
  type: 'tool_start';
  toolName: string;
  toolDisplayName: string;
  toolArgs: Record<string, unknown>;
  callIndex: number;
  timestamp: number;
}

export interface SSEToolEndEvent {
  type: 'tool_end';
  toolName: string;
  callIndex: number;
  durationMs: number;
  success: boolean;
  resultSummary: string;
  timestamp: number;
}

export interface SSEActionStartEvent {
  type: 'action_start';
  actionName: string;
  actionDisplayName: string;
  timestamp: number;
}

export interface SSEActionEndEvent {
  type: 'action_end';
  actionName: string;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface SSETurnCompleteEvent {
  type: 'turn_complete';
  result: unknown; // OrchestratorResult — serialized
  timestamp: number;
}

export interface SSETurnErrorEvent {
  type: 'turn_error';
  error: string;
  timestamp: number;
}

export type SSEEvent =
  | SSETurnStartEvent
  | SSEToolStartEvent
  | SSEToolEndEvent
  | SSEActionStartEvent
  | SSEActionEndEvent
  | SSETurnCompleteEvent
  | SSETurnErrorEvent;

// ============================================================================
// Tool Display Name Map
// ============================================================================

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Kayley MCP domain tools
  recall_memory: 'Searching memories',
  recall_user_info: 'Looking up your info',
  store_user_info: 'Saving info about you',
  store_self_info: 'Saving a personal note',
  store_character_info: 'Noting a pattern',
  recall_character_profile: 'Recalling character profile',
  email_action: 'Handling email',
  email_action_manage: 'Managing email',
  calendar_action: 'Checking calendar',
  google_task_action: 'Managing tasks',
  query_database: 'Querying database',
  google_cli: 'Using Google services',
  store_daily_note: 'Writing daily note',
  retrieve_daily_notes: 'Reading daily notes',
  store_monthly_note: 'Writing monthly note',
  retrieve_monthly_notes: 'Reading monthly notes',
  store_lessons_learned: 'Saving lesson learned',
  retrieve_lessons_learned: 'Reading lessons learned',
  mila_note: 'Writing Mila note',
  retrieve_mila_notes: 'Reading Mila notes',
  resolve_idle_question: 'Resolving idle question',
  resolve_idle_browse_note: 'Browsing notes',
  resolve_open_loop: 'Resolving open loop',
  create_open_loop: 'Creating open loop',
  create_life_storyline: 'Creating life storyline',
  make_promise: 'Making a promise',
  tool_suggestion: 'Suggesting a tool',
  resolve_x_tweet: 'Resolving tweet draft',
  post_x_tweet: 'Posting tweet',
  resolve_x_mention: 'Resolving X mention',
  review_pr: 'Reviewing Opey PR',
  submit_pr_review: 'Submitting PR review verdict',
  delegate_to_engineering: 'Delegating to engineering',
  get_engineering_ticket_status: 'Checking ticket status',
  submit_clarification: 'Submitting clarification',
  kayley_pulse: 'Checking Kayley pulse',
  start_background_task: 'Starting background task',
  check_task_status: 'Checking task progress',
  cancel_task: 'Cancelling task',
  list_active_tasks: 'Listing active tasks',
  // Built-in Claude Code tools
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Glob: 'Searching files',
  Grep: 'Searching code',
  WebSearch: 'Searching the web',
  WebFetch: 'Fetching web page',
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || `Running ${toolName}`;
}

// ============================================================================
// Helpers
// ============================================================================

/** Truncate a result string for SSE summaries (shown in expanded ToolCallBox). */
export function truncateResultSummary(result: unknown, maxLen = 3000): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... (${str.length - maxLen} more chars)`;
}

/** Sanitize tool args for SSE (strip large values like base64). */
export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.slice(0, 100) + `... (${value.length} chars)`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
