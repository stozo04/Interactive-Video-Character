// src/services/imageGeneration/referenceSelector.ts
// LLM guidance is the primary selection mechanism

import {
  ReferenceImageMetadata,
  ReferenceSelectionContext,
  HairstyleType,
  SeasonContext,
} from "./types";
import {
  REFERENCE_IMAGE_REGISTRY,
  getReferenceImageContent,
} from "../../utils/referenceImages";
import { shouldUnlockCurrentLook } from "./temporalDetection";

// ============================================
// DEBUG: Force a specific reference image
// Set to an image ID to bypass all selection logic
// Set to null for normal behavior
// ============================================
const DEBUG_FORCE_REFERENCE: string | null = null;
// Examples:
// const DEBUG_FORCE_REFERENCE = "slickback_bun_casual";
// const DEBUG_FORCE_REFERENCE = "athletic_ponytail";
// const DEBUG_FORCE_REFERENCE = "messy_bun_casual";

// Pattern constants for hairstyle detection (avoids magic strings)
const HAIRSTYLE_PATTERNS: Record<HairstyleType, string[]> = {
  straight: ['straight hair', 'straighten', 'straightened'],
  curly: ['curly hair', 'natural hair', 'with curls', 'curls'],
  waves: ['waves', 'wavy hair', 'beach waves'],
  heatless_curls: ['heatless curls', 'heatless curl', 'no-heat curls', 'no heat curls'],
  half_up: ['half up', 'half-up', 'half up half down', 'half-up half-down'],
  claw_clip: ['claw clip', 'clawclip', 'hair claw'],
  headband: ['headband', 'hairband'],
  dutch_braid: ['dutch braid', 'dutch braids', 'single dutch braid'],
  ponytail: ['ponytail', 'slick back ponytail', 'slickback ponytail'],
  messy_bun: ['bun', 'hair up', 'updo', 'messy bun', 'slick back bun', 'slickback bun'],
  styled_bun: ['styled bun', 'sleek bun', 'neat bun', 'formal bun'],
  bob: ['bob'],
};

function matchesPatterns(text: string, patterns: string[]): boolean {
  return patterns.some(p => text.includes(p));
}

function detectExplicitHairstyleRequest(context: ReferenceSelectionContext): {
  requested: boolean;
  hairstyle: HairstyleType | null;
  source: string;
} {
  const combinedContext = (
    context.scene +
    " " +
    (context.userMessage || "")
  ).toLowerCase();

  for (const [hairstyle, patterns] of Object.entries(HAIRSTYLE_PATTERNS)) {
    if (matchesPatterns(combinedContext, patterns)) {
      return {
        requested: true,
        hairstyle: hairstyle as HairstyleType,
        source: combinedContext,
      };
    }
  }
  return { requested: false, hairstyle: null, source: "" };
}

export function selectReferenceImage(context: ReferenceSelectionContext): {
  referenceId: string;
  base64Content: string;
  reasoning: string[];
} {
  const reasoning: string[] = [];

  // DEBUG: Force a specific reference image for testing
  if (DEBUG_FORCE_REFERENCE) {
    console.log("🔧 [DEBUG] Forcing reference:", DEBUG_FORCE_REFERENCE);
    const content = getReferenceImageContent(DEBUG_FORCE_REFERENCE);
    if (content) {
      reasoning.push("🔧 DEBUG: Forced reference " + DEBUG_FORCE_REFERENCE);
      return {
        referenceId: DEBUG_FORCE_REFERENCE,
        base64Content: content,
        reasoning,
      };
    }
    console.warn("🔧 [DEBUG] Reference not found:", DEBUG_FORCE_REFERENCE);
    reasoning.push(
      "🔧 DEBUG: Reference not found, falling back to normal selection"
    );
  }

  console.log("selectReferenceImage - context: ", context);
  const hairstyleRequest = detectExplicitHairstyleRequest(context);
  console.log("hairstyleRequest: ", hairstyleRequest);
  if (hairstyleRequest.requested && context.currentLookState) {
    if (hairstyleRequest.hairstyle !== context.currentLookState.hairstyle) {
      reasoning.push("🔓 EXPLICIT REQUEST: " + hairstyleRequest.hairstyle);
    }
  }

  const shouldBypassLock =
    hairstyleRequest.requested &&
    context.currentLookState &&
    hairstyleRequest.hairstyle !== context.currentLookState.hairstyle;
  console.log("shouldBypassLock: ", shouldBypassLock);
  const useLocked =
    !shouldBypassLock &&
    !shouldUnlockCurrentLook(context.temporalContext, context.currentLookState);
  console.log("useLocked: ", useLocked);
  if (useLocked && context.currentLookState) {
    reasoning.push("Using locked look: " + context.currentLookState.hairstyle);
    const content = getReferenceImageContent(
      context.currentLookState.referenceImageId
    );
    if (content) {
      console.log("returning:");
      console.log("referenceId: ", context.currentLookState.referenceImageId);
      return {
        referenceId: context.currentLookState.referenceImageId,
        base64Content: content,
        reasoning,
      };
    }
    reasoning.push("⚠️ Locked reference not found");
  }

  if (context.temporalContext.isOldPhoto) {
    reasoning.push("📅 OLD PHOTO detected");
  }

  console.log("REFERENCE_IMAGE_REGISTRY:", REFERENCE_IMAGE_REGISTRY);
  const scored = REFERENCE_IMAGE_REGISTRY.map((ref) => ({
    ref,
    score: scoreReference(ref, context, reasoning),
  }));

  applyAntiRepetitionPenalty(scored, context, reasoning);
  scored.sort((a, b) => b.score - a.score);

  const selected = scored[0];
  console.log("selected:", selected);
  reasoning.push(
    "🎯 SELECTED: " + selected.ref.id + " (" + selected.score.toFixed(0) + ")"
  );

  // Log the selected reference image details
  console.log(
    `📸 [ReferenceSelector] Selected image: ${selected.ref.id}`,
    `\n   Hairstyle: ${selected.ref.hairstyle}`,
    `\n   Outfit: ${selected.ref.outfitStyle}`,
    `\n   File: ${selected.ref.fileName}`,
    `\n   Score: ${selected.score.toFixed(0)}`
  );

  const content = getReferenceImageContent(selected.ref.id);
  console.log("content:", content);
  if (!content) throw new Error("Reference not found: " + selected.ref.id);

  return { referenceId: selected.ref.id, base64Content: content, reasoning };
}

