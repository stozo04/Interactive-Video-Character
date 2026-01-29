// src/services/grokVideoGenerationService.ts
/**
 * AI Video Generation Service for Companion Videos
 *
 * Uses Grok's video generation API to create contextual videos of the AI companion
 * with character consistency via reference images.
 *
 * Flow:
 * 1. Gather context (mood, chat history, events, facts)
 * 2. Generate creative video prompt using Gemini Flash (with motion + camera directions)
 * 3. Select appropriate reference image for character consistency
 * 4. Call Grok video API (image-to-video) with the prompt
 * 5. Poll until complete and return video URL
 */

import { GoogleGenAI } from "@google/genai";
import {
  getCurrentLookState,
  lockCurrentLook,
} from "./imageGeneration/currentLookService";
import {
  selectReferenceImageForGrok,
  getCurrentSeason,
  getTimeOfDay,
} from "./imageGeneration/referenceSelector";
import { getReferenceMetadata } from "../utils/referenceImages";
import type {
  ReferenceSelectionContext,
  SeductionLevel,
  SkinExposure,
  HairstyleType,
  OutfitStyle,
} from "./imageGeneration/types";
import { getActiveLoops } from "./presenceDirector";
import { getMoodAsync } from "./moodKnobs";
import { getCharacterFacts } from "./characterFactsService";
import { getUserFacts } from "./memoryService";

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_VIDEO_MODEL = "grok-imagine-video";
const FLASH_MODEL = "gemini-3-flash-preview";
const XAI_API_BASE = "https://api.x.ai/v1";

// Video generation defaults
const DEFAULT_DURATION = 8; // seconds
const DEFAULT_ASPECT_RATIO = "9:16" as const; // Portrait for mobile
const DEFAULT_RESOLUTION = "720p" as const; // Grok only supports 480p or 720p
const POLL_INTERVAL_MS = 10000; // 10 seconds
const MAX_WAIT_SECONDS = 300; // 5 minutes

// ============================================
// TYPE DEFINITIONS
// ============================================

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
export type VideoResolution = "480p" | "720p"; // Grok only supports these two

export interface VideoRequest {
  scene: string;
  mood?: string;
  outfit?: string;
  userMessage?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  presenceOutfit?: string;
  presenceMood?: string;
  upcomingEvents?: Array<{ title: string; startTime: Date; isFormal: boolean }>;

  // Video-specific options
  duration?: number;
  aspectRatio?: AspectRatio;
  resolution?: VideoResolution;
}

export interface VideoResult {
  success: boolean;
  url?: string;
  duration?: number;
  error?: string;
}

interface VideoPromptContext {
  userRequest: string;
  explicitScene?: string;
  explicitMood?: string;
  recentMessages: Array<{ role: "user" | "kayley"; content: string }>;
  activeLoops: Array<{ topic: string; loopType: string }>;
  kayleyMood: { energy: number; warmth: number };
  userFacts?: string[];
  characterFacts?: string[];
  upcomingEvents?: Array<{ title: string; startTime: Date }>;
  currentLookLock?: {
    hairstyle: HairstyleType;
    outfit: OutfitStyle;
  };
}

interface GeneratedVideoPrompt {
  sceneDescription: string;
  lightingDescription: string;
  moodExpression: string;
  outfitContext: {
    style: OutfitStyle;
    description: string;
  };
  hairstyleGuidance: {
    preference: HairstyleType | "any";
    reason?: string;
  };
  seductionLevelGuidance: {
    preference: SeductionLevel;
    reason?: string;
  };
  skinExposuresGuidance: {
    preference: SkinExposure;
    reason?: string;
  };
  // VIDEO-SPECIFIC FIELDS
  actionDescription: string; // Character movements/actions
  cameraMovement: string; // Camera direction (pan, zoom, tracking)
  additionalDetails?: string;
  confidence: number;
  reasoning?: string;
}

interface GrokVideoGenerationResponse {
  request_id: string;
  status?: "pending" | "processing" | "completed" | "failed";
}

interface GrokVideoResult {
  status: "completed";
  url: string;
  prompt?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  created_at?: string;
}

interface GrokVideoApiResponse {
  status?: "pending" | "processing" | "completed" | "failed";
  video?: {
    url?: string;
    duration?: number;
    respect_moderation?: boolean;
  };
  model?: string;
  error?: string;
  code?: string;
}

