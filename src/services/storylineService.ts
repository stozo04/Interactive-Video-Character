// src/services/storylineService.ts
/**
 * Storyline Service
 *
 * Manages the lifecycle of life events as living storylines.
 * Handles phase transitions, update generation, mood effects, and closure.
 *
 * IMPLEMENTATION STATUS:
 * ✅ Phase 1: TypeScript types, interfaces, core CRUD functions
 * ✅ Phase 2: Phase transition logic, LLM update generation, on-startup processing
 * ⏳ Phase 3: Mood integration
 * ⏳ Phase 4: Prompt integration (2nd message injection)
 * ⏳ Phase 5: Closure sequences
 *
 * PROCESSING MODEL:
 * - Storylines progress based on CALENDAR DAYS (not app runtime)
 * - On app startup, checks for missed days and processes them
 * - Phase transitions and updates happen on startup
 * - Phase 4 will inject storylines into prompt on 2nd user message only
 */

import { supabase } from "./supabaseClient";
import { storeCharacterFact } from "./characterFactsService";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type StorylineCategory = 'work' | 'personal' | 'family' | 'social' | 'creative';

export type StorylineType = 'project' | 'opportunity' | 'challenge' | 'relationship' | 'goal';

export type StorylinePhase =
  | 'announced'      // Just happened, initial excitement/shock
  | 'honeymoon'      // Early enthusiasm, everything feels possible
  | 'reality'        // Challenges become apparent
  | 'active'         // In the thick of it, working through
  | 'climax'         // Critical moment, decision point
  | 'resolving'      // Outcome is clear, processing emotions
  | 'resolved'       // Complete, moved to history
  | 'reflecting';    // Looking back (periodic, after resolved)

export type StorylineOutcome =
  | 'success'        // Achieved the goal
  | 'failure'        // Didn't work out
  | 'abandoned'      // Chose to stop pursuing
  | 'transformed'    // Became something different
  | 'ongoing';       // Still active (for long-term storylines)

type ResolvableOutcome = Exclude<StorylineOutcome, 'ongoing'>;

export type UpdateType =
  // Announcement phase
  | 'initial_reaction'
  | 'processing'
  // Honeymoon phase
  | 'daydreaming'
  | 'planning'
  | 'anticipation'
  // Reality phase
  | 'challenge'
  | 'complication'
  | 'doubt'
  | 'realization'
  // Active phase
  | 'progress'
  | 'setback'
  | 'milestone'
  | 'mood_shift'
  // Climax phase
  | 'decision_point'
  | 'final_push'
  | 'moment_of_truth'
  // Resolving phase
  | 'outcome_reaction'
  | 'emotional_processing'
  | 'meaning_making'
  // Resolved phase
  | 'reflection'
  | 'lesson_learned'
  | 'gratitude'
  // Reflecting phase
  | 'anniversary'
  | 'callback'
  | 'comparison';

// ============================================================================
// CORE INTERFACES
// ============================================================================

export interface LifeStoryline {
  id: string;

  // Core identity
  title: string;
  category: StorylineCategory;
  storylineType: StorylineType;

  // Current state
  phase: StorylinePhase;
  phaseStartedAt: Date;

  // Emotional texture
  currentEmotionalTone: string | null;
  emotionalIntensity: number;

  // Outcome tracking
  outcome: StorylineOutcome | null;
  outcomeDescription: string | null;
  resolutionEmotion: string | null;

  // Mention tracking
  timesMentioned: number;
  lastMentionedAt: Date | null;
  shouldMentionBy: Date | null;

  // Lifecycle
  createdAt: Date;
  resolvedAt: Date | null;

  // Metadata
  initialAnnouncement: string | null;
  stakes: string | null;
  userInvolvement: string | null;
}

export interface StorylineUpdate {
  id: string;
  storylineId: string;

  // Update content
  updateType: UpdateType;
  content: string;
  emotionalTone: string | null;
  shouldRevealAt: Date | null;

  // Tracking
  mentioned: boolean;
  mentionedAt: Date | null;

