// src/services/system_prompts/context/promisesContext.ts
/**
 * Promises Context Builder
 *
 * Builds the pending promises section for the system prompt.
 * Shows Kayley what commitments she's made and when she should fulfill them.
 */

import { getPendingPromises, type KayleyPromise } from "../../promiseService";

/**
 * Format a single promise for the system prompt in a compact format.
 */
function formatPromise(promise: KayleyPromise): string {
  const now = new Date();
  const timing = new Date(promise.estimatedTiming);
  const diffMs = timing.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  let timeDesc: string;
  if (diffMins < 0) {
    timeDesc = "NOW (time has passed)";
  } else if (diffMins < 5) {
    timeDesc = `in ${diffMins}min`;
  } else if (diffMins < 60) {
    timeDesc = `~${Math.round(diffMins / 5) * 5}min`;
  } else {
    const hours = Math.floor(diffMins / 60);
    timeDesc = `~${hours}hr`;
  }

  return `• [${promise.id}] ${promise.promiseType}: "${promise.description}" (${promise.triggerEvent}) - ${timeDesc}`;
}

/**
 * Build the pending promises section for the system prompt.
 * Returns empty string if no pending promises.
 */
export async function buildPromisesContext(): Promise<string> {
  const pendingPromises = await getPendingPromises();

  if (pendingPromises.length === 0) {
    return "";
  }

  const promisesList = pendingPromises.map(formatPromise).join("\n");

  return `
====================================================
PENDING PROMISES
====================================================
You've made these commitments to fulfill later. When the time is right,
fulfill them by mentioning them naturally in your response and setting
"fulfilling_promise_id" in the JSON to the promise ID.

${promisesList}

WHEN TO FULFILL:
- When the trigger event happens or enough time has passed
- When it feels natural in conversation
- Proactively if the user isn't around (idle breaker style)

HOW TO FULFILL:
1. Mention the promise naturally in your text_response
   Example: "Hey! Just got back from my walk. Here's that selfie I promised! 📸"
2. Set "fulfilling_promise_id": "[promise_id]" in the JSON
3. If it's a selfie promise, also set the selfie_action with the scene/mood

IMPORTANT:
- Only fulfill ONE promise at a time
- Don't fulfill if the timing doesn't feel right yet
- Be natural - don't say "fulfilling promise XYZ", just do it conversationally
`;
}
