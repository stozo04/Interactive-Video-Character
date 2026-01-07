// src/services/imageGenerationService.ts
/**
 * AI Image Generation Service for Companion "Selfies"
 *
 * Uses Gemini Imagen to generate contextual images of the AI companion
 * with character consistency via detailed prompts.
 *
 * MULTI-REFERENCE SYSTEM:
 * Dynamically selects reference images based on context (scene, mood, time, season)
 * with current look locking for 24h consistency and anti-repetition tracking.
 */

import { GoogleGenAI } from "@google/genai";
import { getCurrentLookState, lockCurrentLook, getRecentSelfieHistory, recordSelfieGeneration } from './imageGeneration/currentLookService';
import { detectTemporalContextLLMCached } from './imageGeneration/temporalDetection';
import {
  selectReferenceImage,
  getCurrentSeason,
  getTimeOfDay,
} from "./imageGeneration/referenceSelector";
import { getReferenceMetadata } from "../utils/referenceImages";
import type {
  ReferenceSelectionContext,
  ImagePromptContext,
  GeneratedImagePrompt,
} from "./imageGeneration/types";
import { generateImagePrompt } from "./imageGeneration/promptGenerator";
import { getActiveLoops, findRelevantOpinion } from "./presenceDirector";
import { getMoodAsync } from "./moodKnobs";
import { getCharacterFacts } from "./characterFactsService";
import { getUserFacts } from "./memoryService";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const IMAGEN_MODEL = "gemini-3-pro-image-preview";

// ============================================
// MAIN IMAGE GENERATION FUNCTION
// ============================================

export interface SelfieRequest {
  scene: string;
  mood?: string;
  outfitHint?: string;
  referenceImageBase64?: string; // Manual override (for backward compatibility)
  userMessage?: string; // User's message that triggered selfie
  conversationHistory?: Array<{ role: string; content: string }>; // Recent messages
  presenceOutfit?: string; // From presence_contexts table
  presenceMood?: string; // From presence_contexts table
  upcomingEvents?: Array<{ title: string; startTime: Date; isFormal: boolean }>; // From calendar

  // LLM-generated fields (calculated internally)
  llmScene?: string;
  llmLighting?: string;
  llmMood?: string;
  llmAdditional?: string;
}

export interface SelfieResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Generate a "selfie" image of the AI companion in a given scene
 */
