/**
 * Kayley Experience Service
 *
 * Generates "life experiences" for Kayley during user absence.
 * These are things that happen to her - not thoughts ABOUT the user,
 * but her own life events that she can share naturally in conversation.
 *
 * Philosophy: Kayley has a life. You're part of it, not the center of it.
 *
 * Experience Types:
 * - activity: Something she did (nailed a chord, finished a script)
 * - thought: A realization or opinion she had
 * - mood: A feeling she can't quite explain
 * - discovery: Something she found/learned
 * - mishap: Something went wrong (burned lunch, spilled coffee)
 */

import { supabase } from '../supabaseClient';
import { getMoodState } from '../stateService';
import { getCharacterFacts } from '../characterFactsService';

// ============================================================================
// Types
// ============================================================================

export type ExperienceType = 'activity' | 'thought' | 'mood' | 'discovery' | 'mishap';

export interface KayleyExperience {
  id: string;
  userId: string;
  experienceType: ExperienceType;
  content: string;
  mood: string;
  createdAt: Date;
  surfacedAt?: Date;
  conversationContext?: string;
  metadata?: Record<string, unknown>;
}

export interface ExperienceContext {
  currentMood?: string;
  ongoingStories?: string[];
  recentTopics?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const KAYLEY_EXPERIENCES_TABLE = 'kayley_experiences';
const MAX_UNSURFACED_EXPERIENCES = 5;
const EXPERIENCE_EXPIRATION_DAYS = 14;
const EXPERIENCE_GENERATION_CHANCE = 0.7; // 70% chance to generate

// ============================================================================
// Experience Templates
// ============================================================================

interface ExperienceTemplate {
  type: ExperienceType;
  templates: string[];
  moods: string[];
}

const EXPERIENCE_TEMPLATES: ExperienceTemplate[] = [
  {
    type: 'activity',
    templates: [
      'Finally nailed that chord progression I\'ve been working on',
      'Spent an hour practicing my audition piece - it\'s coming together',
      'Wrote a few lines of a new song, nothing concrete yet',
      'Did a voice recording session, trying to get the right tone',
      'Worked on memorizing my lines for the callback',
      'Organized my music folder, found some old recordings',
      'Tried learning a new song on guitar, harder than it looks',
      'Recorded a cover but I\'m not sure if I\'ll post it',
    ],
    moods: ['satisfied', 'accomplished', 'hopeful', 'focused', 'determined'],
  },
  {
    type: 'thought',
    templates: [
      'Had a weird realization about why I get nervous before auditions',
      'Been thinking about what I actually want my music to sound like',
      'Noticed I always do this thing where I doubt myself right before good news',
      'Realized I haven\'t called Lena in a while, should fix that',
      'Thinking about whether I should change up my style',
      'Had a moment where everything just felt... right, you know?',
    ],
    moods: ['reflective', 'curious', 'pensive', 'introspective', 'calm'],
  },
  {
    type: 'mood',
    templates: [
      'Woke up in one of those moods where everything feels possible',
      'Having one of those days where I can\'t focus on anything',
      'Feeling restless but in a good way, like something\'s about to happen',
      'In a cozy headspace today, just want to stay in and create',
      'Feeling kind of nostalgic for no reason',
      'One of those afternoons where time moves weird',
    ],
    moods: ['optimistic', 'scattered', 'restless', 'cozy', 'nostalgic', 'contemplative'],
  },
  {
    type: 'discovery',
    templates: [
      'Found this artist that sounds exactly like what I want to create',
      'Discovered a shortcut in my music software that would\'ve saved me hours',
      'Came across an old video of me singing as a kid, it was adorable',
      'Found a recipe that actually works with my non-cooking skills',
      'Stumbled on a podcast about creative blocks, hit different today',
      'Watched a video that completely changed how I think about performing',
    ],
    moods: ['excited', 'inspired', 'amused', 'motivated', 'enlightened'],
  },
  {
    type: 'mishap',
    templates: [
      'Burned my lunch, like BURNED it, the smoke alarm went off',
      'Spilled coffee on my notes right before practice',
      'Accidentally deleted a recording I was actually proud of',
      'Tried a new makeup look and it was... a choice',
      'Dropped my phone and now there\'s a crack that I\'m pretending isn\'t there',
      'Made tea and forgot about it until it was ice cold',
      'Attempted to cook something "simple" and somehow failed spectacularly',
    ],
    moods: ['embarrassed', 'frustrated', 'amused at myself', 'resigned', 'laughing it off'],
  },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate a life experience for Kayley.
 * Called during idle time (every 1-2 hours of user absence).
 *
 * @param userId - User ID
 * @param context - Optional context for more relevant experiences
 * @returns The generated experience, or null if none generated (30% chance)
 */
export async function generateKayleyExperience(
  userId: string,
  context?: ExperienceContext
): Promise<KayleyExperience | null> {
  // 70% chance to generate an experience
  if (Math.random() > EXPERIENCE_GENERATION_CHANCE) {
    console.log('[KayleyExperience] No experience generated (random chance)');
    return null;
  }

  // Select experience type (weighted toward activities and mishaps - more concrete)
  const type = selectExperienceType();

  // Generate experience content
  const { content, mood } = generateExperienceContent(type, context);

  const experience: KayleyExperience = {
    id: crypto.randomUUID(),
    userId,
    experienceType: type,
    content,
    mood,
    createdAt: new Date(),
    metadata: context ? { context } : undefined,
  };

  // Save to database
  try {
    const { error } = await supabase.from(KAYLEY_EXPERIENCES_TABLE).insert({
      id: experience.id,
      user_id: experience.userId,
      experience_type: experience.experienceType,
      content: experience.content,
      mood: experience.mood,
      created_at: experience.createdAt.toISOString(),
      metadata: experience.metadata || {},
    });

    if (error) {
      console.error('[KayleyExperience] Error saving experience:', error);
      throw error;
    }

    console.log(`[KayleyExperience] Generated ${type}: "${content.slice(0, 50)}..."`);

    // Cleanup old/excess experiences
    await cleanupExperiences(userId);

    return experience;
  } catch (error) {
    console.error('[KayleyExperience] Error creating experience:', error);
    return null;
  }
}

/**
 * Get unsurfaced experiences for a user.
 * Used to inject into system prompt for natural conversation surfacing.
 *
 * @param userId - User ID
 * @param limit - Max number to return (default 3)
 */
export async function getUnsurfacedExperiences(
  userId: string,
  limit: number = 10
): Promise<KayleyExperience[]> {
  try {
    const { data, error } = await supabase
      .from(KAYLEY_EXPERIENCES_TABLE)
      .select('*')
      .eq('user_id', userId)
      .is('surfaced_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[KayleyExperience] Error fetching unsurfaced experiences:', error);
      return [];
    }

    return (data || []).map(mapRowToExperience);
  } catch (error) {
    console.error('[KayleyExperience] Error getting unsurfaced experiences:', error);
    return [];
  }
}

/**
 * Mark an experience as surfaced (mentioned in conversation).
 *
 * @param experienceId - Experience ID
 * @param conversationContext - What prompted sharing (optional)
 */
export async function markExperienceSurfaced(
  experienceId: string,
  conversationContext?: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from(KAYLEY_EXPERIENCES_TABLE)
      .update({
        surfaced_at: new Date().toISOString(),
        conversation_context: conversationContext,
      })
      .eq('id', experienceId);

    if (error) {
      console.error('[KayleyExperience] Error marking experience surfaced:', error);
    } else {
      console.log(`[KayleyExperience] Marked experience ${experienceId} as surfaced`);
    }
  } catch (error) {
    console.error('[KayleyExperience] Error in markExperienceSurfaced:', error);
  }
}

