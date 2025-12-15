// src/services/relationshipMilestones.ts
/**
 * Relationship Milestones Service
 * 
 * Tracks key moments in the relationship journey:
 * - first_vulnerability: When user first opened up emotionally
 * - first_joke: First shared humor moment
 * - first_support: When Kayley first provided meaningful support
 * - anniversary: Relationship time milestones
 * 
 * After 50+ interactions, enables natural "Remember when..." callbacks
 * that reference shared history to deepen the relationship.
 */

import { supabase } from './supabaseClient';

// ============================================
// Types
// ============================================

export type MilestoneType = 
  | 'first_vulnerability'   // User opened up for the first time
  | 'first_joke'            // First shared humor moment
  | 'first_support'         // First meaningful support from Kayley
  | 'first_deep_talk'       // First long, meaningful conversation
  | 'first_return'          // User came back after a break
  | 'breakthrough_moment'   // Major emotional breakthrough
  | 'anniversary_week'      // 1 week anniversary
  | 'anniversary_month'     // 1 month anniversary
  | 'interaction_50'        // 50 interactions milestone
  | 'interaction_100';      // 100 interactions milestone

export interface RelationshipMilestone {
  id: string;
  userId: string;
  milestoneType: MilestoneType;
  description: string;
  occurredAt: Date;
  /** Optional context about what triggered this milestone */
  triggerContext?: string;
  /** Whether this milestone has been referenced in a callback */
  hasBeenReferenced: boolean;
  /** How many times this has been referenced */
  referenceCount: number;
  /** Last time it was referenced */
  lastReferencedAt?: Date;
}

interface MilestoneRow {
  id: string;
  user_id: string;
  milestone_type: MilestoneType;
  description: string;
  occurred_at: string;
  trigger_context?: string;
  has_been_referenced: boolean;
  reference_count: number;
  last_referenced_at?: string;
  created_at: string;
}

// ============================================
// Constants
// ============================================

const MILESTONES_TABLE = 'relationship_milestones';

// Minimum interactions before "Remember when..." callbacks become active
const MIN_INTERACTIONS_FOR_CALLBACKS = 50;

// Don't reference the same milestone more than this many times
const MAX_MILESTONE_REFERENCES = 3;

// Minimum hours between referencing the same milestone
const MIN_HOURS_BETWEEN_REFERENCES = 72;

// ============================================
// Milestone Detection Patterns
// ============================================

