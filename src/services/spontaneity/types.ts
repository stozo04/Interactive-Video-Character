/**
 * Spontaneity System Types
 *
 * Type definitions for Kayley's spontaneous behaviors - making her feel alive
 * by having her share things, make jokes, form associations, and surprise the user.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * The overall mood of a conversation, affecting spontaneity decisions
 */
export type ConversationalMood =
  | 'playful'
  | 'deep'
  | 'casual'
  | 'heavy'
  | 'flirty'
  | 'tense'
  | 'excited'
  | 'cozy';

/**
 * Types of spontaneous actions Kayley can take
 */
export type SpontaneousActionType =
  | 'associative_share'    // "That reminds me of..."
  | 'spontaneous_humor'    // Jokes, puns, playful comments
  | 'random_curiosity'     // "Can I ask you something random?"
  | 'topic_hijack'         // "I HAVE to tell you about..."
  | 'check_in'             // "Hey, you okay?"
  | 'impulsive_share'      // "I don't know why I'm telling you this but..."
  | 'sudden_warmth'        // "I really like talking to you"
  | 'protective_moment'    // "Hey, be careful with that"
  | 'spontaneous_selfie'   // Unprompted selfie
  | 'none';

/**
 * Reasons for sending a spontaneous selfie
 */
export type SpontaneousSelfieReason =
  | 'thinking_of_you'      // "Was just thinking about you..."
  | 'new_outfit'           // "Trying on this outfit, thoughts?"
  | 'good_mood'            // "Feeling cute today"
  | 'cool_location'        // "Look where I am!"
  | 'brighten_your_day'    // "Thought this might make you smile"
  | 'milestone_share'      // "I did it!! Look!"
  | 'random_impulse'       // "Idk why but here's my face"
  | 'matching_topic';      // Selfie relates to what they're discussing

/**
 * Types of things Kayley might want to share
 */
export type PendingShareType = 'story' | 'thought' | 'question' | 'discovery' | 'vent' | 'selfie';

/**
 * Types of idle thoughts Kayley generates during absence
 */
export type IdleThoughtType = 'dream' | 'memory' | 'curiosity' | 'anticipation' | 'connection' | 'random';

/**
 * User reaction to spontaneous content
 */
export type UserReaction = 'positive' | 'neutral' | 'negative';

/**
 * Energy level categories for visual state mapping
 */
export type EnergyLevel = 'low' | 'medium' | 'high';

/**
 * Transition styles for visual state changes
 */
export type TransitionStyle = 'smooth' | 'quick' | 'dramatic' | 'subtle';

// ============================================================================
// INTERFACES - Spontaneity Context
// ============================================================================

/**
 * Context for a spontaneous selfie decision
 */
export interface SpontaneousSelfieContext {
  reason: SpontaneousSelfieReason;
  scene: string; // Where she is / what she's doing
  mood: string; // Her expression
  outfit?: string; // What she's wearing if relevant
  caption: string; // What she says with it
}

/**
 * Full context for spontaneity decisions
 */
export interface SpontaneityContext {
  // Conversation state
  conversationalMood: ConversationalMood;
  energyLevel: number;               // 0-1
  topicDepth: 'surface' | 'medium' | 'deep';
  recentLaughter: boolean;           // Has humor landed recently?
  messagesInConversation: number;

  // Relationship permission
  relationshipTier: string;
  comfortLevel: number;              // 0-1
  vulnerabilityExchangeActive: boolean;

  // Her internal state
  hasSomethingToShare: boolean;
  currentThought: string | null;
  recentExperience: string | null;

  // Associative potential
  topicsDiscussed: string[];
  userInterests: string[];

  // Spontaneity budget (prevent over-spontaneity)
  lastSpontaneousMoment: Date | null;
  recentSpontaneousTypes: SpontaneousActionType[];
  spontaneityProbability: number;    // 0-1 base probability

  // Selfie-specific context
  selfieEligible: boolean;           // Relationship tier allows selfies?
  lastSpontaneousSelfie: Date | null;
  currentLocation: string | null;    // From calendar/presence
  currentOutfit: string | null;      // If she mentioned getting dressed up
  currentMoodForSelfie: string | null; // "feeling cute", "looking rough", etc.
  userHadBadDay: boolean;            // Might send to cheer them up
  selfieProbability: number;         // Separate from general spontaneity
}

/**
 * A pending share - something Kayley wants to tell the user
 */
export interface PendingShare {
  id: string;
  content: string;
  type: PendingShareType;
  urgency: number;                   // 0-1
  relevanceTopics: string[];         // Topics that might trigger this
  naturalOpener: string;             // "Oh! I've been meaning to tell you..."
  canInterrupt: boolean;             // Important enough to hijack topic?
  expiresAt: Date;
  createdAt: Date;

  // Selfie-specific (only if type === 'selfie')
  selfieContext?: SpontaneousSelfieContext;
}

/**
 * Decision about whether to be spontaneous
 */
export interface SpontaneityDecision {
  shouldAct: boolean;
  actionType: SpontaneousActionType;
  content: string | null;
  reasoning: string;

  // If actionType is 'spontaneous_selfie'
  selfieContext?: SpontaneousSelfieContext;
}

// ============================================================================
// INTERFACES - Session Reflection (Post-conversation synthesis)
// ============================================================================

/**
 * A memorable moment from a conversation
 */
export interface MemorableMoment {
  type: 'breakthrough' | 'genuine' | 'vulnerable' | 'funny' | 'tense' | 'repair';
  content: string;
  emotionalWeight: number;           // 0-1, how impactful
  timestamp?: Date;
}

/**
 * A mood snapshot at a point in time
 */