  createdAt: Date;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CreateStorylineInput {
  title: string;
  category: StorylineCategory;
  storylineType: StorylineType;
  currentEmotionalTone?: string;
  emotionalIntensity?: number;
  initialAnnouncement?: string;
  stakes?: string;
}

export interface CreateUpdateInput {
  updateType: UpdateType;
  content: string;
  emotionalTone?: string;
  shouldRevealAt?: Date;
}

export interface UpdateStorylineInput {
  title?: string;
  phase?: StorylinePhase;
  currentEmotionalTone?: string;
  emotionalIntensity?: number;
  outcome?: StorylineOutcome;
  outcomeDescription?: string;
  resolutionEmotion?: string;
  shouldMentionBy?: Date;
  stakes?: string;
  userInvolvement?: string;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface StorylineRow {
  id: string;
  title: string;
  category: string;
  storyline_type: string;
  phase: string;
  phase_started_at: string;
  current_emotional_tone: string | null;
  emotional_intensity: number;
  outcome: string | null;
  outcome_description: string | null;
  resolution_emotion: string | null;
  times_mentioned: number;
  last_mentioned_at: string | null;
  should_mention_by: string | null;
  created_at: string;
  resolved_at: string | null;
  initial_announcement: string | null;
  stakes: string | null;
  user_involvement: string | null;
}

interface UpdateRow {
  id: string;
  storyline_id: string;
  update_type: string;
  content: string;
  emotional_tone: string | null;
  should_reveal_at: string | null;
  mentioned: boolean;
  mentioned_at: string | null;
  created_at: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mapRowToStoryline(row: StorylineRow): LifeStoryline {
  return {
    id: row.id,
    title: row.title,
    category: row.category as StorylineCategory,
    storylineType: row.storyline_type as StorylineType,
    phase: row.phase as StorylinePhase,
    phaseStartedAt: new Date(row.phase_started_at),
    currentEmotionalTone: row.current_emotional_tone,
    emotionalIntensity: row.emotional_intensity,
    outcome: row.outcome as StorylineOutcome | null,
    outcomeDescription: row.outcome_description,
    resolutionEmotion: row.resolution_emotion,
    timesMentioned: row.times_mentioned,
    lastMentionedAt: row.last_mentioned_at ? new Date(row.last_mentioned_at) : null,
    shouldMentionBy: row.should_mention_by ? new Date(row.should_mention_by) : null,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    initialAnnouncement: row.initial_announcement,
    stakes: row.stakes,
    userInvolvement: row.user_involvement,
  };
}

function mapRowToUpdate(row: UpdateRow): StorylineUpdate {
  return {
    id: row.id,
    storylineId: row.storyline_id,
    updateType: row.update_type as UpdateType,
    content: row.content,
    emotionalTone: row.emotional_tone,
    shouldRevealAt: row.should_reveal_at ? new Date(row.should_reveal_at) : null,
    mentioned: row.mentioned,
    mentionedAt: row.mentioned_at ? new Date(row.mentioned_at) : null,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// CORE CRUD FUNCTIONS (Phase 1 - IMPLEMENTED)
// ============================================================================

const STORYLINES_TABLE = "life_storylines";
const UPDATES_TABLE = "storyline_updates";

/**
 * Create a new storyline
 */
export async function createStoryline(input: CreateStorylineInput): Promise<LifeStoryline | null> {
  try {
    const { data: existingActive, error: activeError } = await supabase
      .from(STORYLINES_TABLE)
      .select("id")
      .is("outcome", null)
      .limit(1);

    if (activeError) {
      console.error("[Storylines] Error checking for active storylines:", activeError);
      return null;
    }

    if (existingActive && existingActive.length > 0) {
      console.warn("[Storylines] Active storyline exists - blocking new storyline creation");
      return null;
    }

    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .insert({
        title: input.title,
        category: input.category,
        storyline_type: input.storylineType,
        current_emotional_tone: input.currentEmotionalTone || null,
        emotional_intensity: input.emotionalIntensity ?? 0.7,
        initial_announcement: input.initialAnnouncement || null,
        stakes: input.stakes || null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("[Storylines] Error creating storyline:", error);
      return null;
    }

    return mapRowToStoryline(data as StorylineRow);
  } catch (error) {
    console.error("[Storylines] Unexpected error creating storyline:", error);
    return null;
  }
}

/**
 * Get all active storylines (outcome is null)
 */
export async function getActiveStorylines(): Promise<LifeStoryline[]> {
  try {
    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .select("*")
      .is("outcome", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Storylines] Error fetching active storylines:", error);
      return [];
    }

    return (data as StorylineRow[]).map(mapRowToStoryline);
  } catch (error) {
    console.error("[Storylines] Unexpected error fetching active storylines:", error);
    return [];
  }
}

/**
 * Get storyline by ID
 */
export async function getStorylineById(id: string): Promise<LifeStoryline | null> {
  try {
    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("[Storylines] Error fetching storyline:", error);
      return null;
    }

    return mapRowToStoryline(data as StorylineRow);
  } catch (error) {
    console.error("[Storylines] Unexpected error fetching storyline:", error);
    return null;
  }
}

/**
 * Update a storyline
 */
export async function updateStoryline(id: string, input: UpdateStorylineInput): Promise<LifeStoryline | null> {
  try {
    const updateData: Record<string, unknown> = {};

    if (input.title !== undefined) updateData.title = input.title;
    if (input.phase !== undefined) {
      updateData.phase = input.phase;
      updateData.phase_started_at = new Date().toISOString();
    }
    if (input.currentEmotionalTone !== undefined) updateData.current_emotional_tone = input.currentEmotionalTone;
    if (input.emotionalIntensity !== undefined) updateData.emotional_intensity = input.emotionalIntensity;
    if (input.outcome !== undefined) {
      updateData.outcome = input.outcome;
      if (input.outcome !== null && input.outcome !== 'ongoing') {
        updateData.resolved_at = new Date().toISOString();
      }
    }
    if (input.outcomeDescription !== undefined) updateData.outcome_description = input.outcomeDescription;
    if (input.resolutionEmotion !== undefined) updateData.resolution_emotion = input.resolutionEmotion;
    if (input.shouldMentionBy !== undefined) updateData.should_mention_by = input.shouldMentionBy?.toISOString() || null;
    if (input.stakes !== undefined) updateData.stakes = input.stakes;
    if (input.userInvolvement !== undefined) updateData.user_involvement = input.userInvolvement;

    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      console.error("[Storylines] Error updating storyline:", error);
      return null;
    }

    return mapRowToStoryline(data as StorylineRow);
  } catch (error) {
    console.error("[Storylines] Unexpected error updating storyline:", error);
    return null;
  }
}

/**
 * Delete a storyline (and all its updates via cascade)
 */
export async function deleteStoryline(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(STORYLINES_TABLE)
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[Storylines] Error deleting storyline:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Storylines] Unexpected error deleting storyline:", error);
    return false;
  }
}

/**
 * Mark a storyline as mentioned (increments counter, updates timestamp)
 */
export async function markStorylineMentioned(id: string): Promise<void> {
  try {
    // First get current times_mentioned count
    const { data: current } = await supabase
      .from(STORYLINES_TABLE)
      .select("times_mentioned")
      .eq("id", id)
      .single();

    if (!current) return;

    const currentCount = (current as { times_mentioned: number }).times_mentioned;

    await supabase
      .from(STORYLINES_TABLE)
      .update({
        times_mentioned: currentCount + 1,
        last_mentioned_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch (error) {
    console.error("[Storylines] Error marking storyline mentioned:", error);
  }
}

/**
 * Add an update to a storyline
 */
export async function addStorylineUpdate(
  storylineId: string,
  update: CreateUpdateInput
): Promise<StorylineUpdate | null> {
  try {
    const shouldRevealAt = update.shouldRevealAt ?? new Date();
    const { data, error } = await supabase
      .from(UPDATES_TABLE)
      .insert({
        storyline_id: storylineId,
        update_type: update.updateType,
        content: update.content,
        emotional_tone: update.emotionalTone || null,
        should_reveal_at: shouldRevealAt.toISOString(),
      })
      .select()
      .single();

    if (error || !data) {
      console.error("[Storylines] Error creating update:", error);
      return null;
    }

    return mapRowToUpdate(data as UpdateRow);
  } catch (error) {
    console.error("[Storylines] Unexpected error creating update:", error);
    return null;
  }
}

/**
 * Get all updates for a storyline
 */
export async function getStorylineUpdates(storylineId: string): Promise<StorylineUpdate[]> {
  try {
    const { data, error } = await supabase
      .from(UPDATES_TABLE)
      .select("*")
      .eq("storyline_id", storylineId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Storylines] Error fetching updates:", error);
      return [];
    }

    return (data as UpdateRow[]).map(mapRowToUpdate);
  } catch (error) {
    console.error("[Storylines] Unexpected error fetching updates:", error);
    return [];
  }
}

/**
 * Get unmentioned updates for a storyline
 */
export async function getUnmentionedUpdates(storylineId: string): Promise<StorylineUpdate[]> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from(UPDATES_TABLE)
      .select("*")
      .eq("storyline_id", storylineId)
      .eq("mentioned", false)
      .or(`should_reveal_at.is.null,should_reveal_at.lte.${now}`)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Storylines] Error fetching unmentioned updates:", error);
      return [];
    }

    return (data as UpdateRow[]).map(mapRowToUpdate);
  } catch (error) {
    console.error("[Storylines] Unexpected error fetching unmentioned updates:", error);
    return [];
  }
}

/**
 * Mark an update as mentioned
 */
export async function markUpdateMentioned(updateId: string): Promise<void> {
  try {
    await supabase
      .from(UPDATES_TABLE)
      .update({
        mentioned: true,
        mentioned_at: new Date().toISOString(),
      })
      .eq("id", updateId);
  } catch (error) {
    console.error("[Storylines] Error marking update mentioned:", error);
  }
}

/**
 * Get resolved storylines for callbacks
 */
export async function getResolvedStorylines(limit: number = 10): Promise<LifeStoryline[]> {
  try {
    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .select("*")
      .not("outcome", "is", null)
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[Storylines] Error fetching resolved storylines:", error);
      return [];
    }

    return (data as StorylineRow[]).map(mapRowToStoryline);
  } catch (error) {
    console.error("[Storylines] Unexpected error fetching resolved storylines:", error);
    return [];
  }
}

// ============================================================================
// PHASE TRANSITION CONFIGURATION (Phase 2)
// ============================================================================

