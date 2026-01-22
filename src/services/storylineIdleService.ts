/**
 * Storyline Idle Service - Clean v2
 *
 * Purpose-built service for generating storyline suggestions during user absence.
 * No threads, no complexity - just LLM-driven suggestions with direct prompt injection.
 *
 * Flow:
 * 1. Detect user absence (≥30 minutes, using conversation_history.created_at)
 * 2. Generate ONE storyline suggestion via LLM
 * 3. Store in storyline_pending_suggestions table
 * 4. On user return: Inject into system prompt (passive)
 * 5. LLM decides to mention → creates storyline via tool (or doesn't)
 *
 * @module storylineIdleService
 */

import { supabase } from './supabaseClient';
import type { StorylineCategory } from './storylineService';
import { GoogleGenAI } from '@google/genai';
import { KAYLEY_FULL_PROFILE } from "../domain/characters/kayleyCharacterProfile";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pending storyline suggestion (generated during absence)
 */
export interface PendingStorylineSuggestion {
  id: string;
  category: StorylineCategory;
  theme: string; // "learning guitar", "trip planning", "creative project"
  reasoning: string; // Why this matters to Kayley now
  createdAt: Date;
  expiresAt: Date; // created_at + 24 hours
  surfaced: boolean;
  surfacedAt: Date | null;
  wasCreated: boolean;
  storylineId: string | null;
  rejectedReason: string | null;
}

/**
 * LLM suggestion generation result
 */
interface SuggestionGenerationResult {
  category: StorylineCategory;
  theme: string;
  reasoning: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  /** Check every 10 minutes (2 min for testing) */
  CHECK_INTERVAL_MS: 2 * 60 * 1000, // TESTING: 2 min (change to 10 * 60 * 1000 for production)

  /** Generate suggestion after 30 minutes of absence (5 min for testing) */
  ABSENCE_THRESHOLD_MINUTES: 2, // TESTING: 5 min (change to 30 for production)

  /** Suggestions expire after 24 hours */
  SUGGESTION_EXPIRATION_HOURS: 24,

  /** Only 1 pending suggestion at a time */
  MAX_PENDING_SUGGESTIONS: 1,

  /** 48-hour cooldown between suggestions */
  SUGGESTION_COOLDOWN_HOURS: 48,
} as const;

const TABLES = {
  SUGGESTIONS: "storyline_pending_suggestions",
  CONVERSATION_HISTORY: "conversation_history",
  CONFIG: "storyline_config",
  STORYLINES: "life_storylines",
} as const;

// ============================================================================
// GEMINI CLIENT
// ============================================================================

let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

// ============================================================================
// SCHEDULER STATE
// ============================================================================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start the storyline idle service
 *
 * Begins checking for user absence every 10 minutes.
 * Safe to call multiple times (stops existing scheduler first).
 */
export function startStorylineIdleService(): void {
  if (isRunning) {
    // console.log("💭 [StorylineIdle] Already running, stopping first...");
    stopStorylineIdleService();
  }

  //  console.log("💭 [StorylineIdle] Starting idle service...");
  // console.log(
  //   `💭 [StorylineIdle] Config: Check every ${CONFIG.CHECK_INTERVAL_MS / 60000} min, threshold ${CONFIG.ABSENCE_THRESHOLD_MINUTES} min`,
  // );

  // Start periodic checks (first check will run after CHECK_INTERVAL_MS)
  schedulerInterval = setInterval(() => {
    checkForStorylineSuggestion().catch((err) => {
      console.error("💭 [StorylineIdle] Periodic check error:", err);
    });
  }, CONFIG.CHECK_INTERVAL_MS);

  isRunning = true;
  //  console.log("💭 [StorylineIdle] ✅ Started");
}

/**
 * Stop the storyline idle service
 */
export function stopStorylineIdleService(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  isRunning = false;
  //  console.log("💭 [StorylineIdle] Stopped");
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return isRunning;
}

// ============================================================================
// ABSENCE DETECTION
// ============================================================================

