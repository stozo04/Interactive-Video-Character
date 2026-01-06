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
import type { ReferenceSelectionContext } from "./imageGeneration/types";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const IMAGEN_MODEL = "gemini-3-pro-image-preview";

// ============================================
// CHARACTER VISUAL IDENTITY
// ============================================
// This is the core visual description used for ALL image generation
// to maintain character consistency across selfies.

const CHARACTER_VISUAL_IDENTITY = {
  // OPTIMIZED FOR GEMINI 3 PRO:
  // A cohesive narrative sentence used as the anchor for generation.
  // This replaces the old comma-separated 'basePrompt'.
  narrativeBase: `a photorealistic 23-year-old woman with a slender, fit build and light beige skin with warm undertones. She has a soft heart-shaped face defined by high cheekbones and a refined nose. Her most striking features are her large, almond-shaped sage-ocean blue eyes and full, rose-pink lips. She has extra long, voluminous dark chocolate brown hair (Type 2B/2C waves) that cascades past her shoulders to her mid-back`,

  // Detailed features for reference (optional usage in logic, but good to keep)
  face: {
    shape:
      "soft heart-shape with high cheekbones and gently tapered narrow chin",
    skinTone:
      "light-to-medium with warm neutral undertones, soft beige or light bisque",
    eyes: "large almond-shaped, striking clear bright blue or light green eyes, wide-set and bright",
    eyebrows: "natural medium-thickness with soft arch, dark cool brown",
    nose: "slender bridge with refined slightly soft button tip, proportional and straight",
    lips: "full and attractive, naturally pigmented soft rose-pink, soft cupids bow",
  },
  hair: {
    color:
      "deep espresso or dark chocolate brown, uniform without heavy highlights",
    length: "long, cascading well past shoulders to mid-back",
    texture:
      "loose voluminous curls and beach waves (Type 2B/2C), slightly tousled",
    style: "worn loose and down, framing the face",
    part: "slightly messy indefinite center part",
  },
  body: {
    ageAppearance: "early 20s (approx 20-24 years old)",
    build: "slender but fit/toned, petite to average height",
    distinctiveFeatures: "prominent collarbones",
  },
  aesthetic: {
    vibe: "natural, approachable, and warm, like a wholesome social media influencer",
    style: "casual chic, comfortable yet put-together",
  },
};

/**
 * Build a verbose, narrative mood/expression description
 * optimized for Gemini 3 Pro's understanding of micro-expressions.
 */
