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
  recall_memory: 'Searching memories',
  recall_user_info: 'Looking up your info',
  store_user_info: 'Saving info about you',
  store_self_info: 'Saving a personal note',
  store_character_info: 'Noting a pattern',
  gmail_search: 'Searching emails',
  email_action: 'Handling email',
  calendar_action: 'Checking calendar',
  task_action: 'Managing tasks',
  query_database: 'Querying database',
  read_agent_file: 'Reading file',
  write_agent_file: 'Writing file',
  google_cli: 'Using Google services',
  workspace_action: 'Working with files',
  web_search: 'Searching the web',
  web_fetch: 'Reading web page',
  start_background_task: 'Starting background task',
  check_task_status: 'Checking task progress',
  cancel_task: 'Cancelling task',
  list_active_tasks: 'Listing active tasks',
  kayley_pulse: 'Checking Kayley pulse',
  review_pr: 'Reviewing Opey PR',
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
