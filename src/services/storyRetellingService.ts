// src/services/storyRetellingService.ts
/**
 * Story Retelling Service (Phase 3)
 *
 * Manages Kayley's signature stories and tracks which users have heard them.
 * Ensures consistent retelling across conversations with cooldown logic.
 *
 * Key Features:
 * - Global story catalog (predefined + dynamic stories)
 * - Per-user tracking (who heard what, when)
 * - Cooldown logic (don't retell within X days)
 * - Key details preservation (ensure factual consistency)
 *
 * Design Pattern:
 * Follows the dual-table pattern from Phase 2 (Dynamic Relationships):
 * - kayley_stories (global catalog)
 * - user_story_tracking (per-user tracking)
 */

import { supabase } from './supabaseClient';

// ============================================
// Types
// ============================================

export interface StoryDetail {
  detail: string;       // Type of detail: "quote", "year", "person", "location", etc.
  value: string;        // The actual detail value
}

export interface KayleyStory {
  id: string;
  storyKey: string;
  storyTitle: string;
  summary: string;
  keyDetails: StoryDetail[];
  storyType: 'predefined' | 'dynamic';
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStoryTracking {
  id: string;
  userId: string;
  storyKey: string;
  firstToldAt: Date;
  lastToldAt: Date;
  timesTold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStoryParams {
  storyKey: string;
  storyTitle: string;
  summary: string;
  keyDetails: StoryDetail[];
}

export interface StoryTellingCheck {
  hasTold: boolean;
  story?: KayleyStory;
  tracking?: UserStoryTracking;
  canRetell: boolean;        // False if within cooldown period
  daysSinceLastTold?: number;
}

// ============================================
// Constants
// ============================================

const KAYLEY_STORIES_TABLE = 'kayley_stories';
const USER_STORY_TRACKING_TABLE = 'user_story_tracking';

// Cooldown: Don't retell a story within X days (configurable)
const DEFAULT_COOLDOWN_DAYS = 30;  // 30 days by default

// ============================================
// Database Operations - Global Story Catalog
// ============================================

/**
 * Get a story by key
 *
 * @param storyKey - The story's unique key
 * @returns The story, or null if not found
 */
export const getStory = async (
  storyKey: string
): Promise<KayleyStory | null> => {
  try {
    const { data, error } = await supabase
      .from(KAYLEY_STORIES_TABLE)
      .select('*')
      .eq('story_key', storyKey)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapRowToStory(data);

  } catch (error) {
    console.error('[StoryRetelling] Error getting story:', error);
    return null;
  }
};

/**
 * Get all stories (optionally filter by type)
 *
 * @param options - Filter options
 * @returns Array of stories
 */
export const getAllStories = async (options: {
  storyType?: 'predefined' | 'dynamic';
  limit?: number;
} = {}): Promise<KayleyStory[]> => {
  try {
    let query = supabase
      .from(KAYLEY_STORIES_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (options.storyType) {
      query = query.eq('story_type', options.storyType);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error || !data) {
      return [];
    }

    return data.map(mapRowToStory);

  } catch (error) {
    console.error('[StoryRetelling] Error getting all stories:', error);
    return [];
  }
};

/**
 * Create a new dynamic story
 * (Used when Kayley creates a new story during conversation)
 *
 * @param params - Story details
 * @returns The created story, or null if creation failed
 */
export const createDynamicStory = async (
  params: CreateStoryParams
): Promise<KayleyStory | null> => {
  try {
    const { data, error } = await supabase
      .from(KAYLEY_STORIES_TABLE)
      .insert({
        story_key: params.storyKey,
        story_title: params.storyTitle,
        summary: params.summary,
        key_details: params.keyDetails,
        story_type: 'dynamic'
      })
      .select()
      .single();

    if (error) {
      console.error('[StoryRetelling] Failed to create dynamic story:', error);
      return null;
    }

    console.log(`✨ [StoryRetelling] Created dynamic story: "${params.storyTitle}" (${params.storyKey})`);
    return mapRowToStory(data);

  } catch (error) {
    console.error('[StoryRetelling] Error creating dynamic story:', error);
    return null;
  }
};

// ============================================
// Database Operations - User Story Tracking
// ============================================

/**
 * Check if Kayley has told this story to this user
 * Returns: { hasTold, canRetell, story, tracking, daysSinceLastTold }
 *
 * @param userId - The user's ID
 * @param storyKey - The story's key
 * @param cooldownDays - Cooldown period in days (default: 30)
 * @returns Detailed check result
 */
export const checkIfTold = async (
  userId: string,
  storyKey: string,
  cooldownDays: number = DEFAULT_COOLDOWN_DAYS
): Promise<StoryTellingCheck> => {
  try {
    // 1. Get the story
    const story = await getStory(storyKey);

    if (!story) {
      return {
        hasTold: false,
        canRetell: false
      };
    }

    // 2. Check user_story_tracking for this user-story pair
    const { data: trackingData, error: trackingError } = await supabase
      .from(USER_STORY_TRACKING_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('story_key', storyKey)
      .maybeSingle();

    if (trackingError) {
      console.error('[StoryRetelling] Error checking tracking:', trackingError);
      return {
        hasTold: false,
        story,
        canRetell: true
      };
    }

    // If no tracking record exists, story hasn't been told
    if (!trackingData) {
      return {
        hasTold: false,
        story,
        canRetell: true
      };
    }

    const tracking = mapRowToTracking(trackingData);

    // 3. Calculate days since last_told_at
    const now = Date.now();
    const lastTold = tracking.lastToldAt.getTime();
    const daysSince = Math.floor((now - lastTold) / (1000 * 60 * 60 * 24));

    // 4. Determine if cooldown has passed
    const canRetell = daysSince > cooldownDays;

    return {
      hasTold: true,
      story,
      tracking,
      canRetell,
      daysSinceLastTold: daysSince
    };

  } catch (error) {
    console.error('[StoryRetelling] Error in checkIfTold:', error);
    return {
      hasTold: false,
      canRetell: false
    };
  }
};

/**
 * Mark that Kayley told this story to this user
 * - If first time: INSERT into user_story_tracking
 * - If retelling: UPDATE last_told_at, increment times_told
 *
 * @param userId - The user's ID
 * @param storyKey - The story's key
 * @returns true if successful
 */
export const markAsTold = async (
  userId: string,
  storyKey: string
): Promise<boolean> => {
  try {
    // Check if tracking record exists
    const { data: existing, error: selectError } = await supabase
      .from(USER_STORY_TRACKING_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('story_key', storyKey)
      .maybeSingle();

    if (selectError) {
      console.error('[StoryRetelling] Error checking existing tracking:', selectError);
      return false;
    }

    const now = new Date().toISOString();

    if (!existing) {
      // First time telling - INSERT
      const { error: insertError } = await supabase
        .from(USER_STORY_TRACKING_TABLE)
        .insert({
          user_id: userId,
          story_key: storyKey,
          first_told_at: now,
          last_told_at: now,
          times_told: 1
        });

      if (insertError) {
        console.error('[StoryRetelling] Error inserting tracking:', insertError);
        return false;
      }

      console.log(`📖 [StoryRetelling] Marked story "${storyKey}" as told to user ${userId} (first time)`);
      return true;

    } else {
      // Retelling - UPDATE
      const { error: updateError } = await supabase
        .from(USER_STORY_TRACKING_TABLE)
        .update({
          last_told_at: now,
          times_told: (existing.times_told || 1) + 1
        })
        .eq('user_id', userId)
        .eq('story_key', storyKey);

      if (updateError) {
        console.error('[StoryRetelling] Error updating tracking:', updateError);
        return false;
      }

      console.log(`📖 [StoryRetelling] Marked story "${storyKey}" as retold to user ${userId} (count: ${existing.times_told + 1})`);
      return true;
    }

  } catch (error) {
    console.error('[StoryRetelling] Error in markAsTold:', error);
    return false;
  }
};

/**
 * Get all stories told to a specific user
 *
 * @param userId - The user's ID
 * @returns Array of stories with tracking data
 */
export const getStoriesToldToUser = async (
  userId: string
): Promise<Array<KayleyStory & { tracking: UserStoryTracking }>> => {
  try {
    // Get all tracking records for this user
    const { data: trackingData, error: trackingError } = await supabase
      .from(USER_STORY_TRACKING_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('last_told_at', { ascending: false });

    if (trackingError || !trackingData || trackingData.length === 0) {
      return [];
    }

    // Get all stories for these story keys
    const storyKeys = trackingData.map(t => t.story_key);
    const { data: storiesData, error: storiesError } = await supabase
      .from(KAYLEY_STORIES_TABLE)
      .select('*')
      .in('story_key', storyKeys);

    if (storiesError || !storiesData) {
      return [];
    }

    // Combine stories with tracking data
    const storiesMap = new Map(
      storiesData.map(s => [s.story_key, mapRowToStory(s)])
    );

    const result: Array<KayleyStory & { tracking: UserStoryTracking }> = [];

    for (const trackingRow of trackingData) {
      const story = storiesMap.get(trackingRow.story_key);
      if (story) {
        result.push({
          ...story,
          tracking: mapRowToTracking(trackingRow)
        });
      }
    }

    return result;

  } catch (error) {
    console.error('[StoryRetelling] Error getting stories told to user:', error);
    return [];
  }
};

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format stories for inclusion in system prompt
 *
 * Shows:
 * - All predefined stories (with key details)
 * - Stories this user has already heard (marked as "already told")
 * - Instructions on using the recall_story tool
 *
 * @param userId - The user's ID
 * @returns Formatted prompt section
 */
export const formatStoriesForPrompt = async (
  userId: string
): Promise<string> => {
  try {
    // Get all stories
    const allStories = await getAllStories();

    // Get which ones user has heard
    const toldStories = await getStoriesToldToUser(userId);
    const toldKeys = new Set(toldStories.map(s => s.storyKey));

    let formatted = '\n\n## Your Signature Stories\n\n';
    formatted += 'You have stories from your past that you can share with users. ';
    formatted += 'When telling a story, stick to the key details below to ensure consistency.\n\n';

    // Show predefined stories
    const predefinedStories = allStories.filter(s => s.storyType === 'predefined');

    for (const story of predefinedStories) {
      const alreadyTold = toldKeys.has(story.storyKey);

      formatted += `### ${story.storyTitle}`;
      if (alreadyTold) {
        formatted += ' ✓ (Already told to this user)';
      }
      formatted += '\n';

      formatted += `**Summary:** ${story.summary}\n`;
      formatted += `**Key Details (stay consistent!):**\n`;
      for (const detail of story.keyDetails) {
        formatted += `  - ${detail.detail}: ${detail.value}\n`;
      }
      formatted += '\n';
    }

    formatted += '**IMPORTANT:**\n';
    formatted += '- When sharing a story, keep the KEY DETAILS consistent\n';
    formatted += '- You can embellish and add emotion, but core facts must match\n';
    formatted += '- Use the `recall_story` tool if unsure whether you\'ve told a story to this user\n';
    formatted += '- Don\'t retell the same story too soon (check cooldown)\n';

    return formatted;

  } catch (error) {
    console.error('[StoryRetelling] Error formatting stories for prompt:', error);
    return '';
  }
};

// ============================================
// Helpers
// ============================================

/**
 * Map database row to KayleyStory
 */
function mapRowToStory(row: any): KayleyStory {
  return {
    id: row.id,
    storyKey: row.story_key,
    storyTitle: row.story_title,
    summary: row.summary,
    keyDetails: row.key_details || [],
    storyType: row.story_type as 'predefined' | 'dynamic',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

/**
 * Map database row to UserStoryTracking
 */
function mapRowToTracking(row: any): UserStoryTracking {
  return {
    id: row.id,
    userId: row.user_id,
    storyKey: row.story_key,
    firstToldAt: new Date(row.first_told_at),
    lastToldAt: new Date(row.last_told_at),
    timesTold: row.times_told || 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
