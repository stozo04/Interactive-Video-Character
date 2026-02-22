// src/services/system_prompts/context/promisesContext.ts

import { getPendingPromises, type KayleyPromise } from "../../promiseService";

function hasExplicitTimeReference(text: string): boolean {
  const lower = text.toLowerCase();
  const isoLike = /\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(text);
  const amPm = /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(text);
  return (
    isoLike ||
    amPm ||
    lower.includes("today") ||
    lower.includes("tomorrow")
  );
}

/**
 * Format a single promise with clear behavioral signals (READY vs WAIT).
 */
function formatPromise(promise: KayleyPromise): string {
  const now = new Date();
  const timing = new Date(promise.estimatedTiming);
  const diffMs = timing.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  let timeDesc: string;
  if (diffMins < 0) {
    timeDesc = "READY (Time has passed)";
  } else if (diffMins < 5) {
    timeDesc = `WAIT (${diffMins}m remaining)`;
  } else if (diffMins < 60) {
    timeDesc = `WAIT (~${Math.round(diffMins / 5) * 5}m remaining)`;
  } else {
    const hours = Math.floor(diffMins / 60);
    timeDesc = `WAIT (~${hours}h remaining)`;
  }

  // clear, scan-able format
  return `• [ID:${promise.id}] ${promise.promiseType}: "${promise.description}" (Trigger: ${promise.triggerEvent}) — Status: ${timeDesc}`;
}

/**
 * Build the pending promises section for the system prompt.
 */
export async function buildPromisesContext(): Promise<string> {
  const pendingPromises = await getPendingPromises();
  // Explicit-time commitments are owned by cron mirror jobs and should not
  // remain in conversational "open commitments" once scheduling is active.
  const conversationalPromises = pendingPromises.filter(
    (promise) => !hasExplicitTimeReference(promise.triggerEvent),
  );

  if (conversationalPromises.length === 0) {
    return "";
  }

  const promisesList = conversationalPromises.map(formatPromise).join("\n");

  return `
====================================================OPEN COMMITMENTS====================================================
Tone: Reliable but organic.
Direction: You have pending commitments. Check the "Status" below. If a promise is marked "READY" (or the conversation context is perfect), fulfill ONE commitment naturally.

Pending List:
${promisesList}

Fulfillment Constraints:
- Natural Integration: Do not announce "I am fulfilling a promise." Just do it (e.g., "Oh, I found that photo!" or "Checking on that date...").
- Technical Signal: You MUST set the "fulfilling_promise_id" in your JSON output to mark it as complete.
- Pacing: Clear only one commitment per turn to avoid overwhelming the user.
`.trim();
}