interface GrokVideoError {
  status: "failed";
  error: string;
  code?: string;
}

// ============================================
// STYLE CONSTANTS
// ============================================

const OUTFIT_STYLES: OutfitStyle[] = [
  "casual",
  "dressed_up",
  "athletic",
  "cozy",
  "date_night",
  "sleepwear",
  "swimwear",
  "lingerie",
];

const HAIRSTYLE_TYPES: (HairstyleType | "any")[] = [
  "curly",
  "straight",
  "waves",
  "heatless_curls",
  "half_up",
  "claw_clip",
  "headband",
  "dutch_braid",
  "messy_bun",
  "styled_bun",
  "ponytail",
  "bob",
  "any",
];

const SEDUCTION_LEVELS: SeductionLevel[] = [
  "innocent",
  "playful",
  "flirty",
  "provocative",
  "dangerously_elegant",
];

const SKIN_EXPOSURES: SkinExposure[] = [
  "minimal",
  "suggestive",
  "revealing",
  "implied_only",
];

// ============================================
// VIDEO PROMPT SYSTEM PROMPT
// ============================================

function buildSystemPromptForVideo(): string {
  const outfitOptions = OUTFIT_STYLES.map((s) => `"${s}"`).join(" | ");
  const hairstyleOptions = HAIRSTYLE_TYPES.map((s) => `"${s}"`).join(" | ");
  const seductionLevels = SEDUCTION_LEVELS.map((s) => `"${s}"`).join(" | ");
  const skinExposures = SKIN_EXPOSURES.map((s) => `"${s}"`).join(" | ");

  return `
SYSTEM ROLE:
You are an expert video director for a virtual influencer named Kayley.
Your goal is to generate vivid, creative, and context-aware VIDEO prompts for a generative AI.

GOAL:
Translate the user's request and conversation vibes into a specific SCENE, OUTFIT, and MOTION description.
We use a reference image for her face, so DO NOT describe her physical facial features (eyes, skin tone, etc.).

KAYLEY'S WARDROBE:
- Outfit Styles: ${OUTFIT_STYLES.join(", ")}
- Hairstyle Types: ${HAIRSTYLE_TYPES.join(", ")}
- Seduction Levels: ${SEDUCTION_LEVELS.join(", ")}
- Skin Exposure Types: ${SKIN_EXPOSURES.join(", ")}

====================================================
🎬 VIDEO-SPECIFIC GUIDELINES (Critical)
====================================================
1. **Actions & Motion:** Videos need movement! Describe what Kayley is DOING:
   - Subtle: "gently tucking hair behind ear", "slow smile forming", "eyes fluttering open"
   - Medium: "walking towards camera", "turning to look over shoulder", "reaching for coffee cup"
   - Dynamic: "spinning in dress", "jumping on bed", "dancing playfully"

2. **Camera Movement:** Direct the virtual camera:
   - Static: "fixed camera, subject moves within frame"
   - Slow pan: "camera slowly pans right to follow her movement"
   - Slow zoom: "gentle zoom in on face as she smiles"
   - Tracking: "camera follows as she walks through room"
   - Dolly: "camera moves closer as she leans in"

3. **Duration Awareness:** This is an 8-second clip. Keep actions simple and completable.
   - One main action + one reaction/ending
   - Example: "She looks up from phone, sees camera, smiles and waves"

====================================================
🔥 SPICY & ALLURE GUIDELINES
====================================================
If the context is "flirty," "naughty," or "intimate":
1. **Be Provocative but Safe:** Revealing outfits OK, but NEVER nudity or explicit acts.
2. **Focus on Texture & Vibe:** Use *sheer, lace, silk, satin, form-fitting, plunging, backless*.
3. **Imply, Don't Show:** A "suggestive unzipped hoodie" is better than explicit descriptions.
4. **Sensual Motion:** "Running fingers through hair", "biting lip", "stretching languidly"

====================================================
RULES
====================================================
1. **Context is King:** Look at the 'Recent Messages' for cues.
2. **Lighting:** Use "golden hour," "moody bedroom shadows," "candlelight," etc.
3. **Consistency:** If a 'Look Lock' is active, you MUST respect it.
4. **Video Feel:** Natural, intimate, like a story or short-form content. NOT a photoshoot.

====================================================
OUTPUT FORMAT (JSON ONLY)
====================================================
{
  "sceneDescription": "string (Environment, background, setting)",
  "moodExpression": "string (Starting facial expression, evolves with action)",
  "actionDescription": "string (CRITICAL: What Kayley DOES in the video - be specific about movement)",
  "cameraMovement": "string (CRITICAL: How the camera moves - pan, zoom, tracking, static)",
  "outfitContext": {
    "style": ${outfitOptions},
    "description": "string (Detailed outfit description)"
  },
  "hairstyleGuidance": {
    "preference": ${hairstyleOptions},
    "reason": "string"
  },
  "seductionLevelGuidance": {
    "preference": ${seductionLevels},
    "reason": "string"
  },
  "skinExposuresGuidance": {
    "preference": ${skinExposures},
    "reason": "string"
  },
  "lightingDescription": "string (Lighting setup)",
  "additionalDetails": "string (Any extra notes)",
  "confidence": number,
  "reasoning": "string (Why you chose this scene/action)"
}

EXAMPLE (Flirty Morning Video):
{
  "sceneDescription": "Sunlit bedroom with messy white sheets, morning light streaming through sheer curtains",
  "moodExpression": "Sleepy eyes slowly opening, transitioning to a soft, knowing smile",
  "actionDescription": "She stretches languidly in bed, then props herself up on one elbow, tilts her head and blows a kiss at the camera",
  "cameraMovement": "Slow zoom in from medium shot to close-up as she wakes, ending on her face as she blows the kiss",
  "outfitContext": {
    "style": "sleepwear",
    "description": "An oversized cream-colored boyfriend shirt, slipping off one shoulder"
  },
  "hairstyleGuidance": {
    "preference": "messy_bun",
    "reason": "Just woke up, natural morning look"
  },
  "seductionLevelGuidance": {
    "preference": "playful",
    "reason": "Flirty good morning vibe"
  },
  "skinExposuresGuidance": {
    "preference": "suggestive",
    "reason": "Shoulder visible, legs under sheets"
  },
  "lightingDescription": "Soft, warm morning light with gentle shadows",
  "additionalDetails": "Natural, intimate feel like she's sending this to someone special",
  "confidence": 0.95,
  "reasoning": "User wanted a morning video, keeping it flirty but not explicit"
}
`;
}

