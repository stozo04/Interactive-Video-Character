/**
 * Spontaneity Tracker
 *
 * Tracks conversation state and calculates spontaneity probabilities
 * to make Kayley feel alive with organic, unprompted behaviors.
 */

import {
  type ConversationalMood,
  type SpontaneousActionType,
  type SpontaneityContext,
  SPONTANEITY_DEFAULTS,
  TIER_SPONTANEITY_BONUS,
  TIER_SELFIE_BONUS,
  SELFIE_ELIGIBLE_TIERS,
} from "./types";

// ============================================================================
// INTERNAL STATE
// ============================================================================

interface ConversationState {
  messagesCount: number;
  topicsDiscussed: string[];
  recentLaughter: boolean;
  lastSpontaneousMoment: Date | null;
  recentSpontaneousTypes: SpontaneousActionType[];
  lastSpontaneousSelfie: Date | null;
  humorSuccessesCount: number;
  sessionStartedAt: Date;
}

let conversationState: ConversationState = createDefaultConversationState();
let laughterDecayTimeout: ReturnType<typeof setTimeout> | null = null;

function createDefaultConversationState(): ConversationState {
  return {
    messagesCount: 0,
    topicsDiscussed: [],
    recentLaughter: false,
    lastSpontaneousMoment: null,
    recentSpontaneousTypes: [],
    lastSpontaneousSelfie: null,
    humorSuccessesCount: 0,
    sessionStartedAt: new Date(),
  };
}

// ============================================================================
// STATE ACCESSORS
// ============================================================================

/**
 * Get the current conversation state (for testing/debugging)
 */
export function getConversationState(): ConversationState {
  return { ...conversationState };
}

/**
 * Reset conversation state (call at conversation start)
 */
export function resetConversationState(): void {
  // Clear any pending decay timeout
  if (laughterDecayTimeout) {
    clearTimeout(laughterDecayTimeout);
    laughterDecayTimeout = null;
  }

  conversationState = createDefaultConversationState();
}

// ============================================================================
// TRACKING FUNCTIONS
// ============================================================================

/**
 * Track that a message was exchanged
 */
export function trackMessage(topics: string[]): void {
  conversationState.messagesCount++;

  // Clean and add topics (trim, filter empty, dedupe)
  const cleanTopics = topics
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const topic of cleanTopics) {
    if (!conversationState.topicsDiscussed.includes(topic)) {
      conversationState.topicsDiscussed.push(topic);
    }
  }

  // Keep last 20 topics
  if (conversationState.topicsDiscussed.length > 20) {
    conversationState.topicsDiscussed = conversationState.topicsDiscussed.slice(-20);
  }
}

/**
 * Track that humor landed (user laughed/appreciated joke)
 */
export function trackLaughter(): void {
  conversationState.recentLaughter = true;
  conversationState.humorSuccessesCount++;

  // Clear any existing decay timeout
  if (laughterDecayTimeout) {
    clearTimeout(laughterDecayTimeout);
  }

  // Set decay timer (5 minutes)
  laughterDecayTimeout = setTimeout(() => {
    conversationState.recentLaughter = false;
    laughterDecayTimeout = null;
  }, 5 * 60 * 1000);
}

/**
 * Record a spontaneous action (for cooldown tracking)
 */
export function recordSpontaneousAction(type: SpontaneousActionType): void {
  const now = new Date();

  conversationState.lastSpontaneousMoment = now;
  conversationState.recentSpontaneousTypes.push(type);

  // Keep last 10 types
  if (conversationState.recentSpontaneousTypes.length > 10) {
    conversationState.recentSpontaneousTypes.shift();
  }

  // Track selfie timestamp separately
  if (type === "spontaneous_selfie") {
    conversationState.lastSpontaneousSelfie = now;
  }
}

// ============================================================================
// PROBABILITY CALCULATIONS
// ============================================================================

/**
 * Calculate the probability of being spontaneous in this moment
 */
export function calculateSpontaneityProbability(
  relationshipTier: string,
  energyLevel: number,
  messagesInConversation: number
): number {
  // Base probability
  let probability = SPONTANEITY_DEFAULTS.baseProbability;

  // Tier bonus
  probability += TIER_SPONTANEITY_BONUS[relationshipTier] || 0;

  // Energy modifier (scale energy contribution)
  // At energy 0.5, add 0 bonus; at 1.0, add 0.05; at 0, subtract 0.05
  probability += (energyLevel - 0.5) * 0.1;

  // Message count modifier (more natural to digress in longer convos)
  if (messagesInConversation > 10) {
    probability += 0.05;
  } else if (messagesInConversation > 5) {
    probability += 0.02;
  }

  // Cooldown check
  if (conversationState.lastSpontaneousMoment) {
    const minutesSinceLast =
      (Date.now() - conversationState.lastSpontaneousMoment.getTime()) / 60000;

    if (minutesSinceLast < SPONTANEITY_DEFAULTS.cooldownMinutes) {
      // Heavy reduction during cooldown
      probability *= 0.2;
    }
  }

  // Clamp between 0 and max
  return Math.max(0, Math.min(SPONTANEITY_DEFAULTS.maxProbability, probability));
}