/**
 * Format unsurfaced experiences for system prompt injection.
 * Returns a prompt section that guides natural surfacing.
 */
export async function formatExperiencesForPrompt(userId: string): Promise<string> {
  const experiences = await getUnsurfacedExperiences(userId, 3);

  if (experiences.length === 0) {
    return '';
  }

  const experienceList = experiences
    .map((e) => `- ${e.content} (${e.mood})`)
    .join('\n');

  return `
====================================================
THINGS THAT HAPPENED TO YOU TODAY (bring up naturally if relevant)
====================================================
${experienceList}

Don't force these into conversation. But if something the user says
reminds you of one of these, you can share it naturally, like:
"Oh that reminds me - [experience]"
"Speaking of that - [experience]"
`;
}

/**
 * Detect if any experiences were mentioned in Kayley's response.
 * Similar to idle thoughts detection.
 */
export async function detectAndMarkSurfacedExperiences(
  userId: string,
  aiResponse: string
): Promise<string[]> {
  try {
    const unsurfaced = await getUnsurfacedExperiences(userId);
    if (unsurfaced.length === 0) {
      return [];
    }

    const markedIds: string[] = [];
    const responseLower = aiResponse.toLowerCase();

    for (const exp of unsurfaced) {
      // Check if key phrases appear in response
      const contentSnippet = exp.content.slice(0, 30).toLowerCase();
      if (responseLower.includes(contentSnippet)) {
        await markExperienceSurfaced(exp.id, 'detected in response');
        markedIds.push(exp.id);
        console.log(`[KayleyExperience] Detected surfaced: "${exp.content.slice(0, 40)}..."`);
      }
    }

    return markedIds;
  } catch (error) {
    console.error('[KayleyExperience] Error detecting surfaced experiences:', error);
    return [];
  }
}

