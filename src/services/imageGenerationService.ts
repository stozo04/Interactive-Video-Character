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
import {
  getCurrentLookState,
  lockCurrentLook,
  getRecentSelfieHistory,
  recordSelfieGeneration,
} from "./imageGeneration/currentLookService";
import { detectTemporalContextLLMCached } from "./imageGeneration/temporalDetection";
import {
  selectReferenceImageForGemini,
  selectReferenceImageForGrok,
  getCurrentSeason,
  getTimeOfDay,
} from "./imageGeneration/referenceSelector";
import { getReferenceMetadata } from "../utils/referenceImages";
import type {
  ReferenceSelectionContext,
  ImagePromptContext,
  GeneratedImagePrompt,
  SeductionLevel,
  SkinExposure,
} from "./imageGeneration/types";
import { generateImagePrompt } from "./imageGeneration/promptGenerator";
import { getActiveLoops } from "./presenceDirector";
import { getMoodAsync } from "./moodKnobs";
import { getCharacterFacts } from "./characterFactsService";
import { getUserFacts } from "./memoryService";
import { generateImageEdit } from "@/utils/grokAPIUtils";
import { supabase } from "./supabaseClient";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_IMAGEN_MODEL = import.meta.env.VITE_GEMINI_IMAGEN_MODEL;
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_IMAGEN_MODEL = import.meta.env.VITE_GROK_IMAGEN_MODEL;
const IMAGE_GENERATOR_SERVICE = import.meta.env.VITE_IMAGE_GENERATOR_SERVICE;
const VIDEO_SELFIE_BUCKET = "Character-Images-For-Videos";
const LATEST_SELFIE_PUBLIC_URL_KEY = "latestSelfiePublicUrl";

// ============================================
// MAIN IMAGE GENERATION FUNCTION
// ============================================

