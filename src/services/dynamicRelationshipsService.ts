// src/services/dynamicRelationshipsService.ts
/**
 * Dynamic Relationships Service
 *
 * Manages Kayley's relationships with people in her life (friends, family, colleagues)
 * from two perspectives:
 *
 * 1. KAYLEY'S PERSPECTIVE (Global - kayley_people table)
 *    - Who this person is to Kayley
 *    - Current relationship status (close, distant, etc.)
 *    - What's happening in their life right now
 *    - Kayley's internal notes about them
 *
 * 2. USER'S PERSPECTIVE (Per-user - user_person_relationships table)
 *    - How much this user knows about this person
 *    - User's familiarity/warmth/trust with the person
 *    - Conversation history about this person
 *    - How many times Kayley has mentioned them
 *
 * This dual-perspective system allows:
 * - Kayley to have consistent relationships across all users
 * - Each user to have their own unique knowledge/connection to Kayley's people
 * - Natural conversation progression (strangers -> acquaintances -> friends)
 */

import { supabase } from './supabaseClient';

// ============================================
// Types
// ============================================

export type RelationshipStatus = 'close' | 'friendly' | 'neutral' | 'distant' | 'strained';
export type UserRelationshipState = 'unknown' | 'heard_of' | 'familiar' | 'connected';

export interface PersonSituationEvent {
  date: string;           // ISO8601 date
  event: string;          // What happened in their life
}

export interface UserPersonEvent {
  date: string;           // ISO8601 date
  event: string;          // What was discussed/mentioned
  sentiment?: string;     // positive, neutral, negative
}

export interface ScoreChanges {
  warmthChange?: number;
  trustChange?: number;
  familiarityChange?: number;
}

// Kayley's perspective (global)
export interface KayleyPerson {
  id: string;
  personKey: string;
  personName: string;
  personRole: string;               // "Best friend from college", "Mom", etc.
  relationshipStatus: RelationshipStatus;
  lastInteractionDate?: string;     // Last time Kayley interacted with them
  currentSituation: PersonSituationEvent[];  // What's happening in their life
  kayleyNotes?: string;             // Kayley's internal thoughts about them
  createdAt: Date;
  updatedAt: Date;
}

// User's perspective (per-user)
export interface UserPersonRelationship {
  id: string;
  userId: string;
  personKey: string;
  warmthScore: number;              // -50 to +50 (how positively user feels)
  trustScore: number;               // -50 to +50 (how much user trusts them)
  familiarityScore: number;         // 0 to 100 (how much user knows about them)
  relationshipState: UserRelationshipState;
  mentionCount: number;             // How many times Kayley mentioned them
  lastMentionedAt?: Date;
  userEvents: UserPersonEvent[];    // Conversation history about this person
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Constants
// ============================================

const KAYLEY_PEOPLE_TABLE = 'kayley_people';
const USER_PERSON_REL_TABLE = 'user_person_relationships';

// ============================================
// Kayley's Perspective (Global)
// ============================================

/**
 * Get a person from Kayley's life
 *
 * @param personKey - The person's unique key
 * @returns The person, or null if not found
 */
export const getPerson = async (
  personKey: string
): Promise<KayleyPerson | null> => {
  try {
    const { data, error } = await supabase
      .from(KAYLEY_PEOPLE_TABLE)
      .select('*')
      .eq('person_key', personKey)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapRowToKayleyPerson(data);

  } catch (error) {
    console.error('[DynamicRelationships] Error getting person:', error);
    return null;
  }
};

/**
 * Update what's happening in a person's life (add event to current_situation)
 *
 * @param personKey - The person to update
 * @param event - What happened in their life
 * @returns true if successful
 */
export const updatePersonSituation = async (
  personKey: string,
  event: string
): Promise<boolean> => {
  try {
    // Get current person
    const person = await getPerson(personKey);
    if (!person) {
      console.error(`[DynamicRelationships] Person not found: ${personKey}`);
      return false;
    }

    // Add new event to situation array
    const newEvent: PersonSituationEvent = {
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      event
    };

    const updatedSituation = [...person.currentSituation, newEvent];

    const { error } = await supabase
      .from(KAYLEY_PEOPLE_TABLE)
      .update({
        current_situation: updatedSituation,
        last_interaction_date: newEvent.date
      })
      .eq('person_key', personKey)
      .single();

    if (error) {
      console.error('[DynamicRelationships] Failed to update person situation:', error);
      return false;
    }

    console.log(`✨ [DynamicRelationships] Updated ${person.personName}'s situation: "${event}"`);
    return true;

  } catch (error) {
    console.error('[DynamicRelationships] Error updating person situation:', error);
    return false;
  }
};

/**
 * Update Kayley's relationship status with a person
 *
 * @param personKey - The person to update
 * @param status - New relationship status
 * @returns true if successful
 */
export const updatePersonStatus = async (
  personKey: string,
  status: RelationshipStatus
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(KAYLEY_PEOPLE_TABLE)
      .update({
        relationship_status: status
      })
      .eq('person_key', personKey)
      .single();

    if (error) {
      console.error('[DynamicRelationships] Failed to update person status:', error);
      return false;
    }

    console.log(`✨ [DynamicRelationships] Updated ${personKey}'s status to: ${status}`);
    return true;

  } catch (error) {
    console.error('[DynamicRelationships] Error updating person status:', error);
    return false;
  }
};