// ============================================
// VIDEO PROMPT GENERATOR (LLM)
// ============================================

async function generateVideoPrompt(
  context: VideoPromptContext
): Promise<GeneratedVideoPrompt> {
  if (!GEMINI_API_KEY) {
    console.warn("[VideoPromptGen] No API key, using fallback");
    throw new Error("Missing Gemini API key");
  }

  const cacheKey = getVideoCacheKey(context);
  const cached = videoPromptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < VIDEO_CACHE_TTL) {
    console.log("✨ [VideoPromptGen] Cache hit");
    return cached.result;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const prompt = `
SYSTEM: ${buildSystemPromptForVideo()}

USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
- Kayley Mood: Energy: ${context.kayleyMood.energy}, Warmth: ${context.kayleyMood.warmth}
- Upcoming Events: ${JSON.stringify(context.upcomingEvents || [])}
- User Facts: ${JSON.stringify(context.userFacts || [])}
- Character Facts: ${JSON.stringify(context.characterFacts || [])}

${
  context.currentLookLock
    ? `- Current Look Lock: Hairstyle: ${context.currentLookLock.hairstyle}, Outfit: ${context.currentLookLock.outfit}`
    : ""
}

Generate the VIDEO prompt JSON based on the context above. Remember to include specific action and camera movement directions!
`;

  const result = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
    },
  });

  const text = (result as any).text || "";

  // Extract JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in video prompt response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedVideoPrompt;

  videoPromptCache.set(cacheKey, { result: parsed, timestamp: Date.now() });
  return parsed;
}

// ============================================
// VIDEO PROMPT BUILDER
// ============================================

