// server/services/commandSafety.ts
//
// Shared command safety checks for workspace_action and background tasks.
// Extracted to avoid circular imports between workspaceAgentRoutes and backgroundTaskManager.

/** Commands that are completely blocked — never allowed. */
export const BLOCKED_COMMANDS = new Set([
  "format", "mkfs", "dd",
  "shutdown", "reboot", "halt", "poweroff",
  "passwd", "useradd", "userdel",
  "env", "printenv",
]);

/** Commands that require explicit user approval before execution. */
export const APPROVAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[^\s]*\s+)*-r/i, reason: "Recursive deletion" },
  { pattern: /\brm\s+(-[^\s]*\s+)*-f/i, reason: "Forced deletion" },
  { pattern: /\bgit\s+push\s+.*--force/i, reason: "Force push" },
  { pattern: /\bgit\s+reset\s+--hard/i, reason: "Hard reset (discards changes)" },
  { pattern: /\bgit\s+clean\s+-[^\s]*f/i, reason: "Git clean (deletes untracked files)" },
  { pattern: /\bgit\s+checkout\s+--\s+\./i, reason: "Discard all working changes" },
  { pattern: /\btaskkill\b/i, reason: "Kill a process" },
  { pattern: /\bkill\s+-9\b/i, reason: "Force kill a process" },
  { pattern: /\bnpm\s+publish\b/i, reason: "Publish to npm registry" },
];