/**
 * Calculate the probability of sending a spontaneous selfie
 */
export function calculateSelfieProbability(
  relationshipTier: string,
  energyLevel: number,
  currentMood: string | null,
  userHadBadDay: boolean,
  lastSpontaneousSelfie: Date | null,
  currentLocation: string | null
): number {
  // Selfies require friend+ tier
  if (!SELFIE_ELIGIBLE_TIERS.includes(relationshipTier as typeof SELFIE_ELIGIBLE_TIERS[number])) {
    return 0;
  }

  // Base probability
  let probability = SPONTANEITY_DEFAULTS.selfieBaseProbability;

  // Tier bonus
  probability += TIER_SELFIE_BONUS[relationshipTier] || 0;

  // Energy modifier - more likely when feeling good
  if (energyLevel > 0.7) {
    probability += 0.02;
  }

  // Mood boost - playful/excited moods
  if (currentMood) {
    const positiveMoods = ["playful", "excited", "happy", "cute", "confident", "good"];
    if (positiveMoods.some((m) => currentMood.toLowerCase().includes(m))) {
      probability += 0.03;
    }
  }

  // User had bad day - might want to cheer them up
  if (userHadBadDay) {
    probability += 0.04;
  }

  // Interesting location boost
  if (currentLocation) {
    const boringLocations = ["home", "bedroom", "living room", "apartment"];
    if (!boringLocations.includes(currentLocation.toLowerCase())) {
      probability += 0.02;
    }
  }

  // Check cooldown - use provided timestamp or conversation state
  const selfieTimestamp = lastSpontaneousSelfie || conversationState.lastSpontaneousSelfie;

  if (selfieTimestamp) {
    const hoursSinceLast =
      (Date.now() - selfieTimestamp.getTime()) / (60 * 60 * 1000);

    if (hoursSinceLast < SPONTANEITY_DEFAULTS.selfieCooldownHours) {
      // Heavy reduction during cooldown
      probability *= 0.1;
    } else if (hoursSinceLast < SPONTANEITY_DEFAULTS.selfieCooldownHours * 3) {
      // Moderate reduction within 3 days
      probability *= 0.5;
    }
  }

  // Cap at max
  return Math.min(SPONTANEITY_DEFAULTS.selfieMaxProbability, probability);
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

interface BuildSpontaneityContextOptions {
  conversationalMood: ConversationalMood;
  relationshipTier: string;
  energyLevel: number;
  comfortLevel: number;
  vulnerabilityExchangeActive: boolean;
  hasSomethingToShare: boolean;
  currentThought: string | null;
  recentExperience: string | null;
  userInterests: string[];
  currentLocation: string | null;
  currentOutfit: string | null;
  currentMoodForSelfie: string | null;
  userHadBadDay: boolean;
  lastSpontaneousSelfie?: Date | null;
}

/**
 * Build the full spontaneity context for LLM consumption
 */
export function buildSpontaneityContext(
  options: BuildSpontaneityContextOptions
): SpontaneityContext {
  const {
    conversationalMood,
    relationshipTier,
    energyLevel,
    comfortLevel,
    vulnerabilityExchangeActive,
    hasSomethingToShare,
    currentThought,
    recentExperience,
    userInterests,
    currentLocation,
    currentOutfit,
    currentMoodForSelfie,
    userHadBadDay,
    lastSpontaneousSelfie,
  } = options;

  // Calculate topic depth based on conversation length
  let topicDepth: "surface" | "medium" | "deep";
  if (conversationState.messagesCount >= 15) {
    topicDepth = "deep";
  } else if (conversationState.messagesCount >= 5) {
    topicDepth = "medium";
  } else {
    topicDepth = "surface";
  }

  // Check if selfie eligible
  const selfieEligible = SELFIE_ELIGIBLE_TIERS.includes(
    relationshipTier as typeof SELFIE_ELIGIBLE_TIERS[number]
  );

  // Calculate probabilities
  const spontaneityProbability = calculateSpontaneityProbability(
    relationshipTier,
    energyLevel,
    conversationState.messagesCount
  );

  const selfieProbability = calculateSelfieProbability(
    relationshipTier,
    energyLevel,
    currentMoodForSelfie,
    userHadBadDay,
    lastSpontaneousSelfie || null,
    currentLocation
  );

  return {
    conversationalMood,
    energyLevel,
    topicDepth,
    recentLaughter: conversationState.recentLaughter,
    messagesInConversation: conversationState.messagesCount,

    relationshipTier,
    comfortLevel,
    vulnerabilityExchangeActive,

    hasSomethingToShare,
    currentThought,
    recentExperience,

    topicsDiscussed: [...conversationState.topicsDiscussed],
    userInterests,

    lastSpontaneousMoment: conversationState.lastSpontaneousMoment,
    recentSpontaneousTypes: [...conversationState.recentSpontaneousTypes],
    spontaneityProbability,

    selfieEligible,
    lastSpontaneousSelfie: lastSpontaneousSelfie || conversationState.lastSpontaneousSelfie,
    currentLocation,
    currentOutfit,
    currentMoodForSelfie,
    userHadBadDay,
    selfieProbability,
  };
}