export interface SelfieRequest {
  scene: string;
  mood?: string;
  outfit?: string;
  referenceImageBase64?: string; // Manual override (for backward compatibility)
  userMessage?: string; // User's message that triggered selfie
  conversationHistory?: Array<{ role: string; content: string }>; // Recent messages
  presenceOutfit?: string; // From presence_contexts table
  presenceMood?: string; // From presence_contexts table
  upcomingEvents?: Array<{ title: string; startTime: Date; isFormal: boolean }>; // From calendar
  forVideo?: boolean; // Upload selfie for video generation

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
  request: SelfieRequest,
): Promise<SelfieResult> {
  if (!GEMINI_API_KEY) {
    console.error("❌ [ImageGen] Missing VITE_GEMINI_API_KEY");
    return { success: false, error: "Image generation not configured" };
  }
  console.log("IMAGE_GENERATOR_SERVICE: ", IMAGE_GENERATOR_SERVICE);
  try {
    console.log("📸 [ImageGen] Generating selfie for scene:", request.scene);

    // ====================================
    // MULTI-REFERENCE SYSTEM
    // ====================================
    let selectedReferenceBase64: string;
    let selectedReferenceURL: string;
    let selectionReasoning: string[] = [];
    let selectedHairstyle: string = "unknown";
    let selectedOutfitStyle: string = "unknown";
    let selectedReferenceId: string = "legacy";
    let generatedPrompt: GeneratedImagePrompt;
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
        "📸 [ImageGen] Using multi-reference system with dynamic selection",
      );

      try {
        // STEP 1: Get current look state
        const currentLookState = await getCurrentLookState();
        console.log("📸 [ImageGen] Current look state:", currentLookState);

        // STEP 2: Detect temporal context (old photo vs current)
        temporalContext = await detectTemporalContextLLMCached(
          request.scene,
          request.userMessage,
          request.conversationHistory,
        );
        console.log("📸 [ImageGen] Temporal context:", temporalContext);

        // STEP 3: Get additional context for LLM prompt generation (Phase 2)
        // Run all context fetches in parallel for performance
        const [activeLoops, kayleyMood, characterFacts, userFactsRaw] =
          await Promise.all([
            getActiveLoops(),
            getMoodAsync(),
            getCharacterFacts(),
            getUserFacts("all"),
          ]);
        const userFacts = userFactsRaw.map(
          (f) => `${f.fact_key}: ${f.fact_value}`,
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
          kayleyMood: { energy: kayleyMood.energy, warmth: kayleyMood.warmth },
          userFacts,
          characterFacts: characterFacts.map(
            (f) => `${f.fact_key}: ${f.fact_value}`,
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

        generatedPrompt = await generateImagePrompt(imagePromptContext);
        console.log("📸 [ImageGen] LLM Generated Prompt:", generatedPrompt);
        // STEP 5: Get recent selfie history for anti-repetition
        const recentHistory = await getRecentSelfieHistory(10);
        console.log("Image GenerationService - request: ", request);
        // STEP 6: Select reference image using multi-factor scoring (with LLM guidance)
        const selectionContext: ReferenceSelectionContext = {
          scene: generatedPrompt.sceneDescription,
          mood: generatedPrompt.moodExpression,
          outfit: generatedPrompt.outfitContext.description,
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
        console.log(
          "generateCompanionSelfie: selectionContext: ",
          selectionContext,
        );

        let selection: any;
        if (IMAGE_GENERATOR_SERVICE === "gemini") {
          console.log("CALLING selectReferenceImageForGemini");
          selection = selectReferenceImageForGemini(selectionContext);
          console.log("selectReferenceImage: ", selection);
          selectedReferenceBase64 = selection.base64Content;
        } else {
          console.log("CALLING selectReferenceImageForGrok");
          selection = selectReferenceImageForGrok(selectionContext);
          console.log("selectReferenceImage: ", selection);
          selectedReferenceURL = selection.url;
        }
        selectedReferenceId = selection.referenceId;
        selectionReasoning = selection.reasoning;

        const refMetadata = getRefMetadataFromId(selectedReferenceId);
        console.log("getRefMetadataFromId: ", refMetadata);
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
            24, // Lock for 24 hours
          );
          console.log("📸 [ImageGen] Locked current look for 24h");
        }
      } catch (error) {
        console.error(
          "❌ [ImageGen] Error in multi-reference system, falling back to legacy:",
          error,
        );
        // Fallback to legacy behavior
        selectedReferenceBase64 = request.referenceImageBase64;
      }
    }

    // ====================================
    // IMAGE GENERATION
    // ====================================
    console.log("gates!!!!!!!!!!!!!!!!!!!!!!!!");
    console.log("generatedPrompt : ", generatedPrompt);

    let fullPrompt = `Use the provided reference image to match the woman's face, hairstyle, and overall look as closely as possible.`;
    fullPrompt += buildImagePrompt(
      generatedPrompt.sceneDescription,
      generatedPrompt.moodExpression,
      generatedPrompt.lightingDescription,
      generatedPrompt.outfitContext.description,
      generatedPrompt.outfitContext.style,
      generatedPrompt.seductionLevelGuidance.preference,
      generatedPrompt.skinExposuresGuidance.preference,
      generatedPrompt.additionalDetails,
    );

    const parts: any[] = [];

    // 2. PREPARE REFERENCE IMAGE

    if (IMAGE_GENERATOR_SERVICE === "gemini") {
      console.log("USING GEMINI FOR IMAGE GENERATION");
      const cleanRef = cleanBase64(selectedReferenceBase64);
      console.log("📸 [ImageGen] Attaching reference for style consistency");

      // Reference guidance: maintain face/hair from reference, vary outfit/pose/scene

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanRef,
        },
      });
      parts.push({ text: fullPrompt });

      // 3. Call Gemini 3 Pro
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: GEMINI_IMAGEN_MODEL,
        contents: parts,
        config: {
          responseModalities: ["IMAGE"],

          // 1. Image specific configurations
          imageConfig: {
            aspectRatio: "9:16",
            imageSize: "2K",
          },
        },
      });

      // 4. Parse Response
      const generatedPart = response.candidates?.[0]?.content?.parts?.find(
        (part) => part.inlineData,
      );

      if (!generatedPart?.inlineData?.data) {
        console.error("❌ [ImageGen] No image returned from Gemini");
        return { success: false, error: "No image generated" };
      }

      console.log("📸 [ImageGen] Full prompt text:", fullPrompt);

      console.log("✅ [ImageGen] Selfie generated successfully!");

      if (request.forVideo) {
        await uploadSelfieForVideo(
          generatedPart.inlineData.data,
          generatedPart.inlineData.mimeType || "image/png",
          request.scene,
        );
      }

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
            e,
          ),
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
          },
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
    } else {
      console.log("USING GROK FOR IMAGE GENERATION");
      const result = await generateImageEdit(GROK_API_KEY, {
        model: GROK_IMAGEN_MODEL,
        prompt: fullPrompt,
        image: {
          url: selectedReferenceURL, // Use the variable that actually holds the data
        },
        response_format: "b64_json",
      });

      console.log("Success! Image data received.", result);

      if (request.forVideo) {
        await uploadSelfieForVideo(
          result.data[0].b64_json,
          "image/png",
          request.scene,
        );
      }

      // --- AUTO-SAVE TO LOCAL FILESYSTEM (Development only) ---
      try {
        fetch("/api/save-selfie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: result.data[0].b64_json,
            scene: request.scene,
          }),
        }).catch((e) =>
          console.warn(
            "📸 [ImageGen] Auto-save failed (expected if not in dev):",
            e,
          ),
        );
      } catch (e) {
        console.warn("📸 [ImageGen] Auto-save error:", e);
      }

      // ====================================
      // RECORD GENERATION IN HISTORY
      // ====================================

      try {
        await recordSelfieGeneration(
          crypto.randomUUID(),
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
          },
        );
        console.log("📸 [ImageGen] Recorded generation in history");
      } catch (error) {
        console.error("❌ [ImageGen] Error recording generation:", error);
        // Non-fatal, continue
      }

      return {
        success: true,
        imageBase64: result.data[0].b64_json,
        mimeType: "image/png",
      };
    }
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
    `[ImageGen] Could not determine metadata for ${referenceId}, using defaults`,
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
  mimeType: string = "image/png",
): string {
  return `data:${mimeType};base64,${base64}`;
}