/**
 * Get last interaction timestamp (UTC)
 *
 * Queries conversation_history for most recent message.
 *
 * @returns Last interaction date (UTC) or null if no history
 */
async function getLastInteractionTime(): Promise<Date | null> {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONVERSATION_HISTORY)
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(
        "💭 [StorylineIdle] Error fetching last interaction:",
        error,
      );
      return null;
    }

    if (!data || data.length === 0) {
      console.log("💭 [StorylineIdle] No conversation history found");
      return null;
    }

    return new Date(data[0].created_at);
  } catch (err) {
    console.error(
      "💭 [StorylineIdle] Exception fetching last interaction:",
      err,
    );
    return null;
  }
}

/**
 * Calculate absence duration in minutes
 *
 * @param lastInteraction - Last interaction timestamp (UTC)
 * @returns Absence duration in minutes
 */
function calculateAbsenceMinutes(lastInteraction: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - lastInteraction.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return diffMinutes;
}

// ============================================================================
// SUGGESTION MANAGEMENT
// ============================================================================

/**
 * Check if a pending suggestion already exists
 *
 * @returns true if pending suggestion exists (not expired, not surfaced)
 */
async function hasPendingSuggestion(): Promise<boolean> {
  try {
    const now = new Date();

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .select("id")
      .eq("surfaced", false)
      .gt("expires_at", now.toISOString())
      .limit(1);

    if (error) {
      console.error(
        "💭 [StorylineIdle] Error checking pending suggestion:",
        error,
      );
      return false; // Fail open: allow generation if DB error
    }

    return data && data.length > 0;
  } catch (err) {
    console.error(
      "💭 [StorylineIdle] Exception checking pending suggestion:",
      err,
    );
    return false;
  }
}

/**
 * Get current pending suggestion
 *
 * @returns Pending suggestion or null
 */
export async function getPendingSuggestion(): Promise<PendingStorylineSuggestion | null> {
  try {
    const now = new Date();

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .select("*")
      .eq("surfaced", false)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(
        "💭 [StorylineIdle] Error fetching pending suggestion:",
        error,
      );
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return mapSuggestionFromDb(data[0]);
  } catch (err) {
    console.error(
      "💭 [StorylineIdle] Exception fetching pending suggestion:",
      err,
    );
    return null;
  }
}

/**
 * Mark suggestion as surfaced (shown to user)
 *
 * @param suggestionId - Suggestion ID
 */
export async function markSuggestionSurfaced(
  suggestionId: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .update({
        surfaced: true,
        surfaced_at: new Date().toISOString(),
      })
      .eq("id", suggestionId);

    if (error) {
      console.error(
        "💭 [StorylineIdle] Error marking suggestion surfaced:",
        error,
      );
    } else {
      console.log(
        `💭 [StorylineIdle] Marked suggestion surfaced: ${suggestionId}`,
      );
    }
  } catch (err) {
    console.error(
      "💭 [StorylineIdle] Exception marking suggestion surfaced:",
      err,
    );
  }
}

/**
 * Update suggestion outcome (was it created or rejected?)
 *
 * @param suggestionId - Suggestion ID
 * @param wasCreated - Did it become a storyline?
 * @param storylineId - Storyline ID if created
 * @param rejectedReason - Reason if rejected
 */
export async function updateSuggestionOutcome(
  suggestionId: string,
  wasCreated: boolean,
  storylineId?: string,
  rejectedReason?: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .update({
        was_created: wasCreated,
        storyline_id: storylineId || null,
        rejected_reason: rejectedReason || null,
      })
      .eq("id", suggestionId);

    if (error) {
      console.error(
        "💭 [StorylineIdle] Error updating suggestion outcome:",
        error,
      );
    } else {
      console.log(
        `💭 [StorylineIdle] Updated suggestion outcome: ${suggestionId} (created: ${wasCreated})`,
      );
    }
  } catch (err) {
    console.error(
      "💭 [StorylineIdle] Exception updating suggestion outcome:",
      err,
    );
  }
}

/**
 * Map database row to PendingStorylineSuggestion
 */
