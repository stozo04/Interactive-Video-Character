// src/services/imageGeneration/referenceSelector.ts

import {
  ReferenceImageMetadata,
  ReferenceSelectionContext,
  SeasonContext,
} from './types';
import {
  REFERENCE_IMAGE_REGISTRY,
  getReferenceImageContent,
} from "../../utils/referenceImages";
import { shouldUnlockCurrentLook } from "./temporalDetection";

/**
 * Detect explicit hairstyle request from context
 */
function detectExplicitHairstyleRequest(context: ReferenceSelectionContext): {
  requested: boolean;
  hairstyle: "straight" | "curly" | "messy_bun" | null;
  source: string;
} {
  const sceneLower = context.scene.toLowerCase();
  const userMessageLower = (context.userMessage || "").toLowerCase();
  const combinedContext = `${sceneLower} ${userMessageLower}`;

  if (
    combinedContext.includes("straight hair") ||
    combinedContext.includes("straighten")
  ) {
    return { requested: true, hairstyle: "straight", source: combinedContext };
  }
  if (
    combinedContext.includes("curly hair") ||
    combinedContext.includes("natural hair") ||
    combinedContext.includes("with curls")
  ) {
    return { requested: true, hairstyle: "curly", source: combinedContext };
  }
  if (combinedContext.includes("bun") || combinedContext.includes("hair up")) {
    return { requested: true, hairstyle: "messy_bun", source: combinedContext };
  }

  return { requested: false, hairstyle: null, source: "" };
}

/**
 * Select the best reference image for the given context
 */
export function selectReferenceImage(context: ReferenceSelectionContext): {
  referenceId: string;
  base64Content: string;
  reasoning: string[];
} {
  const reasoning: string[] = [];

  // 🧪 DEBUG: Uncomment to force a specific reference for testing
  const TEST_REFERENCE_ID = "curly_casual_smile"; // Change to the ID you want to test
  const testContent = getReferenceImageContent(TEST_REFERENCE_ID);
  if (testContent) {
    console.log("🧪 [DEBUG] Forcing reference:", TEST_REFERENCE_ID);
    return {
      referenceId: TEST_REFERENCE_ID,
      base64Content: testContent,
      reasoning: ["DEBUG: Forced reference"],
    };
  }

  // DEBUG: Log presence state usage in scoring
  if (context.presenceOutfit || context.presenceMood) {
    console.log("🎯 [Reference Selector] Using Presence State:", {
      outfit: context.presenceOutfit,
      mood: context.presenceMood,
    });
  }

  // STEP 0: Check for explicit hairstyle request (takes priority over locked look)
  const hairstyleRequest = detectExplicitHairstyleRequest(context);
  if (hairstyleRequest.requested && context.currentLookState) {
    // Check if user is requesting a DIFFERENT hairstyle than what's locked
    const lockedHairstyle = context.currentLookState.hairstyle;
    if (hairstyleRequest.hairstyle !== lockedHairstyle) {
      reasoning.push(
        `🔓 EXPLICIT HAIRSTYLE REQUEST: User wants ${hairstyleRequest.hairstyle}, bypassing locked look (${lockedHairstyle})`
      );
      reasoning.push(
        `Request detected in: "${hairstyleRequest.source.substring(0, 50)}..."`
      );
      // Skip locked look check - fall through to normal selection
    }
  }

  // STEP 1: Check if we should use locked current look (unless explicit hairstyle request overrides)
  const shouldBypassLock =
    hairstyleRequest.requested &&
    context.currentLookState &&
    hairstyleRequest.hairstyle !== context.currentLookState.hairstyle;

  const useLocked =
    !shouldBypassLock &&
    !shouldUnlockCurrentLook(context.temporalContext, context.currentLookState);

  if (useLocked && context.currentLookState) {
    reasoning.push(
      `Using locked current look: ${context.currentLookState.hairstyle}`
    );
    reasoning.push(
      `Locked at: ${context.currentLookState.lockedAt.toLocaleString()}`
    );
    reasoning.push(`Reason: ${context.currentLookState.lockReason}`);

    const content = getReferenceImageContent(
      context.currentLookState.referenceImageId
    );
    if (content) {
      return {
        referenceId: context.currentLookState.referenceImageId,
        base64Content: content,
        reasoning,
      };
    } else {
      reasoning.push(
        "⚠️ Locked reference not found, falling through to selection"
      );
    }
  }

  if (context.temporalContext.isOldPhoto) {
    reasoning.push(
      `📅 OLD PHOTO DETECTED: ${context.temporalContext.temporalPhrases.join(
        ", "
      )}`
    );
    reasoning.push("Allowing different hairstyle from current look");
  }

  // STEP 2: Score all references
  const scored = REFERENCE_IMAGE_REGISTRY.map((ref) => ({
    ref,
    score: scoreReference(ref, context, reasoning),
  }));

  // STEP 3: Apply anti-repetition penalty
  applyAntiRepetitionPenalty(scored, context, reasoning);

  // STEP 4: Sort by score and select top candidate
  scored.sort((a, b) => b.score - a.score);

  const selected = scored[0];
  reasoning.push(
    `\n🎯 SELECTED: ${selected.ref.id} (score: ${selected.score.toFixed(2)})`
  );

  const content = getReferenceImageContent(selected.ref.id);
  if (!content) {
    throw new Error(`Reference image content not found for ${selected.ref.id}`);
  }

  return {
    referenceId: selected.ref.id,
    base64Content: content,
    reasoning,
  };
}

