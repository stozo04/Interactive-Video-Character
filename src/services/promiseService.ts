/**
 * Promise Service
 *
 * Tracks and fulfills Kayley's future commitments to make time feel real.
 *
 * Problem: Kayley instantly fulfills future commitments instead of waiting
 * Example: Says "I'm going on a walk later" → instantly sends selfie ❌
 * Solution: Track promises and fulfill them proactively when time comes ✅
 *
 * Current Design (Phase 1):
 * - Fixed 10-minute timing for all promises
 * - LLM-only detection (no regex/guessing)
 * - Offline handling (delivers when user returns)
 * - Extensible architecture for future mood/context-based timing
 *
 * Usage:
 *   1. LLM calls `make_promise` tool when Kayley commits to something later
 *   2. Promise is created with 10-minute timing
 *   3. Background job checks every 5 minutes for ready promises
 *   4. When ready, creates pending message for delivery
 *   5. If user is offline, delivers when they return
 */

import { supabase } from './supabaseClient';


// ============================================================================
// Types
// ============================================================================

export type PromiseType =
  | "send_selfie"
  | "share_update"
  | "send_content"
  | "follow_up"
  | "reminder"
  | "send_voice_note";

export type PromiseStatus = "pending" | "fulfilled" | "missed" | "cancelled";

export interface KayleyPromise {
  id: string;
  promiseType: PromiseType;
  description: string;
  triggerEvent: string;
  estimatedTiming: Date;
  commitmentContext: string;
  fulfillmentData?: {
    selfieParams?: {
      scene: string;
      mood: string;
      location?: string;
    };
    messageText?: string;
    contentToShare?: string;
  };
  status: PromiseStatus;
  createdAt: Date;
  fulfilledAt?: Date;
}

// ============================================================================
// Constants
// ============================================================================

const PROMISES_TABLE = "promises";
const CRON_JOBS_TABLE = "cron_jobs";
const DEFAULT_PROMISE_DELAY_MINUTES = 10;
const PROMISE_CRON_QUERY_PREFIX = "promise_reminder:";
const PROMISE_CRON_CREATED_BY = "promise_migration";
let hasAttemptedPromiseCronMigration = false;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a promise for something Kayley committed to do later.
 *
 * Phase 1: All promises use fixed timing (10 minutes)
 * Future: Dynamic timing based on mood, context, events
 *
 * @param promiseType - Type of promise (send_selfie, share_update, etc.)
 * @param description - What she promised (human-readable)
 * @param triggerEvent - When it should happen ("when I go on my walk")
 * @param estimatedTiming - When to fulfill (Date object)
 * @param commitmentContext - User's original request
 * @param fulfillmentData - Data needed to fulfill the promise
 * @returns The created promise, or null on error
 */