async function uploadSelfieForVideo(
  imageBase64: string,
  mimeType: string,
  scene?: string,
): Promise<void> {
  const cleaned = cleanBase64(imageBase64);
  if (!cleaned) {
    throw new Error("Empty selfie payload");
  }

  const bytes = atob(cleaned);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    buffer[i] = bytes.charCodeAt(i);
  }

  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeScene = scene
    ? scene.substring(0, 30).replace(/[^a-z0-9]/gi, "_").toLowerCase()
    : "selfie";
  const filePath = `selfies/selfie_${timestamp}_${safeScene}.${ext}`;

  console.log("📤 [ImageGen][SelfieUpload] Uploading selfie for video:", {
    bucket: VIDEO_SELFIE_BUCKET,
    filePath,
    mimeType,
  });

  const { error } = await supabase.storage
    .from(VIDEO_SELFIE_BUCKET)
    .upload(filePath, new Blob([buffer], { type: mimeType }), {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error("❌ [ImageGen][SelfieUpload] Upload failed:", error);
    throw new Error("Selfie upload failed");
  }

  const { data } = supabase.storage
    .from(VIDEO_SELFIE_BUCKET)
    .getPublicUrl(filePath);

  const publicUrl = data?.publicUrl;
  if (!publicUrl) {
    console.error("❌ [ImageGen][SelfieUpload] Missing public URL");
    throw new Error("Missing selfie public URL");
  }

  localStorage.setItem(LATEST_SELFIE_PUBLIC_URL_KEY, publicUrl);
  console.log("✅ [ImageGen][SelfieUpload] Stored latest selfie URL:", {
    publicUrl,
  });
}

/**
 * Build the complete image generation prompt using a narrative structure.
 * Optimized for Gemini 3 Pro's natural language understanding.
 */
function buildImagePrompt(
  scene: string,
  moodDescription: string,
  lightingDescription: string,
  outfitDescription: string,
  outfitStyle: string,
  seductionLevelGuidance: SeductionLevel,
  skinExposureGuidance: SkinExposure,
  additionalDetails: string = "",
): string {
  const seductionGuidanceMap: Record<SeductionLevel, string> = {
    innocent:
      "The overall vibe is soft, wholesome, and natural, with a relaxed and approachable presence.",
    playful:
      "The vibe is playful and lightly flirtatious, confident but casual, with a teasing warmth.",
    flirty:
      "The vibe is confidently flirty and alluring, drawing attention through posture, expression, and styling.",
    provocative:
      "The vibe is intentionally provocative and seductive, using implication, confidence, and subtle tension rather than explicit sexuality.",
    dangerously_elegant:
      "The vibe is dangerously elegant—refined, confident, and subtly scandalous, balancing luxury with a hint of forbidden allure.",
  };

  const skinExposureGuidanceMap: Record<SkinExposure, string> = {
    minimal:
      "The outfit is modest and fully covering, with no emphasis on exposed skin.",
    suggestive:
      "The outfit subtly highlights shape and form, with limited skin exposure such as collarbone, arms, or legs.",
    revealing:
      "The outfit is revealing in a tasteful way, showing legs, cleavage, midriff, or back while remaining fully clothed.",
    implied_only:
      "The outfit relies on implication rather than exposure—loose straps, sheer fabric, open silhouettes, or garments that appear to be shifting or falling naturally.",
  };

  return [
    `She is looking into the lens ${moodDescription}.`,
    `She is situated in ${scene}.`,
    `She is wearing ${outfitDescription}, in the style of ${outfitStyle}.`,
    seductionGuidanceMap[seductionLevelGuidance],
    skinExposureGuidanceMap[skinExposureGuidance],
    `The lighting is ${lightingDescription}.`,
    additionalDetails ? `Note: ${additionalDetails}` : "",
    `The image should feel like a real smartphone selfie, with natural imperfections such as slight grain, uneven lighting, or casual framing—not a studio or magazine photo.`,
  ]
    .filter(Boolean)
    .join(" ");
}