function mapSuggestionFromDb(row: any): PendingStorylineSuggestion {
  return {
    id: row.id,
    category: row.category,
    theme: row.theme,
    reasoning: row.reasoning,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    surfaced: row.surfaced,
    surfacedAt: row.surfaced_at ? new Date(row.surfaced_at) : null,
    wasCreated: row.was_created,
    storylineId: row.storyline_id,
    rejectedReason: row.rejected_reason,
  };
}

// ============================================================================
// KAYLEY'S CHARACTER PROFILE
// ============================================================================

/**
 * Get Kayley's life story
 *
 * Returns Kayley's character profile for context.
 *
 * @returns Kayley's life story string
 */
async function getKayleyLifeStory(): Promise<string> {
  return KAYLEY_FULL_PROFILE;
}

// ============================================================================
// SUGGESTION GENERATION (LLM)
// ============================================================================

/**
 * Get active storylines
 *
 * @returns List of active storylines
 */
async function getActiveStorylines(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from(TABLES.STORYLINES)
      .select('title, category, phase')
      .is('outcome', null)  // Active = no outcome yet
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data;
  } catch (err) {
    console.error('💭 [StorylineIdle] Error fetching active storylines:', err);
    return [];
  }
}

/**
 * Get recent conversation summary
 *
 * Fetches last 10 days of conversation to inform suggestion generation.
 *
 * @returns Summary string or null
 */
