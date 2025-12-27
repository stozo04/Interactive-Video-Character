/**
 * Visual State Mapper
 *
 * Maps internal emotional states to video manifests for visual consistency.
 * Ensures that when Kayley says she's at a cafe, the UI reflects that.
 */

import { supabase } from '../supabaseClient';
import type {
  VisualStateMapping,
  VisualContext,
  EnergyLevel,
  TransitionStyle,
} from './types';
import type { EmotionalMomentum, MoodState } from '../stateService';
import type { PresenceContext } from '../presenceDirector';

// ============================================================================
// DEFAULT MAPPINGS (Fallback if DB query fails)
// ============================================================================

const DEFAULT_MAPPINGS: Omit<VisualStateMapping, 'id'>[] = [
  {
    emotionalState: 'guarded',
    energyLevel: 'low',
    moodCategory: 'neutral',
    idleVideoManifestId: 'idle_reserved_low',
    backgroundId: 'bg_dim',
    transitionStyle: 'subtle',
    priority: 0,
  },
  {
    emotionalState: 'guarded',
    energyLevel: 'medium',
    moodCategory: 'neutral',
    idleVideoManifestId: 'idle_reserved',
    backgroundId: 'bg_neutral',
    transitionStyle: 'subtle',
    priority: 0,
  },
  {
    emotionalState: 'open',
    energyLevel: 'medium',
    moodCategory: 'happy',
    idleVideoManifestId: 'idle_warm',
    backgroundId: 'bg_warm',
    transitionStyle: 'smooth',
    priority: 0,
  },
  {
    emotionalState: 'open',
    energyLevel: 'high',
    moodCategory: 'excited',
    idleVideoManifestId: 'idle_bouncy',
    backgroundId: 'bg_bright',
    transitionStyle: 'quick',
    priority: 0,
  },
  {
    emotionalState: 'playful',
    energyLevel: 'high',
    moodCategory: 'happy',
    idleVideoManifestId: 'idle_playful',
    backgroundId: 'bg_fun',
    transitionStyle: 'quick',
    priority: 0,
  },
  {
    emotionalState: 'playful',
    energyLevel: 'medium',
    moodCategory: 'happy',
    idleVideoManifestId: 'idle_smirk',
    backgroundId: 'bg_warm',
    transitionStyle: 'smooth',
    priority: 0,
  },
  {
    emotionalState: 'vulnerable',
    energyLevel: 'low',
    moodCategory: 'sad',
    idleVideoManifestId: 'idle_soft',
    backgroundId: 'bg_dim',
    transitionStyle: 'smooth',
    priority: 0,
  },
  {
    emotionalState: 'vulnerable',
    energyLevel: 'medium',
    moodCategory: 'anxious',
    idleVideoManifestId: 'idle_tender',
    backgroundId: 'bg_soft',
    transitionStyle: 'subtle',
    priority: 0,
  },
  {
    emotionalState: 'flirty',
    energyLevel: 'medium',
    moodCategory: 'happy',
    idleVideoManifestId: 'idle_coy',
    backgroundId: 'bg_warm',
    transitionStyle: 'smooth',
    priority: 0,
  },
  {
    emotionalState: 'flirty',
    energyLevel: 'high',
    moodCategory: 'excited',
    idleVideoManifestId: 'idle_teasing',
    backgroundId: 'bg_pink',
    transitionStyle: 'quick',
    priority: 0,
  },
];

// ============================================================================
// LOCATION-SPECIFIC BACKGROUNDS
// ============================================================================