function scoreReference(
  ref: ReferenceImageMetadata,
  context: ReferenceSelectionContext,
  reasoning: string[]
): number {
  let score = 0;
  const factors: string[] = [];

  if (context.llmGuidance) {
    const guidance = context.llmGuidance;

    if (guidance.hairstyleGuidance.preference !== "any") {
      if (ref.hairstyle === guidance.hairstyleGuidance.preference) {
        score += 40;
        factors.push("+40 hairstyle");
      } else {
        score -= 50;
        factors.push("-50 wrong hair");
      }
    }

    if (ref.outfitStyle === guidance.outfitContext.style) {
      score += 45;
      factors.push("+45 outfit");
    } else {
      score -= 30;
      factors.push("-30 wrong outfit");
    }
  }

  const combinedContext = (
    context.scene +
    " " +
    (context.userMessage || "")
  ).toLowerCase();
  for (const [hairstyle, patterns] of Object.entries(HAIRSTYLE_PATTERNS)) {
    if (
      matchesPatterns(combinedContext, patterns) &&
      ref.hairstyle === hairstyle
    ) {
      score += 80;
      factors.push("+80 explicit " + hairstyle);
      break;
    }
  }

  const nearbyFormalEvents = context.upcomingEvents.filter(
    (e) =>
      e.isFormal &&
      Math.abs(e.startTime.getTime() - Date.now()) < 2 * 60 * 60 * 1000
  );
  if (nearbyFormalEvents.length > 0 && ref.outfitStyle === "dressed_up") {
    score += 50;
    factors.push("+50 formal event");
  }

  score += Math.random() * 5;
  reasoning.push(
    "  " +
      ref.id +
      ": " +
      score.toFixed(0) +
      " (" +
      (factors.join(", ") || "base") +
      ")"
  );
  return score;
}

function applyAntiRepetitionPenalty(
  scored: Array<{ ref: ReferenceImageMetadata; score: number }>,
  context: ReferenceSelectionContext,
  reasoning: string[]
): void {
  const recentUses = context.recentReferenceHistory.slice(-10);
  for (const item of scored) {
    const uses = recentUses.filter((h) => h.referenceImageId === item.ref.id);
    if (uses.length === 0) continue;
    const mostRecent = uses[uses.length - 1];
    const hours = (Date.now() - mostRecent.usedAt.getTime()) / (60 * 60 * 1000);
    if (hours < 1 && mostRecent.scene === context.scene) continue;
    let penalty = hours < 6 ? 40 : hours < 24 ? 25 : hours < 72 ? 10 : 0;
    if (penalty > 0) {
      item.score -= penalty;
      reasoning.push("  " + item.ref.id + ": -" + penalty + " repetition");
    }
  }
}

export function getCurrentSeason(): SeasonContext {
  const month = new Date().getUTCMonth();
  if (month >= 11 || month <= 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  return "fall";
}

export function getTimeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getUTCHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}
