import type { EngineeringAgentTurn, EngineeringTicket } from "./types";
import type { RuntimeBounds } from "./runtimeBounds";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[MultiAgentEscalation]";
const runtimeLog = log.fromContext({ source: "escalationPolicy" });

// EscalationPolicy is a convenience snapshot of limits (mostly mirrored in runtime bounds).
export interface EscalationPolicy {
  maxReviewCycles: number;
  maxImplementationAttempts: number;
  maxAgentTurnsPerCycle: number;
  maxRuntimeMinutesPerTicket: number;
  maxCommandsPerTicket: number;
}

export interface EscalationAssessment {
  shouldEscalate: boolean;
  
  reason?: string;
}

// Default policy values (used when no overrides exist).
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  maxReviewCycles: 2,
  maxImplementationAttempts: 2,
  maxAgentTurnsPerCycle: 8,
  maxRuntimeMinutesPerTicket: 10,
  maxCommandsPerTicket: 20,
};

// Check escalation conditions using ticket-level fields (cycles/dev attempts).
export function assessEscalationFromTicket(
  ticket: EngineeringTicket,
): EscalationAssessment {
  if (ticket.currentCycle >= ticket.maxCycles) {
    return {
      shouldEscalate: true,
      reason: `Cycle limit reached (${ticket.currentCycle}/${ticket.maxCycles}).`,
    };
  }

  if (ticket.maxDevAttempts <= 0) {
    return {
      shouldEscalate: true,
      reason: "Max dev attempts is invalid (<= 0).",
    };
  }

  return {
    shouldEscalate: false,
  };
}

// Check escalation conditions using turn history + runtime bounds.
export function assessEscalationFromTurns(
  ticket: EngineeringTicket,
  turns: EngineeringAgentTurn[],
  bounds: RuntimeBounds,
): EscalationAssessment {
  const cycleTurns = turns.filter(
    (turn) => turn.cycleNumber === ticket.currentCycle,
  );
  if (cycleTurns.length > bounds.maxAgentTurnsPerCycle) {
    return {
      shouldEscalate: true,
      reason: `Max agent turns exceeded (${cycleTurns.length}/${bounds.maxAgentTurnsPerCycle}).`,
    };
  }

  const devAttempts = cycleTurns.filter(
    (turn) =>
      turn.agentRole === "opey" &&
      (turn.purpose === "implementation" || turn.purpose === "rework"),
  ).length;
  if (devAttempts >= ticket.maxDevAttempts) {
    return {
      shouldEscalate: true,
      reason: `Max dev attempts exceeded (${devAttempts}/${ticket.maxDevAttempts}).`,
    };
  }

  const recentClaudyTurns = cycleTurns
    .filter((turn) => turn.agentRole === "claudy")
    .slice(-bounds.maxDebateTurns);

  if (recentClaudyTurns.length >= bounds.maxDebateTurns) {
    return {
      shouldEscalate: true,
      reason: `Max debate turns exceeded (${recentClaudyTurns.length}/${bounds.maxDebateTurns}).`,
    };
  }

  if (recentClaudyTurns.length >= 2) {
    const last = recentClaudyTurns[recentClaudyTurns.length - 1];
    const prior = recentClaudyTurns[recentClaudyTurns.length - 2];
    if (
      last.verdict === "changes_requested" &&
      prior.verdict === "changes_requested" &&
      last.responseExcerpt.trim() &&
      last.responseExcerpt === prior.responseExcerpt
    ) {
      return {
        shouldEscalate: true,
        reason: "Repeated QA feedback detected.",
      };
    }
  }

  return {
    shouldEscalate: false,
  };
}

// Structured log helper for escalation events.
export function logEscalation(ticketId: string, reason: string): void {
  runtimeLog.warning(`${LOG_PREFIX} ticket=${ticketId} reason=${reason}`, {
    ticketId,
    reason,
  });
}