const LOCATION_BACKGROUNDS: Record<string, string> = {
  cafe: 'bg_cafe',
  coffee_shop: 'bg_cafe',
  'coffee shop': 'bg_cafe',
  beach: 'bg_beach',
  park: 'bg_park',
  outside: 'bg_outdoor',
  outdoors: 'bg_outdoor',
  office: 'bg_office',
  work: 'bg_office',
  gym: 'bg_gym',
  home: 'bg_warm',
  bedroom: 'bg_warm',
  default: 'bg_warm',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Classify energy level from mood state
 */
function classifyEnergyLevel(moodState: MoodState): EnergyLevel {
  const energy = moodState.dailyEnergy;
  const socialBattery = moodState.socialBattery;

  // Combine both factors
  const combined = (energy + socialBattery) / 2;

  if (combined < 0.4) return 'low';
  if (combined < 0.7) return 'medium';
  return 'high';
}

/**
 * Classify emotional state from momentum
 */
function classifyEmotionalState(momentum: EmotionalMomentum): string {
  const { currentMoodLevel, vulnerabilityExchangeActive, positiveInteractionStreak } = momentum as EmotionalMomentum & { vulnerabilityExchangeActive?: boolean };

  // Vulnerable: Active vulnerability exchange or low mood with negative momentum
  if (vulnerabilityExchangeActive || (currentMoodLevel < -0.3 && momentum.momentumDirection < 0)) {
    return 'vulnerable';
  }

  // Flirty: Very high mood with strong positive momentum (check before playful!)
  if (currentMoodLevel > 0.7 && momentum.momentumDirection > 0.5) {
    return 'flirty';
  }

  // Playful: High mood with positive streak
  if (currentMoodLevel > 0.5 && positiveInteractionStreak >= 3) {
    return 'playful';
  }

  // Open: Positive mood
  if (currentMoodLevel > 0) {
    return 'open';
  }

  // Guarded: Default state
  return 'guarded';
}

/**
 * Classify mood category from mood level
 */
function classifyMoodCategory(moodLevel: number): string {
  if (moodLevel > 0.7) return 'excited';
  if (moodLevel > 0.3) return 'happy';
  if (moodLevel > -0.3) return 'neutral';
  if (moodLevel > -0.6) return 'anxious';
  return 'sad';
}

/**
 * Extract location from presence context
 */
function extractLocation(presenceContext?: PresenceContext): string | undefined {
  if (!presenceContext) return undefined;

  // Look through active loops for location mentions
  for (const loop of presenceContext.activeLoops) {
    const content = loop.content.toLowerCase();

    // Check for location keywords
    for (const [key] of Object.entries(LOCATION_BACKGROUNDS)) {
      if (content.includes(key)) {
        return key;
      }
    }
  }

  return undefined;
}

/**
 * Get location-specific background
 */
function getLocationBackground(location?: string): string | undefined {
  if (!location) return undefined;

  const normalized = location.toLowerCase().trim();
  return LOCATION_BACKGROUNDS[normalized] || LOCATION_BACKGROUNDS.default;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Query visual state mapping from database
 */
async function queryVisualStateMapping(
  emotionalState: string,
  energyLevel: EnergyLevel,
  moodCategory: string,
  location?: string
): Promise<VisualStateMapping | null> {
  try {
    // First, try to find a mapping with matching location
    if (location) {
      const { data: locationData } = await supabase
        .from('visual_state_mapping')
        .select('*')
        .eq('emotional_state', emotionalState)
        .eq('energy_level', energyLevel)
        .eq('mood_category', moodCategory)
        .eq('location_context', location)
        .order('priority', { ascending: false })
        .limit(1)
        .single();

      if (locationData) {
        return {
          id: locationData.id,
          emotionalState: locationData.emotional_state,
          energyLevel: locationData.energy_level as EnergyLevel,
          moodCategory: locationData.mood_category,
          idleVideoManifestId: locationData.idle_video_manifest_id,
          backgroundId: locationData.background_id,
          expressionHints: locationData.expression_hints,
          locationContext: locationData.location_context,
          locationBackgroundId: locationData.location_background_id,
          transitionStyle: locationData.transition_style as TransitionStyle,
          priority: locationData.priority,
        };
      }
    }

    // Fall back to mapping without location
    const { data } = await supabase
      .from('visual_state_mapping')
      .select('*')
      .eq('emotional_state', emotionalState)
      .eq('energy_level', energyLevel)
      .eq('mood_category', moodCategory)
      .is('location_context', null)
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (!data) return null;

    return {
      id: data.id,
      emotionalState: data.emotional_state,
      energyLevel: data.energy_level as EnergyLevel,
      moodCategory: data.mood_category,
      idleVideoManifestId: data.idle_video_manifest_id,
      backgroundId: data.background_id,
      expressionHints: data.expression_hints,
      locationContext: data.location_context,
      locationBackgroundId: data.location_background_id,
      transitionStyle: data.transition_style as TransitionStyle,
      priority: data.priority,
    };
  } catch (error) {
    console.error('[VisualStateMapper] Error querying visual state mapping:', error);
    return null;
  }
}

/**
 * Find best match from default mappings (fallback)
 */
function findDefaultMapping(
  emotionalState: string,
  energyLevel: EnergyLevel,
  moodCategory: string
): Omit<VisualStateMapping, 'id'> | null {
  // Try exact match
  const exactMatch = DEFAULT_MAPPINGS.find(
    (m) =>
      m.emotionalState === emotionalState &&
      m.energyLevel === energyLevel &&
      m.moodCategory === moodCategory
  );

  if (exactMatch) return exactMatch;

  // Try fuzzy match (same emotional state and energy, different mood)
  const fuzzyMatch = DEFAULT_MAPPINGS.find(
    (m) => m.emotionalState === emotionalState && m.energyLevel === energyLevel
  );

  if (fuzzyMatch) return fuzzyMatch;

  // Absolute fallback - neutral state
  return DEFAULT_MAPPINGS.find(
    (m) => m.emotionalState === 'guarded' && m.energyLevel === 'medium'
  ) || DEFAULT_MAPPINGS[0];
}

/**
 * Map emotional state to video manifest
 *
 * @param emotionalState - The classified emotional state (guarded, open, playful, etc.)
 * @param energyLevel - Energy level (low, medium, high)
 * @param moodCategory - Mood category (happy, sad, anxious, excited, calm)
 * @param location - Optional location context (cafe, beach, etc.)
 * @returns Visual state mapping or null if not found
 */
export async function mapEmotionalStateToVideo(
  emotionalState: string,
  energyLevel: EnergyLevel,
  moodCategory: string,
  location?: string
): Promise<VisualStateMapping | null> {
  // Try database query first
  const dbMapping = await queryVisualStateMapping(
    emotionalState,
    energyLevel,
    moodCategory,
    location
  );

  if (dbMapping) {
    // Apply location background override if location is provided
    if (location && !dbMapping.locationBackgroundId) {
      const locationBg = getLocationBackground(location);
      if (locationBg) {
        return {
          ...dbMapping,
          backgroundId: locationBg,
        };
      }
    }
    return dbMapping;
  }

  // Fall back to defaults
  const defaultMapping = findDefaultMapping(emotionalState, energyLevel, moodCategory);

  if (!defaultMapping) return null;

  // Apply location background if applicable
  let backgroundId = defaultMapping.backgroundId;
  if (location) {
    backgroundId = getLocationBackground(location) || backgroundId;
  }

  return {
    id: 'default',
    ...defaultMapping,
    backgroundId,
  };
}

/**
 * Get full visual context from current state
 *
 * @param fullState - Combined state object with momentum, mood, and presence
 * @returns Visual context with video manifest and background IDs
 */
export async function getVisualContext(fullState: {
  momentum: EmotionalMomentum;
  moodState: MoodState;
  presenceContext?: PresenceContext;
}): Promise<VisualContext> {
  const { momentum, moodState, presenceContext } = fullState;

  // Classify state
  const emotionalState = classifyEmotionalState(momentum);
  const energyLevel = classifyEnergyLevel(moodState);
  const moodCategory = classifyMoodCategory(momentum.currentMoodLevel);
  const location = extractLocation(presenceContext);

  // Get mapping
  const mapping = await mapEmotionalStateToVideo(
    emotionalState,
    energyLevel,
    moodCategory,
    location
  );

  // Fallback to safe defaults
  if (!mapping) {
    return {
      videoManifestId: 'idle_reserved',
      backgroundId: 'bg_warm',
      transitionStyle: 'smooth',
    };
  }

  return {
    videoManifestId: mapping.idleVideoManifestId,
    backgroundId: mapping.backgroundId || 'bg_warm',
    transitionStyle: mapping.transitionStyle,
    expressionHints: mapping.expressionHints,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  classifyEnergyLevel,
  classifyEmotionalState,
  classifyMoodCategory,
  extractLocation,
  getLocationBackground,
};