function buildVideoPrompt(prompt: GeneratedVideoPrompt): string {
  const seductionGuidanceMap: Record<SeductionLevel, string> = {
    innocent: "The overall vibe is soft, wholesome, and natural.",
    playful: "The vibe is playful and lightly flirtatious.",
    flirty: "The vibe is confidently flirty and alluring.",
    provocative: "The vibe is provocative and seductive, using implication rather than explicit content.",
    dangerously_elegant: "The vibe is dangerously elegant—refined and subtly scandalous.",
  };

  const skinExposureGuidanceMap: Record<SkinExposure, string> = {
    minimal: "The outfit is modest and fully covering.",
    suggestive: "The outfit subtly highlights shape with limited skin exposure.",
    revealing: "The outfit is revealing in a tasteful way.",
    implied_only: "The outfit relies on implication rather than exposure.",
  };

  return [
    // Reference image consistency
    `Use the provided reference image to match the woman's face, hairstyle, and overall look as closely as possible.`,

    // Scene and setting
    `Scene: ${prompt.sceneDescription}`,

    // Action (CRITICAL for video)
    `Action: ${prompt.actionDescription}`,

    // Camera movement (CRITICAL for video)
    `Camera: ${prompt.cameraMovement}`,

    // Outfit
    `She is wearing ${prompt.outfitContext.description}.`,

    // Expression
    `Expression: ${prompt.moodExpression}`,

    // Vibe
    seductionGuidanceMap[prompt.seductionLevelGuidance.preference],
    skinExposureGuidanceMap[prompt.skinExposuresGuidance.preference],

    // Lighting
    `Lighting: ${prompt.lightingDescription}`,

    // Additional
    prompt.additionalDetails ? `Note: ${prompt.additionalDetails}` : "",

    // Video quality
    `The video should feel natural and intimate, like a real phone-recorded moment, not a professional production.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ============================================
// GROK API HELPERS
// ============================================

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${GROK_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function 
startVideoGeneration(
  prompt: string,
  imageUrl: string,
  options: {
    duration?: number;
    aspectRatio?: AspectRatio;
    resolution?: VideoResolution;
  } = {}
): Promise<GrokVideoGenerationResponse> {
  const res = await fetch(`${XAI_API_BASE}/videos/generations`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model: GROK_VIDEO_MODEL,
      prompt,
      image: { url: imageUrl },
      duration: options.duration ?? DEFAULT_DURATION,
      aspect_ratio: options.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      resolution: options.resolution ?? DEFAULT_RESOLUTION,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Video generation failed: ${res.status} – ${err.error || res.statusText}`
    );
  }

  return res.json() as Promise<GrokVideoGenerationResponse>;
}

async function getVideoStatus(
  requestId: string
): Promise<GrokVideoResult | GrokVideoError | GrokVideoApiResponse> {
  // Note: Status endpoint is /videos/{id}, not /videos/generations/{id}
  const res = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
    headers: getHeaders(),
  });

  // 200 = completed, 202 = still processing (pending/processing)
  if (!res.ok && res.status !== 202) {
    throw new Error(`Status check failed: ${res.status}`);
  }

  return res.json();
}