interface PhaseTransition {
  from: StorylinePhase;
  to: StorylinePhase;
  minDays: number;        // Minimum days before transition possible
  maxDays: number;        // Maximum days before transition forced
  probability: number;    // Daily probability after minDays
}

/**
 * Phase transition rules (from feature spec).
 * Each transition defines how storylines progress through phases over time.
 */
const PHASE_TRANSITIONS: PhaseTransition[] = [
  // Announcement → Honeymoon (quick, 1-3 days)
  {
    from: 'announced',
    to: 'honeymoon',
    minDays: 1,
    maxDays: 3,
    probability: 0.5,
  },

  // Honeymoon → Reality (3-7 days, challenges emerge)
  {
    from: 'honeymoon',
    to: 'reality',
    minDays: 3,
    maxDays: 7,
    probability: 0.3,
  },

  // Reality → Active (2-5 days, start working through)
  {
    from: 'reality',
    to: 'active',
    minDays: 2,
    maxDays: 5,
    probability: 0.4,
  },

  // Active → Climax (7-21 days, reaching decision point)
  {
    from: 'active',
    to: 'climax',
    minDays: 7,
    maxDays: 21,
    probability: 0.15,
  },

  // Climax → Resolving (1-3 days, outcome becomes clear)
  {
    from: 'climax',
    to: 'resolving',
    minDays: 1,
    maxDays: 3,
    probability: 0.6,
  },

  // Resolving → Resolved (2-5 days, emotional processing)
  {
    from: 'resolving',
    to: 'resolved',
    minDays: 2,
    maxDays: 5,
    probability: 0.5,
  },
];

// ============================================================================
// PHASE TRANSITION HELPER FUNCTIONS (Phase 2)
// ============================================================================

/**
 * Calculate days between two dates
 */
function daysBetween(startDate: Date, endDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const start = startDate.getTime();
  const end = endDate.getTime();
  return Math.floor((end - start) / msPerDay);
}

/**
 * Find the transition rule for a given phase
 */
function findTransitionRule(currentPhase: StorylinePhase): PhaseTransition | null {
  return PHASE_TRANSITIONS.find(t => t.from === currentPhase) || null;
}

/**
 * Determine if a phase transition should occur
 * @returns true if transition should happen, false otherwise
 */
function shouldTransition(daysInPhase: number, rule: PhaseTransition): boolean {
  // Force transition if maxDays exceeded
  if (daysInPhase >= rule.maxDays) {
    return true;
  }

  // No transition if minDays not reached
  if (daysInPhase < rule.minDays) {
    return false;
  }

  // Apply probability for days between minDays and maxDays
  return Math.random() < rule.probability;
}

// ============================================================================
// PHASE TRANSITION FUNCTIONS (Phase 2 - IMPLEMENTED)
// ============================================================================

/**
 * Update storyline phase (manual)
 * Phase 2: Now includes automatic phase transition logic
 */
export async function updateStorylinePhase(id: string, newPhase: StorylinePhase): Promise<void> {
  console.log(`📖 [Storylines] Manual phase update: ${id} → ${newPhase}`);
  await updateStoryline(id, { phase: newPhase });
}

/**
 * Check and process phase transitions for all active storylines.
 * Phase 2: Fully implemented with time-based rules and probabilities.
 *
 * Algorithm:
 * 1. Get all active storylines (outcome is null)
 * 2. For each storyline, calculate days in current phase
 * 3. Find applicable transition rule
 * 4. Apply probability logic (minDays, maxDays, probability)
 * 5. Transition phase if criteria met
 */
export async function checkPhaseTransitions(): Promise<void> {
  try {
    console.log('📖 [Storylines] Checking phase transitions for active storylines...');

    // Get all active storylines
    const activeStorylines = await getActiveStorylines();

    if (activeStorylines.length === 0) {
      console.log('📖 [Storylines] No active storylines to check');
      return;
    }

    console.log(`📖 [Storylines] Found ${activeStorylines.length} active storyline(s)`);

    const now = new Date();
    let transitionCount = 0;

    // Check each storyline for phase transition
    for (const storyline of activeStorylines) {
      // Skip if already in final phase
      if (storyline.phase === 'resolved' || storyline.phase === 'reflecting') {
        continue;
      }

      // Calculate days in current phase
      const daysInPhase = daysBetween(storyline.phaseStartedAt, now);

      // Find transition rule for current phase
      const rule = findTransitionRule(storyline.phase);
      if (!rule) {
        console.log(`📖 [Storylines] No transition rule for phase: ${storyline.phase} (storyline: ${storyline.title})`);
        continue;
      }

      // Check if transition should occur
      if (shouldTransition(daysInPhase, rule)) {
        console.log(`📖 [Storylines] Transitioning "${storyline.title}": ${rule.from} → ${rule.to} (${daysInPhase} days in phase)`);

        await updateStoryline(storyline.id, {
          phase: rule.to,
          // Phase update automatically sets phase_started_at in updateStoryline()
        });

        transitionCount++;
      } else {
        console.log(`📖 [Storylines] No transition for "${storyline.title}": ${storyline.phase} (${daysInPhase}/${rule.maxDays} days)`);
      }
    }

    console.log(`📖 [Storylines] Phase transition check complete: ${transitionCount} transition(s) applied`);

  } catch (error) {
    console.error('📖 [Storylines] Error checking phase transitions:', error);
  }
}

/**
 * Process daily storyline updates (generate new updates, check transitions).
 * Phase 2: Fully implemented.
 *
 * This is the main daily processing function called by the scheduler.
 * It handles all daily storyline maintenance tasks.
 *
 * Algorithm:
 * 1. Check phase transitions for all active storylines
 * 2. For each active storyline, attempt to generate an update
 * 3. Set should_mention_by deadlines for unmentioned updates
 */
export async function processStorylineDay(): Promise<void> {
  try {
    console.log('📖 [Storylines] ========== Daily Processing Started ==========');

    // Step 1: Check phase transitions
    await checkPhaseTransitions();

    // Step 2: Generate updates for active storylines
    const activeStorylines = await getActiveStorylines();

    if (activeStorylines.length === 0) {
      console.log('📖 [Storylines] No active storylines to process');
      return;
    }

    console.log(`📖 [Storylines] Processing ${activeStorylines.length} active storyline(s)`);

    let updatesGenerated = 0;

    for (const storyline of activeStorylines) {
      // Skip resolved storylines (shouldn't happen, but safety check)
      if (storyline.outcome !== null && storyline.phase === 'resolved') {
        continue;
      }

      // Attempt to generate update
      const update = await generateStorylineUpdate(storyline);
      if (update) {
        updatesGenerated++;

        // Step 3: Set should_mention_by deadline (24 hours from now)
        const mentionDeadline = new Date();
        mentionDeadline.setHours(mentionDeadline.getHours() + 24);

        await updateStoryline(storyline.id, {
          shouldMentionBy: mentionDeadline,
        });

        console.log(`📖 [Storylines] Set mention deadline for "${storyline.title}": ${mentionDeadline.toISOString()}`);
      }
    }

    // Step 4: Auto-resolve storylines stuck in climax (5+ days)
    const climaxStorylines = activeStorylines.filter(s => s.phase === 'climax');
    for (const storyline of climaxStorylines) {
      const daysInClimax = daysBetween(storyline.phaseStartedAt, new Date());

      if (daysInClimax >= 5) {
        console.log(`📖 [Storylines] Auto-resolving "${storyline.title}" (${daysInClimax} days in climax)`);

        const outcomeWeights: Record<ResolvableOutcome, number> = {
          success: 0.5,
          transformed: 0.3,
          failure: 0.15,
          abandoned: 0.05,
        };

        const outcome = weightedRandomSelect(outcomeWeights);
        await initiateStorylineClosure(storyline.id, outcome);
      }
    }

    console.log(`📖 [Storylines] ========== Daily Processing Complete: ${updatesGenerated} update(s) generated ==========`);

  } catch (error) {
    console.error('📖 [Storylines] Error in daily processing:', error);
  }
}