// ============================================
// User's Perspective (Per-User)
// ============================================

/**
 * Get or create a user's relationship with a person
 * Creates the relationship with default scores if it doesn't exist
 *
 * @param userId - The user
 * @param personKey - The person
 * @returns The relationship, or null on error
 */
export const getUserPersonRelationship = async (
  userId: string,
  personKey: string
): Promise<UserPersonRelationship | null> => {
  try {
    // Try to get existing relationship
    const { data, error } = await supabase
      .from(USER_PERSON_REL_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('person_key', personKey)
      .maybeSingle();

    if (error) {
      console.error('[DynamicRelationships] Error getting user-person relationship:', error);
      return null;
    }

    // If exists, return it
    if (data) {
      return mapRowToUserPersonRel(data);
    }

    // Otherwise, create it
    const { data: newData, error: insertError } = await supabase
      .from(USER_PERSON_REL_TABLE)
      .insert({
        user_id: userId,
        person_key: personKey,
        warmth_score: 0.0,
        trust_score: 0.0,
        familiarity_score: 0.0,
        relationship_state: 'unknown',
        mention_count: 0,
        user_events: []
      })
      .select()
      .single();

    if (insertError || !newData) {
      console.error('[DynamicRelationships] Failed to create user-person relationship:', insertError);
      return null;
    }

    console.log(`✨ [DynamicRelationships] Created relationship for user ${userId} <-> ${personKey}`);
    return mapRowToUserPersonRel(newData);

  } catch (error) {
    console.error('[DynamicRelationships] Error in getUserPersonRelationship:', error);
    return null;
  }
};

/**
 * Update user's warmth/trust/familiarity scores with a person
 * Scores are clamped to valid ranges:
 * - warmth: -50 to +50
 * - trust: -50 to +50
 * - familiarity: 0 to 100
 *
 * @param userId - The user
 * @param personKey - The person
 * @param changes - Score changes to apply
 * @returns Updated relationship, or null on error
 */
export const updateUserPersonScores = async (
  userId: string,
  personKey: string,
  changes: ScoreChanges
): Promise<UserPersonRelationship | null> => {
  try {
    // Get current relationship
    const rel = await getUserPersonRelationship(userId, personKey);
    if (!rel) {
      console.error(`[DynamicRelationships] Relationship not found: ${userId} <-> ${personKey}`);
      return null;
    }

    // Apply changes with clamping
    const newWarmth = clampScore(
      rel.warmthScore + (changes.warmthChange || 0),
      -50,
      50
    );
    const newTrust = clampScore(
      rel.trustScore + (changes.trustChange || 0),
      -50,
      50
    );
    const newFamiliarity = clampScore(
      rel.familiarityScore + (changes.familiarityChange || 0),
      0,
      100
    );

    // Determine relationship state based on scores
    const relationshipState = calculateRelationshipState(newFamiliarity, newWarmth);

    const { data, error } = await supabase
      .from(USER_PERSON_REL_TABLE)
      .update({
        warmth_score: newWarmth,
        trust_score: newTrust,
        familiarity_score: newFamiliarity,
        relationship_state: relationshipState
      })
      .match({ user_id: userId, person_key: personKey })
      .single();

    if (error) {
      console.error('[DynamicRelationships] Failed to update user-person scores:', error);
      return null;
    }

    console.log(`✨ [DynamicRelationships] Updated scores for ${userId} <-> ${personKey}`);
    return mapRowToUserPersonRel(data);

  } catch (error) {
    console.error('[DynamicRelationships] Error updating user-person scores:', error);
    return null;
  }
};

/**
 * Log an event in the user's conversation history about a person
 * Increments mention_count and updates last_mentioned_at
 *
 * @param userId - The user
 * @param personKey - The person
 * @param event - What was discussed
 * @param sentiment - Optional sentiment (positive, neutral, negative)
 * @returns true if successful
 */
export const logUserPersonEvent = async (
  userId: string,
  personKey: string,
  event: string,
  sentiment?: string
): Promise<boolean> => {
  try {
    // Get current relationship
    const rel = await getUserPersonRelationship(userId, personKey);
    if (!rel) {
      console.error(`[DynamicRelationships] Relationship not found: ${userId} <-> ${personKey}`);
      return false;
    }

    // Add new event to user_events array
    const newEvent: UserPersonEvent = {
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      event,
      sentiment
    };

    const updatedEvents = [...rel.userEvents, newEvent];

    const { error } = await supabase
      .from(USER_PERSON_REL_TABLE)
      .update({
        user_events: updatedEvents,
        mention_count: rel.mentionCount + 1,
        last_mentioned_at: new Date().toISOString()
      })
      .match({ user_id: userId, person_key: personKey })
      .single();

    if (error) {
      console.error('[DynamicRelationships] Failed to log user-person event:', error);
      return false;
    }

    console.log(`✨ [DynamicRelationships] Logged event for ${userId} <-> ${personKey}: "${event}"`);
    return true;

  } catch (error) {
    console.error('[DynamicRelationships] Error logging user-person event:', error);
    return false;
  }
};

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format dynamic relationships for inclusion in system prompt
 * Shows BOTH Kayley's perspective AND user's perspective for each person
 *
 * @param userId - The user (for user-specific perspective)
 * @returns Formatted string for prompt injection
 */
export const formatDynamicRelationshipsForPrompt = async (
  userId: string
): Promise<string> => {
  try {
    // Get all people in Kayley's life
    const { data: people, error: peopleError } = await supabase
      .from(KAYLEY_PEOPLE_TABLE)
      .select('*');

    if (peopleError || !people || people.length === 0) {
      return '';
    }

    let formatted = '\n\n## People in Your Life\n\n';
    formatted += 'These are real people in YOUR life. You have relationships with them that exist independently of any user.\n\n';

    for (const personRow of people) {
      const person = mapRowToKayleyPerson(personRow);

      // Get user's relationship with this person
      const userRel = await getUserPersonRelationship(userId, person.personKey);

      formatted += `### ${person.personName}\n`;
      formatted += `**Who they are:** ${person.personRole}\n`;
      formatted += `**Your relationship:** ${person.relationshipStatus}\n`;

      // Recent events in their life
      if (person.currentSituation.length > 0) {
        formatted += `**Recent events:**\n`;
        const recentEvents = person.currentSituation.slice(-3);
        for (const event of recentEvents) {
          formatted += `  - ${event.date}: ${event.event}\n`;
        }
      }

      if (person.kayleyNotes) {
        formatted += `**Your notes:** ${person.kayleyNotes}\n`;
      }

      // User's perspective
      if (userRel) {
        formatted += `\n**User's perspective:**\n`;
        formatted += `- Familiarity: ${userRel.familiarityScore}/100\n`;
        formatted += `- Warmth: ${userRel.warmthScore > 0 ? '+' : ''}${userRel.warmthScore}\n`;
        formatted += `- Trust: ${userRel.trustScore > 0 ? '+' : ''}${userRel.trustScore}\n`;
        formatted += `- Mentioned to user: ${userRel.mentionCount} times\n`;
        formatted += `- Relationship state: ${userRel.relationshipState}\n`;
      } else {
        formatted += `\n**User's perspective:** User doesn't know about this person yet\n`;
      }

      formatted += '\n';
    }

    formatted += '**IMPORTANT:**\n';
    formatted += '- These are YOUR real relationships, not the user\'s\n';
    formatted += '- Share about them naturally based on how much the user knows\n';
    formatted += '- Don\'t info-dump - let relationships develop organically\n';
    formatted += '- If user asks about someone they don\'t know, introduce them naturally\n';

    return formatted;

  } catch (error) {
    console.error('[DynamicRelationships] Error formatting relationships for prompt:', error);
    return '';
  }
};

// ============================================
// Helper Functions
// ============================================

function mapRowToKayleyPerson(row: any): KayleyPerson {
  return {
    id: row.id,
    personKey: row.person_key,
    personName: row.person_name,
    personRole: row.person_role,
    relationshipStatus: row.relationship_status,
    lastInteractionDate: row.last_interaction_date,
    currentSituation: row.current_situation || [],
    kayleyNotes: row.kayley_notes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapRowToUserPersonRel(row: any): UserPersonRelationship {
  return {
    id: row.id,
    userId: row.user_id,
    personKey: row.person_key,
    warmthScore: row.warmth_score,
    trustScore: row.trust_score,
    familiarityScore: row.familiarity_score,
    relationshipState: row.relationship_state,
    mentionCount: row.mention_count,
    lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : undefined,
    userEvents: row.user_events || [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calculateRelationshipState(
  familiarity: number,
  warmth: number
): UserRelationshipState {
  if (familiarity === 0) return 'unknown';
  if (familiarity < 20) return 'heard_of';
  if (familiarity < 50) return 'familiar';
  return 'connected';
}

// ============================================
// Exports
// ============================================

export const dynamicRelationshipsService = {
  // Kayley's perspective
  getPerson,
  updatePersonSituation,
  updatePersonStatus,

  // User's perspective
  getUserPersonRelationship,
  updateUserPersonScores,
  logUserPersonEvent,

  // Prompt formatting
  formatDynamicRelationshipsForPrompt
};

export default dynamicRelationshipsService;
