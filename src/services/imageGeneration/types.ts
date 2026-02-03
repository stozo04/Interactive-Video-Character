// src/services/imageGeneration/types.ts



export type HairstyleType =
  | 'curly'           // Natural voluminous curls (2B/2C waves)
  | 'straight'        // Blown out or naturally straight
  | 'waves'           // Soft waves or beach waves
  | 'heatless_curls'  // No-heat curls or set waves
  | 'half_up'         // Half-up, half-down style
  | 'claw_clip'       // Claw clip updo
  | 'headband'        // Headband-styled hair
  | 'dutch_braid'     // Single or double dutch braid
  | 'ponytail'        // High or low ponytail
  | 'messy_bun'       // Casual updo, curly texture
  | 'styled_bun'      // Sleek or styled bun
  | 'bob';            // Shorter style (future)

export type OutfitStyle =
  | 'casual'          // Everyday wear (t-shirt, jeans, sweater)
  | 'dressed_up'      // Formal/nice (dress, blouse, jewelry)
  | 'athletic'        // Gym/activewear
  | 'cozy'         // Loungewear, pajamas
  | "date_night"
  | "sleepwear"
  | "swimwear"
  | "lingerie";

  export type SeductionLevel =
  | "innocent"
  | "playful"
  | "flirty"
  | "provocative"
  | "dangerously_elegant";

export type SkinExposure =
  | "minimal"
  | "suggestive"
  | "revealing"
  | "implied_only";

export type SeasonContext =
  | 'winter'          // Dec, Jan, Feb
  | 'spring'          // Mar, Apr, May
  | 'summer'          // Jun, Jul, Aug
  | 'fall';           // Sep, Oct, Nov

  
export interface ReferenceImageMetadata {
  id: string; // Unique identifier
  fileName: string; // e.g., "curlyHairCasual/curly_hair_casual.jpg"
  url: string; // Supabase key for Grok Image
  hairstyle: HairstyleType; // Derived from folder name
  outfitStyle: OutfitStyle; // Derived from folder name
}

export interface CurrentLookState {
  // Locked for current temporal context
  hairstyle: HairstyleType;
  referenceImageId: string;
  lockedAt: Date;
  expiresAt: Date;                     // When this look can change

  // Context that locked it
  lockReason: 'session_start' | 'first_selfie_of_day' | 'explicit_now_selfie';

  // Temporal awareness
  isCurrentLook: boolean;              // true = NOW, false = OLD PHOTO
}

export interface SelfieTemporalContext {
  isOldPhoto: boolean;                 // Detected from conversation
  referenceDate?: Date;                // "from last Tuesday"
  temporalPhrases: string[];           // Phrases that triggered old photo detection
}

export interface ReferenceSelectionContext {
  // Scene and mood (passed through but not used for static scoring)
  scene: string;
  mood?: string;
  outfit?: string;

  // User's original message for hairstyle detection
  userMessage?: string;

  // Temporal context
  temporalContext?: SelfieTemporalContext;
  currentLookState: CurrentLookState | null;

  // Calendar context
  upcomingEvents: Array<{
    title: string;
    startTime: Date;
    isFormal: boolean;
  }>;

  // Presence context (from presence_contexts table)
  presenceOutfit?: string; // "just got back from the gym"
  presenceMood?: string; // "feeling cute today"

  // Anti-repetition tracking
  recentReferenceHistory?: Array<{
    referenceImageId: string;
    usedAt: Date;
    scene: string;
  }>;

  // Environmental context (used by some services)
  currentSeason: SeasonContext;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  currentLocation: string | null;

  // LLM guidance (primary selection mechanism)
  llmGuidance?: GeneratedImagePrompt;
}

// ============================================
// LLM-DRIVEN IMAGE PROMPT TYPES
// ============================================

export interface ImagePromptContext {
  // User's request
  userRequest: string;
  explicitScene?: string;
  explicitMood?: string;

  // Conversation context
  recentMessages: Array<{ role: string; content: string }>;

  // Presence context (from presenceDirector)
  activeLoops: Array<{ topic: string; loopType: string }>;
  relevantOpinion?: { topic: string; sentiment: string };

  // Character context
  userFacts?: string[];
  characterFacts?: string[];

  // Temporal context
  isOldPhoto: boolean;
  temporalReference?: string;

  // Calendar context
  upcomingEvents?: Array<{ title: string; startTime: Date }>;

  // Current look lock (for consistency)
  currentLookLock?: {
    hairstyle: HairstyleType;
    outfit: OutfitStyle;
  };
}

export interface GeneratedImagePrompt {
  // Scene description (replaces getEnhancedScene)
  sceneDescription: string;

  // Lighting (replaces inferLightingAndAtmosphere)
  lightingDescription: string;

  // Expression (replaces buildMoodDescription)
  moodExpression: string;

  // Outfit context for reference selection
  outfitContext: {
    style: OutfitStyle;
    description: string;
  };

  // Hairstyle guidance for reference selection
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

  // Additional visual details
  additionalDetails?: string;

  // Metadata
  confidence: number;
  reasoning?: string;
}
