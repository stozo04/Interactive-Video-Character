// src/domain/relationships/patternInsights.ts

import { z } from "zod";

/**
 * Types of insights the system can store.
 *
 * - 'pattern'  – behavioral pattern (e.g. "You ask for action videos when stressed.")
 * - 'milestone' – important relational events (first fight, big repair, etc.)
 * - 'trigger'  – things that strongly affect behavior/mood.
 */
export const InsightTypeEnum = z.enum(["pattern", "milestone", "trigger"]);
export type InsightType = z.infer<typeof InsightTypeEnum>;

/**
 * Core shape of a Relationship Insight in your *domain* model (camelCase).
 * This is what your application logic should use.
 */
export interface RelationshipInsight {
  id: string;
  relationshipId: string;
  insightType: InsightType;
  /**
   * Machine-readable key describing the pattern, e.g.:
   * - 'stressed_action_video'
   * - 'late_night_checkin'
   * - 'shares_vulnerable_thoughts_when_calm'
   */
  key: string;
  /**
   * Human-readable summary Kayley can reference in prompts, e.g.:
   * "You often ask for action videos when you're stressed."
   */
  summary: string;
  /**
   * 0.0–1.0: how confident we are this pattern is real/stable.
   */
  confidence: number;
  /**
   * Number of times this pattern has been observed in logs.
   */
  timesObserved: number;
  /**
   * ISO timestamp of the most recent observation.
   */
  lastObservedAt: string;
  /**
   * ISO timestamp of when this insight was first created.
   */
  createdAt: string;
}

/**
 * Shape as it exists in the DATABASE (snake_case) e.g. Supabase/Postgres.
 * This is helpful if you’re using a typed client or doing manual mapping.
 */
export interface RelationshipInsightRow {
  id: string;
  relationship_id: string;
  insight_type: InsightType;
  key: string;
  summary: string;
  confidence: number;
  times_observed: number;
  last_observed_at: string;
  created_at: string;
}

/**
 * Zod schema for DB rows (snake_case).
 * Useful when reading from an untyped source (Supabase, raw SQL, etc.).
 */
export const relationshipInsightRowSchema = z.object({
  id: z.string().uuid(),
  relationship_id: z.string().uuid(),
  insight_type: InsightTypeEnum,
  key: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  times_observed: z.number().int().min(0),
  last_observed_at: z.string(),
  created_at: z.string(),
});

/**
 * Zod schema for the domain model (camelCase).
 * Use this if you’re validating after mapping from DB → domain model.
 */
export const relationshipInsightSchema = z.object({
  id: z.string().uuid(),
  relationshipId: z.string().uuid(),
  insightType: InsightTypeEnum,
  key: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  timesObserved: z.number().int().min(0),
  lastObservedAt: z.string(),
  createdAt: z.string(),
});

/**
 * DTO for creating or incrementally updating an insight.
 * This is what your relationshipService should accept when it logs a pattern.
 */
export const upsertRelationshipInsightInputSchema = z.object({
  relationshipId: z.string().uuid(),
  insightType: InsightTypeEnum.default("pattern"),
  key: z.string().min(1),

  /**
   * Optional human-readable summary. If not provided,
   * your service can generate or update it automatically from the key.
   */
  summary: z.string().min(1).optional(),

  /**
   * If you’re doing incremental updates:
   * - confidenceDelta > 0 to increase confidence
   * - confidenceDelta < 0 to decrease confidence
   * Typically something like +0.1 per strong observation.
   */
  confidenceDelta: z.number().optional(),

  /**
   * The timestamp at which this pattern was observed.
   * Default: now() if omitted.
   */
  observedAt: z.string().optional(),
});

export type UpsertRelationshipInsightInput = z.infer<
  typeof upsertRelationshipInsightInputSchema
>;

/**
 * Helper: Map DB row → domain model.
 */
export function mapInsightRowToDomain(
  row: RelationshipInsightRow
): RelationshipInsight {
  return {
    id: row.id,
    relationshipId: row.relationship_id,
    insightType: row.insight_type,
    key: row.key,
    summary: row.summary,
    confidence: row.confidence,
    timesObserved: row.times_observed,
    lastObservedAt: row.last_observed_at,
    createdAt: row.created_at,
  };
}

/**
 * Helper: Map domain model → DB row.
 * Useful if you ever construct rows in code (e.g. for tests or batch jobs).
 */
export function mapInsightDomainToRow(
  insight: RelationshipInsight
): RelationshipInsightRow {
  return {
    id: insight.id,
    relationship_id: insight.relationshipId,
    insight_type: insight.insightType,
    key: insight.key,
    summary: insight.summary,
    confidence: insight.confidence,
    times_observed: insight.timesObserved,
    last_observed_at: insight.lastObservedAt,
    created_at: insight.createdAt,
  };
}

/**
 * Helper: Build a consistent insight key from mood + action.
 * You can expand this later with more dimensions if needed.
 *
 * Example:
 *  buildInsightKey("stressed", "action_video")  -> "stressed_action_video"
 */
export function buildInsightKey(
  userMood: string,
  actionType: string
): string {
  const safeMood = userMood.trim().toLowerCase().replace(/\s+/g, "_");
  const safeAction = actionType.trim().toLowerCase().replace(/\s+/g, "_");
  return `${safeMood}_${safeAction}`;
}

/**
 * Helper: Initialize a new insight from an upsert input
 * when there is no existing row for (relationshipId, key).
 */
export function createNewInsightFromInput(
  input: UpsertRelationshipInsightInput
): RelationshipInsight {
  const now = new Date().toISOString();
  const baseConfidence = input.confidenceDelta ?? 0.2; // starting point, tweak as desired

  return {
    id: crypto.randomUUID(),
    relationshipId: input.relationshipId,
    insightType: input.insightType,
    key: input.key,
    summary:
      input.summary ??
      "Behavioral pattern detected. (Summary should be generated later.)",
    confidence: Math.max(0, Math.min(1, baseConfidence)),
    timesObserved: 1,
    lastObservedAt: input.observedAt ?? now,
    createdAt: now,
  };
}

/**
 * Helper: Apply a new observation to an existing insight.
 * - increments timesObserved
 * - bumps confidence (with clamp)
 * - updates lastObservedAt
 */
export function applyObservationToInsight(
  existing: RelationshipInsight,
  input: UpsertRelationshipInsightInput
): RelationshipInsight {
  const now = input.observedAt ?? new Date().toISOString();
  const delta = input.confidenceDelta ?? 0.1; // default increment
  const newConfidence = Math.max(
    0,
    Math.min(1, existing.confidence + delta)
  );

  return {
    ...existing,
    confidence: newConfidence,
    timesObserved: existing.timesObserved + 1,
    lastObservedAt: now,
    summary:
      input.summary && input.summary.trim().length > 0
        ? input.summary
        : existing.summary,
  };
}
