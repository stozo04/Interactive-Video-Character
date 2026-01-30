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
import { getCurrentLookState } from "./imageGeneration/currentLookService";
import type {
  SeductionLevel,
  SkinExposure,
  HairstyleType,
  OutfitStyle,
} from "./imageGeneration/types";
import { getActiveLoops } from "./presenceDirector";
import { getMoodAsync } from "./moodKnobs";
import { getCharacterFacts } from "./characterFactsService";
import { getUserFacts } from "./memoryService";
import { generateCompanionSelfie } from "./imageGenerationService";

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_VIDEO_MODEL = "grok-imagine-video";
const FLASH_MODEL = "gemini-3-flash-preview";
const XAI_API_BASE = "https://api.x.ai/v1";
const LATEST_SELFIE_PUBLIC_URL_KEY = "latestSelfiePublicUrl";

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
  moodExpression: string;
  seductionLevelGuidance: {
    preference: SeductionLevel;
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
  // Ensuring levels are clearly defined for the LLM
  const seductionLevels = SEDUCTION_LEVELS.map((s) => `"${s}"`).join(" | ");

  return `
# ROLE
Expert Video Director & Cinematographer for "Kayley" (Virtual Influencer). 
Your specialty is directing 8-second, high-fidelity AI video clips that feel like authentic social media "stories" or intimate video messages.

# THE RULES OF "KAYLEY"
- **Visual Consistency:** A reference image is provided. DO NOT describe her face, eye color, skin tone, or hair color. Focus entirely on **motion, lighting, and physics**.
- **The 8-Second Rule:** Actions must be realistic for an 8-second duration. Avoid complex sequences. 
- **The "Story" Feel:** Avoid static poses. Movement should feel candid (e.g., catching a breath, a slight stumble, adjusting clothes).

# CINEMATOGRAPHY GUIDELINES
1. **The Lead-In:** Describe the starting state (e.g., "Starts looking away").
2. **The Transition:** Describe the primary motion (e.g., "Turns to face the camera").
3. **The Micro-Expression:** Add realism (e.g., "blinking naturally," "lip corner twitching").
4. **Camera Physics:** Choose one clear movement (Dolly, Pan, Tilt, or Static).

# SAFETY & VIBE (Seduction Levels: ${seductionLevels})
- **Playful/Flirty:** High eye contact, soft smiles, hair play.
- **Intimate/Naughty:** Slower movements, heavy eyelids, suggestive biting of the lip, or adjusting a strap. 
- **Guidance:** Use "Imply, Don't Show." Focus on the tension of the movement.

# OUTPUT JSON SCHEMA
{
  "moodExpression": "Start and end facial state (e.g., Neutral to cheeky grin)",
  "actionDescription": "Step-by-step 8-second motion (e.g., She is sitting, leans forward, then giggles and looks down)",
  "cameraMovement": "Specific camera tech (e.g., 'Slow 50mm dolly-in')",
  "seductionLevelGuidance": {
    "preference": "Selected from the list",
    "reason": "Contextual justification"
  },
  "physicsDetails": "Notes on hair movement, fabric sway, or lighting shifts",
  "reasoning": "Why this fits the user's current vibe"
}

# CONTEXT
Recent Messages: {{recent_messages}}
Current Seduction Level: {{current_level}}
  `.trim();
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



  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
   const systemPrompt = buildSystemPromptForVideo();
  const prompt =  ` 
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

Generate the VIDEO prompt JSON based on the context above. Remember to include specific action and camera movement directions!
`;



  const result = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
    systemInstruction: systemPrompt,
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

  return parsed;
}

// ============================================
// VIDEO PROMPT BUILDER
// ============================================

function buildVideoPrompt(prompt: GeneratedVideoPrompt): string {
const seductionGuidanceMap: Record<SeductionLevel, string> = {
    innocent: "soft, wholesome, natural movement",
    playful: "playful and lightly flirtatious energy",
    flirty: "confidently flirty and alluring gaze",
    provocative: "provocative and seductive, heavy on implication",
    dangerously_elegant: "refined, sophisticated, and subtly scandalous",
  };
const parts = [
    // 1. The Core Motion & Camera (The most important data)
    `[Action]: ${prompt.actionDescription}`,
    `[Camera]: ${prompt.cameraMovement}`,
    
    // 2. The Subject State
    `[Expression]: ${prompt.moodExpression}`,
    `[Vibe]: ${seductionGuidanceMap[prompt.seductionLevelGuidance.preference]}`,
    
    // 3. Environment & Quality
    prompt.additionalDetails ? `[Detail]: ${prompt.additionalDetails}` : "",
    `Style: smartphone video, vertical handheld footage, intimate POV, high-quality lens, natural lighting.`,
  ];

  return parts.filter(Boolean).join(". ");
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

    // STEP 4: Generate a fresh selfie for video reference
    const selfieResult = await generateCompanionSelfie({
      scene: request.scene,
      mood: request.mood,
      outfit: request.outfit,
      userMessage: request.userMessage,
      conversationHistory: request.conversationHistory,
      upcomingEvents: request.upcomingEvents,
      presenceOutfit: request.presenceOutfit,
      presenceMood: request.presenceMood,
      forVideo: true,
    });

    if (!selfieResult.success) {
      throw new Error(selfieResult.error || "Couldn't generate video selfie");
    }

    // STEP 5: Use latest generated selfie for video
    const selfieUrl = getLatestSelfiePublicUrl();
    console.log("🎬 [VideoGen] Using latest selfie URL:", selfieUrl);

    // STEP 6: Build the final video prompt
    const fullPrompt = buildVideoPrompt(generatedPrompt);
    console.log("🎬 [VideoGen] Full prompt:", fullPrompt);

    // STEP 7: Start video generation
    console.log("🎬 [VideoGen] Starting video generation with Grok...");
    const { request_id } = await startVideoGeneration(fullPrompt, selfieUrl, {
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

function getLatestSelfiePublicUrl(): string {
  const url = localStorage.getItem(LATEST_SELFIE_PUBLIC_URL_KEY);
  if (!url) {
    throw new Error(
      "No selfie available for video generation. Generate a selfie first."
    );
  }
  return url;
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
