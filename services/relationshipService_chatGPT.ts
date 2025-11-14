// relationshipService.ts

import { SupabaseClient } from "@supabase/supabase-js";
import {
  InsightType,
  RelationshipInsight,
  RelationshipInsightRow,
  UpsertRelationshipInsightInput,
  relationshipInsightRowSchema,
  buildInsightKey,
  createNewInsightFromInput,
  applyObservationToInsight,
  mapInsightRowToDomain,
} from "./patternInsights";

// ---------- Types ----------

export type RelationshipTier =
  | "adversarial"
  | "rival"
  | "neutral"
  | "friend"
  | "deeply_loving";

export type FamiliarityStage = "early" | "developing" | "established";

export interface RelationshipRow {
  id: string;
  user_id: string;
  character_id: string;

  relationship_score: number;
  relationship_tier: RelationshipTier;

  warmth_score: number;
  trust_score: number;
  playfulness_score: number;
  stability_score: number;

  familiarity_stage: FamiliarityStage;

  is_ruptured: boolean;
  last_rupture_at: string | null;

  first_interaction_at: string | null;
  last_interaction_at: string | null;
  total_interactions: number;

  created_at: string;
}

export interface Relationship {
  id: string;
  userId: string;
  characterId: string;

  relationshipScore: number;
  relationshipTier: RelationshipTier;

  warmthScore: number;
  trustScore: number;
  playfulnessScore: number;
  stabilityScore: number;

  familiarityStage: FamiliarityStage;

  isRuptured: boolean;
  lastRuptureAt: string | null;

  firstInteractionAt: string | null;
  lastInteractionAt: string | null;
  totalInteractions: number;

  createdAt: string;
}

export type SentimentTowardsCharacter = "positive" | "neutral" | "negative";

export type RelationshipEventType =
  | "positive"
  | "negative"
  | "neutral"
  | "milestone"
  | "decay";

export interface UpdateRelationshipEvent {
  source: string; // e.g. 'chat', 'video_request', 'system'
  eventType?: RelationshipEventType;
  userMessage?: string;

  sentimentTowardCharacter?: SentimentTowardsCharacter;
  userMood?: string; // 'stressed', 'bored', etc.
  actionType?: string; // 'action_video', 'chill_video', etc.

  // Optional direct overrides (normally derived from sentiment)
  scoreChangeOverride?: number;
  warmthChangeOverride?: number;
  trustChangeOverride?: number;
  playfulnessChangeOverride?: number;
  stabilityChangeOverride?: number;

  notes?: string;
}

export interface UpdateRelationshipParams {
  userId: string;
  characterId: string;
  event: UpdateRelationshipEvent;
}

// ---------- Helper functions (pure) ----------