// ============================================================================
// ON-STARTUP PROCESSING (Phase 2)
// ============================================================================

/**
 * Table to track last storyline processing timestamp.
 * Uses a single-row table with id=1.
 */
const STORYLINE_CONFIG_TABLE = 'storyline_config';

/**
 * Convert UTC date to CST (Central Standard Time).
 * CST is UTC-6 (or UTC-5 during daylight saving, but we use CST year-round for consistency).
 *
 * IMPORTANT: The database stores UTC, but we calculate days in CST to avoid timezone bugs.
 */
function convertUTCtoCST(utcDate: Date): Date {
  const cstDate = new Date(utcDate.getTime() - (6 * 60 * 60 * 1000)); // UTC-6
  return cstDate;
}

/**
 * Get the last processed timestamp from database (in UTC).
 * Returns null if never processed before.
 */
async function getLastProcessedTimestamp(): Promise<Date | null> {
  try {
    const { data, error } = await supabase
      .from(STORYLINE_CONFIG_TABLE)
      .select('last_processed_at')
      .eq('id', 1)
      .single();

    if (error || !data) {
      console.log('📖 [Storylines] No last processed timestamp found (first run)');
      return null;
    }

    return new Date(data.last_processed_at);
  } catch (error) {
    console.error('📖 [Storylines] Error getting last processed timestamp:', error);
    return null;
  }
}

/**
 * Update the last processed timestamp in database (UTC).
 */
async function updateLastProcessedTimestamp(timestamp: Date): Promise<void> {
  try {
    const { error } = await supabase
      .from(STORYLINE_CONFIG_TABLE)
      .upsert({
        id: 1,
        last_processed_at: timestamp.toISOString(),
      });

    if (error) {
      console.error('📖 [Storylines] Error updating last processed timestamp:', error);
    }
  } catch (error) {
    console.error('📖 [Storylines] Error updating last processed timestamp:', error);
  }
}

/**
 * Calculate days between two dates (in CST timezone).
 * This ensures we count calendar days in Central time, not UTC.
 */
function daysBetweenCST(startDate: Date, endDate: Date): number {
  const startCST = convertUTCtoCST(startDate);
  const endCST = convertUTCtoCST(endDate);

  // Reset to midnight CST for accurate day counting
  startCST.setHours(0, 0, 0, 0);
  endCST.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((endCST.getTime() - startCST.getTime()) / msPerDay);
}

/**
 * Process storylines on app startup.
 * Checks for missed days and processes them.
 *
 * USAGE: Call this once when the app starts (from App.tsx or main entry point).
 *
 * Algorithm:
 * 1. Get last processed timestamp (UTC from database)
 * 2. Calculate days since last process (in CST)
 * 3. If 1+ days passed, process each missed day
 * 4. Update last processed timestamp
 *
 * IMPORTANT: Uses CST timezone for day calculations to avoid timezone bugs.
 */
export async function processStorylineOnStartup(): Promise<void> {
  try {
    console.log('📖 [Storylines] ========== On-Startup Processing ==========');

    const now = new Date(); // UTC
    const lastProcessed = await getLastProcessedTimestamp();

    if (!lastProcessed) {
      // First run ever - just set timestamp and exit
      console.log('📖 [Storylines] First run - initializing timestamp');
      await updateLastProcessedTimestamp(now);
      return;
    }

    // Calculate days since last process (in CST)
    const daysSince = daysBetweenCST(lastProcessed, now);

    console.log(`📖 [Storylines] Last processed: ${lastProcessed.toISOString()} (${daysSince} day(s) ago in CST)`);

    if (daysSince < 1) {
      console.log('📖 [Storylines] Already processed today - skipping');
      return;
    }

    // Process missed days
    console.log(`📖 [Storylines] Processing ${daysSince} missed day(s)...`);

    for (let i = 0; i < daysSince; i++) {
      console.log(`📖 [Storylines] Processing day ${i + 1}/${daysSince}...`);
      await processStorylineDay();
    }

    // Update last processed timestamp
    await updateLastProcessedTimestamp(now);

    console.log('📖 [Storylines] ========== On-Startup Processing Complete ==========');

  } catch (error) {
    console.error('📖 [Storylines] Error in on-startup processing:', error);
  }
}

// ============================================================================
// PHASE BEHAVIOR CONFIGURATION (Phase 2)
// ============================================================================

interface PhaseBehavior {
  phase: StorylinePhase;
  emotionalRange: string[];
  mentionFrequency: 'high' | 'medium' | 'low' | 'very_low';
  moodImpact: number;
  promptGuidance: string;
  updateTypes: UpdateType[];
  updateIntervalDays: number;  // How often to generate updates
}

/**
 * Phase-specific behaviors that guide update generation and mood effects.
 * From feature spec lines 276-341
 */
const PHASE_BEHAVIORS: PhaseBehavior[] = [
  {
    phase: 'announced',
    emotionalRange: ['excited', 'shocked', 'nervous', 'thrilled', 'disbelieving'],
    mentionFrequency: 'high',
    moodImpact: 0.3,
    promptGuidance: `This JUST happened. You're still processing. Share the news with genuine emotion - excitement, nervousness, disbelief. You want to talk about it.`,
    updateTypes: ['initial_reaction', 'processing'],
    updateIntervalDays: 1,
  },
  {
    phase: 'honeymoon',
    emotionalRange: ['optimistic', 'dreamy', 'hopeful', 'giddy'],
    mentionFrequency: 'medium',
    moodImpact: 0.4,
    promptGuidance: `You're in the excited early phase. Everything feels possible. You might daydream about outcomes or share hopeful thoughts. The challenges haven't hit yet.`,
    updateTypes: ['daydreaming', 'planning', 'anticipation'],
    updateIntervalDays: 2,
  },
  {
    phase: 'reality',
    emotionalRange: ['anxious', 'overwhelmed', 'uncertain', 'stressed', 'determined'],
    mentionFrequency: 'medium',
    moodImpact: -0.2,
    promptGuidance: `The rose-colored glasses are off. You're seeing the challenges. You might vent about complications or express doubt. This is normal and human.`,
    updateTypes: ['challenge', 'complication', 'doubt', 'realization'],
    updateIntervalDays: 2,
  },
  {
    phase: 'active',
    emotionalRange: ['focused', 'tired', 'frustrated', 'hopeful', 'determined', 'stressed'],
    mentionFrequency: 'low',
    moodImpact: 0,
    promptGuidance: `You're in the work phase. Some days are good, some are hard. Share progress or frustrations naturally. This affects your energy level.`,
    updateTypes: ['progress', 'setback', 'milestone', 'mood_shift', 'realization'],
    updateIntervalDays: 3,
  },
  {
    phase: 'climax',
    emotionalRange: ['anxious', 'hopeful', 'terrified', 'determined', 'on_edge'],
    mentionFrequency: 'high',
    moodImpact: -0.3,
    promptGuidance: `Critical moment. Big decision coming or happening. You're thinking about this A LOT. It's affecting your focus and mood significantly.`,
    updateTypes: ['decision_point', 'final_push', 'moment_of_truth'],
    updateIntervalDays: 1,
  },
  {
    phase: 'resolving',
    emotionalRange: ['relieved', 'disappointed', 'processing', 'numb', 'bittersweet'],
    mentionFrequency: 'high',
    moodImpact: 0.2,
    promptGuidance: `The outcome is clear. You're processing emotions. Share what happened and how you feel. You need to talk about it to process.`,
    updateTypes: ['outcome_reaction', 'emotional_processing', 'meaning_making'],
    updateIntervalDays: 1,
  },
  {
    phase: 'resolved',
    emotionalRange: ['peaceful', 'proud', 'sad', 'grateful', 'wistful', 'content'],
    mentionFrequency: 'low',
    moodImpact: 0.1,
    promptGuidance: `It's over. You've processed the main emotions. You can reference it as something that happened, with perspective.`,
    updateTypes: ['reflection', 'lesson_learned', 'gratitude'],
    updateIntervalDays: 7,
  },
  {
    phase: 'reflecting',
    emotionalRange: ['nostalgic', 'grateful', 'proud', 'wistful', 'amused'],
    mentionFrequency: 'very_low',
    moodImpact: 0,
    promptGuidance: `Looking back months later. Reference this as part of your history. "Remember when..." moments.`,
    updateTypes: ['anniversary', 'callback', 'comparison'],
    updateIntervalDays: 30,
  },
];

