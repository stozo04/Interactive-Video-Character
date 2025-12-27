// src/services/almostMoments/integrate.ts

import type { RelationshipMetrics } from "../relationshipService";
import {
  getUnsaidFeelings,
  shouldTriggerAlmostMoment,
  calculateStage,
} from "./almostMomentsService";
import { buildAlmostMomentsPrompt } from "./almostMomentsPromptBuilder";
import { maybeGenerateNewFeeling } from "./feelingGenerator";
import { generateAlmostExpression } from "./expressionGenerator";
import type { AlmostMomentContext, AlmostMomentStage } from "./types";

interface AlmostMomentIntegration {
  promptSection: string;
  shouldTrigger: boolean;
  suggestedExpression: string | null;
}

interface IntegrateOptions {
  conversationDepth: "surface" | "medium" | "deep" | "intimate";
  recentSweetMoment: boolean;
  vulnerabilityExchangeActive: boolean;
  allowGeneration?: boolean;
  now?: Date;
}

/**
 * Full integration for almost moments.
 */
export async function integrateAlmostMoments(
  userId: string,
  relationship: RelationshipMetrics,
  options: IntegrateOptions
): Promise<AlmostMomentIntegration> {
  const { allowGeneration = true, now = new Date() } = options;

  if (allowGeneration) {
    await maybeGenerateNewFeeling(
      userId,
      relationship.warmthScore,
      relationship.trustScore,
      relationship.relationshipTier
    );
  }

  const feelings = await getUnsaidFeelings(userId);

  if (feelings.length === 0) {
    return {
      promptSection: "",
      shouldTrigger: false,
      suggestedExpression: null,
    };
  }

  const primaryFeeling = feelings[0];
  const currentStage: AlmostMomentStage = calculateStage(
    primaryFeeling.intensity,
    primaryFeeling.suppressionCount
  );

  const hour = now.getHours();
  const lateNight = hour >= 22 || hour < 5;

  const context: AlmostMomentContext = {
    warmthScore: relationship.warmthScore,
    playfulnessScore: relationship.playfulnessScore,
    trustScore: relationship.trustScore,
    relationshipTier: relationship.relationshipTier,
    romanticTensionBuilding: feelings.some(
      (f) => f.type === "romantic" || f.type === "attraction"
    ),
    conversationDepth: options.conversationDepth,
    recentSweetMoment: options.recentSweetMoment,
    lateNightConversation: lateNight,
    vulnerabilityExchangeActive: options.vulnerabilityExchangeActive,
    totalAlmostMoments: feelings.reduce(
      (sum, feeling) => sum + feeling.suppressionCount,
      0
    ),
    lastAlmostMomentDate: primaryFeeling.lastAlmostMoment,
    currentStage,
    unsaidFeelings: feelings,
  };

  const promptSection = buildAlmostMomentsPrompt(context);

  const shouldTrigger = shouldTriggerAlmostMoment(context, primaryFeeling);
  let suggestedExpression: string | null = null;

  if (shouldTrigger) {
    const expression = generateAlmostExpression(primaryFeeling, currentStage);
    suggestedExpression = expression.text + (expression.followUp ? ` ${expression.followUp}` : "");
  }

  return {
    promptSection,
    shouldTrigger,
    suggestedExpression,
  };
}