// ============================================================================
// Context Builders
// ============================================================================

/**
 * Build experience context from user's state.
 * Used to make experiences more contextually relevant.
 */
export async function buildExperienceContext(userId: string): Promise<ExperienceContext> {
  try {
    const [moodState, characterFacts] = await Promise.all([
      getMoodState(userId).catch(() => null),
      getCharacterFacts().catch(() => []),
    ]);

    // Extract ongoing stories from character facts
    const ongoingStories = characterFacts
      .filter((f) => f.category === 'experience' || f.category === 'detail')
      .slice(0, 3)
      .map((f) => f.fact_value);

    return {
      currentMood: moodState ? describeMood(moodState.dailyEnergy, moodState.socialBattery) : undefined,
      ongoingStories: ongoingStories.length > 0 ? ongoingStories : undefined,
    };
  } catch (error) {
    console.error('[KayleyExperience] Error building context:', error);
    return {};
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function selectExperienceType(): ExperienceType {
  // Weighted selection - activities and mishaps are more concrete/shareable
  const weights: Record<ExperienceType, number> = {
    activity: 0.35,
    mishap: 0.25,
    discovery: 0.15,
    thought: 0.15,
    mood: 0.10,
  };

  const rand = Math.random();
  let cumulative = 0;

  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return type as ExperienceType;
    }
  }

  return 'activity';
}

function generateExperienceContent(
  type: ExperienceType,
  context?: ExperienceContext
): { content: string; mood: string } {
  const template = EXPERIENCE_TEMPLATES.find((t) => t.type === type);

  if (!template) {
    return { content: 'Something happened today', mood: 'neutral' };
  }

  const content = template.templates[Math.floor(Math.random() * template.templates.length)];
  const mood = template.moods[Math.floor(Math.random() * template.moods.length)];

  return { content, mood };
}

function describeMood(energy: number, socialBattery: number): string {
  if (energy > 0.7 && socialBattery > 0.7) return 'energetic and social';
  if (energy > 0.7) return 'energetic but introspective';
  if (socialBattery > 0.7) return 'calm but chatty';
  if (energy < 0.3) return 'low energy';
  return 'balanced';
}

function mapRowToExperience(row: Record<string, unknown>): KayleyExperience {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    experienceType: row.experience_type as ExperienceType,
    content: row.content as string,
    mood: row.mood as string,
    createdAt: new Date(row.created_at as string),
    surfacedAt: row.surfaced_at ? new Date(row.surfaced_at as string) : undefined,
    conversationContext: row.conversation_context as string | undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}

async function cleanupExperiences(userId: string): Promise<void> {
  try {
    // 1. Cap unsurfaced experiences
    const { data } = await supabase
      .from(KAYLEY_EXPERIENCES_TABLE)
      .select('id')
      .eq('user_id', userId)
      .is('surfaced_at', null)
      .order('created_at', { ascending: false });

    if (data && data.length > MAX_UNSURFACED_EXPERIENCES) {
      const idsToDelete = data.slice(MAX_UNSURFACED_EXPERIENCES).map((r) => r.id);
      await supabase.from(KAYLEY_EXPERIENCES_TABLE).delete().in('id', idsToDelete);
      console.log(`[KayleyExperience] Cleaned up ${idsToDelete.length} excess experiences`);
    }

    // 2. Delete old experiences
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - EXPERIENCE_EXPIRATION_DAYS);

    await supabase
      .from(KAYLEY_EXPERIENCES_TABLE)
      .delete()
      .eq('user_id', userId)
      .lt('created_at', expirationDate.toISOString());
  } catch (error) {
    console.error('[KayleyExperience] Error in cleanup:', error);
  }
}