// ============================================================================
// RESOLUTION TEMPLATES (Phase 5)
// ============================================================================

interface ResolutionTemplate {
  emotions: string[];
  promptGuidance: string;
  closureSteps: UpdateType[];
  moodImpact: number;
}

const RESOLUTION_TEMPLATES: Record<ResolvableOutcome, ResolutionTemplate> = {
  success: {
    emotions: ['thrilled', 'relieved', 'proud', 'grateful', 'surreal'],
    promptGuidance: `You did it! Let yourself celebrate. Share the win genuinely. Thank people who supported you. It's okay to be proud.`,
    closureSteps: ['outcome_reaction', 'gratitude', 'reflection', 'lesson_learned'],
    moodImpact: 0.4,
  },
  failure: {
    emotions: ['disappointed', 'sad', 'frustrated', 'accepting', 'processing'],
    promptGuidance: `It didn't work out. Be honest about disappointment. Don't fake positivity. It's okay to be sad. You'll process this.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'meaning_making', 'lesson_learned'],
    moodImpact: -0.3,
  },
  abandoned: {
    emotions: ['relieved', 'conflicted', 'peaceful', 'guilty', 'certain'],
    promptGuidance: `You chose to stop. That's valid. Explain why without over-justifying. Sometimes walking away is the right choice.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'meaning_making', 'reflection'],
    moodImpact: 0.1,
  },
  transformed: {
    emotions: ['surprised', 'curious', 'excited', 'uncertain', 'open'],
    promptGuidance: `It became something different than expected. Life is weird like that. Share the surprise and what it's becoming.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'reflection', 'lesson_learned'],
    moodImpact: 0.2,
  },
};

/**
 * Find phase behavior configuration for a given phase
 */
function getPhaseBehavior(phase: StorylinePhase): PhaseBehavior | null {
  return PHASE_BEHAVIORS.find(p => p.phase === phase) || null;
}

// ============================================================================
// LLM UPDATE GENERATION (Phase 2 - IMPLEMENTED)
// ============================================================================

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY is not set');
    }
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return geminiClient;
}

/**
 * Determine if a storyline should generate an update.
 * Based on days since last update and phase-specific intervals.
 *
 * @param storyline - The storyline to check
 * @returns true if update should be generated
 */
function shouldGenerateUpdate(storyline: LifeStoryline, lastUpdateDate: Date | null): boolean {
  const phaseBehavior = getPhaseBehavior(storyline.phase);
  if (!phaseBehavior) return false;

  const now = new Date();
  const daysSinceLastUpdate = lastUpdateDate
    ? daysBetween(lastUpdateDate, now)
    : daysBetween(storyline.createdAt, now);

  const intervalDays = phaseBehavior.updateIntervalDays;

  // Not enough time passed
  if (daysSinceLastUpdate < intervalDays) {
    return false;
  }

  // Probability increases as we exceed interval
  const overdueDays = daysSinceLastUpdate - intervalDays;
  const probability = Math.min(0.9, 0.3 + (overdueDays * 0.2));

  return Math.random() < probability;
}

/**
 * Build the LLM prompt for generating a storyline update.
 * From feature spec lines 490-518.
 */
function buildUpdateGenerationPrompt(
  storyline: LifeStoryline,
  phaseBehavior: PhaseBehavior,
  previousUpdates: StorylineUpdate[]
): string {
  const daysInPhase = daysBetween(storyline.phaseStartedAt, new Date());

  // Format previous updates for context
  const updatesContext = previousUpdates.length > 0
    ? previousUpdates
        .slice(-3)  // Last 3 updates for context
        .map(u => `[${u.updateType}] ${u.content}`)
        .join('\n')
    : 'No previous updates';

  // Format valid update types for this phase
  const validUpdateTypes = phaseBehavior.updateTypes.join(' | ');

  return `You are generating a storyline update for Kayley's life.

STORYLINE:
Title: ${storyline.title}
Category: ${storyline.category}
Type: ${storyline.storylineType}
Current Phase: ${storyline.phase}
Days in Phase: ${daysInPhase}
Current Emotion: ${storyline.currentEmotionalTone || 'neutral'}
Previous Updates:
${updatesContext}
Stakes: ${storyline.stakes || 'Not specified'}

PHASE CONTEXT:
${phaseBehavior.promptGuidance}

Generate a realistic update that:
1. Fits the current phase naturally
2. Adds depth or new information
3. Feels like genuine life progression
4. Has emotional authenticity
5. Isn't too dramatic (life is often mundane)

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "updateType": "${validUpdateTypes}",
  "content": "The actual update in Kayley's voice (first person, casual, 1-2 sentences)",
  "emotionalTone": "one word emotion from phase's emotional range"
}`;
}

/**
 * Generate a new update for a storyline using LLM.
 * Phase 2: Fully implemented with Gemini integration.
 *
 * Algorithm:
 * 1. Get phase behavior configuration
 * 2. Fetch previous updates for context
 * 3. Build LLM prompt with storyline context
 * 4. Call Gemini to generate update
 * 5. Parse JSON response
 * 6. Create and return update record
 *
 * @param storyline - The storyline to generate an update for
 * @returns Promise resolving to the created update, or null if generation fails/skipped
 */
export async function generateStorylineUpdate(storyline: LifeStoryline): Promise<StorylineUpdate | null> {
  try {
    console.log(`📖 [Storylines] Generating update for: "${storyline.title}" (${storyline.phase})`);

    // Get phase behavior
    const phaseBehavior = getPhaseBehavior(storyline.phase);
    if (!phaseBehavior) {
      console.log(`📖 [Storylines] No behavior config for phase: ${storyline.phase}`);
      return null;
    }

    // Get previous updates for context
    const previousUpdates = await getStorylineUpdates(storyline.id);
    const lastUpdateDate = previousUpdates.length > 0
      ? previousUpdates[previousUpdates.length - 1].createdAt
      : null;

    // Check if update should be generated
    if (!shouldGenerateUpdate(storyline, lastUpdateDate)) {
      console.log(`📖 [Storylines] Skipping update generation (not enough time passed)`);
      return null;
    }

    // Build prompt
    const prompt = buildUpdateGenerationPrompt(storyline, phaseBehavior, previousUpdates);

    // Call Gemini LLM
    const ai = getGeminiClient();
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,  // Higher for creative variation
        maxOutputTokens: 300,
      }
    });

    const responseText = result.text || '{}';
    console.log(`📖 [Storylines] LLM response: ${responseText.slice(0, 100)}...`);

    // Parse JSON response
    let parsed: any;
    try {
      // Remove markdown code blocks if present
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('📖 [Storylines] Failed to parse LLM response:', responseText);
      return null;
    }

    // Validate response structure
    if (!parsed.updateType || !parsed.content || !parsed.emotionalTone) {
      console.error('📖 [Storylines] Invalid response structure:', parsed);
      return null;
    }

    // Create the update
    const update = await addStorylineUpdate(storyline.id, {
      updateType: parsed.updateType as UpdateType,
      content: parsed.content,
      emotionalTone: parsed.emotionalTone,
    });

    if (update) {
      console.log(`📖 [Storylines] Generated update: [${update.updateType}] "${update.content.slice(0, 60)}..."`);
    }

    return update;

  } catch (error) {
    console.error('📖 [Storylines] Error generating update:', error);
    return null;
  }
}

function weightedRandomSelect(weights: Record<ResolvableOutcome, number>): ResolvableOutcome {
  const entries = Object.entries(weights) as [ResolvableOutcome, number][];
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let random = Math.random() * totalWeight;

  for (const [key, weight] of entries) {
    random -= weight;
    if (random <= 0) {
      return key;
    }
  }

  return entries[0][0];
}

// ============================================================================
// CLOSURE & RESOLUTION (Phase 5 - NOT YET IMPLEMENTED)
// ============================================================================

function buildClosureUpdatePrompt(
  storyline: LifeStoryline,
  outcome: ResolvableOutcome,
  outcomeDescription: string,
  updateType: UpdateType,
  emotion: string,
  promptGuidance: string,
  dayNumber: number
): string {
  return `You are generating a closure update for Kayley's storyline.

STORYLINE:
Title: ${storyline.title}
Category: ${storyline.category}
Type: ${storyline.storylineType}
Outcome: ${outcome}
Outcome Description: "${outcomeDescription}"

CLOSURE CONTEXT:
This is day ${dayNumber + 1} of the closure sequence (4 days total).
Update Type: ${updateType}
Target Emotion: ${emotion}

GUIDANCE:
${promptGuidance}

Generate a realistic update that:
1. Reflects the ${updateType} stage of closure
2. Captures ${emotion} emotion authentically
3. Feels like genuine emotional processing (not forced positivity)
4. Is 1-2 sentences in Kayley's voice (first person, casual)
5. Advances the closure journey appropriately for day ${dayNumber + 1}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "updateType": "${updateType}",
  "content": "The closure update in Kayley's voice",
  "emotionalTone": "${emotion}"
}`;
}

async function generateClosureSequence(
  storyline: LifeStoryline,
  outcome: ResolvableOutcome,
  outcomeDescription: string,
  template: ResolutionTemplate
): Promise<StorylineUpdate[]> {
  const closureUpdates: StorylineUpdate[] = [];
  const baseDate = new Date();

  for (let i = 0; i < template.closureSteps.length; i++) {
    const updateType = template.closureSteps[i];
    const emotion = template.emotions[Math.floor(Math.random() * template.emotions.length)];
    const revealAt = new Date(baseDate);
    revealAt.setDate(baseDate.getDate() + i);

    const prompt = buildClosureUpdatePrompt(
      storyline,
      outcome,
      outcomeDescription,
      updateType,
      emotion,
      template.promptGuidance,
      i
    );

    try {
      const ai = getGeminiClient();
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: 0.7,
          maxOutputTokens: 300,
        }
      });

      const responseText = result.text || '{}';
      let parsed: any;
      try {
        const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.error('📖 [Storylines] Failed to parse closure update:', responseText);
        continue;
      }

      if (!parsed.updateType || !parsed.content || !parsed.emotionalTone) {
        console.error('📖 [Storylines] Invalid closure update structure:', parsed);
        continue;
      }

      const update = await addStorylineUpdate(storyline.id, {
        updateType: parsed.updateType as UpdateType,
        content: parsed.content,
        emotionalTone: parsed.emotionalTone,
        shouldRevealAt: revealAt,
      });

      if (update) {
        closureUpdates.push(update);
        console.log(`📖 [Storylines] Generated closure update ${i + 1}/4: [${update.updateType}] "${update.content.slice(0, 60)}..."`);
      }
    } catch (error) {
      console.warn('📖 [Storylines] Error generating closure update:', error);
    }
  }

  return closureUpdates;
}

async function generateOutcomeDescription(
  storyline: LifeStoryline,
  outcome: ResolvableOutcome
): Promise<string> {
  const template = RESOLUTION_TEMPLATES[outcome];

  const prompt = `Generate a brief outcome description for this storyline.