export async function createPromise(
  promiseType: PromiseType,
  description: string,
  triggerEvent: string,
  estimatedTiming: Date,
  commitmentContext: string,
  fulfillmentData?: KayleyPromise["fulfillmentData"]
): Promise<KayleyPromise | null> {
  console.log('promiseService: createPromise')
  try {
    const promise: Partial<KayleyPromise> = {
      id: crypto.randomUUID(),
      promiseType,
      description,
      triggerEvent,
      estimatedTiming,
      commitmentContext,
      fulfillmentData: fulfillmentData || {},
      status: "pending",
      createdAt: new Date(),
    };

    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .insert({
        id: promise.id,
        promise_type: promise.promiseType,
        description: promise.description,
        trigger_event: promise.triggerEvent,
        estimated_timing: promise.estimatedTiming!.toISOString(),
        commitment_context: promise.commitmentContext,
        fulfillment_data: promise.fulfillmentData || {},
        status: promise.status,
        created_at: promise.createdAt!.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[Promises] Error creating promise:", error);
      return null;
    }

    console.log(
      `[Promises] Created: ${promiseType} - "${description}" at ${estimatedTiming.toLocaleTimeString()}`
    );

    const createdPromise = mapRowToPromise(data);

    const parsedTiming = parseExplicitTriggerTiming(triggerEvent);
    if (parsedTiming.isExplicit) {
      await ensureCronMirrorForPromise(createdPromise);
    }

    return createdPromise;
  } catch (error) {
    console.error("[Promises] Error in createPromise:", error);
    return null;
  }
}

export function resolvePromiseTimingFromTrigger(triggerEvent: string): {
  estimatedTiming: Date;
  isExplicit: boolean;
} {
  const parsed = parseExplicitTriggerTiming(triggerEvent);
  if (parsed.isExplicit) {
    return {
      estimatedTiming: parsed.timing,
      isExplicit: true,
    };
  }

  return {
    estimatedTiming: new Date(Date.now() + DEFAULT_PROMISE_DELAY_MINUTES * 60 * 1000),
    isExplicit: false,
  };
}

/**
 * Get pending promises that are ready to be fulfilled (time has arrived).
 * This is called by the background job to find promises ready for delivery.
 *
 * @returns Array of ready promises, sorted by timing (earliest first)
 */
export async function getReadyPromises(): Promise<KayleyPromise[]> {
  try {
    const now = new Date().toISOString();
    // console.log('promiseService: getReadyPromises')
    // console.log("getReadyPromises now:", now);
    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .select("*")
      .eq("status", "pending")
      .lte("estimated_timing", now)
      .order("estimated_timing", { ascending: true });
    console.log("all pending:", data);
    if (error) {
      console.error("[Promises] Error fetching ready promises:", error);
      return [];
    }

    return (data || []).map(mapRowToPromise);
  } catch (error) {
    console.error("[Promises] Error in getReadyPromises:", error);
    return [];
  }
}

/**
 * Get all pending promises (for debugging or display).
 *
 * @returns Array of pending promises, sorted by timing
 */
export async function getPendingPromises(): Promise<KayleyPromise[]> {
  try {
    console.log("promiseService: getPendingPromises");
    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .select("*")
      .eq("status", "pending")
      .order("estimated_timing", { ascending: true });

    if (error) {
      console.error("[Promises] Error fetching pending promises:", error);
      return [];
    }

    const promises = (data || []).map(mapRowToPromise);

    if (!hasAttemptedPromiseCronMigration) {
      hasAttemptedPromiseCronMigration = true;
      void migrateTimedPromisesToCronJobs(promises).catch((error) => {
        console.warn("[Promises] Timed promise migration to cron failed:", error);
      });
    }

    return promises;
  } catch (error) {
    console.error("[Promises] Error in getPendingPromises:", error);
    return [];
  }
}

export async function migrateTimedPromisesToCronJobs(
  pendingPromises?: KayleyPromise[],
): Promise<number> {
  const promisesToCheck =
    pendingPromises ||
    (await getPendingPromises());

  let migratedCount = 0;
  for (const promise of promisesToCheck) {
    const parsed = parseExplicitTriggerTiming(promise.triggerEvent);
    if (!parsed.isExplicit) {
      continue;
    }

    const created = await ensureCronMirrorForPromise(promise);
    if (created) {
      migratedCount += 1;
    }
  }

  if (migratedCount > 0) {
    console.log(`[Promises] Migrated ${migratedCount} timed promise(s) into one-time cron jobs.`);
  }

  return migratedCount;
}

/**
 * Fulfill a promise - deliver what was promised.
 *
 * This:
 * 1. Fetches the promise from DB
 * 2. Creates a pending message with the fulfillment data
 * 3. Marks the promise as fulfilled
 *
 * @param promiseId - ID of the promise to fulfill
 * @returns True if successful, false otherwise
 */
export async function fulfillPromise(promiseId: string): Promise<boolean> {
  try {
    console.log("promiseService: fulfillPromise");
    const fulfilledAt = new Date().toISOString();

    const { data: promiseData, error: updateError } = await supabase
      .from(PROMISES_TABLE)
      .update({
        status: "fulfilled",
        fulfilled_at: fulfilledAt,
      })
      .eq("id", promiseId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (updateError) {
      console.error("[Promises] Error marking promise fulfilled:", updateError);
      return false;
    }

    if (!promiseData) {
      console.warn(
        "[Promises] Promise already fulfilled or missing:",
        promiseId,
      );
      return false;
    }

    const promise = mapRowToPromise(promiseData);


    // Create the pending message based on promise type
    let messageText = "";
    let messageType: "text" | "photo" = "text";
    let metadata: any = {};

    switch (promise.promiseType) {
      case "send_selfie":
        messageText =
          promise.fulfillmentData?.messageText ||
          "Okay heading out now! Here's your selfie 📸";
        messageType = "photo";
        metadata = {
          promiseId: promise.id,
          selfieParams: promise.fulfillmentData?.selfieParams || {
            scene: "casual outdoor selfie",
            mood: "happy smile",
          },
        };
        break;

      case "share_update":
        messageText =
          promise.fulfillmentData?.messageText ||
          `Update on ${promise.triggerEvent}: ${promise.description}`;
        break;

      case "follow_up":
        messageText =
          promise.fulfillmentData?.messageText ||
          `Hey! Checking in like I said I would 💕`;
        break;

      case "send_content":
        messageText =
          promise.fulfillmentData?.messageText ||
          `Here's that ${promise.description}`;
        metadata = {
          promiseId: promise.id,
          contentToShare: promise.fulfillmentData?.contentToShare,
        };
        break;

      default:
        messageText = promise.description;
    }

    console.log(`[Promises] ✅ Fulfilled: ${promise.description}`);
    return true;
  } catch (error) {
    console.error("[Promises] Error in fulfillPromise:", error);
    return false;
  }
}

/**
 * Check for ready promises and fulfill them.
 * This should be called periodically (e.g., every 5 minutes in background).
 *
 * @returns Number of promises fulfilled
 */
export async function checkAndFulfillPromises(): Promise<number> {
  // console.log('promiseService: checkAndFulfillPromises')
  const readyPromises = await getReadyPromises();

  if (readyPromises.length === 0) {
    return 0;
  }

  console.log(
    `[Promises] Found ${readyPromises.length} ready promise(s) to fulfill`,
  );

  let fulfilledCount = 0;

  // BUG: We do not fullfill promise untill it is either:
  // LLM choose to fullfill
  // Expires at LLM chose it was not important
  // What we need to do here instead is fullfill (clean up)
  // expired promises that never surfaced
  // for (const promise of readyPromises) {
  //   const success = await fulfillPromise(promise.id);
  //   if (success) fulfilledCount++;
  // }

  return fulfilledCount;
}

/**
 * Mark a promise as fulfilled without creating a pending message.
 * Used when the LLM fulfills a promise directly in its response.
 *
 * @param promiseId - ID of the promise to mark as fulfilled
 * @param fulfillmentData - Data about how the promise was fulfilled (message text, selfie params, etc.)
 * @returns True if successful, false otherwise
 */
export async function markPromiseAsFulfilled(
  promiseId: string,
  fulfillmentData?: KayleyPromise["fulfillmentData"]
): Promise<boolean> {
  try {
    console.log('promiseService: markPromiseAsFulfilled', promiseId);
    const fulfilledAt = new Date().toISOString();

    const updateData: any = {
      status: "fulfilled",
      fulfilled_at: fulfilledAt,
    };

    if (fulfillmentData) {
      updateData.fulfillment_data = fulfillmentData;
    }

    const { data, error } = await supabase
      .from(PROMISES_TABLE)
      .update(updateData)
      .eq("id", promiseId)
      .eq("status", "pending")
      .select("description")
      .maybeSingle();

    if (error) {
      console.error("[Promises] Error marking promise fulfilled:", error);
      return false;
    }

    if (!data) {
      console.warn(
        "[Promises] Promise already fulfilled or not found:",
        promiseId,
      );
      return false;
    }

    console.log(`[Promises] ✅ Marked as fulfilled: ${data.description}`);
    return true;
  } catch (error) {
    console.error("[Promises] Error in markPromiseAsFulfilled:", error);
    return false;
  }
}

/**
 * Cancel a promise (if user changes mind or it's no longer relevant).
 *
 * @param promiseId - ID of the promise to cancel
 */
export async function cancelPromise(promiseId: string): Promise<void> {
  try {
    console.log('promiseService: cancelPromise')
    await supabase
      .from(PROMISES_TABLE)
      .update({ status: "cancelled" })
      .eq("id", promiseId);

    console.log(`[Promises] Cancelled: ${promiseId}`);
  } catch (error) {
    console.error("[Promises] Error cancelling promise:", error);
  }
}

/**
 * Clean up old fulfilled/cancelled promises (keep DB lean).
 * Removes promises older than 30 days that are fulfilled or cancelled.
 */
export async function cleanupOldPromises(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await supabase
      .from(PROMISES_TABLE)
      .delete()
      .in("status", ["fulfilled", "cancelled"])
      .lt("created_at", thirtyDaysAgo.toISOString());

    console.log("[Promises] Cleaned up old promises");
  } catch (error) {
    console.error("[Promises] Error cleaning up old promises:", error);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map database row to Promise object.
 * Handles type conversions and snake_case to camelCase.
 */
function mapRowToPromise(row: any): KayleyPromise {
  return {
    id: row.id,
    promiseType: row.promise_type as PromiseType,
    description: row.description,
    triggerEvent: row.trigger_event,
    estimatedTiming: new Date(row.estimated_timing),
    commitmentContext: row.commitment_context,
    fulfillmentData: row.fulfillment_data,
    status: row.status as PromiseStatus,
    createdAt: new Date(row.created_at),
    fulfilledAt: row.fulfilled_at ? new Date(row.fulfilled_at) : undefined,
  };
}

function parseExplicitTriggerTiming(triggerEvent: string): {
  timing: Date;
  isExplicit: boolean;
} {
  const lower = triggerEvent.toLowerCase();
  const now = new Date();
  const normalized = triggerEvent.trim();

  // ISO-style datetime first
  if (/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        timing: parsed,
        isExplicit: true,
      };
    }
  }

  // "11:30am", "11am", etc.
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!timeMatch) {
    return {
      timing: new Date(Date.now() + DEFAULT_PROMISE_DELAY_MINUTES * 60 * 1000),
      isExplicit: false,
    };
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || "0");
  const meridian = timeMatch[3];

  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;

  let dayOffset = 0;
  if (lower.includes("tomorrow")) {
    dayOffset = 1;
  } else if (lower.includes("today")) {
    dayOffset = 0;
  }

  const timing = new Date(now);
  timing.setSeconds(0, 0);
  timing.setDate(timing.getDate() + dayOffset);
  timing.setHours(hour, minute, 0, 0);

  // If no explicit day and time already passed, treat as next day.
  if (!lower.includes("today") && !lower.includes("tomorrow") && timing <= now) {
    timing.setDate(timing.getDate() + 1);
  }

  return {
    timing,
    isExplicit: true,
  };
}

