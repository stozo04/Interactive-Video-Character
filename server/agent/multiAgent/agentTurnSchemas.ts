// AgentTurnPurpose describes why a turn is being requested.
// This helps the LLM or CLI runner shape its response.
export type AgentTurnPurpose =
  | "intake"
  | "planning"
  | "implementation"
  | "review"
  | "rework"
  | "status_update";

// AgentTurnVerdict is used mostly by QA (Claudy) to summarize review outcomes.
export type AgentTurnVerdict =
  | "approved"
  | "changes_requested"
  | "blocked"
  | "needs_human";

// AgentRequestedAction is a single action the agent wants executed by the workspace agent.
export interface AgentRequestedAction {
  action: string;
  args: Record<string, unknown>;
}

// AgentTurnEnvelope is the strict JSON format we expect from any agent CLI response.
// The runner will reject any output that does not match this shape.
export interface AgentTurnEnvelope {
  summary: string;
  nextStateHint?: string;
  requestedActions: AgentRequestedAction[];
  needsHuman?: boolean;
  verdict?: AgentTurnVerdict;
}

// Result of validating a turn response (ok=false means parsing/validation failed).
export interface AgentTurnValidationResult {
  ok: boolean;
  errors: string[];
  parsed?: AgentTurnEnvelope;
}

// Parse JSON first, then validate shape.
export function parseAgentTurnEnvelope(
  raw: string,
): AgentTurnValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error ? error.message : "Invalid JSON response.",
      ],
    };
  }

  return validateAgentTurnEnvelope(parsed);
}

// Validate the parsed object matches AgentTurnEnvelope requirements.
export function validateAgentTurnEnvelope(
  value: unknown,
): AgentTurnValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, errors: ["Envelope must be a JSON object."] };
  }

  const summary = value.summary;
  const requestedActions = value.requestedActions;
  const nextStateHint = value.nextStateHint;
  const needsHuman = value.needsHuman;
  const verdict = value.verdict;

  const errors: string[] = [];
  if (typeof summary !== "string" || !summary.trim()) {
    errors.push("summary is required.");
  }

  if (!Array.isArray(requestedActions)) {
    errors.push("requestedActions must be an array.");
  }

  if (typeof nextStateHint !== "undefined" && typeof nextStateHint !== "string") {
    errors.push("nextStateHint must be a string when provided.");
  }

  if (typeof needsHuman !== "undefined" && typeof needsHuman !== "boolean") {
    errors.push("needsHuman must be a boolean when provided.");
  }

  if (
    typeof verdict !== "undefined" &&
    !["approved", "changes_requested", "blocked", "needs_human"].includes(verdict as string)
  ) {
    errors.push("verdict must be a supported value when provided.");
  }

  // Normalize each action so missing or invalid fields don't crash the system.
  const normalizedActions: AgentRequestedAction[] = Array.isArray(requestedActions)
    ? requestedActions
        .map((action) =>
          isPlainObject(action)
            ? {
                action:
                  typeof action.action === "string" ? action.action : "unknown",
                args: isPlainObject(action.args) ? action.args : {},
              }
            : null,
        )
        .filter((action): action is AgentRequestedAction => Boolean(action))
    : [];

  if (Array.isArray(requestedActions) && normalizedActions.length !== requestedActions.length) {
    errors.push("requestedActions entries must be objects with action/args.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    parsed: {
      summary: summary.trim(),
      requestedActions: normalizedActions,
      nextStateHint: typeof nextStateHint === "string" ? nextStateHint : undefined,
      needsHuman,
      verdict: verdict as AgentTurnVerdict | undefined,
    },
  };
}

// ExecutionTurnResult represents the output of an execution-mode turn
// where the LLM worked directly (no JSON envelope).
export interface ExecutionTurnResult {
  summary: string;
  verdict?: AgentTurnVerdict;
  raw: {
    stdout: string;
    stderr: string;
  };
}

// Extract a verdict from Claudy's natural-language output.
// Looks for explicit "VERDICT: approved" / "VERDICT: changes_requested" markers,
// then falls back to heuristic keyword matching.
export function parseVerdictFromText(text: string): AgentTurnVerdict | undefined {
  const normalized = text.toLowerCase();

  // Explicit marker: "VERDICT: <value>" (case-insensitive)
  const markerMatch = normalized.match(/verdict\s*:\s*(approved|changes_requested|blocked|needs_human)/);
  if (markerMatch) {
    return markerMatch[1] as AgentTurnVerdict;
  }

  // Fallback heuristics — only match clear signals
  if (/\bapproved?\b/.test(normalized) && !/\bnot\s+approved?\b/.test(normalized)) {
    // Check for conflicting signals
    if (/\bchanges?\s+requested\b/.test(normalized) || /\bblocked\b/.test(normalized)) {
      return undefined; // ambiguous
    }
    return "approved";
  }
  if (/\bchanges?\s+requested\b/.test(normalized)) {
    return "changes_requested";
  }
  if (/\bblocked\b/.test(normalized)) {
    return "blocked";
  }
  if (/\bneeds?\s+human\b/.test(normalized)) {
    return "needs_human";
  }

  return undefined;
}

// Small helper to ensure we are dealing with plain JSON objects.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
