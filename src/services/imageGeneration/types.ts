// src/services/imageGeneration/types.ts

export type HairstyleType =
  | 'curly'           // Natural voluminous curls (2B/2C waves)
  | 'straight'        // Blown out or naturally straight
  | 'messy_bun'       // Casual updo, curly texture
  | 'ponytail'        // High or low ponytail
  | 'bob';            // Shorter style (future)

export type OutfitStyle =
  | 'casual'          // Everyday wear (t-shirt, jeans, sweater)
  | 'dressed_up'      // Formal/nice (dress, blouse, jewelry)
  | 'athletic'        // Gym/activewear
  | 'cozy';           // Loungewear, pajamas

export type SeasonContext =
  | 'winter'          // Dec, Jan, Feb
  | 'spring'          // Mar, Apr, May
  | 'summer'          // Jun, Jul, Aug
  | 'fall';           // Sep, Oct, Nov

export interface ReferenceImageMetadata {
  id: string;                          // Unique identifier
  fileName: string;                    // e.g., "curly_hair_casual.txt"
  hairstyle: HairstyleType;
  outfitStyle: OutfitStyle;

  // Selection weights
  baseFrequency: number;               // 0-1, how common this look is

  // Contextual suitability
  suitableScenes: string[];            // ['coffee', 'home', 'park']
  unsuitableScenes: string[];          // ['gym', 'pool']
  suitableSeasons: SeasonContext[];    // ['fall', 'winter', 'spring']

  // Mood affinity
  moodAffinity: {
    playful: number;                   // 0-1, how well this fits playful mood
    confident: number;
    relaxed: number;
    excited: number;
    flirty: number;
  };

  // Time appropriateness
  timeOfDay: {
    morning: number;                   // 0-1, suitability score
    afternoon: number;
    evening: number;
    night: number;
  };
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
  // Scene and mood (from existing system)
  scene: string;
  mood?: string;
  outfitHint?: string;

  // User's original message for hairstyle detection
  userMessage?: string;

  // Temporal context
  temporalContext: SelfieTemporalContext;
  currentLookState: CurrentLookState | null;

  // Calendar context
  upcomingEvents: Array<{
    title: string;
    startTime: Date;
    isFormal: boolean;
  }>;

  // Environmental context
  currentSeason: SeasonContext;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  currentLocation: string | null;

  // Presence context (from presence_contexts table)
  presenceOutfit?: string;             // "just got back from the gym"
  presenceMood?: string;               // "feeling cute today"

  // Anti-repetition tracking
  recentReferenceHistory: Array<{
    referenceImageId: string;
    usedAt: Date;
    scene: string;
  }>;

  // New LLM guidance (Phase 2)
  llmGuidance?: GeneratedImagePrompt;
}

export interface EnhancedSelfieContext {
  inferredOutfitStyle: 'casual' | 'dressed_up' | 'athletic' | 'cozy' | 'unknown';
  inferredHairstylePreference: 'curly' | 'straight' | 'messy_bun' | 'ponytail' | 'any';
  activityContext: string; // "just got back from gym", "getting ready for dinner", etc.
  confidence: number;
  reasoning: string;
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
  relevantOpinion?: { topic: string; sentiment: string }; // Simplification of opiniion context

  // Character context
  kayleyMood: { energy: number; warmth: number };
  userFacts?: string[]; // e.g., "User's name is Mike", "User works at Google"
  characterFacts?: string[]; // e.g., "Kayley has a laptop named Nova"

  // Temporal context
  isOldPhoto: boolean;
  temporalReference?: string; // "last week", "yesterday", etc.

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

  // New: Outfit context for reference selection
  outfitContext: {
    style: OutfitStyle;
    description: string; // "sequined cocktail dress", "cozy sweater"
  };

  // New: Hairstyle guidance for reference selection
  hairstyleGuidance: {
    preference: HairstyleType | 'any';
    reason?: string;
  };

  // New: Additional visual details
  additionalDetails?: string; // Props, accessories, background elements

  // Metadata
  confidence: number; // 0-1, how confident the LLM is
  reasoning?: string; // For debugging
}
