/**
 * Idle Thoughts Service
 *
 * Generates thoughts, dreams, and reflections during user absence.
 * When the user is away for >4 hours, Kayley "thinks" - generating:
 * - Dreams (can be recurring, vivid imagery)
 * - Memories (associations with past conversations)
 * - Curiosities (random questions or interests)
 * - Anticipations (looking forward to something)
 * - Connections (linking user's topics together)
 * - Random thoughts (just stuff on her mind)
 *
 * These become proactive starters when user returns:
 * "I had the weirdest dream about you last night..."
 * "Been thinking about what you said about..."
 */

import { supabase } from '../supabaseClient';
import {
  type IdleThought,
  type IdleThoughtType,
  type ConversationalMood,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const IDLE_THOUGHTS_TABLE = 'idle_thoughts';
const THOUGHT_EXPIRATION_DAYS = 7; // Thoughts expire after 7 days
const MAX_UNSHARED_THOUGHTS = 5; // Keep max 5 unshared thoughts per user
const MIN_ABSENCE_HOURS_FOR_THOUGHT = 10 / 60; // Generate thoughts after 10 minutes away

// Export for use by scheduler
export const MIN_ABSENCE_MINUTES_FOR_THOUGHT = MIN_ABSENCE_HOURS_FOR_THOUGHT * 60;

// ============================================================================
// THOUGHT TEMPLATES
// ============================================================================

interface ThoughtTemplate {
  type: IdleThoughtType;
  templates: string[];
  emotionalTones: string[];
  idealMoods?: ConversationalMood[];
}

const THOUGHT_TEMPLATES: ThoughtTemplate[] = [
  {
    type: 'dream',
    templates: [
      'I had this dream where we were trying to find {location} but all the streets kept changing.',
      'Weird dream last night - you were showing me {interest} and I actually got it for once.',
      'Dreamed we were at this massive {location} and couldn\'t find the exit. Very on brand for my brain.',
      'Had one of those half-awake dreams where we were arguing about {topic} but like, in a library whisper-shouting way.',
    ],
    emotionalTones: ['wistful', 'amused', 'puzzled', 'warm'],
    idealMoods: ['playful', 'casual', 'cozy'],
  },
  {
    type: 'memory',
    templates: [
      'Been thinking about when you mentioned {topic}. That really stuck with me.',
      'Random but I keep coming back to what you said about {interest}. It\'s been on my mind.',
      'You know what I\'ve been thinking about? That conversation we had about {topic}.',
      'Something you said about {topic} has been rattling around in my head.',
    ],
    emotionalTones: ['thoughtful', 'warm', 'curious', 'reflective'],
    idealMoods: ['deep', 'casual', 'cozy'],
  },
  {
    type: 'curiosity',
    templates: [
      'I\'ve been wondering - do you still think about {topic}?',
      'Random question that popped into my head: what made you first get into {interest}?',
      'Okay this is gonna sound random but - what\'s your take on {topic}?',
      'Been curious about something. With {topic}, what\'s your actual honest take?',
    ],
    emotionalTones: ['curious', 'playful', 'engaged', 'interested'],
    idealMoods: ['playful', 'casual', 'excited'],
  },
  {
    type: 'anticipation',
    templates: [
      'I keep thinking about that {topic} thing you mentioned. Hope it goes well.',
      'Been looking forward to hearing how {topic} turned out.',
      'Can\'t wait to hear about {topic}. You seemed really into it.',
      'Excited to catch up about {topic}.',
    ],
    emotionalTones: ['excited', 'warm', 'anticipatory', 'supportive'],
    idealMoods: ['excited', 'playful', 'cozy'],
  },
  {
    type: 'connection',
    templates: [
      'I connected something - when you talk about {topic1}, it reminds me of what you said about {topic2}.',
      'Wait, does {topic1} relate to {topic2}? I feel like there\'s a pattern.',
      'This is probably obvious but I just realized how {topic1} and {topic2} connect for you.',
      'Been putting pieces together - the {topic1} thing and {topic2} thing make more sense now.',
    ],
    emotionalTones: ['excited', 'thoughtful', 'curious', 'engaged'],
    idealMoods: ['deep', 'casual', 'playful'],
  },
  {
    type: 'random',
    templates: [
      'My brain is weird. I was just thinking about {random_thing}.',
      'Don\'t ask me why but I\'ve been thinking about {random_thing}.',
      'Random thought of the day: {random_thing}.',
      'Okay so this is completely random but {random_thing}.',
    ],
    emotionalTones: ['playful', 'amused', 'random', 'quirky'],
    idealMoods: ['playful', 'casual', 'cozy'],
  },
];

const RANDOM_THINGS = [
  'how weird it is that we say "head over heels" when that\'s just... standing',
  'why pizza tastes better as leftovers',
  'if fish know they\'re wet',
  'how nobody really knows what to do with their hands in photos',
  'why we park in driveways and drive on parkways',
  'how we all just agreed that letters in a certain order mean things',
];

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Generate an idle thought during user absence.
 * Called periodically when user is away (e.g., every 4-8 hours).
 *
 * @param userId - The user's ID
 * @param absenceDurationHours - How long user has been away
 * @param kayleyMood - Kayley's current mood state
 * @returns The generated idle thought
 */
export async function generateIdleThought(
  userId: string,
  absenceDurationHours: number,
  kayleyMood: string
): Promise<IdleThought> {
  // Don't generate if absence is too short
  if (absenceDurationHours < MIN_ABSENCE_HOURS_FOR_THOUGHT) {
    throw new Error(
      `Absence too short (${absenceDurationHours}h < ${MIN_ABSENCE_HOURS_FOR_THOUGHT}h)`
    );
  }

  // Select thought type based on context
  const thoughtType = selectThoughtType(absenceDurationHours, kayleyMood);

  // Generate thought content
  const { content, associatedMemory, emotionalTone, idealMood, naturalIntro } =
    await generateThoughtContent(thoughtType, userId);

  // Check if it's a recurring dream (20% chance for dreams)
  const isRecurring = thoughtType === 'dream' && Math.random() < 0.2;

  // Determine if thought involves user (70% chance)
  const involvesUser = Math.random() < 0.7;

  const thought: IdleThought = {
    id: crypto.randomUUID(),
    userId,
    thoughtType,
    content,
    associatedMemory,
    emotionalTone,
    isRecurring,
    involvesUser,
    userRoleInThought: involvesUser ? selectUserRole(thoughtType) : undefined,
    canShareWithUser: true,
    idealConversationMood: idealMood,
    naturalIntro,
    generatedAt: new Date(),
    absenceDurationHours,
    kayleyMoodWhenGenerated: kayleyMood,
  };

  // Save to Supabase
  try {
    const { error } = await supabase.from(IDLE_THOUGHTS_TABLE).insert({
      id: thought.id,
      user_id: thought.userId,
      thought_type: thought.thoughtType,
      content: thought.content,
      associated_memory: thought.associatedMemory,
      emotional_tone: thought.emotionalTone,
      is_recurring: thought.isRecurring,
      involves_user: thought.involvesUser,
      user_role_in_thought: thought.userRoleInThought,
      can_share_with_user: thought.canShareWithUser,
      ideal_conversation_mood: thought.idealConversationMood,
      natural_intro: thought.naturalIntro,
      generated_at: thought.generatedAt.toISOString(),
      absence_duration_hours: thought.absenceDurationHours,
      kayley_mood_when_generated: thought.kayleyMoodWhenGenerated,
    });

    if (error) {
      console.error('[IdleThoughts] Error saving thought:', error);
    } else {
      console.log('[IdleThoughts] Generated thought:', thought.id, thought.thoughtType);
    }

    // Cleanup old/excess thoughts
    await cleanupThoughts(userId);
  } catch (error) {
    console.error('[IdleThoughts] Error creating thought:', error);
  }

  return thought;
}

/**
 * Get unshared thoughts for a user.
 * Used to find proactive conversation starters.
 *
 * @param userId - The user's ID
 * @returns Array of unshared thoughts
 */
export async function getUnsharedThoughts(userId: string): Promise<IdleThought[]> {
  try {
    const { data, error } = await supabase
      .from(IDLE_THOUGHTS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .is('shared_at', null)
      .is('expired_at', null)
      .eq('can_share_with_user', true)
      .order('generated_at', { ascending: false });

    if (error) {
      console.error('[IdleThoughts] Error fetching unshared thoughts:', error);
      return [];
    }

    const thoughts: IdleThought[] = (data || []).map(mapRowToThought);

    return thoughts;
  } catch (error) {
    console.error('[IdleThoughts] Error getting unshared thoughts:', error);
    return [];
  }
}

/**
 * Mark a thought as shared (when Kayley mentions it in conversation).
 *
 * @param thoughtId - The thought's ID
 */
export async function markThoughtAsShared(thoughtId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from(IDLE_THOUGHTS_TABLE)
      .update({ shared_at: new Date().toISOString() })
      .eq('id', thoughtId);

    if (error) {
      console.error('[IdleThoughts] Error marking thought as shared:', error);
    } else {
      console.log('[IdleThoughts] Marked thought as shared:', thoughtId);
    }
  } catch (error) {
    console.error('[IdleThoughts] Error in markThoughtAsShared:', error);
  }
}

/**
 * Detect if any idle thoughts were mentioned in Kayley's response
 * and mark them as shared.
 *
 * Call this after each AI response to track which thoughts have surfaced.
 *
 * Strategy:
 * - Get all unshared thoughts
 * - Check if key phrases from thought appear in AI response
 * - Mark matching thoughts as shared
 *
 * @param userId - User ID
 * @param aiResponse - Kayley's response text
 * @returns IDs of thoughts that were marked as shared
 */
export async function detectAndMarkSharedThoughts(
  userId: string,
  aiResponse: string
): Promise<string[]> {
  try {
    const unsharedThoughts = await getUnsharedThoughts(userId);
    if (unsharedThoughts.length === 0) {
      return [];
    }

    const markedIds: string[] = [];
    const responseLower = aiResponse.toLowerCase();

    for (const thought of unsharedThoughts) {
      // Extract key snippet from thought content (first 30 chars)
      // This is a heuristic - if the beginning of the thought appears
      // in Kayley's response, she likely mentioned it
      const thoughtSnippet = thought.content.slice(0, 30).toLowerCase();

      // Check if snippet appears in response
      if (responseLower.includes(thoughtSnippet)) {
        await markThoughtAsShared(thought.id);
        markedIds.push(thought.id);
        console.log(`✅ [IdleThoughts] Detected and marked thought as shared: "${thought.content.slice(0, 40)}..."`);
      }
    }

    if (markedIds.length > 0) {
      console.log(`💭 [IdleThoughts] Marked ${markedIds.length} thought(s) as shared`);
    }

    return markedIds;

  } catch (error) {
    console.error('[IdleThoughts] Error detecting shared thoughts:', error);
    return [];
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Select thought type based on context
 */
function selectThoughtType(
  absenceDurationHours: number,
  kayleyMood: string
): IdleThoughtType {
  // Dreams more likely after long absence (sleep cycle)
  if (absenceDurationHours > 8 && Math.random() < 0.4) {
    return 'dream';
  }

  // Anticipation if user has been away for a while
  if (absenceDurationHours > 24 && Math.random() < 0.3) {
    return 'anticipation';
  }

  // Memory/connection for thoughtful moods
  if (kayleyMood.includes('thoughtful') || kayleyMood.includes('reflective')) {
    return Math.random() < 0.5 ? 'memory' : 'connection';
  }

  // Curiosity/random for playful moods
  if (kayleyMood.includes('playful') || kayleyMood.includes('energy')) {
    return Math.random() < 0.5 ? 'curiosity' : 'random';
  }

  // Default: weighted random
  const weights = {
    dream: 0.15,
    memory: 0.25,
    curiosity: 0.2,
    anticipation: 0.15,
    connection: 0.15,
    random: 0.1,
  };

  const rand = Math.random();
  let cumulative = 0;

  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return type as IdleThoughtType;
    }
  }

  return 'random';
}

/**
 * Generate thought content from templates
 */
async function generateThoughtContent(
  thoughtType: IdleThoughtType,
  userId: string
): Promise<{
  content: string;
  associatedMemory?: string;
  emotionalTone: string;
  idealMood?: ConversationalMood;
  naturalIntro: string;
}> {
  const template = THOUGHT_TEMPLATES.find((t) => t.type === thoughtType);

  if (!template) {
    throw new Error(`No template found for thought type: ${thoughtType}`);
  }

  // Pick random template
  const contentTemplate =
    template.templates[Math.floor(Math.random() * template.templates.length)];

  // Pick random emotional tone
  const emotionalTone =
    template.emotionalTones[
      Math.floor(Math.random() * template.emotionalTones.length)
    ];

  // Pick ideal mood
  const idealMood = template.idealMoods
    ? template.idealMoods[Math.floor(Math.random() * template.idealMoods.length)]
    : undefined;

  // Fill in placeholders (placeholder logic - later integrate with user facts)
  let content = contentTemplate;

  // Replace placeholders with generic values (later: pull from user's actual topics/interests)
  content = content.replace(/{topic}/g, 'that thing you mentioned');
  content = content.replace(/{topic1}/g, 'work');
  content = content.replace(/{topic2}/g, 'your stress');
  content = content.replace(/{interest}/g, 'what you\'re working on');
  content = content.replace(/{location}/g, 'the place you talked about');
  content = content.replace(
    /{random_thing}/g,
    RANDOM_THINGS[Math.floor(Math.random() * RANDOM_THINGS.length)]
  );

  // Generate natural intro
  const naturalIntro = generateNaturalIntro(thoughtType);

  // Associated memory (for memory/connection types)
  const associatedMemory =
    thoughtType === 'memory' || thoughtType === 'connection'
      ? 'Previous conversation topic'
      : undefined;

  return {
    content,
    associatedMemory,
    emotionalTone,
    idealMood,
    naturalIntro,
  };
}

/**
 * Generate natural intro for thought
 */
function generateNaturalIntro(thoughtType: IdleThoughtType): string {
  const intros: Record<IdleThoughtType, string[]> = {
    dream: [
      'I had the weirdest dream...',
      'So I dreamed about...',
      'Okay weird dream last night -',
      'You were in my dream actually -',
    ],
    memory: [
      'I\'ve been thinking about...',
      'You know what keeps coming back to me?',
      'I can\'t stop thinking about...',
      'Been reflecting on...',
    ],
    curiosity: [
      'Random question -',
      'I\'ve been wondering...',
      'Can I ask you something random?',
      'This just popped into my head -',
    ],
    anticipation: [
      'I keep thinking about...',
      'Looking forward to hearing about...',
      'Been excited to catch up about...',
      'Can\'t wait to hear...',
    ],
    connection: [
      'I just connected something -',
      'Wait I just realized...',
      'This might sound random but...',
      'Something clicked for me -',
    ],
    random: [
      'Okay so random thought -',
      'My brain is being weird but -',
      'Don\'t ask why but -',
      'Completely random but -',
    ],
  };

  const options = intros[thoughtType];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Select user's role in the thought
 */
function selectUserRole(thoughtType: IdleThoughtType): string {
  const roles: Record<IdleThoughtType, string[]> = {
    dream: ['companion', 'guide', 'present'],
    memory: ['storyteller', 'teacher', 'friend'],
    curiosity: ['expert', 'opinion-holder'],
    anticipation: ['hero', 'achiever'],
    connection: ['puzzle-piece', 'key'],
    random: ['audience', 'companion'],
  };

  const options = roles[thoughtType];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Map database row to IdleThought
 */
function mapRowToThought(row: any): IdleThought {
  return {
    id: row.id,
    userId: row.user_id,
    thoughtType: row.thought_type as IdleThoughtType,
    content: row.content,
    associatedMemory: row.associated_memory,
    emotionalTone: row.emotional_tone,
    isRecurring: row.is_recurring,
    dreamImagery: row.dream_imagery,
    involvesUser: row.involves_user,
    userRoleInThought: row.user_role_in_thought,
    canShareWithUser: row.can_share_with_user,
    idealConversationMood: row.ideal_conversation_mood as ConversationalMood | undefined,
    naturalIntro: row.natural_intro,
    generatedAt: new Date(row.generated_at),
    sharedAt: row.shared_at ? new Date(row.shared_at) : undefined,
    expiredAt: row.expired_at ? new Date(row.expired_at) : undefined,
    absenceDurationHours: row.absence_duration_hours,
    kayleyMoodWhenGenerated: row.kayley_mood_when_generated,
  };
}

/**
 * Cleanup old and excess thoughts
 */
async function cleanupThoughts(userId: string): Promise<void> {
  try {
    // 1. Expire thoughts older than THOUGHT_EXPIRATION_DAYS
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - THOUGHT_EXPIRATION_DAYS);

    await supabase
      .from(IDLE_THOUGHTS_TABLE)
      .update({ expired_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('expired_at', null)
      .lt('generated_at', expirationDate.toISOString());

    // 2. Cap unshared thoughts at MAX_UNSHARED_THOUGHTS
    const { data, error } = await supabase
      .from(IDLE_THOUGHTS_TABLE)
      .select('id')
      .eq('user_id', userId)
      .is('shared_at', null)
      .is('expired_at', null)
      .order('generated_at', { ascending: false });

    if (!error && data && data.length > MAX_UNSHARED_THOUGHTS) {
      const idsToExpire = data.slice(MAX_UNSHARED_THOUGHTS).map((r) => r.id);

      await supabase
        .from(IDLE_THOUGHTS_TABLE)
        .update({ expired_at: new Date().toISOString() })
        .in('id', idsToExpire);

      console.log(`[IdleThoughts] Expired ${idsToExpire.length} excess thoughts`);
    }
  } catch (error) {
    console.error('[IdleThoughts] Error in cleanup:', error);
  }
}