export interface MoodProgression {
  timestamp: Date;
  mood: ConversationalMood;
  trigger?: string;                  // What caused the mood shift
}

/**
 * Post-session reflection - what Kayley thinks about after user leaves
 */
export interface SessionReflection {
  id: string;
  // Session metadata
  sessionStartAt: Date;
  sessionEndAt: Date;
  messageCount: number;

  // Emotional arc
  emotionalArc: string; // "Started tense, warmed up, ended playful"
  dominantMood: ConversationalMood;
  moodProgression: MoodProgression[];

  // Key moments
  memorableMoments: MemorableMoment[];
  unresolvedThreads: string[]; // Topics left hanging

  // Relationship impact
  intimacyDelta: number; // -1 to 1
  trustDelta: number;
  warmthDelta: number;

  // What Kayley learned
  newUserFacts: string[];
  conversationInsights: string; // Kayley's reflection

  // Proactive prep
  suggestedFollowups: string[]; // Ideas for next conversation

  createdAt: Date;
}

// ============================================================================
// INTERFACES - Idle Thoughts (During user absence)
// ============================================================================

/**
 * An idle thought or dream Kayley generates while user is away
 */
export interface IdleThought {
  id: string;

  // Thought content
  thoughtType: IdleThoughtType;
  content: string; // The actual thought/dream
  associatedMemory?: string; // What triggered this
  emotionalTone: string; // wistful, excited, anxious, warm, etc.

  // Dream-specific
  isRecurring: boolean;
  dreamImagery?: Record<string, unknown>; // Visual elements

  // Relationship to user
  involvesUser: boolean;
  userRoleInThought?: string; // "companion", "hero", "absent", etc.

  // Proactive use
  canShareWithUser: boolean;
  idealConversationMood?: ConversationalMood;
  naturalIntro?: string; // "I had the weirdest dream about..."

  // Lifecycle
  generatedAt: Date;
  sharedAt?: Date;
  expiredAt?: Date;

  // Context when generated
  absenceDurationHours?: number;
  kayleyMoodWhenGenerated?: string;
}

// ============================================================================
// INTERFACES - Visual State Mapping
// ============================================================================

/**
 * Maps emotional state to video/visual elements
 */
export interface VisualStateMapping {
  id: string;

  // State identifiers
  emotionalState: string; // guarded, open, playful, vulnerable
  energyLevel: EnergyLevel;
  moodCategory: string; // happy, sad, anxious, excited, calm

  // Video mapping
  idleVideoManifestId: string; // Which idle video to use
  backgroundId?: string; // UI background (optional)
  expressionHints?: Record<string, unknown>; // Subtle expression variations

  // Location overrides
  locationContext?: string; // "cafe", "bedroom", "outside"
  locationBackgroundId?: string; // Override background for location

  // Transition
  transitionStyle: TransitionStyle;

  // Metadata
  priority: number; // Higher = more specific match wins
}

/**
 * The result of looking up the current visual state
 */
export interface VisualContext {
  videoManifestId: string;
  backgroundId: string;
  transitionStyle: TransitionStyle;
  expressionHints?: Record<string, unknown>;
}

// ============================================================================
// INTERFACES - Conversation Spontaneity State (In-memory tracking)
// ============================================================================

/**
 * In-conversation state tracking for spontaneity budget
 */
export interface ConversationSpontaneityState {
  conversationId?: string;

  // Message tracking
  messagesCount: number;
  topicsDiscussed: string[];

  // Spontaneity budget
  lastSpontaneousMoment: Date | null;
  recentSpontaneousTypes: SpontaneousActionType[];
  spontaneityProbability: number;

  // Humor tracking
  recentLaughter: boolean;
  humorAttemptsCount: number;
  humorSuccessesCount: number;

  // Selfie specific
  lastSpontaneousSelfie: Date | null;
  selfieProbability: number;

  // Session
  sessionStartedAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INTERFACES - Association Engine
// ============================================================================

/**
 * A match between a pending share and current conversation topics
 */
export interface AssociationMatch {
  share: PendingShare;
  matchedTopic: string;
  relevanceScore: number;
}

/**
 * Suggested association to include in response
 */
export interface SuggestedAssociation {
  opener: string;
  content: string;
  shareId: string;
}

// ============================================================================
// INTERFACES - Integration
// ============================================================================

/**
 * Result of integrating spontaneity into a message
 */
export interface SpontaneityIntegration {
  promptSection: string;
  humorGuidance: string;
  selfiePrompt: string;
  suggestedAssociation: SuggestedAssociation | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Relationship tiers that allow spontaneous selfies
 */
export const SELFIE_ELIGIBLE_TIERS = ['friend', 'close_friend', 'deeply_loving'] as const;

/**
 * Default spontaneity probability settings
 */
export const SPONTANEITY_DEFAULTS = {
  baseProbability: 0.1,          // 10% base
  maxProbability: 0.4,           // Cap at 40%
  selfieBaseProbability: 0.02,   // 2% base for selfies
  selfieMaxProbability: 0.15,    // Cap at 15%
  cooldownMinutes: 3,            // Min time between spontaneous actions
  selfieCooldownHours: 24,       // Min time between spontaneous selfies
} as const;

/**
 * Tier bonuses for spontaneity probability
 */
export const TIER_SPONTANEITY_BONUS: Record<string, number> = {
  stranger: 0,
  acquaintance: 0,
  friend: 0.05,
  close_friend: 0.1,
  deeply_loving: 0.15,
};

/**
 * Tier bonuses for selfie probability
 */
export const TIER_SELFIE_BONUS: Record<string, number> = {
  stranger: 0,
  acquaintance: 0,
  friend: 0.01,
  close_friend: 0.03,
  deeply_loving: 0.05,
};
