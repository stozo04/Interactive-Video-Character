// src/services/narrativeArcsService.ts
/**
 * Narrative Arcs Service
 *
 * Manages Kayley's ongoing life events, projects, and experiences.
 * This gives Kayley a "living present" that evolves over time,
 * separate from her static backstory in the character profile.
 *
 * Examples:
 * - "Working on a collab video with Sarah" (ongoing project)
 * - "Training for a 5K run" (personal goal)
 * - "Dealing with a difficult client project" (work challenge)
 *
 * Arcs have:
 * - A beginning (started_at)
 * - Middle (events array - progress updates)
 * - End (resolved_at + resolution_summary)
 */

import { supabase } from './supabaseClient';

// ============================================
// Types
// ============================================

export type ArcType = 'ongoing' | 'resolved' | 'paused' | 'abandoned';

export interface ArcEvent {
  date: string;           // ISO8601 timestamp
  event: string;          // Description of what happened
}

export interface NarrativeArc {
  id: string;
  arcKey: string;
  arcTitle: string;
  arcType: ArcType;

  startedAt: Date;
  resolvedAt?: Date;
  resolutionSummary?: string;

  events: ArcEvent[];
  mentionedToUsers: string[];

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateArcParams {
  arcKey: string;
  arcTitle: string;
  initialEvent?: string;      // Optional first event description
  userId?: string;            // User who first heard about this
}

export interface AddEventParams {
  event: string;
  date?: Date;                // Defaults to now
}

export interface ResolveArcParams {
  resolutionSummary: string;
  resolvedAt?: Date;          // Defaults to now
}

// ============================================
// Constants
// ============================================

const NARRATIVE_ARCS_TABLE = 'kayley_narrative_arcs';

// ============================================
// Database Operations
// ============================================

/**
 * Create a new narrative arc (Kayley starts something new)
 *
 * @param params - Arc details
 * @returns The created arc, or null if creation failed
 */
export const createNarrativeArc = async (
  params: CreateArcParams
): Promise<NarrativeArc | null> => {
  try {
    const now = new Date();
    const events: ArcEvent[] = params.initialEvent
      ? [{ date: now.toISOString(), event: params.initialEvent }]
      : [];

    const { data, error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .insert({
        arc_key: params.arcKey,
        arc_title: params.arcTitle,
        arc_type: 'ongoing',
        started_at: now.toISOString(),
        events,
        mentioned_to_users: params.userId ? [params.userId] : []
      })
      .select()
      .single();

    if (error) {
      console.error('[NarrativeArcs] Failed to create arc:', error);
      return null;
    }

    console.log(`✨ [NarrativeArcs] Created arc: "${params.arcTitle}" (${params.arcKey})`);
    return mapRowToArc(data);

  } catch (error) {
    console.error('[NarrativeArcs] Error creating arc:', error);
    return null;
  }
};

/**
 * Get a specific arc by key
 *
 * @param arcKey - The arc's unique key
 * @returns The arc, or null if not found
 */
export const getNarrativeArc = async (
  arcKey: string
): Promise<NarrativeArc | null> => {
  try {
    const { data, error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .select('*')
      .eq('arc_key', arcKey)
      .single();

    if (error || !data) {
      return null;
    }

    return mapRowToArc(data);

  } catch (error) {
    console.error('[NarrativeArcs] Error getting arc:', error);
    return null;
  }
};

/**
 * Get all ongoing arcs (currently happening in Kayley's life)
 *
 * @param userId - Optional: Only get arcs this user knows about
 * @returns Array of ongoing arcs, sorted by most recent first
 */
export const getOngoingArcs = async (
  userId?: string
): Promise<NarrativeArc[]> => {
  try {
    let query = supabase
      .from(NARRATIVE_ARCS_TABLE)
      .select('*')
      .eq('arc_type', 'ongoing')
      .order('started_at', { ascending: false });

    // Filter by user if specified
    if (userId) {
      query = query.contains('mentioned_to_users', [userId]);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[NarrativeArcs] Failed to get ongoing arcs:', error);
      return [];
    }

    return (data || []).map(mapRowToArc);

  } catch (error) {
    console.error('[NarrativeArcs] Error getting ongoing arcs:', error);
    return [];
  }
};

/**
 * Get all arcs (ongoing + resolved), with optional filtering
 *
 * @param options - Filter options
 * @returns Array of arcs
 */
export const getAllArcs = async (options: {
  arcType?: ArcType;
  userId?: string;
  limit?: number;
} = {}): Promise<NarrativeArc[]> => {
  try {
    let query = supabase
      .from(NARRATIVE_ARCS_TABLE)
      .select('*')
      .order('started_at', { ascending: false });

    if (options.arcType) {
      query = query.eq('arc_type', options.arcType);
    }

    if (options.userId) {
      query = query.contains('mentioned_to_users', [options.userId]);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[NarrativeArcs] Failed to get arcs:', error);
      return [];
    }

    return (data || []).map(mapRowToArc);

  } catch (error) {
    console.error('[NarrativeArcs] Error getting arcs:', error);
    return [];
  }
};

/**
 * Add an event to an existing arc (progress update)
 *
 * @param arcKey - The arc to update
 * @param params - Event details
 * @returns true if successful
 */
export const addArcEvent = async (
  arcKey: string,
  params: AddEventParams
): Promise<boolean> => {
  try {
    // Get current arc
    const arc = await getNarrativeArc(arcKey);
    if (!arc) {
      console.error(`[NarrativeArcs] Arc not found: ${arcKey}`);
      return false;
    }

    // Add new event to events array
    const newEvent: ArcEvent = {
      date: (params.date || new Date()).toISOString(),
      event: params.event
    };

    const updatedEvents = [...arc.events, newEvent];

    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({
        events: updatedEvents
      })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to add event:', error);
      return false;
    }

    console.log(`📝 [NarrativeArcs] Added event to "${arc.arcTitle}": "${params.event}"`);
    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error adding event:', error);
    return false;
  }
};

/**
 * Mark an arc as resolved (finished, completed)
 *
 * @param arcKey - The arc to resolve
 * @param params - Resolution details
 * @returns true if successful
 */
export const resolveArc = async (
  arcKey: string,
  params: ResolveArcParams
): Promise<boolean> => {
  try {
    const resolvedAt = params.resolvedAt || new Date();

    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({
        arc_type: 'resolved',
        resolved_at: resolvedAt.toISOString(),
        resolution_summary: params.resolutionSummary
      })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to resolve arc:', error);
      return false;
    }

    console.log(`✅ [NarrativeArcs] Resolved arc "${arcKey}": ${params.resolutionSummary}`);
    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error resolving arc:', error);
    return false;
  }
};

/**
 * Pause an arc (on hold, but not abandoned)
 *
 * @param arcKey - The arc to pause
 * @returns true if successful
 */
export const pauseArc = async (arcKey: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({ arc_type: 'paused' })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to pause arc:', error);
      return false;
    }