export async function generateCompanionSelfie(
  request: SelfieRequest
): Promise<SelfieResult> {
  if (!GEMINI_API_KEY) {
    console.error("❌ [ImageGen] Missing VITE_GEMINI_API_KEY");
    return { success: false, error: "Image generation not configured" };
  }

  try {
    console.log("📸 [ImageGen] Generating selfie for scene:", request.scene);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // ====================================
    // MULTI-REFERENCE SYSTEM
    // ====================================
    let selectedReferenceBase64: string;
    let selectionReasoning: string[] = [];
    let selectedHairstyle: string = "unknown";
    let selectedOutfitStyle: string = "unknown";
    let selectedReferenceId: string = "legacy";
    let temporalContext: {
      isOldPhoto: boolean;
      referenceDate?: Date;
      temporalPhrases: string[];
    } = {
      isOldPhoto: false,
      temporalPhrases: [],
    };

    if (request.userMessage && request.conversationHistory) {
      console.log(
        "📸 [ImageGen] Using multi-reference system with dynamic selection"
      );

      try {
        // STEP 1: Get current look state
        const currentLookState = await getCurrentLookState();
        console.log("📸 [ImageGen] Current look state:", currentLookState);

        // STEP 2: Detect temporal context (old photo vs current)
        temporalContext = await detectTemporalContextLLMCached(
          request.scene,
          request.userMessage,
          request.conversationHistory
        );
        console.log("📸 [ImageGen] Temporal context:", temporalContext);

        // STEP 3: Get additional context for LLM prompt generation (Phase 2)
        // Run all context fetches in parallel for performance
        const [
          activeLoops,
          kayleyMood,
          characterFacts,
          userFactsRaw,
          relevantOpinion,
        ] = await Promise.all([
          getActiveLoops(),
          getMoodAsync(),
          getCharacterFacts(),
          getUserFacts("all"),
          request.userMessage
            ? findRelevantOpinion(request.userMessage)
            : Promise.resolve(undefined),
        ]);
        const userFacts = userFactsRaw.map(
          (f) => `${f.fact_key}: ${f.fact_value}`
        );

        // Map conversation history to expected role format
        const recentMessages = (request.conversationHistory || []).map((m) => ({
          role: m.role === "user" ? "user" : ("kayley" as "user" | "kayley"),
          content: m.content,
        }));

        // STEP 4: Generate creative image prompt using LLM
        const imagePromptContext: ImagePromptContext = {
          userRequest: request.userMessage || request.scene || "",
          explicitScene: request.scene,
          explicitMood: request.mood,
          recentMessages,
          activeLoops: activeLoops.map((l) => ({
            topic: l.topic,
            loopType: l.loopType,
          })),
          relevantOpinion: relevantOpinion
            ? {
                topic: relevantOpinion.topic,
                sentiment: relevantOpinion.sentiment,
              }
            : undefined,
          kayleyMood: { energy: kayleyMood.energy, warmth: kayleyMood.warmth },
          userFacts,
          characterFacts: characterFacts.map(
            (f) => `${f.fact_key}: ${f.fact_value}`
          ),
          isOldPhoto: temporalContext.isOldPhoto,
          temporalReference: temporalContext.temporalPhrases.join(", "),
          upcomingEvents: (request.upcomingEvents || []).map((e) => ({
            title: e.title,
            startTime: e.startTime,
          })),
          currentLookLock: currentLookState
            ? {
                hairstyle: currentLookState.hairstyle as any,
                outfit:
                  currentLookState.lockReason === "explicit_now_selfie"
                    ? "dressed_up"
                    : "casual", // Heuristic
              }
            : undefined,
        };

        const generatedPrompt = await generateImagePrompt(imagePromptContext);
        console.log("📸 [ImageGen] LLM Generated Prompt:", generatedPrompt);

        // STEP 5: Get recent selfie history for anti-repetition
        const recentHistory = await getRecentSelfieHistory(10);

        // STEP 6: Select reference image using multi-factor scoring (with LLM guidance)
        const selectionContext: ReferenceSelectionContext = {
          scene: request.scene,
          mood: request.mood,
          outfitHint: request.outfitHint,
          userMessage: request.userMessage,
          presenceOutfit: request.presenceOutfit,
          presenceMood: request.presenceMood,
          upcomingEvents: request.upcomingEvents || [],
          currentSeason: getCurrentSeason(),
          timeOfDay: getTimeOfDay(),
          currentLocation: null,
          currentLookState,
          temporalContext,
          recentReferenceHistory: recentHistory,
          llmGuidance: generatedPrompt,
        };

        const selection = selectReferenceImage(selectionContext);
        selectedReferenceBase64 = selection.base64Content;
        selectedReferenceId = selection.referenceId;
        selectionReasoning = selection.reasoning;

        const refMetadata = getRefMetadataFromId(selectedReferenceId);
        selectedHairstyle = refMetadata.hairstyle;
        selectedOutfitStyle = refMetadata.outfitStyle;

        // Use the LLM's narrative descriptions for the final Imagen call
        request.scene = generatedPrompt.sceneDescription;
        request.llmLighting = generatedPrompt.lightingDescription;
        request.llmMood = generatedPrompt.moodExpression;
        request.llmAdditional = generatedPrompt.additionalDetails;

        console.log("📸 [ImageGen] Selected reference:", selectedReferenceId);

        // STEP 7: Lock current look if this is a "now" photo
        if (
          !temporalContext.isOldPhoto &&
          (!currentLookState || new Date() > currentLookState.expiresAt)
        ) {
          await lockCurrentLook(
            selectedReferenceId,
            selectedHairstyle,
            "explicit_now_selfie",
            24 // Lock for 24 hours
          );
          console.log("📸 [ImageGen] Locked current look for 24h");
        }
      } catch (error) {
        console.error(
          "❌ [ImageGen] Error in multi-reference system, falling back to legacy:",
          error
        );
        // Fallback to legacy behavior
        selectedReferenceBase64 = request.referenceImageBase64;
      }
    }

    // ====================================
    // IMAGE GENERATION
    // ====================================

    // 1. Clean scene description - remove hairstyle TYPE mentions only (keep style variations like "in a bun")
    const cleanedScene = request.scene
      .replace(
        /with (perfectly |super |really )?(straight|curly|wavy) hair(?! (up|down|in a bun|in a ponytail))/gi,
        ""
      )
      .replace(/(straight|curly|wavy)[\s-]haired?/gi, "")
      .trim();

    // 2. Build the prompt
    // Use LLM-generated components
    const moodDescription = request.llmMood;
    const lightingDescription = request.llmLighting;
    const additionalDetails = request.llmAdditional || "";

    let fullPrompt = buildImagePrompt(
      cleanedScene,
      moodDescription,
      lightingDescription,
      additionalDetails
    );

    const parts: any[] = [];

    // 2. PREPARE REFERENCE IMAGE
    const cleanRef = cleanBase64(selectedReferenceBase64);

    if (cleanRef) {
      console.log("📸 [ImageGen] Attaching reference for style consistency");

      // Reference guidance: maintain face/hair from reference, vary outfit/pose/scene
      fullPrompt = `Use the provided reference image to match the woman's face, hairstyle, and overall look as closely as possible. ${fullPrompt}`;

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanRef,
        },
      });
    }

    parts.push({ text: fullPrompt });
    console.log("📸 [ImageGen] Full prompt text:", fullPrompt);

    // 3. Call Gemini 3 Pro

    const response = await ai.models.generateContent({
      model: IMAGEN_MODEL,
      contents: parts,
      config: {
        responseModalities: ["IMAGE"],

        // 1. Image specific configurations
        imageConfig: {
          aspectRatio: "9:16",
          imageSize: "2K",
          // Bypass the missing property in the current SDK types
          ...({ personGeneration: "allow_adult" } as any),
        },
      },
    });

    // 4. Parse Response
    const generatedPart = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData
    );

    if (!generatedPart?.inlineData?.data) {
      console.error("❌ [ImageGen] No image returned from Gemini");
      return { success: false, error: "No image generated" };
    }

    console.log("✅ [ImageGen] Selfie generated successfully!");

    // --- AUTO-SAVE TO LOCAL FILESYSTEM (Development only) ---
    try {
      fetch("/api/save-selfie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: generatedPart.inlineData.data,
          scene: request.scene,
        }),
      }).catch((e) =>
        console.warn(
          "📸 [ImageGen] Auto-save failed (expected if not in dev):",
          e
        )
      );
    } catch (e) {
      console.warn("📸 [ImageGen] Auto-save error:", e);
    }

    // ====================================
    // RECORD GENERATION IN HISTORY
    // ====================================

    try {
      await recordSelfieGeneration(
        selectedReferenceId,
        selectedHairstyle,
        selectedOutfitStyle,
        request.scene,
        request.mood,
        temporalContext.isOldPhoto,
        temporalContext.referenceDate,
        {
          reasoning: selectionReasoning,
          season: getCurrentSeason(),
          timeOfDay: getTimeOfDay(),
        }
      );
      console.log("📸 [ImageGen] Recorded generation in history");
    } catch (error) {
      console.error("❌ [ImageGen] Error recording generation:", error);
      // Non-fatal, continue
    }

    return {
      success: true,
      imageBase64: generatedPart.inlineData.data,
      mimeType: generatedPart.inlineData.mimeType || "image/png",
    };
  } catch (error: any) {
    console.error("❌ [ImageGen] Error generating selfie:", error);
    if (error?.message?.includes("SAFETY")) {
      return {
        success: false,
        error: "The image could not be generated due to content guidelines",
      };
    }
    return {
      success: false,
      error: error?.message || "Failed to generate image",
    };
  }
}