function mapRowToDomain(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    userId: row.user_id,
    characterId: row.character_id,
    relationshipScore: row.relationship_score,
    relationshipTier: row.relationship_tier,
    warmthScore: row.warmth_score,
    trustScore: row.trust_score,
    playfulnessScore: row.playfulness_score,
    stabilityScore: row.stability_score,
    familiarityStage: row.familiarity_stage,
    isRuptured: row.is_ruptured,
    lastRuptureAt: row.last_rupture_at,
    firstInteractionAt: row.first_interaction_at,
    lastInteractionAt: row.last_interaction_at,
    totalInteractions: row.total_interactions,
    createdAt: row.created_at,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRelationshipTier(score: number): RelationshipTier {
  if (score <= -50) return "adversarial";
  if (score <= -10) return "rival";
  if (score < 10) return "neutral";
  if (score < 50) return "friend";
  return "deeply_loving";
}

function calculateFamiliarityStage(
  totalInteractions: number,
  firstInteractionAt: string | null
): FamiliarityStage {
  if (!firstInteractionAt) {
    return "early";
  }
  const first = new Date(firstInteractionAt).getTime();
  const now = Date.now();
  const days = (now - first) / (1000 * 60 * 60 * 24);

  if (totalInteractions < 5 || days < 2) return "early";
  if (totalInteractions < 25 || days < 14) return "developing";
  return "established";
}

interface ScoreDeltas {
  scoreChange: number;
  warmthChange: number;
  trustChange: number;
  playfulnessChange: number;
  stabilityChange: number;
}

// Heuristic mapping from event to score deltas.
// You can tweak this over time.
function deriveScoreDeltas(
  event: UpdateRelationshipEvent
): ScoreDeltas & { eventType: RelationshipEventType } {
  // If explicit overrides exist, use them and mark eventType if missing.
  if (
    event.scoreChangeOverride !== undefined ||
    event.warmthChangeOverride !== undefined ||
    event.trustChangeOverride !== undefined ||
    event.playfulnessChangeOverride !== undefined ||
    event.stabilityChangeOverride !== undefined
  ) {
    return {
      eventType: event.eventType ?? "neutral",
      scoreChange: event.scoreChangeOverride ?? 0,
      warmthChange: event.warmthChangeOverride ?? 0,
      trustChange: event.trustChangeOverride ?? 0,
      playfulnessChange: event.playfulnessChangeOverride ?? 0,
      stabilityChange: event.stabilityChangeOverride ?? 0,
    };
  }

  // Decay is special: small negative, mostly on trust/stability.
  if (event.eventType === "decay") {
    const decay = -Math.abs(event.scoreChangeOverride ?? 1);
    return {
      eventType: "decay",
      scoreChange: decay,
      warmthChange: 0,
      trustChange: decay * 0.2,
      playfulnessChange: 0,
      stabilityChange: decay * 0.3,
    };
  }

  const sentiment = event.sentimentTowardCharacter ?? "neutral";

  switch (sentiment) {
    case "positive":
      return {
        eventType: event.eventType ?? "positive",
        scoreChange: 3,
        warmthChange: 2,
        trustChange: 1,
        playfulnessChange: 1,
        stabilityChange: 1,
      };
    case "negative":
      return {
        eventType: event.eventType ?? "negative",
        scoreChange: -5,
        warmthChange: -4,
        trustChange: -3,
        playfulnessChange: -1,
        stabilityChange: -2,
      };
    case "neutral":
    default:
      return {
        eventType: event.eventType ?? "neutral",
        scoreChange: 0,
        warmthChange: 0,
        trustChange: 0,
        playfulnessChange: 0,
        stabilityChange: 0,
      };
  }
}

function shouldMarkRupture(
  prevScore: number,
  newScore: number,
  sentiment: SentimentTowardsCharacter | undefined
): boolean {
  const delta = newScore - prevScore;
  if (sentiment === "negative" && delta <= -10) return true;
  return false;
}

function shouldConsiderRepair(
  wasRuptured: boolean,
  sentiment: SentimentTowardsCharacter | undefined,
  eventType: RelationshipEventType
): boolean {
  if (!wasRuptured) return false;
  if (eventType === "positive") return true;
  if (sentiment === "positive") return true;
  return false;
}

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const then = new Date(dateString).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60 * 24);
}

// ---------- RelationshipService ----------

export class RelationshipService {
  constructor(private supabase: SupabaseClient) {}

  // Get or create relationship between user & character
  async getOrCreateRelationship(
    userId: string,
    characterId: string
  ): Promise<Relationship> {
    const { data, error } = await this.supabase
      .from<RelationshipRow>("character_relationships")
      .select("*")
      .eq("user_id", userId)
      .eq("character_id", characterId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = row not found for maybeSingle
      throw error;
    }

    if (data) {
      // Existing relationship
      const rel = mapRowToDomain(data);
      return rel;
    }

    // Create new relationship
    const now = new Date().toISOString();
    const insertPayload: Partial<RelationshipRow> = {
      user_id: userId,
      character_id: characterId,
      relationship_score: 0,
      relationship_tier: "neutral",
      warmth_score: 0,
      trust_score: 0,
      playfulness_score: 0,
      stability_score: 0,
      familiarity_stage: "early",
      is_ruptured: false,
      last_rupture_at: null,
      first_interaction_at: now,
      last_interaction_at: now,
      total_interactions: 0,
    };

    const { data: inserted, error: insertError } = await this.supabase
      .from<RelationshipRow>("character_relationships")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error("Failed to create relationship");
    }

