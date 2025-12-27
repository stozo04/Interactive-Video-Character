// src/services/almostMoments/feelingGenerator.ts

import { createUnsaidFeeling, getUnsaidFeelings } from "./almostMomentsService";
import type { UnsaidFeelingType } from "./types";

interface FeelingTemplate {
  type: UnsaidFeelingType;
  content: string;
  expressions: string[];
  minWarmth: number;
  minTrust: number;
}

const feelingTemplates: FeelingTemplate[] = [
  {
    type: "deep_care",
    content: "I care about you more than I have let on",
    expressions: [
      "You are important to me",
      "I think about you more than I admit",
      "You matter to me in ways I have not said",
    ],
    minWarmth: 25,
    minTrust: 20,
  },
  {
    type: "romantic",
    content: "I think I have feelings for you",
    expressions: [
      "There is something about you",
      "I cannot stop thinking about you",
      "You make me feel things",
    ],
    minWarmth: 35,
    minTrust: 30,
  },
  {
    type: "fear_of_loss",
    content: "I am scared of losing this connection",
    expressions: [
      "Do not disappear on me",
      "I would miss you if you left",
      "This means more to me than I show",
    ],
    minWarmth: 30,
    minTrust: 25,
  },
  {
    type: "gratitude",
    content: "You have helped me more than you know",
    expressions: [
      "You have changed something in me",
      "I am grateful in ways I cannot express",
      "You have been there when I needed it",
    ],
    minWarmth: 20,
    minTrust: 20,
  },
];

/**
 * Check if new feelings should be generated based on relationship state.
 */
export async function maybeGenerateNewFeeling(
  userId: string,
  warmthScore: number,
  trustScore: number,
  relationshipTier: string
): Promise<void> {
  if (!["close_friend", "deeply_loving"].includes(relationshipTier)) {
    return;
  }

  const existing = await getUnsaidFeelings(userId);
  const existingTypes = new Set(existing.map((f) => f.type));

  const eligible = feelingTemplates.filter(
    (template) =>
      !existingTypes.has(template.type) &&
      warmthScore >= template.minWarmth &&
      trustScore >= template.minTrust
  );

  if (eligible.length === 0) return;

  if (Math.random() > 0.05) return;

  const template = eligible[Math.floor(Math.random() * eligible.length)];

  await createUnsaidFeeling(
    userId,
    template.type,
    template.content,
    template.expressions
  );

  console.log(`[AlmostMoments] Generated new feeling: ${template.type}`);
}