async function ensureCronMirrorForPromise(promise: KayleyPromise): Promise<boolean> {
  const searchQuery = `${PROMISE_CRON_QUERY_PREFIX}${promise.id}`;

  const { data: existingCron, error: existingError } = await supabase
    .from(CRON_JOBS_TABLE)
    .select("id")
    .eq("search_query", searchQuery)
    .maybeSingle();

  if (existingError) {
    console.warn("[Promises] Failed to check cron mirror existence:", existingError);
    return false;
  }

  if (existingCron?.id) {
    return false;
  }

  const cronTitle = `Promise reminder: ${promise.description}`;
  const summaryInstruction =
    `Promise reminder for ${promise.promiseType}. Trigger: ${promise.triggerEvent}.`;

  const { error } = await supabase
    .from(CRON_JOBS_TABLE)
    .insert({
      title: cronTitle,
      search_query: searchQuery,
      summary_instruction: summaryInstruction,
      schedule_type: "one_time",
      timezone: "America/Chicago",
      one_time_run_at: promise.estimatedTiming.toISOString(),
      next_run_at: promise.estimatedTiming.toISOString(),
      status: "active",
      created_by: PROMISE_CRON_CREATED_BY,
    });

  if (error) {
    console.warn("[Promises] Failed to create cron mirror for promise:", {
      promiseId: promise.id,
      error,
    });
    return false;
  }

  console.log("[Promises] Created cron mirror for timed promise", {
    promiseId: promise.id,
    runAt: promise.estimatedTiming.toISOString(),
  });
  return true;
}