/**
 * Score a reference image based on context
 */
function scoreReference(
  ref: ReferenceImageMetadata,
  context: ReferenceSelectionContext,
  reasoning: string[]
): number {
  let score = ref.baseFrequency * 100; // Start with base frequency
  const factors: string[] = [];

  // FACTOR 1: Scene suitability
  const sceneLower = context.scene.toLowerCase();
  const matchingSuitableScenes = ref.suitableScenes.filter(s =>
    sceneLower.includes(s) || s.includes(sceneLower)
  );
  const matchingUnsuitableScenes = ref.unsuitableScenes.filter(s =>
    sceneLower.includes(s) || s.includes(sceneLower)
  );

  if (matchingSuitableScenes.length > 0) {
    score += 30;
    factors.push(`+30 scene match (${matchingSuitableScenes.join(', ')})`);
  }
  if (matchingUnsuitableScenes.length > 0) {
    score -= 50;
    factors.push(`-50 unsuitable scene (${matchingUnsuitableScenes.join(', ')})`);
  }

  // FACTOR 2: Mood affinity
  if (context.mood) {
    const moodKey = normalizeMoodToAffinityKey(context.mood);
    if (moodKey && ref.moodAffinity[moodKey] !== undefined) {
      const moodScore = ref.moodAffinity[moodKey] * 20;
      score += moodScore;
      factors.push(`+${moodScore.toFixed(1)} mood (${moodKey}: ${ref.moodAffinity[moodKey]})`);
    }
  }

  // FACTOR 3: Time of day
  const timeScore = ref.timeOfDay[context.timeOfDay] * 15;
  score += timeScore;
  factors.push(`+${timeScore.toFixed(1)} time (${context.timeOfDay})`);

  // FACTOR 4: Season appropriateness
  if (ref.suitableSeasons.includes(context.currentSeason)) {
    score += 10;
    factors.push(`+10 season (${context.currentSeason})`);
  } else {
    score -= 15;
    factors.push(`-15 wrong season (${context.currentSeason})`);
  }

  // FACTOR 5: Outfit hint from context
  if (context.outfitHint) {
    const hintLower = context.outfitHint.toLowerCase();
    if (
      (hintLower.includes('dress') || hintLower.includes('nice') || hintLower.includes('formal')) &&
      ref.outfitStyle === 'dressed_up'
    ) {
      score += 25;
      factors.push('+25 outfit hint match (dressed up)');
    } else if (
      (hintLower.includes('casual') || hintLower.includes('comfy')) &&
      ref.outfitStyle === 'casual'
    ) {
      score += 15;
      factors.push('+15 outfit hint match (casual)');
    }
  }

  // FACTOR 6: Presence outfit context
  if (context.presenceOutfit) {
    const presenceLower = context.presenceOutfit.toLowerCase();
    if (presenceLower.includes('gym') && ref.hairstyle === 'messy_bun') {
      score += 30;
      factors.push('+30 presence match (gym → messy bun)');
    }
    if (
      (presenceLower.includes('dress') || presenceLower.includes('getting ready')) &&
      ref.outfitStyle === 'dressed_up'
    ) {
      score += 25;
      factors.push('+25 presence match (getting ready → dressed up)');
    }
  }

  // FACTOR 7: Calendar events
  const nearbyFormalEvents = context.upcomingEvents.filter(e =>
    e.isFormal && Math.abs(e.startTime.getTime() - Date.now()) < 2 * 60 * 60 * 1000
  );
  if (nearbyFormalEvents.length > 0 && ref.outfitStyle === 'dressed_up') {
    score += 60; // Strong boost to override base frequency and scene mismatch
    factors.push(`+60 nearby formal event (${nearbyFormalEvents[0].title})`);
  }

  // FACTOR 8: Explicit hairstyle request from scene/context OR user message
  const sceneLowerForHair = context.scene.toLowerCase();
  const userMessageLower = (context.userMessage || '').toLowerCase();
  const combinedContext = `${sceneLowerForHair} ${userMessageLower}`;

  // Check for combined requests (e.g., "straight hair in a bun")
  const hasStraightRequest = combinedContext.includes('straight hair') || combinedContext.includes('straighten');
  const hasCurlyRequest = combinedContext.includes('curly hair') || combinedContext.includes('natural hair') || combinedContext.includes('with curls');
  const hasBunRequest = combinedContext.includes('bun') || combinedContext.includes('hair up') || combinedContext.includes('in a ponytail');

  // Handle "straight hair in a bun" - boost straight_bun_casual
  if (hasStraightRequest && hasBunRequest) {
    if (ref.id.includes('straight') && ref.id.includes('bun')) {
      score += 120; // Extra boost for matching both criteria
      factors.push('+120 straight hair in bun (combined match)');
    } else if (ref.hairstyle === 'straight') {
      score += 50; // Partial boost for straight hair down
      factors.push('+50 straight hair (partial match, wants bun)');
    } else if (ref.hairstyle === 'curly') {
      score -= 80;
      factors.push('-80 curly hair (user wants straight in bun)');
    }
  }
  // Handle regular straight hair request
  else if (hasStraightRequest) {
    if (ref.hairstyle === 'straight') {
      score += 100;
      factors.push('+100 explicit straight hair request');
    } else if (ref.hairstyle === 'curly') {
      score -= 80;
      factors.push('-80 curly hair (user wants straight)');
    }
  }
  // Handle curly hair request
  else if (hasCurlyRequest) {
    if (ref.hairstyle === 'curly') {
      score += 100;
      factors.push('+100 explicit curly hair request');
    } else if (ref.hairstyle === 'straight') {
      score -= 80;
      factors.push('-80 straight hair (user wants curly)');
    }
  }
  // Handle bun/updo request alone
  else if (hasBunRequest) {
    if (ref.hairstyle === 'messy_bun') {
      score += 80;
      factors.push('+80 explicit bun/updo request');
    }
  }

  reasoning.push(`  ${ref.id}: ${score.toFixed(1)} (${factors.join(', ')})`);

  return score;
}