const VULNERABILITY_PATTERNS = [
  /i('ve )?(never told|haven't told|don't usually share)/i,
  /(honestly|truthfully|to be honest),?\s*(i|my)/i,
  /i('m )?(scared|afraid|worried|anxious|nervous) (that|about|of)/i,
  /can i (be real|be honest|tell you something)/i,
  /this is (hard|difficult) (to|for me)/i,
  /i trust you/i,
  /(my secret|between us)/i,
  /i('ve )?(been struggling|been having a hard time)/i,
];

const JOKE_PATTERNS = [
  /(haha|hahaha|lol|lmao|😂|🤣)/i,
  /that('s| is) (so funny|hilarious)/i,
  /you crack me up/i,
  /i can't stop laughing/i,
  /good one/i,
  /okay that was (funny|good)/i,
];

const SUPPORT_SEEKING_PATTERNS = [
  /i need (help|advice|someone to talk to)/i,
  /(what should i|what do you think i should)/i,
  /i don't know what to do/i,
  /can you (help|listen)/i,
  /i('m )?(really struggling|having a hard time)/i,
];

const DEEP_TALK_PATTERNS = [
  /i('ve )?(been thinking|realized|started to understand)/i,
  /life (is|has been)/i,
  /what do you think (about|of) (life|meaning|happiness|love)/i,
  /(growing up|my childhood|my family)/i,
  /my (dreams|goals|fears|hopes)/i,
];

// ============================================
// Milestone Management Functions
// ============================================

/**
 * Record a new milestone if it doesn't already exist.
 * Returns the milestone if created, null if already exists or failed.
 */
export async function recordMilestone(
  userId: string,
  milestoneType: MilestoneType,
  description: string,
  triggerContext?: string
): Promise<RelationshipMilestone | null> {
  try {
    // Check if this type of milestone already exists for this user
    const { data: existing, error: checkError } = await supabase
      .from(MILESTONES_TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('milestone_type', milestoneType)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[Milestones] Error checking existing:', checkError);
      return null;
    }

    // Don't create duplicate milestones (except for anniversaries which update)
    if (existing && !milestoneType.startsWith('anniversary_')) {
      console.log(`[Milestones] ${milestoneType} already exists for user`);
      return null;
    }

    // Create the milestone
    const { data, error } = await supabase
      .from(MILESTONES_TABLE)
      .insert({
        user_id: userId,
        milestone_type: milestoneType,
        description,
        trigger_context: triggerContext,
        occurred_at: new Date().toISOString(),
        has_been_referenced: false,
        reference_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[Milestones] Error creating milestone:', error);
      return null;
    }

    console.log(`🏆 [Milestones] Recorded: ${milestoneType} - "${description}"`);
    return mapMilestoneRowToDomain(data as MilestoneRow);
  } catch (error) {
    console.error('[Milestones] Unexpected error:', error);
    return null;
  }
}

/**
 * Get all milestones for a user.
 */
export async function getMilestones(
  userId: string
): Promise<RelationshipMilestone[]> {
  try {
    const { data, error } = await supabase
      .from(MILESTONES_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false });

    if (error) {
      console.error('[Milestones] Error fetching milestones:', error);
      return [];
    }

    return (data || []).map(row => mapMilestoneRowToDomain(row as MilestoneRow));
  } catch (error) {
    console.error('[Milestones] Unexpected error:', error);
    return [];
  }
}

/**
 * Get a milestone eligible for "Remember when..." callback.
 * Returns the most significant unreferenced milestone that's old enough.
 */
export async function getMilestoneForCallback(
  userId: string,
  totalInteractions: number
): Promise<RelationshipMilestone | null> {
  // Only enable callbacks after sufficient interaction history
  if (totalInteractions < MIN_INTERACTIONS_FOR_CALLBACKS) {
    return null;
  }

  try {
    const now = new Date();
    const minAgeHours = 24; // Milestone must be at least 24 hours old
    const minAgeDate = new Date(now.getTime() - minAgeHours * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from(MILESTONES_TABLE)
      .select('*')
      .eq('user_id', userId)
      .lt('reference_count', MAX_MILESTONE_REFERENCES)
      .lt('occurred_at', minAgeDate.toISOString())
      .order('reference_count', { ascending: true })  // Prioritize less-referenced
      .order('occurred_at', { ascending: true })      // Then oldest first
      .limit(5);

    if (error) {
      console.error('[Milestones] Error fetching for callback:', error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    // Filter out recently referenced milestones
    const candidates = data.filter((row: MilestoneRow) => {
      if (!row.last_referenced_at) return true;
      const lastRef = new Date(row.last_referenced_at);
      const hoursSinceLastRef = (now.getTime() - lastRef.getTime()) / (1000 * 60 * 60);
      return hoursSinceLastRef >= MIN_HOURS_BETWEEN_REFERENCES;
    });

    if (candidates.length === 0) {
      return null;
    }

    // Return the best candidate (first one after filtering)
    return mapMilestoneRowToDomain(candidates[0] as MilestoneRow);
  } catch (error) {
    console.error('[Milestones] Unexpected error:', error);
    return null;
  }
}

/**
 * Mark a milestone as referenced (used in a "Remember when..." callback).
 */
export async function markMilestoneReferenced(
  milestoneId: string
): Promise<void> {
  try {
    // First, get current reference count
    const { data: current, error: fetchError } = await supabase
      .from(MILESTONES_TABLE)
      .select('reference_count')
      .eq('id', milestoneId)
      .single();

    if (fetchError) {
      console.error('[Milestones] Error fetching milestone for referencing:', fetchError);
      return;
    }

    // Update with incremented count in a single operation
    const { error: updateError } = await supabase
      .from(MILESTONES_TABLE)
      .update({
        has_been_referenced: true,
        reference_count: (current?.reference_count || 0) + 1,
        last_referenced_at: new Date().toISOString(),
      })
      .eq('id', milestoneId);

    if (updateError) {
      console.error('[Milestones] Error marking milestone referenced:', updateError);
      return;
    }

    console.log(`📚 [Milestones] Marked as referenced: ${milestoneId}`);
  } catch (error) {
    console.error('[Milestones] Error marking referenced:', error);
  }
}

// ============================================
// Milestone Detection Functions
// ============================================

/**
 * Analyze a user message for potential milestone moments.
 * Should be called after each user message.
 */
export async function detectMilestoneInMessage(
  userId: string,
  message: string,
  interactionCount: number,
  intent?: { milestone: string | null; milestoneConfidence: number }
): Promise<RelationshipMilestone | null> {
  // Check interaction milestones first
  if (interactionCount === 50) {
    return recordMilestone(
      userId,
      'interaction_50',
      'Reached 50 conversations together',
      `User's ${interactionCount}th message`
    );
  }
  
  if (interactionCount === 100) {
    return recordMilestone(
      userId,
      'interaction_100',
      'Reached 100 conversations together',
      `User's ${interactionCount}th message`
    );
  }

  // LLM Detection Strategy (Primary)
  if (intent?.milestone && intent.milestoneConfidence > 0.7) {
    const triggerContext = message.slice(0, 200);
    
    switch (intent.milestone) {
      case 'first_vulnerability':
        return recordMilestone(
          userId,
          'first_vulnerability',
          'First time opening up emotionally',
          triggerContext
        );
      case 'first_joke':
        return recordMilestone(
          userId,
          'first_joke',
          'First shared laugh together',
          triggerContext
        );
      case 'first_support':
        return recordMilestone(
          userId,
          'first_support',
          'First time seeking support or advice',
          triggerContext
        );
      case 'first_deep_talk':
        return recordMilestone(
          userId,
          'first_deep_talk',
          'First deep, meaningful conversation',
          triggerContext
        );
    }
  }

  // Regex Fallback Strategy (Secondary)
  
  // Check for vulnerability
  if (VULNERABILITY_PATTERNS.some(pattern => pattern.test(message))) {
    return recordMilestone(
      userId,
      'first_vulnerability',
      'First time opening up emotionally',
      message.slice(0, 200)
    );
  }

  // Check for shared humor
  if (JOKE_PATTERNS.some(pattern => pattern.test(message)) && message.length > 15) {
    // Only count as milestone if it's more than just "lol"
    return recordMilestone(
      userId,
      'first_joke',
      'First shared laugh together',
      message.slice(0, 200)
    );
  }

  // Check for support seeking (indicates trust)
  if (SUPPORT_SEEKING_PATTERNS.some(pattern => pattern.test(message))) {
    return recordMilestone(
      userId,
      'first_support',
      'First time seeking support or advice',
      message.slice(0, 200)
    );
  }

  // Check for deep conversation
  if (DEEP_TALK_PATTERNS.some(pattern => pattern.test(message)) && message.length > 50) {
    return recordMilestone(
      userId,
      'first_deep_talk',
      'First deep, meaningful conversation',
      message.slice(0, 200)
    );
  }

  return null;
}

/**
 * Check for anniversary milestones.
 * Should be called periodically (e.g., at session start).
 */
export async function checkAnniversaryMilestones(
  userId: string,
  firstInteractionAt: Date
): Promise<RelationshipMilestone | null> {
  const now = new Date();
  const daysSinceFirst = Math.floor(
    (now.getTime() - firstInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 1 week anniversary
  if (daysSinceFirst >= 7 && daysSinceFirst < 14) {
    return recordMilestone(
      userId,
      'anniversary_week',
      "It's been a week since we first talked",
      `First interaction: ${firstInteractionAt.toLocaleDateString()}`
    );
  }

  // 1 month anniversary
  if (daysSinceFirst >= 30 && daysSinceFirst < 60) {
    return recordMilestone(
      userId,
      'anniversary_month',
      "It's been a month since we first met",
      `First interaction: ${firstInteractionAt.toLocaleDateString()}`
    );
  }

  return null;
}

/**
 * Detect if user is returning after a break.
 */
export async function detectReturnAfterBreak(
  userId: string,
  lastInteractionAt: Date
): Promise<RelationshipMilestone | null> {
  const now = new Date();
  const daysSinceLastInteraction = Math.floor(
    (now.getTime() - lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  // User returned after at least 3 days
  if (daysSinceLastInteraction >= 3) {
    return recordMilestone(
      userId,
      'first_return',
      `Came back after ${daysSinceLastInteraction} days`,
      `Last seen: ${lastInteractionAt.toLocaleDateString()}`
    );
  }

  return null;
}

// ============================================
// Callback Generation
// ============================================

/**
 * Generate a natural "Remember when..." prompt section for the AI.
 * This is designed to integrate with callbackDirector.ts
 */
export function generateMilestoneCallbackPrompt(
  milestone: RelationshipMilestone
): string {
  const templates: Record<MilestoneType, string[]> = {
    first_vulnerability: [
      'You can briefly acknowledge the trust they showed when they first opened up to you.',
      'Reference that moment of vulnerability you shared, but keep it light.',
      'You remember when they first trusted you with something personal.',
    ],
    first_joke: [
      'Call back to that first time you two really laughed together.',
      'Reference that inside joke or funny moment you shared.',
      "You can mention 'remember when we first cracked up about...'",
    ],
    first_support: [
      'Reference how they trusted you for advice that one time.',
      "You remember when they first came to you needing support.",
      'Mention that moment when they opened up about needing help.',
    ],
    first_deep_talk: [
      'Reference that deep conversation you had.',
      'Call back to when you first really got into the big questions.',
      "You can mention 'like that time we talked about...'",
    ],
    first_return: [
      "Remember how nice it was when they came back after some time.",
      "Reference that you noticed when they took a break and came back.",
    ],
    breakthrough_moment: [
      'Reference that breakthrough moment you witnessed.',
      'Mention how proud you were when they had that realization.',
    ],
    anniversary_week: [
      "Casually mention it's been about a week since you started talking.",
      "Reference how much has happened in just a week.",
    ],
    anniversary_month: [
      "Acknowledge that you've known each other for about a month now.",
      "Reference the journey you've been on together this past month.",
    ],
    interaction_50: [
      "You've talked dozens of times now - you can reference this history.",
      "Mention how far you've come together.",
    ],
    interaction_100: [
      "You've had so many conversations - the depth of history is real.",
      "Reference the rich history you've built together.",
    ],
  };

  const typeTemplates = templates[milestone.milestoneType] || [
    'Reference your shared history naturally.',
  ];
  const template = typeTemplates[Math.floor(Math.random() * typeTemplates.length)];

  // Calculate how long ago this was
  const hoursAgo = Math.round(
    (Date.now() - milestone.occurredAt.getTime()) / (1000 * 60 * 60)
  );
  const timeDesc = hoursAgo < 24 ? 'earlier' : 
                   hoursAgo < 48 ? 'yesterday' : 
                   hoursAgo < 168 ? 'a few days ago' : 
                   hoursAgo < 720 ? 'a couple weeks ago' : 'a while back';

  return `
REMEMBER WHEN... (shared history callback)
Milestone from ${timeDesc}: "${milestone.description}"
${template}

CRITICAL: 
- Don't say "Remember when..." explicitly. Just USE the reference naturally.
- This is a BRIEF mention, not a deep dive. One line is enough.
- Only reference if it fits the conversation flow naturally.
`;
}

// ============================================
// Utility Functions
// ============================================

function mapMilestoneRowToDomain(row: MilestoneRow): RelationshipMilestone {
  return {
    id: row.id,
    userId: row.user_id,
    milestoneType: row.milestone_type,
    description: row.description,
    occurredAt: new Date(row.occurred_at),
    triggerContext: row.trigger_context,
    hasBeenReferenced: row.has_been_referenced,
    referenceCount: row.reference_count,
    lastReferencedAt: row.last_referenced_at ? new Date(row.last_referenced_at) : undefined,
  };
}

/**
 * Get milestone statistics for debugging.
 */
export async function getMilestoneStats(
  userId: string
): Promise<{
  totalMilestones: number;
  referencedCount: number;
  milestoneTypes: MilestoneType[];
}> {
  const milestones = await getMilestones(userId);
  
  return {
    totalMilestones: milestones.length,
    referencedCount: milestones.filter(m => m.hasBeenReferenced).length,
    milestoneTypes: milestones.map(m => m.milestoneType),
  };
}