async function pollUntilComplete(requestId: string): Promise<GrokVideoResult> {
  const start = Date.now();

  while (true) {
    if (Date.now() - start > MAX_WAIT_SECONDS * 1000) {
      throw new Error("Timeout waiting for video generation");
    }

    const status = await getVideoStatus(requestId);

    if ("status" in status && status.status === "failed") {
      throw new Error(
        (status as GrokVideoError).error || "Video generation failed"
      );
    }

    if ("video" in status && status.video?.url) {
      return {
        status: "completed",
        url: status.video.url,
        duration: status.video.duration,
      };
    }

    if ("status" in status && status.status === "completed") {
      return status as GrokVideoResult;
    }

    console.log(`🎬 [VideoGen] Still processing... (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ============================================
// MAIN VIDEO GENERATION FUNCTION
// ============================================

/**
 * Generate a video of the AI companion in a given scene
 */
export async function generateCompanionVideo(
  request: VideoRequest
): Promise<VideoResult> {
  if (!GROK_API_KEY) {
    console.error("❌ [VideoGen] Missing VITE_GROK_API_KEY");
    return { success: false, error: "Video generation not configured" };
  }

  try {
    console.log("🎬 [VideoGen] Generating video for scene:", request.scene);

    // STEP 1: Get current look state
    const currentLookState = await getCurrentLookState();
    console.log("🎬 [VideoGen] Current look state:", currentLookState);

    // STEP 2: Get additional context for LLM prompt generation
    const [activeLoops, kayleyMood, characterFacts, userFactsRaw] =
      await Promise.all([
        getActiveLoops(),
        getMoodAsync(),
        getCharacterFacts(),
        getUserFacts("all"),
      ]);

    const userFacts = userFactsRaw.map((f) => `${f.fact_key}: ${f.fact_value}`);

    // Map conversation history to expected role format
    const recentMessages = (request.conversationHistory || []).map((m) => ({
      role: m.role === "user" ? "user" : ("kayley" as "user" | "kayley"),
      content: m.content,
    }));

    // STEP 3: Generate creative video prompt using LLM
    const videoPromptContext: VideoPromptContext = {
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
      characterFacts: characterFacts.map((f) => `${f.fact_key}: ${f.fact_value}`),
      upcomingEvents: (request.upcomingEvents || []).map((e) => ({
        title: e.title,
        startTime: e.startTime,
      })),
      currentLookLock: currentLookState
        ? {
            hairstyle: currentLookState.hairstyle as HairstyleType,
            outfit:
              currentLookState.lockReason === "explicit_now_selfie"
                ? "dressed_up"
                : "casual",
          }
        : undefined,
    };

    const generatedPrompt = await generateVideoPrompt(videoPromptContext);
    console.log("🎬 [VideoGen] LLM Generated Prompt:", generatedPrompt);

    // STEP 4: Select reference image
    // Videos are always "now" - never old photos
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
      temporalContext: {
        isOldPhoto: false,
        temporalPhrases: [],
      },
    };

    const selection = selectReferenceImageForGrok(selectionContext);
    console.log("🎬 [VideoGen] Selected reference:", selection.referenceId);

    // STEP 5: Build the final video prompt
    const fullPrompt = buildVideoPrompt(generatedPrompt);
    console.log("🎬 [VideoGen] Full prompt:", fullPrompt);

    // STEP 7: Start video generation
    console.log("🎬 [VideoGen] Starting video generation with Grok...");
    const { request_id } = await startVideoGeneration(fullPrompt, selection.url, {
      duration: request.duration ?? DEFAULT_DURATION,
      aspectRatio: request.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      resolution: request.resolution ?? DEFAULT_RESOLUTION,
    });
    console.log("🎬 [VideoGen] Request ID:", request_id);

    // STEP 8: Poll until complete
    console.log("🎬 [VideoGen] Polling for completion...");
    const videoResult = await pollUntilComplete(request_id);
    console.log("✅ [VideoGen] Video generated successfully!");

    // STEP 9: Auto-save to local filesystem (Development only)
    try {
      fetch("/api/save-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoResult.url,
          scene: request.scene,
        }),
      }).catch((e) =>
        console.warn(
          "🎬 [VideoGen] Auto-save failed (expected if not in dev):",
          e
        )
      );
    } catch (e) {
      console.warn("🎬 [VideoGen] Auto-save error:", e);
    }

    return {
      success: true,
      url: videoResult.url,
      duration: videoResult.duration,
    };
  } catch (error: any) {
    console.error("❌ [VideoGen] Error generating video:", error);
    if (error?.message?.includes("SAFETY")) {
      return {
        success: false,
        error: "The video could not be generated due to content guidelines",
      };
    }
    return {
      success: false,
      error: error?.message || "Failed to generate video",
    };
  }
}

// ============================================
// HELPERS
// ============================================

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

  // Fallback: parse from reference ID
  const parts = referenceId.split("_");
  if (parts.length >= 2) {
    const hairstyle = parts[0];
    const outfit = parts[parts.length - 1];

    return {
      hairstyle: hairstyle === "messy" ? "messy_bun" : hairstyle,
      outfitStyle: outfit === "up" ? "dressed_up" : outfit,
    };
  }

  console.warn(
    `[VideoGen] Could not determine metadata for ${referenceId}, using defaults`
  );
  return {
    hairstyle: "curly",
    outfitStyle: "casual",
  };
}

// ============================================
// CACHING
// ============================================

const VIDEO_CACHE_TTL = 60 * 1000; // 60 seconds
const videoPromptCache = new Map<
  string,
  { result: GeneratedVideoPrompt; timestamp: number }
>();

function getVideoCacheKey(context: VideoPromptContext): string {
  const msgHash = context.recentMessages
    .slice(-3)
    .map((m) => m.content)
    .join("|");
  const loopHash = context.activeLoops.map((l) => l.topic).join(",");
  const eventsCount = context.upcomingEvents?.length || 0;

  return [
    "video",
    context.userRequest,
    context.explicitScene || "",
    context.explicitMood || "",
    msgHash,
    Math.round(context.kayleyMood.energy * 10),
    loopHash,
    eventsCount,
  ].join("|");
}
