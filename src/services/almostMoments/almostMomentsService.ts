// src/services/almostMoments/almostMomentsService.ts

import { supabase } from "../supabaseClient";
import type {
  UnsaidFeeling,
  UnsaidFeelingType,
  AlmostMomentStage,
  AlmostMomentContext,
} from "./types";

/**
 * Get active unsaid feelings for a user.
 */
export async function getUnsaidFeelings(userId: string): Promise<UnsaidFeeling[]> {
  let query: any = supabase
    .from("kayley_unsaid_feelings")
    .select("*")
    .eq("user_id", userId);

  if (typeof query.is === "function") {
    query = query.is("resolved_at", null);
  } else if (typeof query.eq === "function") {
    query = query.eq("resolved_at", null);
  }

  if (typeof query.order === "function") {
    query = query.order("intensity", { ascending: false });
  }

  const { data, error } = await query;

  if (error || !data) {
    console.error("[AlmostMoments] Error fetching feelings:", error);
    return [];
  }

  return data.map(mapFeelingFromDb);
}

/**
 * Create a new unsaid feeling.
 */
export async function createUnsaidFeeling(
  userId: string,
  type: UnsaidFeelingType,
  content: string,
  expressions: string[]
): Promise<UnsaidFeeling> {
  const { data, error } = await supabase
    .from("kayley_unsaid_feelings")
    .insert({
      user_id: userId,
      feeling_type: type,
      unsaid_content: content,
      partial_expressions: expressions,
      intensity: 0.3,
      suppression_count: 0,
      current_stage: "micro_hint",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create unsaid feeling: ${error?.message || "unknown error"}`);
  }

  return mapFeelingFromDb(data);
}

/**
 * Record an almost moment (when she almost said something).
 */
export async function recordAlmostMoment(
  userId: string,
  feelingId: string,
  stage: AlmostMomentStage,
  expressionUsed: string,
  context: string
): Promise<void> {
  await supabase.from("kayley_almost_moment_log").insert({
    user_id: userId,
    unsaid_feeling_id: feelingId,
    stage,
    expression_used: expressionUsed,
    conversation_context: context,
  });

  const { data: feeling, error } = await supabase
    .from("kayley_unsaid_feelings")
    .select("intensity, suppression_count")
    .eq("id", feelingId)
    .single();

  if (error || !feeling) {
    return;
  }

  const newIntensity = Math.min(1.0, Number(feeling.intensity) + 0.1);
  const newCount = (feeling.suppression_count as number) + 1;
  const newStage = calculateStage(newIntensity, newCount);

  await supabase
    .from("kayley_unsaid_feelings")
    .update({
      intensity: newIntensity,
      suppression_count: newCount,
      current_stage: newStage,
      last_almost_moment_at: new Date().toISOString(),
    })
    .eq("id", feelingId);
}

/**
 * Resolve a feeling (she finally said it).
 */
export async function resolveFeeling(feelingId: string): Promise<void> {
  await supabase
    .from("kayley_unsaid_feelings")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", feelingId);
}

/**
 * Calculate stage based on intensity and suppression.
 */
export function calculateStage(
  intensity: number,
  suppressionCount: number
): AlmostMomentStage {
  const combined = intensity + suppressionCount * 0.1;

  if (combined >= 0.9) return "almost_confession";
  if (combined >= 0.6) return "obvious_unsaid";
  if (combined >= 0.3) return "near_miss";
  return "micro_hint";
}

/**
 * Check if conditions are right for an almost moment.
 */
export function shouldTriggerAlmostMoment(
  context: AlmostMomentContext,
  feeling: UnsaidFeeling
): boolean {
  const tierAllows = ["close_friend", "deeply_loving"].includes(
    context.relationshipTier
  );
  if (!tierAllows) return false;

  if (context.warmthScore < 20) return false;

  if (feeling.lastAlmostMoment) {
    const hoursSince =
      (Date.now() - feeling.lastAlmostMoment.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) return false;
  }

  let probability = 0.05;

  if (context.conversationDepth === "intimate") probability += 0.15;
  if (context.conversationDepth === "deep") probability += 0.1;
  if (context.recentSweetMoment) probability += 0.1;
  if (context.lateNightConversation) probability += 0.1;
  if (context.vulnerabilityExchangeActive) probability += 0.1;

  probability += feeling.intensity * 0.2;

  return Math.random() < probability;
}

function mapFeelingFromDb(row: Record<string, unknown>): UnsaidFeeling {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.feeling_type as UnsaidFeelingType,
    intensity: Number(row.intensity),
    suppressionCount: row.suppression_count as number,
    lastAlmostMoment: row.last_almost_moment_at
      ? new Date(row.last_almost_moment_at as string)
      : null,
    unsaidContent: row.unsaid_content as string,
    partialExpressions: (row.partial_expressions as string[]) || [],
    createdAt: new Date(row.created_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
  };
}