/**
 * Get reference metadata from ID (for recording hairstyle/outfit)
 */
function getRefMetadataFromId(referenceId: string): {
  hairstyle: string;
  outfitStyle: string;
} {
  const metadata = getReferenceMetadata(referenceId);

  if (metadata) {
    return {
      hairstyle: metadata.hairstyle,
      outfitStyle: metadata.outfitStyle,
    };
  }

  // Fallback: parse from reference ID (e.g., "curly_casual" -> hairstyle: "curly")
  const parts = referenceId.split("_");
  if (parts.length >= 2) {
    const hairstyle = parts[0]; // "curly", "straight", "messy"
    const outfit = parts[parts.length - 1]; // "casual", "dressed"

    return {
      hairstyle: hairstyle === "messy" ? "messy_bun" : hairstyle,
      outfitStyle: outfit === "up" ? "dressed_up" : outfit,
    };
  }

  // Last resort fallback - use curly casual as default
  console.warn(
    `[ImageGen] Could not determine metadata for ${referenceId}, using defaults`
  );
  return {
    hairstyle: "curly",
    outfitStyle: "casual",
  };
}

/**
 * Cleans a base64 string by removing data URI prefixes and newlines
 */
function cleanBase64(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/^data:image\/[a-z]+;base64,/, "") // Remove "data:image/xyz;base64," prefix
    .replace(/[\r\n\s]+/g, ""); // Remove newlines and spaces
}

export function base64ToDataUrl(
  base64: string,
  mimeType: string = "image/png"
): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Build the complete image generation prompt using a narrative structure.
 * Optimized for Gemini 3 Pro's natural language understanding.
 */
function buildImagePrompt(
  scene: string,
  moodDescription: string,
  lightingDescription: string,
  additionalDetails: string = ""
): string {
  return [
    `She is looking into the lens ${moodDescription}.`,
    `She is situated in ${scene}.`,
    `The lighting is ${lightingDescription}.`,
    additionalDetails ? `Note: ${additionalDetails}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}