STORYLINE:
Title: ${storyline.title}
Category: ${storyline.category}
Type: ${storyline.storylineType}
Stakes: ${storyline.stakes || 'Not specified'}

OUTCOME: ${outcome}

Generate a 1-sentence description of what happened (outcome).
Examples:
- Success: "Signed the contract! I'm officially a partnered creator."
- Failure: "They went with someone else. Disappointing but I'll be okay."
- Abandoned: "Decided to walk away. The terms weren't right for me."
- Transformed: "The partnership turned into something completely different - now it's a collab instead of a contract."

Respond with ONLY the description (no quotes, no explanation):`;

  const ai = getGeminiClient();
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 100,
    }
  });

  return result.text?.trim() || `Storyline ${outcome}`;
}

async function extractStorylineLearning(
  storyline: LifeStoryline,
  outcome: ResolvableOutcome,
  outcomeDescription: string
): Promise<string | null> {
  const prompt = `Extract a brief learning or insight from this storyline outcome.

STORYLINE: ${storyline.title}
OUTCOME: ${outcome} - "${outcomeDescription}"

What did Kayley learn from this experience? Keep it brief (1 sentence).
Examples:
- "learned that I need to negotiate for creative control in brand deals"
- "discovered I can't sustain 3 posts per week without burning out"
- "realized walking away is sometimes the right choice"