    console.log(`⏸️  [NarrativeArcs] Paused arc: ${arcKey}`);
    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error pausing arc:', error);
    return false;
  }
};

/**
 * Resume a paused arc
 *
 * @param arcKey - The arc to resume
 * @returns true if successful
 */
export const resumeArc = async (arcKey: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({ arc_type: 'ongoing' })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to resume arc:', error);
      return false;
    }

    console.log(`▶️  [NarrativeArcs] Resumed arc: ${arcKey}`);
    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error resuming arc:', error);
    return false;
  }
};

/**
 * Mark an arc as abandoned (gave up, didn't work out)
 *
 * @param arcKey - The arc to abandon
 * @param reason - Why it was abandoned
 * @returns true if successful
 */
export const abandonArc = async (
  arcKey: string,
  reason: string
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({
        arc_type: 'abandoned',
        resolution_summary: reason
      })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to abandon arc:', error);
      return false;
    }

    console.log(`🚫 [NarrativeArcs] Abandoned arc "${arcKey}": ${reason}`);
    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error abandoning arc:', error);
    return false;
  }
};

/**
 * Mark that a user has heard about this arc
 *
 * @param arcKey - The arc
 * @param userId - The user who heard about it
 * @returns true if successful
 */
export const markArcMentionedToUser = async (
  arcKey: string,
  userId: string
): Promise<boolean> => {
  try {
    // Get current arc
    const arc = await getNarrativeArc(arcKey);
    if (!arc) {
      console.error(`[NarrativeArcs] Arc not found: ${arcKey}`);
      return false;
    }

    // Check if user already in list
    if (arc.mentionedToUsers.includes(userId)) {
      return true; // Already marked
    }

    const updatedUsers = [...arc.mentionedToUsers, userId];

    const { error } = await supabase
      .from(NARRATIVE_ARCS_TABLE)
      .update({
        mentioned_to_users: updatedUsers
      })
      .eq('arc_key', arcKey);

    if (error) {
      console.error('[NarrativeArcs] Failed to mark user mention:', error);
      return false;
    }

    return true;

  } catch (error) {
    console.error('[NarrativeArcs] Error marking user mention:', error);
    return false;
  }
};

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format narrative arcs for inclusion in system prompt
 *
 * @param userId - Optional: Filter to arcs this user knows about
 * @returns Formatted string for prompt injection
 */
