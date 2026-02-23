import { TICKET_STATUSES, type EngineeringTicketStatus } from "./types";

// TRANSITIONS defines the allowed next statuses for each status.
// If a transition isn't listed here, it is not allowed.
const TRANSITIONS: Record<EngineeringTicketStatus, EngineeringTicketStatus[]> = {
  created: ["intake_acknowledged", "needs_clarification", "cancelled"],
  intake_acknowledged: ["needs_clarification", "requirements_ready", "cancelled"],
  needs_clarification: ["requirements_ready", "cancelled", "failed"],
  requirements_ready: ["planning", "implementing", "cancelled"],
  planning: ["implementing", "cancelled", "failed"],
  implementing: ["ready_for_qa", "failed", "escalated_human"],
  ready_for_qa: ["qa_testing", "failed", "escalated_human"],
  qa_testing: ["qa_changes_requested", "qa_approved", "failed", "escalated_human"],
  qa_changes_requested: ["implementing", "failed", "escalated_human"],
  qa_approved: ["pr_preparing", "failed", "escalated_human"],
  pr_preparing: ["pr_ready", "failed", "escalated_human"],
  pr_ready: ["completed", "escalated_human"],
  completed: [],
  failed: [],
  escalated_human: ["implementing", "planning", "cancelled"],
  cancelled: [],
};

// Returns all allowed next statuses for a given current status.
export function getAllowedTransitions(
  status: EngineeringTicketStatus,
): EngineeringTicketStatus[] {
  return TRANSITIONS[status] ?? [];
}

// True if the transition is allowed by the state machine.
export function isAllowedTransition(
  fromStatus: EngineeringTicketStatus,
  toStatus: EngineeringTicketStatus,
): boolean {
  return getAllowedTransitions(fromStatus).includes(toStatus);
}

// Ensures a status string is one of the supported status enum values.
export function assertValidStatus(status: string): EngineeringTicketStatus {
  if (!TICKET_STATUSES.includes(status as EngineeringTicketStatus)) {
    throw new Error(`[MultiAgentStatusMachine] Invalid ticket status: ${status}`);
  }

  return status as EngineeringTicketStatus;
}