Respond with ONLY the learning (no quotes, no explanation):`;

  const ai = getGeminiClient();
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.7, maxOutputTokens: 100 }
  });

  return result.text?.trim() || null;
}

/**
 * Resolve a storyline with outcome and description
 * TODO: Phase 5 - Implement closure sequence generation
 */
export async function resolveStoryline(
  id: string,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  resolutionEmotion?: string
): Promise<void> {
  console.log(`📖 [Storylines] Resolving storyline ${id} with outcome: ${outcome}`);

  if (outcome === 'ongoing') {
    console.warn(`📖 [Storylines] Cannot resolve storyline ${id} with outcome 'ongoing'`);
    return;
  }

  const storyline = await getStorylineById(id);
  if (!storyline) {
    console.error(`📖 [Storylines] Storyline not found: ${id}`);
    return;
  }

  const template = RESOLUTION_TEMPLATES[outcome];
  if (!template) {
    console.error(`📖 [Storylines] Invalid outcome type: ${outcome}`);
    return;
  }

  await updateStoryline(id, {
    phase: 'resolving',
    outcome,
    outcomeDescription,
    resolutionEmotion: resolutionEmotion || template.emotions[0],
  });

  try {
    const closureUpdates = await generateClosureSequence(
      storyline,
      outcome,
      outcomeDescription,
      template
    );
    console.log(`📖 [Storylines] Generated ${closureUpdates.length} closure updates for "${storyline.title}"`);
  } catch (error) {
    console.warn('📖 [Storylines] Failed to generate closure sequence:', error);
  }

  try {
    if (outcome === 'success' || outcome === 'failure' || outcome === 'abandoned') {
      const learning = await extractStorylineLearning(storyline, outcome, outcomeDescription);
      if (learning) {
        await storeCharacterFact('experience', `storyline_${storyline.id}`, learning);
        console.log(`📖 [Storylines] Stored learning as character fact: "${learning.slice(0, 60)}..."`);
      }
    }
  } catch (error) {
    console.warn('📖 [Storylines] Failed to store storyline learning:', error);
  }

  console.log(`📖 [Storylines] Resolution mood impact: ${template.moodImpact}`);
}

/**
 * Initiate storyline closure sequence
 * TODO: Phase 5 - Implement multi-day closure flow
 */
export async function initiateStorylineClosure(
  id: string,
  outcome: StorylineOutcome
): Promise<void> {
  console.log(`📖 [Storylines] Initiating closure for storyline ${id} with outcome: ${outcome}`);

  if (outcome === 'ongoing') {
    console.warn(`📖 [Storylines] Cannot initiate closure with outcome 'ongoing'`);
    return;
  }

  const storyline = await getStorylineById(id);
  if (!storyline) {
    console.error(`📖 [Storylines] Storyline not found: ${id}`);
    return;
  }

  const outcomeDescription = await generateOutcomeDescription(storyline, outcome);
  await resolveStoryline(id, outcome, outcomeDescription);
}

/**
 * Get a resolved storyline for callback mention
 * TODO: Phase 5 - Implement historical callback selection
 */
export async function getResolvedStorylineForCallback(): Promise<LifeStoryline | null> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .select('*')
      .not('outcome', 'is', null)
      .not('resolved_at', 'is', null)
      .lte('resolved_at', thirtyDaysAgo.toISOString())
      .or(`last_mentioned_at.is.null,last_mentioned_at.lte.${fourteenDaysAgo.toISOString()}`)
      .order('emotional_intensity', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      console.log('📖 [Storylines] No eligible resolved storylines for callback');
      return null;
    }

    const storylines = (data as StorylineRow[]).map(mapRowToStoryline);
    const totalWeight = storylines.reduce((sum, s) => sum + s.emotionalIntensity, 0);
    const random = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    for (const storyline of storylines) {
      cumulativeWeight += storyline.emotionalIntensity;
      if (random <= cumulativeWeight) {
        console.log(`📖 [Storylines] Selected callback: "${storyline.title}" (${storyline.outcome})`);
        return storyline;
      }
    }

    return storylines[0] || null;
  } catch (error) {
    console.error('📖 [Storylines] Error getting callback storyline:', error);
    return null;
  }
}

// ============================================================================
// MOOD INTEGRATION (Phase 3 - NOT YET IMPLEMENTED)
// ============================================================================

export interface StorylineMoodEffect {
  storylineId: string;
  phase: StorylinePhase;
  currentEmotion: string | null;
  moodDelta: number;        // -1 to 1
  energyDelta: number;      // -1 to 1
  preoccupation: number;    // 0 to 1, how much mental space this takes
}

/**
 * Get mood effects from all active storylines.
 * Phase 3: Emotional Integration
 *
 * Calculates how active storylines affect Kayley's mood and energy levels.
 * Implemented in Phase 3.
 *
 * @returns Array of mood effects from all active storylines
 */
export async function getStorylineMoodEffects(): Promise<StorylineMoodEffect[]> {
  try {
    // Step 1: Get all active storylines (outcome is null)
    const activeStorylines = await getActiveStorylines();

    if (activeStorylines.length === 0) {
      console.log('📖 [Storylines] No active storylines affecting mood');
      return [];
    }

    console.log(`📖 [Storylines] Calculating mood effects for ${activeStorylines.length} active storyline(s)`);

    // Preoccupation values by phase (from spec lines 394-403)
    const preoccupationByPhase: Record<StorylinePhase, number> = {
      announced: 0.8,
      honeymoon: 0.5,
      reality: 0.6,
      active: 0.4,
      climax: 0.9,
      resolving: 0.7,
      resolved: 0.2,
      reflecting: 0.1,
    };

    // Stressful phases that drain energy
    const stressfulPhases: StorylinePhase[] = ['reality', 'active', 'climax'];

    // Step 2: Calculate mood effect for each storyline
    const effects: StorylineMoodEffect[] = activeStorylines.map(storyline => {
      const phaseBehavior = getPhaseBehavior(storyline.phase);

      if (!phaseBehavior) {
        console.warn(`📖 [Storylines] No phase behavior found for phase: ${storyline.phase}`);
        return {
          storylineId: storyline.id,
          phase: storyline.phase,
          currentEmotion: storyline.currentEmotionalTone,
          moodDelta: 0,
          energyDelta: 0,
          preoccupation: 0,
        };
      }

      // Mood delta: base mood impact × emotional intensity
      const moodDelta = phaseBehavior.moodImpact * storyline.emotionalIntensity;

      // Energy delta: -0.1 × intensity for stressful phases, 0 otherwise
      const energyDelta = stressfulPhases.includes(storyline.phase)
        ? -0.1 * storyline.emotionalIntensity
        : 0;

      // Preoccupation: how much mental space this takes
      const basePreoccupation = preoccupationByPhase[storyline.phase] || 0;
      const preoccupation = basePreoccupation * storyline.emotionalIntensity;

      console.log(`📖 [Storylines] "${storyline.title}" (${storyline.phase}): mood ${moodDelta.toFixed(2)}, energy ${energyDelta.toFixed(2)}, preoccupation ${preoccupation.toFixed(2)}`);

      return {
        storylineId: storyline.id,
        phase: storyline.phase,
        currentEmotion: storyline.currentEmotionalTone,
        moodDelta,
        energyDelta,
        preoccupation,
      };
    });

    // Step 3: Log total effects
    const totalMoodDelta = effects.reduce((sum, e) => sum + e.moodDelta, 0);
    const totalEnergyDelta = effects.reduce((sum, e) => sum + e.energyDelta, 0);
    const totalPreoccupation = effects.reduce((sum, e) => sum + e.preoccupation, 0);

    console.log(`📖 [Storylines] Total effects - Mood: ${totalMoodDelta.toFixed(2)}, Energy: ${totalEnergyDelta.toFixed(2)}, Preoccupation: ${totalPreoccupation.toFixed(2)}`);

    return effects;
  } catch (error) {
    console.error('📖 [Storylines] Error calculating mood effects:', error);
    return []; // Return empty array on error (fail gracefully)
  }
}

// ============================================================================
// PROMPT INTEGRATION (Phase 4 - IMPLEMENTED)
// ============================================================================

export interface StorylinePromptContext {
  hasActiveStorylines: boolean;
  activeStorylines: LifeStoryline[];
  unmentionedUpdates: StorylineUpdate[];
  mostPressingStoryline: LifeStoryline | null;
  promptSection: string;
}

/**
 * Calculate salience score for a storyline.
 * Salience determines priority for prompt injection.
 *
 * Algorithm:
 * - Base score from phase urgency (0.1 to 1.0)
 * - Multiplied by emotional intensity
 * - Bonus +0.3 if storyline has unmentioned updates
 */
function calculateStorylineSalience(
  storyline: LifeStoryline,
  hasUnmentionedUpdate: boolean
): number {
  // Phase urgency values (from implementation prompt)
  const phaseUrgency: Record<StorylinePhase, number> = {
    announced: 1.0,    // Just happened - high urgency
    climax: 1.0,       // Critical moment - high urgency
    resolving: 0.9,    // Outcome clear - want to share
    honeymoon: 0.6,    // Excited but not urgent
    reality: 0.5,      // Ongoing - medium salience
    active: 0.4,       // Background work - lower salience
    resolved: 0.2,     // Wrapped up - low salience
    reflecting: 0.1,   // Historical - very low salience
  };

  const urgency = phaseUrgency[storyline.phase] || 0.4;
  const baseSalience = urgency * storyline.emotionalIntensity;
  const updateBonus = hasUnmentionedUpdate ? 0.3 : 0;

  return baseSalience + updateBonus;
}

/**
 * Build the formatted prompt section for active storylines.
 *
 * Format matches the spec in Life_Event_Storylines.md lines 735-776.
 */
function buildStorylinePromptSection(
  activeStorylines: LifeStoryline[],
  unmentionedUpdates: StorylineUpdate[]
): string {
  if (activeStorylines.length === 0) {
    return '';
  }

  let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT'S HAPPENING IN YOUR LIFE (Active Storylines)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are ongoing things in YOUR life that affect your mood and might come up naturally.

`;

  for (const storyline of activeStorylines) {
    const phaseBehavior = PHASE_BEHAVIORS.find(p => p.phase === storyline.phase);
    const unmentionedUpdate = unmentionedUpdates.find(u => u.storylineId === storyline.id);

    section += `**${storyline.title}** (${storyline.category})
Phase: ${storyline.phase} | Feeling: ${storyline.currentEmotionalTone || 'neutral'}
${phaseBehavior?.promptGuidance || ''}

`;

    if (unmentionedUpdate) {
      section += `📍 Recent development: "${unmentionedUpdate.content}"
   You haven't mentioned this yet. Share it if it feels natural.

`;
    }

    if (storyline.stakes) {
      section += `Why this matters to you: ${storyline.stakes}

`;
    }
  }

  section += `GUIDELINES:
- These are YOUR experiences. They affect YOUR mood.
- Don't info-dump. Mention things naturally when relevant.
- If user asks "how are you?" these might color your answer.
- You can bring things up unprompted if they're weighing on you.
- Share struggles genuinely. You don't have to be positive all the time.
`;

  return section;
}