export const formatArcsForPrompt = async (userId?: string): Promise<string> => {
  const ongoingArcs = await getOngoingArcs(userId);

  if (ongoingArcs.length === 0) {
    return '';
  }

  let formatted = '\n\n## Your Current Life (Ongoing Projects & Events)\n\n';
  formatted += 'These are things currently happening in YOUR life right now:\n\n';

  for (const arc of ongoingArcs) {
    formatted += `### ${arc.arcTitle}\n`;
    formatted += `- **Started:** ${formatDate(arc.startedAt)}\n`;

    if (arc.events.length > 0) {
      formatted += `- **Progress:**\n`;
      // Show last 3 events (most recent progress)
      const recentEvents = arc.events.slice(-3);
      for (const event of recentEvents) {
        formatted += `  - ${formatDate(new Date(event.date))}: ${event.event}\n`;
      }
    }

    formatted += '\n';
  }

  formatted += '**IMPORTANT:**\n';
  formatted += '- These are YOUR ongoing projects and experiences\n';
  formatted += '- You can mention them naturally: "Oh, I\'m still working on [thing]"\n';
  formatted += '- You can share updates: "That [thing] I mentioned? It\'s going well!"\n';
  formatted += '- This is your LIFE - it matters and you care about these things\n';

  return formatted;
};

/**
 * Get a summary of recent arc activity for context
 *
 * @param userId - Optional: Filter to user's known arcs
 * @param limit - Max number of arcs to include
 * @returns Compact summary string
 */
export const getArcsSummary = async (
  userId?: string,
  limit: number = 3
): Promise<string> => {
  const ongoingArcs = await getOngoingArcs(userId);

  if (ongoingArcs.length === 0) {
    return 'No ongoing projects or events right now.';
  }

  const topArcs = ongoingArcs.slice(0, limit);
  const summaries = topArcs.map(arc => {
    const latestEvent = arc.events[arc.events.length - 1];
    if (latestEvent) {
      return `"${arc.arcTitle}" - ${latestEvent.event}`;
    }
    return `"${arc.arcTitle}" (just started)`;
  });

  return summaries.join(' | ');
};

// ============================================
// Helper Functions
// ============================================

function mapRowToArc(row: any): NarrativeArc {
  return {
    id: row.id,
    arcKey: row.arc_key,
    arcTitle: row.arc_title,
    arcType: row.arc_type,
    startedAt: new Date(row.started_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolutionSummary: row.resolution_summary,
    events: row.events || [],
    mentionedToUsers: row.mentioned_to_users || [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return 'last week';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return 'last month';
  return `${Math.floor(diffDays / 30)} months ago`;
}

// ============================================
// Exports
// ============================================

export const narrativeArcsService = {
  createNarrativeArc,
  getNarrativeArc,
  getOngoingArcs,
  getAllArcs,
  addArcEvent,
  resolveArc,
  pauseArc,
  resumeArc,
  abandonArc,
  markArcMentionedToUser,
  formatArcsForPrompt,
  getArcsSummary
};

export default narrativeArcsService;
