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
import {
  createPendingMessage,
  hasUndeliveredMessageForTriggerEvent,
} from './idleLife/pendingMessageService';

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

    return mapRowToPromise(data);
  } catch (error) {
    console.error("[Promises] Error in createPromise:", error);
    return null;
  }
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

    return (data || []).map(mapRowToPromise);
  } catch (error) {
    console.error("[Promises] Error in getPendingPromises:", error);
    return [];
  }
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

    const hasExisting = await hasUndeliveredMessageForTriggerEvent(
      "promise",
      promise.id,
    );
    if (hasExisting) {
      console.warn(
        `[Promises] Pending message already exists for promise: ${promise.id}`,
      );
      return true;
    }

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

    // Create pending message (will be delivered when user is online)
    try {
      await createPendingMessage({
        messageText,
        messageType,
        trigger: "promise",
        priority: "normal",
        triggerEventId: promise.id,
        triggerEventTitle: "Promise",
        metadata,
      });
    } catch (error) {
      await supabase
        .from(PROMISES_TABLE)
        .update({ status: "pending", fulfilled_at: null })
        .eq("id", promiseId);
      console.error("[Promises] Error creating pending message:", error);
      return false;
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
