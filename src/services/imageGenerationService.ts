// src/services/imageGenerationService.ts
/**
 * AI Image Generation Service for Companion "Selfies"
 * 
 * Uses Gemini Imagen to generate contextual images of the AI companion
 * with character consistency via detailed prompts.
 */

import { GoogleGenAI } from "@google/genai";
import referenceImageRaw from "../utils/base64.txt?raw";

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
    lips: "full and plump, naturally pigmented soft rose-pink, soft cupids bow",
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
 * Select an appropriate outfit based on the scene context
 */
// function selectOutfitForScene(scene: string, outfitHint?: string): string {
//   const sceneKeywords = scene.toLowerCase().split(/\s+/);

//   // If there's an outfit hint, try to match it first
//   if (outfitHint) {
//     const hintKeywords = outfitHint.toLowerCase().split(/\s+/);
//     for (const outfit of OUTFIT_OPTIONS) {
//       if (outfit.contexts.some((ctx) => hintKeywords.includes(ctx))) {
//         return outfit.description;
//       }
//     }
//   }

//   // Find the best matching outfit based on scene
//   let bestMatch: OutfitOption | null = null;
//   let bestScore = 0;

//   for (const outfit of OUTFIT_OPTIONS) {
//     const score = outfit.contexts.filter((ctx) =>
//       sceneKeywords.some(
//         (keyword) => keyword.includes(ctx) || ctx.includes(keyword)
//       )
//     ).length;

//     if (score > bestScore) {
//       bestScore = score;
//       bestMatch = outfit;
//     }
//   }

//   // If we found a match, use it; otherwise pick a random casual outfit
//   if (bestMatch && bestScore > 0) {
//     return bestMatch.description;
//   }

//   // Random selection from casual-appropriate outfits for variety
//   const casualOutfits = OUTFIT_OPTIONS.filter(
//     (o) => o.contexts.includes("casual") || o.contexts.includes("default")
//   );
//   return (
//     casualOutfits[Math.floor(Math.random() * casualOutfits.length)]
//       ?.description || OUTFIT_OPTIONS[0].description
//   );
// }

/**
 * Build a verbose, narrative mood/expression description
 * optimized for Gemini 3 Pro's understanding of micro-expressions.
 */
function buildMoodDescription(mood?: string): string {
  const moodMap: Record<string, string> = {
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
  referenceImageBase64?: string;
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

    // 1. Build the prompt
   // const outfit = selectOutfitForScene(request.scene, request.outfitHint);
    const moodDescription = buildMoodDescription(request.mood);
    let fullPrompt = buildImagePrompt(request.scene, "outfit", moodDescription);

    const parts: any[] = [];

    // 2. PREPARE REFERENCE IMAGE
    // Use the request override if provided, otherwise use the imported file
    const rawRef = request.referenceImageBase64 || referenceImageRaw;
    const cleanRef = cleanBase64(rawRef);

    if (cleanRef) {
      console.log("📸 [ImageGen] Attaching reference face for consistency");

      // Strong instruction for identity preservation
      fullPrompt = `Use the provided reference image to maintain the exact facial features and identity of the woman. ${fullPrompt}`;

      parts.push({
        inlineData: {
          mimeType: "image/jpeg", // Assuming your base64.txt is a JPEG. Change to 'image/png' if needed.
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
        imageConfig: {
          aspectRatio: "9:16",
          imageSize: "2K",
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
  // 1. Get the rich scene description
  const enhancedScene = getEnhancedScene(scene);

  // 2. Infer lighting (this still works great on top of the expansion)
  const lightingDescription = inferLightingAndAtmosphere(scene);

  const narrative = [
    `A high-resolution, photorealistic smartphone selfie taken by`,
    `${CHARACTER_VISUAL_IDENTITY.narrativeBase}.`,
    `She is looking into the camera ${moodDescription}.`,

    // The grammar is now safe: "She is situated in [a cozy upscale restaurant...]"
    `She is situated in ${enhancedScene}.`,

    `The lighting is ${lightingDescription}.`,
    `The image has a candid Instagram-story aesthetic with sharp focus on her eyes and a natural shallow depth of field blurring the background.`,
  ].join(" ");

  return narrative;
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
    home: "a bright, modern apartment living room with cozy textures and soft decor",
    bedroom: "a soft, aesthetic bedroom with fairy lights and neutral bedding",
    gym: "a modern, clean gym with high-end exercise equipment blurred in the background",
    park: "a lush green park with dappled sunlight filtering through the trees",
    office: "a minimalist home office with a clean white desk setup",
    kitchen:
      "a bright, modern kitchen featuring marble countertops and copper accents",
    pool: "a poolside lounge area with sparkling blue water and lounge chairs",
    concert:
      "a vibrant concert venue with colorful stage lights beaming in the background",
    car: "the passenger seat of a car with soft interior lighting",
    sunset:
      "an outdoor setting bathed in the warm orange and pink glow of golden hour",
    city: "a city rooftop overlooking a sprawling urban skyline",
    library: "a quiet library aisle surrounded by rows of books",
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

  // Default fallback
  return "soft, flattering natural lighting";
}