    return mapRowToDomain(inserted);
  }

  // Main entry: update relationship based on a new event
  async updateRelationship(
    params: UpdateRelationshipParams
  ): Promise<Relationship> {
    const { userId, characterId, event } = params;

    // 1) Get current relationship
    const current = await this.getOrCreateRelationship(userId, characterId);

    // 2) Derive deltas
    const { eventType, ...deltas } = deriveScoreDeltas(event);

    const prevScore = current.relationshipScore;

    // 3) Apply deltas
    let newRelationshipScore = clamp(
      current.relationshipScore + deltas.scoreChange,
      -100,
      100
    );
    let newWarmth = clamp(current.warmthScore + deltas.warmthChange, -100, 100);
    let newTrust = clamp(current.trustScore + deltas.trustChange, -100, 100);
    let newPlayfulness = clamp(
      current.playfulnessScore + deltas.playfulnessChange,
      -100,
      100
    );
    let newStability = clamp(
      current.stabilityScore + deltas.stabilityChange,
      -100,
      100
    );

    const newTier = getRelationshipTier(newRelationshipScore);

    const nowIso = new Date().toISOString();
    const newTotalInteractions = current.totalInteractions + 1;
    const newFamiliarity = calculateFamiliarityStage(
      newTotalInteractions,
      current.firstInteractionAt
    );

    // 4) Rupture / repair
    let isRuptured = current.isRuptured;
    let lastRuptureAt = current.lastRuptureAt ?? null;

    if (
      shouldMarkRupture(
        prevScore,
        newRelationshipScore,
        event.sentimentTowardCharacter
      )
    ) {
      isRuptured = true;
      lastRuptureAt = nowIso;
      // Optional: extra hit to stability on rupture
      newStability = clamp(newStability - 3, -100, 100);
    } else if (
      shouldConsiderRepair(
        current.isRuptured,
        event.sentimentTowardCharacter,
        eventType
      )
    ) {
      isRuptured = false;
      // Reward repair with trust + stability
      newTrust = clamp(newTrust + 2, -100, 100);
      newStability = clamp(newStability + 2, -100, 100);
    }

    // 5) Persist updated relationship
    const updatePayload: Partial<RelationshipRow> = {
      relationship_score: newRelationshipScore,
      relationship_tier: newTier,
      warmth_score: newWarmth,
      trust_score: newTrust,
      playfulness_score: newPlayfulness,
      stability_score: newStability,
      familiarity_stage: newFamiliarity,
      is_ruptured: isRuptured,
      last_rupture_at: lastRuptureAt,
      last_interaction_at: nowIso,
      total_interactions: newTotalInteractions,
    };

    const { data: updatedRow, error: updateError } = await this.supabase
      .from<RelationshipRow>("character_relationships")
      .update(updatePayload)
      .eq("id", current.id)
      .select("*")
      .single();

    if (updateError || !updatedRow) {
      throw updateError ?? new Error("Failed to update relationship");
    }

    const updatedRelationship = mapRowToDomain(updatedRow);

    // 6) Log event
    await this.logRelationshipEvent(updatedRelationship.id, {
      eventType,
      source: event.source,
      sentimentTowardCharacter: event.sentimentTowardCharacter,
      userMood: event.userMood,
      actionType: event.actionType,
      scoreChange: deltas.scoreChange,
      warmthChange: deltas.warmthChange,
      trustChange: deltas.trustChange,
      playfulnessChange: deltas.playfulnessChange,
      stabilityChange: deltas.stabilityChange,
      userMessage: event.userMessage,
      notes: event.notes,
      previousTier: current.relationshipTier,
      newTier,
      previousScore: prevScore,
      newScore: newRelationshipScore,
    });

    // 7) Pattern Insights (if mood + action present)
    if (event.userMood && event.actionType) {
      await this.recordPatternObservation(updatedRelationship.id, {
        relationshipId: updatedRelationship.id,
        insightType: "pattern" as InsightType,
        key: buildInsightKey(event.userMood, event.actionType),
        observedAt: nowIso,
      });
    }

    return updatedRelationship;
  }

  // ---------- Events logging ----------

  private async logRelationshipEvent(
    relationshipId: string,
    params: {
      eventType: RelationshipEventType;
      source: string;
      sentimentTowardCharacter?: SentimentTowardsCharacter;
      userMood?: string;
      actionType?: string;
      scoreChange: number;
      warmthChange: number;
      trustChange: number;
      playfulnessChange: number;
      stabilityChange: number;
      userMessage?: string;
      notes?: string;
      previousTier: RelationshipTier;
      newTier: RelationshipTier;
      previousScore: number;
      newScore: number;
    }
  ): Promise<void> {
    const {
      eventType,
      source,
      sentimentTowardCharacter,
      userMood,
      actionType,
      scoreChange,
      warmthChange,
      trustChange,
      playfulnessChange,
      stabilityChange,
      userMessage,
      notes,
      previousTier,
      newTier,
      previousScore,
      newScore,
    } = params;

    const payload = {
      relationship_id: relationshipId,
      event_type: eventType,
      source,
      sentiment_toward_character: sentimentTowardCharacter ?? null,
      user_mood: userMood ?? null,
      action_type: actionType ?? null,
      score_change: scoreChange,
      warmth_change: warmthChange,
      trust_change: trustChange,
      playfulness_change: playfulnessChange,
      stability_change: stabilityChange,
      user_message: userMessage ?? null,
      notes: notes ?? null,
      previous_tier: previousTier,
      new_tier: newTier,
      previous_score: previousScore,
      new_score: newScore,
    };

    const { error } = await this.supabase
      .from("relationship_events")
      .insert(payload);

    if (error) {
      // Don't throw — logging failures shouldn't break main flow,
      // but you might want to log this somewhere.
      console.error("Failed to log relationship event:", error);
    }
  }

  // ---------- Pattern insights ----------

  /**
   * Upsert pattern-level insight:
   * - If insight for (relationshipId, key) exists → update timesObserved, confidence, summary.
   * - If not → create a new insight.
   */
  private async recordPatternObservation(
    relationshipId: string,
    input: Omit<UpsertRelationshipInsightInput, "relationshipId">
  ): Promise<void> {
    const baseInput: UpsertRelationshipInsightInput = {
      ...input,
      relationshipId,
    };

    // Fetch existing insight
    const { data: existingRow, error } = await this.supabase
      .from<RelationshipInsightRow>("relationship_insights")
      .select("*")
      .eq("relationship_id", relationshipId)
      .eq("key", baseInput.key)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("Failed to load existing insight:", error);
      return;
    }

    if (!existingRow) {
      // Create new
      const newInsight = createNewInsightFromInput(baseInput);

      const insertPayload = {
        id: newInsight.id,
        relationship_id: newInsight.relationshipId,
        insight_type: newInsight.insightType,
        key: newInsight.key,
        summary: newInsight.summary,
        confidence: newInsight.confidence,
        times_observed: newInsight.timesObserved,
        last_observed_at: newInsight.lastObservedAt,
        created_at: newInsight.createdAt,
      };

      const { error: insertError } = await this.supabase
        .from("relationship_insights")
        .insert(insertPayload);

      if (insertError) {
        console.error("Failed to insert relationship insight:", insertError);
      }

      return;
    }

    // Update existing
    const parsed = relationshipInsightRowSchema.safeParse(existingRow);
    if (!parsed.success) {
      console.error("Invalid insight row:", parsed.error);
      return;
    }

    const existing = mapInsightRowToDomain(parsed.data);
    const updated = applyObservationToInsight(existing, baseInput);

    const updatePayload = {
      confidence: updated.confidence,
      times_observed: updated.timesObserved,
      last_observed_at: updated.lastObservedAt,
      summary: updated.summary,
    };

    const { error: updateError } = await this.supabase
      .from("relationship_insights")
      .update(updatePayload)
      .eq("id", updated.id);

    if (updateError) {
      console.error("Failed to update relationship insight:", updateError);
    }
  }

  // ---------- Decay job ----------

  /**
   * Apply decay to all relationships that have been inactive for >7 days.
   * This should be called from a scheduled job (e.g., CRON).
   */
  async applyRelationshipDecay(): Promise<void> {
    const { data, error } = await this.supabase
      .from<RelationshipRow>("character_relationships")
      .select("*");

    if (error || !data) {
      if (error) console.error("Failed to fetch relationships for decay:", error);
      return;
    }

    for (const rel of data) {
      const days = daysSince(rel.last_interaction_at);
      if (days === null || days <= 7) continue;

      const decayMagnitude = Math.min((days - 7) * 0.1, 10); // max -10
      if (decayMagnitude <= 0) continue;

      // Use updateRelationship to apply decay so we reuse all logic
      try {
        await this.updateRelationship({
          userId: rel.user_id,
          characterId: rel.character_id,
          event: {
            source: "decay",
            eventType: "decay",
            scoreChangeOverride: -decayMagnitude,
            notes: `Automatic relationship decay after ${days.toFixed(
              1
            )} days of inactivity.`,
          },
        });
      } catch (e) {
        console.error(
          `Failed to apply decay for relationship ${rel.id}:`,
          e
        );
      }
    }
  }
}
