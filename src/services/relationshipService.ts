import { supabase } from './supabaseClient';
import { ChatMessage } from '../types';
import { GoogleGenAI } from "@google/genai"; // Import Google GenAI SDK
import {
  InsightType,
  RelationshipInsightRow,
  UpsertRelationshipInsightInput,
  relationshipInsightRowSchema,
  buildInsightKey,
  createNewInsightFromInput,
  applyObservationToInsight,
  mapInsightRowToDomain,
} from '../domain/relationships/patternInsights';

const RELATIONSHIPS_TABLE = 'character_relationships';
const RELATIONSHIP_EVENTS_TABLE = 'relationship_events';
const RELATIONSHIP_INSIGHTS_TABLE = 'relationship_insights';

export interface RelationshipMetrics {
  id: string;
  relationshipScore: number;
  relationshipTier: string;
  warmthScore: number;
  trustScore: number;
  playfulnessScore: number;
  stabilityScore: number;
  familiarityStage: string;
  totalInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  firstInteractionAt: Date | null;
  lastInteractionAt: Date | null;
  isRuptured: boolean;
  lastRuptureAt: Date | null;
  ruptureCount: number;
}


export interface RelationshipEvent {
  eventType: 'positive' | 'negative' | 'neutral' | 'milestone' | 'rupture' | 'repair';
  source: 'chat' | 'video_request' | 'system' | 'milestone' | 'decay';
  sentimentTowardCharacter?: 'positive' | 'neutral' | 'negative';
  sentimentIntensity?: number; // 1-10
  userMood?: string;
  actionType?: string; // e.g., 'action_video', 'chill_video', 'greeting', etc.
  scoreChange: number;
  warmthChange: number;
  trustChange: number;
  playfulnessChange: number;
  stabilityChange: number;
  userMessage?: string;
  notes?: string;
}

// ... (omitted lines)

/**
 * Detect if an event constitutes a rupture
 */
export function detectRupture(
  event: RelationshipEvent,
  previousScore: number,
  newScore: number
): boolean {

  // Existing Logic (Fallback)
  if (
    event.sentimentTowardCharacter === 'negative' &&
    event.sentimentIntensity &&
    event.sentimentIntensity >= 7 &&
    event.scoreChange <= -10
  ) {
    return true;
  }

  const scoreDrop = previousScore - newScore;
  if (scoreDrop >= 15) {
    return true;
  }

  if (event.userMessage) {
    const hostilePhrases = [
      'hate you',
      "you're useless",
      'shut up',
      'you suck',
      'you\'re stupid',
      'i hate talking to you',
    ];
    const lowerMessage = event.userMessage.toLowerCase();
    if (hostilePhrases.some(phrase => lowerMessage.includes(phrase))) {
      return true;
    }
  }

  return false;
}