/**
 * Apply penalty for recently used references (soft cooldown)
 */
function applyAntiRepetitionPenalty(
  scored: Array<{ ref: ReferenceImageMetadata; score: number }>,
  context: ReferenceSelectionContext,
  reasoning: string[]
): void {
  const recentUses = context.recentReferenceHistory.slice(-10); // Last 10 selfies

  for (const item of scored) {
    const uses = recentUses.filter(h => h.referenceImageId === item.ref.id);

    if (uses.length === 0) continue;

    const mostRecent = uses[uses.length - 1];
    const hoursSinceUse = (Date.now() - mostRecent.usedAt.getTime()) / (60 * 60 * 1000);

    // EXCEPTION: If same scene within same conversation (< 1 hour), NO penalty
    // This handles "take another selfie at the same cafe" gracefully
    if (hoursSinceUse < 1 && mostRecent.scene === context.scene) {
      reasoning.push(`  ${item.ref.id}: No penalty (same scene, same session)`);
      continue;
    }

    // PENALTY: Recently used
    let penalty = 0;
    if (hoursSinceUse < 6) {
      penalty = 40; // Heavy penalty within 6 hours
    } else if (hoursSinceUse < 24) {
      penalty = 25; // Medium penalty within a day
    } else if (hoursSinceUse < 72) {
      penalty = 10; // Light penalty within 3 days
    }

    if (penalty > 0) {
      item.score -= penalty;
      reasoning.push(`  ${item.ref.id}: -${penalty} repetition penalty (used ${hoursSinceUse.toFixed(1)}h ago)`);
    }
  }
}

/**
 * Normalize mood string to mood affinity key
 */
function normalizeMoodToAffinityKey(
  mood: string
): 'playful' | 'confident' | 'relaxed' | 'excited' | 'flirty' | null {
  const moodLower = mood.toLowerCase();

  if (moodLower.includes('playful') || moodLower.includes('fun')) return 'playful';
  if (moodLower.includes('confident') || moodLower.includes('assured')) return 'confident';
  if (moodLower.includes('relax') || moodLower.includes('calm') || moodLower.includes('cozy')) return 'relaxed';
  if (moodLower.includes('excit') || moodLower.includes('energetic')) return 'excited';
  if (moodLower.includes('flirt') || moodLower.includes('coy')) return 'flirty';

  return null;
}

/**
 * Get current season based on month
 */
export function getCurrentSeason(): SeasonContext {
  const month = new Date().getMonth(); // 0-11

  if (month >= 11 || month <= 1) return 'winter'; // Dec, Jan, Feb
  if (month >= 2 && month <= 4) return 'spring';  // Mar, Apr, May
  if (month >= 5 && month <= 7) return 'summer';  // Jun, Jul, Aug
  return 'fall'; // Sep, Oct, Nov
}

/**
 * Get time of day category
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