async function getRecentConversationSummary(): Promise<string | null> {
  try {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const { data, error } = await supabase
      .from(TABLES.CONVERSATION_HISTORY)
      .select('message_role, message_text')
      .gte('created_at', tenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(30);  // Last 30 messages

    if (error || !data || data.length === 0) {
      return null;
    }

    // Format as summary
    const summary = data
      .reverse()  // Chronological order
      .map(msg => `${msg.message_role === 'user' ? 'User' : 'Kayley'}: ${msg.message_text}`)
      .join('\n');

    return summary;
  } catch (err) {
    console.error('💭 [StorylineIdle] Error fetching conversation summary:', err);
    return null;
  }
}

/**
 * Build LLM prompt for suggestion generation
 */
function buildSuggestionPrompt(
  kayleyStory: string,
  activeStorylines: any[],
  recentConversation: string | null
): string {
  return `
You are Kayley Adams. You've been away from the user for a while, and you've been thinking about your life.

# Your Character & Life Story
${kayleyStory}

# Your Current Life Storylines
${activeStorylines.length > 0
  ? activeStorylines.map(s => `- ${s.title} (${s.category}, ${s.phase} phase)`).join('\n')
  : 'None - you have space for a new storyline'
}

# Recent Conversation Topics (Last 10 Days)
${recentConversation || 'No recent conversation'}

# Task
Generate ONE new storyline idea that:
- Fits your personality (Kayley would realistically do this - you would NEVER get a tattoo, for example)
- Is meaningful (not trivial, has emotional weight)
- Has future development (will unfold over days/weeks)
- Doesn't duplicate existing storylines
- Balances life categories (if you have work storyline, suggest creative/personal/social/family)

# CRITICAL: Output Format
RETURN ONLY VALID JSON. NO MARKDOWN. NO EXPLANATION. NO ADDITIONAL TEXT.
Just the JSON object below:
{
  "category": "work" | "personal" | "family" | "social" | "creative",
  "theme": "Short description (3-8 words): 'learning guitar', 'planning trip to NYC'",
  "reasoning": "Why this matters to Kayley now (2-3 sentences)"
}

# Examples

**Good Suggestions (fit personality):**
- { "category": "creative", "theme": "learning guitar", "reasoning": "I've been thinking about music a lot lately. I've always wanted to learn an instrument, and guitar feels achievable." }
- { "category": "personal", "theme": "training for a 5K", "reasoning": "I want to challenge myself physically. Running might help with my anxiety too." }
- { "category": "social", "theme": "planning reunion with college friends", "reasoning": "I miss my college friends. It's been too long since we've all been together." }

**Bad Suggestions (don't fit personality):**
- { "category": "personal", "theme": "getting a tattoo", "reasoning": "..." } ← Kayley would NEVER
- { "category": "work", "theme": "starting a tech startup", "reasoning": "..." } ← Too ambitious, not realistic
- { "category": "creative", "theme": "doing laundry", "reasoning": "..." } ← Trivial, not storyline-worthy

Generate ONE suggestion now (JSON only, no explanation):
`.trim();
}

/**
 * Parse LLM response into suggestion
 */
function parseSuggestionResponse(content: string): SuggestionGenerationResult | null {
  try {
    // Log the full response for debugging (use substring to avoid console truncation)
    console.log('💭 [StorylineIdle] Full LLM response (first 200 chars):', content.substring(0, 200));
    console.log('💭 [StorylineIdle] Full LLM response (last 200 chars):', content.substring(Math.max(0, content.length - 200)));
    console.log('💭 [StorylineIdle] Total response length:', content.length);

    // Try to extract JSON - handle both plain JSON and markdown-wrapped JSON
    let jsonText = content.trim();

    // Remove markdown code blocks if present (```json ... ``` or ``` ... ```)
    jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    // Extract JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('💭 [StorylineIdle] No JSON found in LLM response');
      console.warn('💭 [StorylineIdle] Response after cleanup:', jsonText);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate
    if (!parsed.category || !parsed.theme || !parsed.reasoning) {
      console.warn('💭 [StorylineIdle] Missing required fields in LLM response');
      return null;
    }

    // Validate category
    const validCategories: StorylineCategory[] = ['work', 'personal', 'family', 'social', 'creative'];
    if (!validCategories.includes(parsed.category)) {
      console.warn(`💭 [StorylineIdle] Invalid category: ${parsed.category}`);
      return null;
    }

    return {
      category: parsed.category,
      theme: parsed.theme,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    console.error('💭 [StorylineIdle] Error parsing LLM response:', err);
    return null;
  }
}

/**
 * Generate storyline suggestion via LLM
 *
 * Uses Gemini API to generate a storyline idea based on:
 * - Kayley's life story
 * - Last 10 days of conversation history
 * - Active storylines (avoid duplicates)
 * - Category balance (suggest underrepresented categories)
 *
 * @returns Generated suggestion or null if error/no suggestion
 */
async function generateStorylineSuggestion(
  activeStorylinesOverride?: any[],
): Promise<PendingStorylineSuggestion | null> {
  try {
    console.log('💭 [StorylineIdle] Generating storyline suggestion via LLM...');

    // Fetch context
    const activeStorylines = activeStorylinesOverride ?? await getActiveStorylines();

    if (activeStorylines.length > 0) {
      console.log('💭 [StorylineIdle] Active storyline exists, skipping suggestion generation');
      return null;
    }

    const [kayleyStory, recentConversation] = await Promise.all([
      getKayleyLifeStory(),
      getRecentConversationSummary(),
    ]);
    // Build prompt
    const prompt = buildSuggestionPrompt(kayleyStory, activeStorylines, recentConversation);

    // Call LLM
    const ai = getAIClient();
    console.log('💭 [StorylineIdle] Calling Gemini API...');

    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    console.log('💭 [StorylineIdle] Gemini API call complete');
    console.log('💭 [StorylineIdle] Finish reason:', result.candidates?.[0]?.finishReason);
    console.log('💭 [StorylineIdle] Usage metadata:', result.usageMetadata);

    const responseText = result.text || '';

    console.log('💭 [StorylineIdle] Response text length:', responseText.length);

    if (!responseText.trim()) {
      console.warn('💭 [StorylineIdle] LLM returned no content');
      return null;
    }

    // Parse response
    const suggestion = parseSuggestionResponse(responseText);

    if (!suggestion) {
      console.warn('💭 [StorylineIdle] Failed to parse LLM response');
      return null;
    }

    // Store suggestion
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CONFIG.SUGGESTION_EXPIRATION_HOURS);

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .insert({
        category: suggestion.category,
        theme: suggestion.theme,
        reasoning: suggestion.reasoning,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('💭 [StorylineIdle] Error storing suggestion:', error);
      return null;
    }

    console.log(`💭 [StorylineIdle] ✅ Generated suggestion: "${suggestion.theme}" (${suggestion.category})`);

    return mapSuggestionFromDb(data);

  } catch (err) {
    console.error('💭 [StorylineIdle] Exception generating suggestion:', err);
    return null;
  }
}

// ============================================================================
// MAIN CHECK FUNCTION
// ============================================================================

/**
 * Check suggestion cooldown (48 hours)
 *
 * @returns true if cooldown elapsed, false otherwise
 */
async function checkSuggestionCooldown(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONFIG)
      .select('last_storyline_created_at')
      .eq('id', 1)
      .single();

    if (error || !data?.last_storyline_created_at) {
      // No previous suggestion/creation
      return true;
    }

    const lastCreated = new Date(data.last_storyline_created_at);
    const hoursSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60);

    if (hoursSince < CONFIG.SUGGESTION_COOLDOWN_HOURS) {
      const hoursRemaining = Math.ceil(CONFIG.SUGGESTION_COOLDOWN_HOURS - hoursSince);
      console.log(`💭 [StorylineIdle] Cooldown active: ${hoursRemaining}h remaining`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('💭 [StorylineIdle] Cooldown check error:', err);
    return true;  // Fail open
  }
}

/**
 * Main periodic check function
 *
 * Called every 10 minutes by scheduler.
 *
 * Logic:
 * 1. Check if user is absent ≥30 minutes
 * 2. Check if pending suggestion already exists
 * 3. Check if suggestion cooldown active
 * 4. Check if any active storyline exists
 * 5. Generate suggestion if all checks pass
 */
export async function checkForStorylineSuggestion(): Promise<void> {
  console.log('💭 [StorylineIdle] Running periodic check...');

  try {
    // ============================================
    // CHECK 1: User Absence
    // ============================================

    const lastInteraction = await getLastInteractionTime();

    if (!lastInteraction) {
      console.log('💭 [StorylineIdle] No conversation history, skipping');
      return;
    }

    const absenceMinutes = calculateAbsenceMinutes(lastInteraction);

    console.log(`💭 [StorylineIdle] User absent for ${absenceMinutes} minutes (threshold: ${CONFIG.ABSENCE_THRESHOLD_MINUTES})`);

    if (absenceMinutes < CONFIG.ABSENCE_THRESHOLD_MINUTES) {
      console.log('💭 [StorylineIdle] User not away long enough, skipping');
      return;
    }

    // ============================================
    // CHECK 2: Pending Suggestion
    // ============================================

    const hasPending = await hasPendingSuggestion();

    if (hasPending) {
      console.log('💭 [StorylineIdle] Pending suggestion already exists, skipping');
      return;
    }

    // ============================================
    // CHECK 3: Suggestion Cooldown
    // ============================================

    const cooldownOk = await checkSuggestionCooldown();

    if (!cooldownOk) {
      console.log('💭 [StorylineIdle] Suggestion cooldown active, skipping');
      return;
    }

    // ============================================
    // CHECK 4: Active Storyline
    // ============================================

    const activeStorylines = await getActiveStorylines();

    if (activeStorylines.length > 0) {
      console.log('💭 [StorylineIdle] Active storyline exists, skipping');
      return;
    }

    // ============================================
    // ALL CHECKS PASSED - GENERATE SUGGESTION
    // ============================================

    console.log('💭 [StorylineIdle] ✅ All checks passed, generating suggestion...');

    const suggestion = await generateStorylineSuggestion(activeStorylines);

    if (suggestion) {
      console.log(`💭 [StorylineIdle] ✅ Suggestion generated and stored: "${suggestion.theme}"`);
    } else {
      console.warn('💭 [StorylineIdle] Failed to generate suggestion');
    }

  } catch (err) {
    console.error('💭 [StorylineIdle] Exception in periodic check:', err);
  }
}