interface RelationshipRow {
  id: string;
  relationship_score: number;
  relationship_tier: string;
  warmth_score: number;
  trust_score: number;
  playfulness_score: number;
  stability_score: number;
  familiarity_stage: string;
  total_interactions: number;
  positive_interactions: number;
  negative_interactions: number;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  is_ruptured: boolean;
  last_rupture_at: string | null;
  rupture_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get or create relationship for a user
 */
const RELATIONSHIP_ID = "a45afaf3-565f-40f2-9876-c0adaf832547";
export const getRelationship =
  async (): Promise<RelationshipMetrics | null> => {
    try {
      // Try to get existing relationship
      const { data, error } = await supabase
        .from(RELATIONSHIPS_TABLE)
        .select("*")
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Error fetching relationship:", error);
        return null;
      }

      if (data) {
        return mapRelationshipRowToMetrics(data as RelationshipRow);
      }

      // Create new relationship if it doesn't exist
      const now = new Date().toISOString();
      const { data: newData, error: createError } = await supabase
        .from(RELATIONSHIPS_TABLE)
        .insert({
          relationship_score: 0.0,
          relationship_tier: "acquaintance",
          warmth_score: 0.0,
          trust_score: 0.0,
          playfulness_score: 0.0,
          stability_score: 0.0,
          familiarity_stage: "early",
          total_interactions: 0,
          positive_interactions: 0,
          negative_interactions: 0,
          first_interaction_at: now,
          last_interaction_at: now,
          is_ruptured: false,
          rupture_count: 0,
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating relationship:", createError);
        return null;
      }

      return mapRelationshipRowToMetrics(newData as RelationshipRow);
    } catch (error) {
      console.error("Unexpected error in getRelationship:", error);
      return null;
    }
  };

/**
 * Update relationship based on an event
 */
export const updateRelationship = async (
  event: RelationshipEvent
): Promise<RelationshipMetrics | null> => {
  try {
    // Get current relationship
    const current = await getRelationship();
    if (!current) {
      console.error("Could not get relationship for update");
      return null;
    }

    // Calculate new scores (with clamping)
    const newRelationshipScore = clamp(
      current.relationshipScore + event.scoreChange,
      -100,
      100
    );
    const newWarmthScore = clamp(
      current.warmthScore + event.warmthChange,
      -50,
      50
    );
    const newTrustScore = clamp(
      current.trustScore + event.trustChange,
      -50,
      50
    );
    const newPlayfulnessScore = clamp(
      current.playfulnessScore + event.playfulnessChange,
      -50,
      50
    );
    const newStabilityScore = clamp(
      current.stabilityScore + event.stabilityChange,
      -50,
      50
    );

    // Update interaction counts
    const newTotalInteractions = current.totalInteractions + 1;
    const newPositiveInteractions =
      event.eventType === "positive"
        ? current.positiveInteractions + 1
        : current.positiveInteractions;
    const newNegativeInteractions =
      event.eventType === "negative"
        ? current.negativeInteractions + 1
        : current.negativeInteractions;

    // Calculate familiarity stage
    const newFamiliarity = calculateFamiliarityStage(
      newTotalInteractions,
      current.firstInteractionAt
    );

    // Check for rupture
    const isRupture = detectRupture(
      event,
      current.relationshipScore,
      newRelationshipScore
    );
    const newIsRuptured = isRupture
      ? true
      : event.eventType === "repair"
      ? false
      : current.isRuptured;
    const newRuptureCount = isRupture
      ? current.ruptureCount + 1
      : current.ruptureCount;
    const newLastRuptureAt = isRupture
      ? new Date().toISOString()
      : current.lastRuptureAt?.toISOString() || null;

    // Update relationship
    const { data, error } = await supabase
      .from(RELATIONSHIPS_TABLE)
      .update({
        relationship_score: newRelationshipScore,
        warmth_score: newWarmthScore,
        trust_score: newTrustScore,
        playfulness_score: newPlayfulnessScore,
        stability_score: newStabilityScore,
        total_interactions: newTotalInteractions,
        positive_interactions: newPositiveInteractions,
        negative_interactions: newNegativeInteractions,
        last_interaction_at: new Date().toISOString(),
        is_ruptured: newIsRuptured,
        last_rupture_at: newLastRuptureAt,
        rupture_count: newRuptureCount,
        familiarity_stage: newFamiliarity,
      })
      .eq("id", RELATIONSHIP_ID)
      .select()
      .single();

    if (error) {
      console.error("Error updating relationship:", error);
      return null;
    }

    if (!data) {
      console.warn("updateRelationship received null data from update");
      return null;
    }

    // Log the event
    await logRelationshipEvent(
      data.id,
      event,
      current.relationshipScore,
      newRelationshipScore,
      current.relationshipTier,
      getRelationshipTier(newRelationshipScore)
    );

    // Record pattern insights (if mood + action present)
    if (event.userMood && event.actionType) {
      await recordPatternObservation(data.id, {
        insightType: "pattern" as InsightType,
        key: buildInsightKey(event.userMood, event.actionType),
        observedAt: new Date().toISOString(),
      });
    }

    return mapRelationshipRowToMetrics(data as RelationshipRow);
  } catch (error) {
    console.error("Unexpected error in updateRelationship:", error);
    return null;
  }
};


/**
 * Calculate score changes based on sentiment, intensity, and message content.
 *
 * TUNING NOTES (v3 - realistic 6-12 month progression):
 * - Relationships should take MONTHS to build, not weeks
 * - Positive messages: +0.15 to +0.5 relationship score (halved from v2)
 * - Negative messages: -0.5 to -3.0 relationship score (destruction is faster than building)
 * - Warmth/Trust/etc: +0.05 to +0.25 per interaction (halved from v2)
 *
 * TARGET PROGRESSION:
 * - Acquaintance (0-10): First 15-30 interactions (~1-2 weeks)
 * - Friend (10-50): 100-150 interactions (~1-3 months of regular use)
 * - Close Friend (50-100): 250-350 interactions (~3-6 months of regular use)
 * - Deeply Loving (100+): 400+ interactions (~6-12 months of deep connection)
 *
 * This matches the user's 12-month curve expectation.
 */
export function calculateScoreChanges(
  sentiment: "positive" | "neutral" | "negative",
  intensity: number,
  message: string,
): {
  scoreChange: number;
  warmthChange: number;
  trustChange: number;
  playfulnessChange: number;
  stabilityChange: number;
} {
  const baseMultiplier = intensity / 10; // Scale by intensity (0.1 to 1.0)

  // Detect interaction type for nuanced dimension updates
  const isCompliment =
    /(amazing|great|wonderful|love|awesome|fantastic|perfect|excellent|brilliant|beautiful)/i.test(
      message
    );
  const isApology = /(sorry|apologize|my\s+bad|my\s+fault|forgive)/i.test(
    message
  );
  const isJokeOrBanter =
    /(haha|hahaha|lol|lmao|funny|joke|tease|sassy)/i.test(message) ||
    message.includes("😄") ||
    message.includes("😂");
  const isPersonalShare =
    /(i\s+(feel|think|want|need|wish|hope)|my\s+(day|life|work|family|friend))/i.test(
      message
    );
  const isQuestion = message.includes("?");
  const isEngagement = message.length > 20 && isQuestion;
  const isDismissive =
    /(whatever|just|only|don'?t\s+care|doesn'?t\s+matter)/i.test(message);

  if (sentiment === "positive") {
    // BASE: +0.15 to +0.5 points (HALVED from v2 for realistic progression)
    let scoreChange = Math.round((0.15 + 0.35 * baseMultiplier) * 10) / 10;
    let warmthChange = Math.round((0.05 + 0.15 * baseMultiplier) * 10) / 10; // +0.05 to +0.2
    let trustChange = Math.round(0.05 * baseMultiplier * 10) / 10; // +0 to +0.05
    let playfulnessChange = 0;
    let stabilityChange = Math.round(0.05 * baseMultiplier * 10) / 10; // +0 to +0.05

    // Compliments boost warmth (but still modest)
    if (isCompliment) {
      warmthChange += Math.round(0.1 * baseMultiplier * 10) / 10;
      trustChange += Math.round(0.03 * baseMultiplier * 10) / 10;
    }

    // Apologies build trust and stability (meaningful gesture)
    if (isApology) {
      trustChange += Math.round(0.15 * baseMultiplier * 10) / 10;
      stabilityChange += Math.round(0.1 * baseMultiplier * 10) / 10;
      warmthChange += Math.round(0.05 * baseMultiplier * 10) / 10;
    }

    // Jokes/banter boost playfulness
    if (isJokeOrBanter) {
      playfulnessChange = Math.round((0.05 + 0.1 * baseMultiplier) * 10) / 10;
      warmthChange += Math.round(0.05 * baseMultiplier * 10) / 10;
    }

    // Personal sharing builds trust (vulnerability = trust)
    if (isPersonalShare) {
      trustChange += Math.round(0.1 * baseMultiplier * 10) / 10;
      warmthChange += Math.round(0.05 * baseMultiplier * 10) / 10;
    }

    // Engagement builds stability
    if (isEngagement) {
      stabilityChange += Math.round(0.05 * baseMultiplier * 10) / 10;
      trustChange += Math.round(0.03 * baseMultiplier * 10) / 10;
    }

    return {
      scoreChange,
      warmthChange: Math.round(warmthChange * 10) / 10,
      trustChange: Math.round(trustChange * 10) / 10,
      playfulnessChange: Math.round(playfulnessChange * 10) / 10,
      stabilityChange: Math.round(stabilityChange * 10) / 10,
    };
  } else if (sentiment === "negative") {
    // Negative is 2-3x stronger than positive (easier to destroy than build)
    // BASE: -0.5 to -3.0 points (unchanged - destruction should be faster)
    let scoreChange = Math.round(-(0.5 + 2.5 * baseMultiplier) * 10) / 10;
    let warmthChange = Math.round(-(0.2 + 0.5 * baseMultiplier) * 10) / 10;
    let trustChange = Math.round(-(0.1 + 0.4 * baseMultiplier) * 10) / 10;
    let playfulnessChange = Math.round(-0.2 * 10) / 10;
    let stabilityChange = Math.round(-(0.1 + 0.2 * baseMultiplier) * 10) / 10;

    if (isDismissive) {
      trustChange += Math.round(-0.2 * baseMultiplier * 10) / 10;
      stabilityChange += Math.round(-0.1 * baseMultiplier * 10) / 10;
      warmthChange += Math.round(-0.1 * baseMultiplier * 10) / 10;
    }

    if (/(stupid|dumb|hate|useless|worthless|annoying)/i.test(message)) {
      warmthChange += Math.round(-0.3 * baseMultiplier * 10) / 10;
      trustChange += Math.round(-0.2 * baseMultiplier * 10) / 10;
    }

    return {
      scoreChange,
      warmthChange: Math.round(warmthChange * 10) / 10,
      trustChange: Math.round(trustChange * 10) / 10,
      playfulnessChange: Math.round(playfulnessChange * 10) / 10,
      stabilityChange: Math.round(stabilityChange * 10) / 10,
    };
  }

  // Neutral - very small positive influence for engagement
  if (isEngagement || isQuestion) {
    return {
      scoreChange: 0.05, // Tiny bump for showing up (halved)
      warmthChange: 0.03,
      trustChange: 0,
      playfulnessChange: 0,
      stabilityChange: 0.03,
    };
  }

  return {
    scoreChange: 0,
    warmthChange: 0,
    trustChange: 0,
    playfulnessChange: 0,
    stabilityChange: 0,
  };
}

/**
 * Calculate relationship tier from score.
 *
 * THRESHOLDS (v3 - realistic 6-12 month progression):
 * - adversarial: <= -50 (hostile relationship)
 * - neutral_negative: -49 to -10 (tense, strained)
 * - acquaintance: -9 to 10 (polite, surface-level) ~15-30 interactions
 * - friend: 11 to 50 (friendly, comfortable) ~100-150 interactions
 * - close_friend: 51 to 100 (deep trust, vulnerability) ~250-350 interactions
 * - deeply_loving: 100+ (intimate connection) ~400+ interactions over 6-12 months
 *
 * These thresholds are designed to make reaching "deeply_loving" feel earned
 * and meaningful, requiring sustained positive interaction over months.
 */
function getRelationshipTier(score: number): string {
  if (score <= -50) return "adversarial";
  if (score <= -10) return "neutral_negative";
  if (score < 10) return "acquaintance";
  if (score < 50) return "friend";
  if (score < 100) return "close_friend";
  return "deeply_loving";
}

function calculateFamiliarityStage(
  totalInteractions: number,
  firstInteractionAt: Date | null
): "early" | "developing" | "established" {
  const daysSince = firstInteractionAt
    ? (Date.now() - firstInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  if (totalInteractions < 5 || daysSince < 2) return "early";
  if (totalInteractions < 25 || daysSince < 14) return "developing";
  return "established";
}

async function logRelationshipEvent(
  relationshipId: string,
  event: RelationshipEvent,
  previousScore: number,
  newScore: number,
  previousTier: string,
  newTier: string
): Promise<void> {
  try {
    await supabase.from(RELATIONSHIP_EVENTS_TABLE).insert({
      relationship_id: relationshipId,
      event_type: event.eventType,
      source: event.source,
      sentiment_toward_character: event.sentimentTowardCharacter,
      sentiment_intensity: event.sentimentIntensity,
      user_mood: event.userMood,
      score_change: event.scoreChange,
      warmth_change: event.warmthChange,
      trust_change: event.trustChange,
      playfulness_change: event.playfulnessChange,
      stability_change: event.stabilityChange,
      previous_relationship_score: previousScore,
      new_relationship_score: newScore,
      previous_tier: previousTier,
      new_tier: newTier,
      user_message: event.userMessage,
      notes: event.notes,
    });
  } catch (error) {
    console.error("Error logging relationship event:", error);
  }
}

async function recordPatternObservation(
  relationshipId: string,
  input: Omit<UpsertRelationshipInsightInput, "relationshipId">
): Promise<void> {
  try {
    const baseInput: UpsertRelationshipInsightInput = {
      ...input,
      relationshipId,
    };

    const { data: existingRow, error } = await supabase
      .from(RELATIONSHIP_INSIGHTS_TABLE)
      .select("*")
      .eq("relationship_id", relationshipId)
      .eq("key", baseInput.key)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("Failed to load existing insight:", error);
      return;
    }

    if (!existingRow) {
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

      await supabase.from(RELATIONSHIP_INSIGHTS_TABLE).insert(insertPayload);
      return;
    }

    const parsed = relationshipInsightRowSchema.safeParse(existingRow);
    if (!parsed.success) {
      console.error("Invalid insight row:", parsed.error);
      return;
    }

    const existing = mapInsightRowToDomain(
      parsed.data as RelationshipInsightRow
    );
    const updated = applyObservationToInsight(existing, baseInput);

    const updatePayload = {
      confidence: updated.confidence,
      times_observed: updated.timesObserved,
      last_observed_at: updated.lastObservedAt,
      summary: updated.summary,
    };

    await supabase
      .from(RELATIONSHIP_INSIGHTS_TABLE)
      .update(updatePayload)
      .eq("id", updated.id);
  } catch (error) {
    console.error("Unexpected error in recordPatternObservation:", error);
  }
}

function mapRelationshipRowToMetrics(
  row: RelationshipRow
): RelationshipMetrics {
  return {
    id: row.id,
    relationshipScore: row.relationship_score,
    relationshipTier: row.relationship_tier,
    warmthScore: row.warmth_score,
    trustScore: row.trust_score,
    playfulnessScore: row.playfulness_score,
    stabilityScore: row.stability_score,
    familiarityStage: row.familiarity_stage,
    totalInteractions: row.total_interactions,
    positiveInteractions: row.positive_interactions,
    negativeInteractions: row.negative_interactions,
    firstInteractionAt: row.first_interaction_at
      ? new Date(row.first_interaction_at)
      : null,
    lastInteractionAt: row.last_interaction_at
      ? new Date(row.last_interaction_at)
      : null,
    isRuptured: row.is_ruptured,
    lastRuptureAt: row.last_rupture_at ? new Date(row.last_rupture_at) : null,
    ruptureCount: row.rupture_count,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
