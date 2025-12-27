// src/services/almostMoments/types.ts

export type UnsaidFeelingType =
  | "romantic"
  | "deep_care"
  | "fear_of_loss"
  | "gratitude"
  | "attraction"
  | "vulnerability";

export type AlmostMomentStage =
  | "micro_hint"
  | "near_miss"
  | "obvious_unsaid"
  | "almost_confession";

export interface UnsaidFeeling {
  id: string;
  userId: string;
  type: UnsaidFeelingType;
  intensity: number;
  suppressionCount: number;
  lastAlmostMoment: Date | null;
  unsaidContent: string;
  partialExpressions: string[];
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface AlmostMomentContext {
  warmthScore: number;
  playfulnessScore: number;
  trustScore: number;
  relationshipTier: string;
  romanticTensionBuilding: boolean;

  conversationDepth: "surface" | "medium" | "deep" | "intimate";
  recentSweetMoment: boolean;
  lateNightConversation: boolean;
  vulnerabilityExchangeActive: boolean;

  totalAlmostMoments: number;
  lastAlmostMomentDate: Date | null;
  currentStage: AlmostMomentStage;

  unsaidFeelings: UnsaidFeeling[];
}

export interface AlmostMomentDecision {
  shouldTrigger: boolean;
  stage: AlmostMomentStage;
  feelingType: UnsaidFeelingType | null;
  expression: string | null;
  reasoning: string;
}