function buildMoodDescription(mood?: string): string {
  const moodMap: Record<string, string> = {
    // 😜 CANDID / SELFIE-STUFF
    smirk:
      "with a playful half-smirk and one eye squinting slightly as if reacting to the camera flash",
    casual:
      "with a relaxed, neutral expression and a soft gaze, avoiding a 'posed' look",
    cheeky:
      "sticking her tongue out slightly with a wink, mimicking a casual snap sent to a friend",

    // 😊 POSITIVE / WARM
    happy:
      "with a radiant, genuine smile that reaches her eyes, creating subtle crinkles at the corners and radiating warmth",
    smiling:
      "flashing a bright, friendly smile that shows a hint of teeth, looking approachable and kind",
    excited:
      "with wide, sparkling eyes and an enthusiastic, open-mouthed smile, looking eager and energetic",
    laughing:
      "caught in a candid moment of genuine laughter, head tilted back slightly with eyes squinted in joy",

    // 😏 PLAYFUL / FLIRTY
    playful:
      "flashing a mischievous smirk with one eyebrow slightly raised, giving the camera a teasing, fun look",
    flirty:
      "giving a coy look through her lashes with a subtle, knowing smile playing on her lips and head tilted slightly down",
    cute: "tilting her head to the side with a sweet, endearing smile and wide, innocent eyes",
    wink: "giving a playful wink with a cheeky grin, looking directly at the viewer",

    // 😌 CALM / RELAXED
    relaxed:
      "wearing a soft, peaceful expression with softened eyes and loose shoulders, exuding total calm",
    cozy: "with a gentle, content smile and heavy-lidded, relaxed eyes, looking completely at ease and comfortable",
    thoughtful:
      "gazing softly into the lens with a contemplative, gentle expression and lips slightly parted",
    tired:
      'with a sleepy, soft expression and heavy eyelids, giving a cute "just woke up" vibe',

    // 😐 SERIOUS / INTENSE
    confident:
      "with a direct, unwavering gaze and a small, assured half-smile, radiating self-possession and cool",
    serious:
      "with an intense, focused gaze and a neutral but soft expression, looking deeply engaged",
    surprised:
      'with a look of pleasant surprise, eyes slightly widened and lips forming a small "o" shape',
  };

  if (mood) {
    const normalizedMood = mood.toLowerCase();
    for (const [key, description] of Object.entries(moodMap)) {
      if (normalizedMood.includes(key)) {
        return description;
      }
    }
  }

  // Default fallback: generic but descriptive
  return "with a warm, friendly smile and direct eye contact";
}
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

        // STEP 3: Get recent selfie history for anti-repetition
        const recentHistory = await getRecentSelfieHistory(10);

        // STEP 4: Build reference selection context
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
          currentLocation: null, // TODO: Add location tracking if available
          currentLookState,
          temporalContext,
          recentReferenceHistory: recentHistory,
        };

        // STEP 5: Select reference image using multi-factor scoring
        const selection = selectReferenceImage(selectionContext);
        selectedReferenceBase64 = selection.base64Content;
        selectedReferenceId = selection.referenceId;
        selectionReasoning = selection.reasoning;

        // Extract hairstyle and outfit from metadata (need to parse from registry)
        const refMetadata = getRefMetadataFromId(selectedReferenceId);
        selectedHairstyle = refMetadata.hairstyle;
        selectedOutfitStyle = refMetadata.outfitStyle;

        console.log("📸 [ImageGen] Selected reference:", selectedReferenceId);
        console.log("📸 [ImageGen] Selection reasoning:", selectionReasoning);

        // STEP 6: Lock current look if this is a "now" photo and no lock exists or expired
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
        selectedReferenceBase64 =          request.referenceImageBase64;
      }
    } else {
      // Legacy behavior: use manual override or default reference
      console.log(
        "📸 !!!!!!!!!!!!!!!  [ImageGen] Using legacy single reference"
      );
      selectedReferenceBase64 =request.referenceImageBase64;
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
    const moodDescription = buildMoodDescription(request.mood);
    let fullPrompt = buildImagePrompt(cleanedScene, "outfit", moodDescription);

    const parts: any[] = [];

    // 2. PREPARE REFERENCE IMAGE
    const cleanRef = cleanBase64(selectedReferenceBase64);

    if (cleanRef) {
      console.log("📸 [ImageGen] Attaching reference for style consistency");

      // Reference guidance: maintain face/hair from reference, vary outfit/pose/scene
      fullPrompt = `Use the provided reference image to match the woman's face, hairstyle, and overall look as closely as possible. Allow for different outfits, poses, and scenes as described in the prompt. ${fullPrompt}`;

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
  outfitDescription: string,
  moodDescription: string
): string {
  const enhancedScene = getEnhancedScene(scene);
  const lightingDescription = inferLightingAndAtmosphere(scene);

  // Logic to detect "Home" scenes for extra realism
  const isCasualScene = scene.match(
    /(home|bedroom|kitchen|morning|bed|couch|night)/i
  );

  // A. PERSPECTIVE: Mirror selfie vs. Direct selfie
  // Note: Phone is implied by the arm position, not shown in frame
  const perspective = isCasualScene
    ? "A casual mirror selfie taken in a bedroom mirror."
    : "A handheld smartphone selfie with a slight hand-held tilt.";

  // B. TEXTURE: Force Gemini to stop the "AI airbrushing"
  const skinAndHair = isCasualScene
    ? "Natural, unposed look. Visible skin texture with pores and minor freckles. Her hair is unstyled, slightly messy, and tousled."
    : "Candid look with sharp focus on her eyes and a natural shallow depth of field.";

  // C. CAMERA ARTIFACTS: Mimic a real phone sensor
  const cameraVibe = isCasualScene
    ? "Low-fidelity smartphone photo, subtle image grain, slight motion blur, and realistic indoor sensor noise."
    : "A high-resolution smartphone story aesthetic.";

  // D. DYNAMIC OVERRIDES: Handle scenes that contradict standard "No Phone" rules
  const involvesShowingPhone = scene.toLowerCase().includes('on my phone') || 
                               scene.toLowerCase().includes('showing a photo') ||
                               scene.toLowerCase().includes('screen');

  const handAndPhoneConstraint = involvesShowingPhone
    ? "She is holding her phone toward the camera to show the screen, with her other hand visible or holding the device. High focus on the screen content. Note: It is okay to see the phone/screen in this specific scene."
    : "She is taking a selfie with one arm extended toward the camera, cropped at the edge of the frame. Her other arm rests naturally at her side or on her hip. CRITICAL: Only two arms total, no phone visible in frame.";

  return [
    perspective,
    `She is looking into the lens ${moodDescription}.`,
    `She is situated in ${enhancedScene}.`,
    `The lighting is ${lightingDescription}.`,
    skinAndHair,
    cameraVibe,
    handAndPhoneConstraint,
  ].join(" ");
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Expands simple scene keywords into rich, narrative setting descriptions.
 * Returns a string compatible with "She is situated in [DESCRIPTION]."
 */
function getEnhancedScene(scene: string): string {
  const lowerScene = scene.toLowerCase().trim();

  // Richer descriptions for common scenes
  const expansions: Record<string, string> = {
    restaurant:
      "a cozy upscale restaurant booth with elegant decor visible in the background",
    beach: "a scenic sandy beach with ocean waves crashing in the distance",
    coffee:
      "a trendy aesthetic coffee shop with exposed brick walls and lush plants",
    cafe: "a warm, inviting cafe with a pastry display case in the background",
    gym: "a modern, clean gym with high-end exercise equipment blurred in the background",
    park: "a lush green park with dappled sunlight filtering through the trees",
    office: "a minimalist home office with a clean white desk setup",
    pool: "a poolside lounge area with sparkling blue water and lounge chairs",
    concert:
      "a vibrant concert venue with colorful stage lights beaming in the background",
    car: "the passenger seat of a car with soft interior lighting",
    sunset:
      "an outdoor setting bathed in the warm orange and pink glow of golden hour",
    city: "a city rooftop overlooking a sprawling urban skyline",
    library: "a quiet library aisle surrounded by rows of books",
    home: "a lived-in apartment living room with a slightly messy couch and warm, natural light",
    bedroom:
      "a cozy, unmade bed with soft pillows and warm ambient lamp light in the background",
    kitchen:
      "a real domestic kitchen with morning light hitting the counter and a coffee maker visible",
    morning: "a soft-focus bedroom at dawn, looking cozy and slightly groggy",
  };

  // 1. Check for a direct keyword match
  for (const [key, description] of Object.entries(expansions)) {
    if (lowerScene.includes(key)) {
      return description;
    }
  }

  // 2. Fallback: Clean up the raw input if no match found
  // Remove prepositions so it fits "situated in..."
  let clean = lowerScene.replace(/^(at |in |on |the )/i, "");

  // Ensure it starts with an article
  if (!clean.match(/^(a |an |the |my )/i)) {
    clean = `a ${clean}`;
  }

  return clean;
}

/**
 * Infers realistic lighting and atmosphere based on keywords in the scene.
 * This grounds the character in the image so they don't look "pasted on".
 */
function inferLightingAndAtmosphere(scene: string): string {
  const s = scene.toLowerCase();

  // 🌙 NIGHT / EVENING
  if (s.match(/(night|evening|party|bar|club|dinner|movie|bed|sleep)/)) {
    return "dim, atmospheric ambient lighting with soft shadows and perhaps a warm glow from nearby lamps or neon signs";
  }

  // ☀️ SUNNY / OUTDOORS
  if (s.match(/(beach|park|hike|walk|sun|outside|garden|pool|vacation)/)) {
    return "bright, golden-hour natural sunlight casting soft, flattering shadows on her face";
  }

  // 🏠 INDOOR / COZY
  if (s.match(/(home|couch|sofa|kitchen|living|reading|book|coffee|cafe)/)) {
    return "soft, diffused window light mixed with warm interior lighting";
  }

  // 🏢 ARTIFICIAL / NEUTRAL
  if (s.match(/(gym|work|office|library|store|shop|mall)/)) {
    return "clean, bright overhead lighting";
  }

  // FLASH PHOTOGRAPHY (For that "party" or "night at home" look)
  if (s.match(/(night|dark|club|bar|late)/)) {
    return "harsh smartphone camera flash lighting, high contrast, casting a sharp shadow behind her, creating a raw candid vibe";
  }

  // LIVED-IN INDOOR LIGHT
  if (s.match(/(home|bedroom|couch|kitchen)/)) {
    return "soft, uneven window light mixed with warm, dim lamp light in the background";
  }

  // Default fallback
  return "soft, flattering natural lighting";
}



