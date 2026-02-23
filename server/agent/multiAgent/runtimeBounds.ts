export interface RuntimeBounds {
  // Maximum number of tickets that can be actively processed at once.
  maxActiveTickets: number;
  // How many implementation passes Opey can attempt before stopping.
  maxImplementationPasses: number;
  // How many QA cycles (Claudy reviews) are allowed.
  maxQaCycles: number;
  // Total agent turns allowed per cycle (Kera/Opey/Claudy combined).
  maxAgentTurnsPerCycle: number;
  // Maximum back-and-forth debate turns between agents in one cycle.
  maxDebateTurns: number;
  // Maximum total runtime (minutes) allowed for a single ticket.
  maxRuntimeMinutesPerTicket: number;
  // Maximum CLI commands allowed for a single ticket.
  maxCommandsPerTicket: number;
  // Maximum number of test runs per implementation pass.
  maxTestRunsPerPass: number;
  // How many times we attempt to create a PR before giving up.
  maxPrCreateAttempts: number;
  // Safety cap on CLI stdout size per turn (kilobytes).
  maxCliStdoutKbPerTurn: number;
  // Safety cap on CLI stderr size per turn (kilobytes).
  maxCliStderrKbPerTurn: number;
  // How many times we retry invalid JSON output in a single turn.
  maxInvalidJsonRetriesPerTurn: number;
}

// GATES!!!!!!!!!!!!!!!!
export const DEFAULT_RUNTIME_BOUNDS: RuntimeBounds = {
  // Only allow one active ticket at a time.
  maxActiveTickets: 1,
  // Opey gets two implementation passes before escalation.
  maxImplementationPasses: 2,
  // Claudy can review twice before escalation.
  maxQaCycles: 2,
  // Limit total agent turns per cycle to avoid endless loops.
  maxAgentTurnsPerCycle: 8,
  // Limit debate turns to avoid back-and-forth overload.
  maxDebateTurns: 4,
  // Cap total ticket runtime in minutes (prevents runaway costs).
  maxRuntimeMinutesPerTicket: 5,
  // Cap total CLI commands per ticket (limits how much can run).
  maxCommandsPerTicket: 15,
  // Limit how many test runs happen per implementation pass.
  maxTestRunsPerPass: 2,
  // Limit PR creation retries.
  maxPrCreateAttempts: 2,
  // Limit raw CLI output size to prevent huge logs.
  maxCliStdoutKbPerTurn: 512,
  // Limit error output size to prevent huge logs.
  maxCliStderrKbPerTurn: 256,
  // Only retry invalid JSON once per turn.
  maxInvalidJsonRetriesPerTurn: 1,
};