/**
 * Get storyline context for system prompt injection (2nd message only).
 * Phase 4: Fully implemented.
 *
 * Algorithm:
 * 1. Get all active storylines (outcome is null)
 * 2. Get recent unmentioned updates (last 7 days)
 * 3. Calculate salience for each storyline
 * 4. Filter out low-intensity storylines (< 0.3)
 * 5. Sort by salience (highest first)
 * 6. Limit to top 5 storylines (token efficiency)
 * 7. Build formatted prompt section
 * 8. Return context object
 */
export async function getStorylinePromptContext(): Promise<StorylinePromptContext> {
  try {
    // Step 1: Get all active storylines
    const allActiveStorylines = await getActiveStorylines();

    if (allActiveStorylines.length === 0) {
      console.log('📖 [Storylines] No active storylines for prompt context');
      return {
        hasActiveStorylines: false,
        activeStorylines: [],
        unmentionedUpdates: [],
        mostPressingStoryline: null,
        promptSection: '',
      };
    }

    // Step 2: Get unmentioned updates from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const now = new Date();
    const { data: recentUnmentionedUpdates, error } = await supabase
      .from(UPDATES_TABLE)
      .select('*')
      .eq('mentioned', false)
      .gte('created_at', sevenDaysAgo.toISOString())
      .or(`should_reveal_at.is.null,should_reveal_at.lte.${now.toISOString()}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('📖 [Storylines] Error fetching unmentioned updates:', error);
    }

    const unmentionedUpdates = (recentUnmentionedUpdates as UpdateRow[] || []).map(mapRowToUpdate);

    console.log(`📖 [Storylines] Found ${allActiveStorylines.length} active storyline(s), ${unmentionedUpdates.length} unmentioned update(s)`);

    // Step 3: Calculate salience and create scored list
    interface ScoredStoryline {
      storyline: LifeStoryline;
      salience: number;
      hasUnmentionedUpdate: boolean;
    }

    const scoredStorylines: ScoredStoryline[] = allActiveStorylines.map(storyline => {
      const hasUnmentionedUpdate = unmentionedUpdates.some(u => u.storylineId === storyline.id);
      const salience = calculateStorylineSalience(storyline, hasUnmentionedUpdate);

      return { storyline, salience, hasUnmentionedUpdate };
    });

    // Step 4: Filter out low-intensity storylines (< 0.3 emotional intensity)
    const significantStorylines = scoredStorylines.filter(s => s.storyline.emotionalIntensity >= 0.3);

    if (significantStorylines.length === 0) {
      console.log('📖 [Storylines] No significant storylines (all < 0.3 intensity)');
      return {
        hasActiveStorylines: false,
        activeStorylines: [],
        unmentionedUpdates: [],
        mostPressingStoryline: null,
        promptSection: '',
      };
    }

    // Step 5: Sort by salience (highest first)
    significantStorylines.sort((a, b) => b.salience - a.salience);

    // Step 6: Limit to top 5 (token efficiency)
    const top5 = significantStorylines.slice(0, 5);
    const activeStorylines = top5.map(s => s.storyline);
    const mostPressing = top5[0].storyline;

    console.log(`📖 [Storylines] Building prompt context for ${activeStorylines.length} storyline(s)`);
    console.log(`📖 [Storylines] Most pressing: "${mostPressing.title}" (salience: ${top5[0].salience.toFixed(2)})`);

    // Step 7: Build formatted prompt section
    const promptSection = buildStorylinePromptSection(activeStorylines, unmentionedUpdates);

    // Step 8: Return context object
    return {
      hasActiveStorylines: true,
      activeStorylines,
      unmentionedUpdates,
      mostPressingStoryline: mostPressing,
      promptSection,
    };

  } catch (error) {
    console.error('📖 [Storylines] Error building prompt context:', error);
    return {
      hasActiveStorylines: false,
      activeStorylines: [],
      unmentionedUpdates: [],
      mostPressingStoryline: null,
      promptSection: '',
    };
  }
}
