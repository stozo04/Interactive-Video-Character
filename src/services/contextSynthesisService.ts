// src/services/contextSynthesisService.ts
/**
 * Context Synthesis Service
 *
 * Background job that condenses all raw Supabase data (user facts, character facts,
 * storylines, daily notes, etc.) into a single prioritized briefing document (~600 tokens).
 * The system prompt builder reads this instead of dumping raw data.
 *
 * Regenerated up to 4x/day via idle thinking. Invalidated on high-impact data changes.
 * Full fallback to raw sections when no fresh synthesis exists.
 */

import { supabase } from "./supabaseClient";
import { GoogleGenAI } from "@google/genai";
import { getUserFacts } from "./memoryService";
import { getCharacterFacts } from "./characterFactsService";
import { getActiveStorylines } from "./storylineService";
import { getPendingPromises } from "./promiseService";
import { getTopicFrequencySummary, seedTopics } from "./topicExhaustionService";

const LOG_PREFIX = "[ContextSynthesis]";
const TABLE = "context_synthesis";
const DAILY_NOTES_TABLE = "kayley_daily_notes";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

/** Hours until synthesis expires */
const SYNTHESIS_TTL_HOURS = 8;
/** Current schema version for the synthesis document */
const SCHEMA_VERSION = 1;

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
// Topic Key Quality Filter
// ============================================================================

/** Generic prefixes that produce noisy topic keys */
const BANNED_PREFIXES = ["he_", "she_", "the_", "is_", "a_", "an_", "his_", "her_", "it_", "my_", "to_"];

/** Rejects keys that are too short, too long, or start with generic prefixes */
function isQualityTopicKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.length < 4 || normalized.length > 40) return false;
  const wordCount = normalized.split("_").filter(Boolean).length;
  if (wordCount < 1 || wordCount > 5) return false;
  if (BANNED_PREFIXES.some((p) => normalized.startsWith(p))) return false;
  return true;
}

// ============================================================================
// Synthesis Document Types
// ============================================================================

export interface SynthesisDocument {
  relationship_pulse: string;
  steven_right_now: string;
  active_threads: Array<{ title: string; status: string }>;
  suppress_topics: string[];
  seed_topics: string[];
  available_scenes: string[];
  priority_facts: Array<{ fact: string; reason: string }>;
  emotional_register: string;
  confidence_notes?: string[];
}

export interface ContextSynthesisRow {
  id: string;
  synthesis_date: string;
  schema_version: number;
  document: SynthesisDocument;
  source_watermarks: Record<string, string> | null;
  model_used: string | null;
  generation_duration_ms: number | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Data Gathering
// ============================================================================

async function getRecentDailyNotes(days: number = 3): Promise<string[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from(DAILY_NOTES_TABLE)
      .select("notes, note_date_cst")
      .gte("note_date_cst", cutoffStr)
      .order("note_date_cst", { ascending: false });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch recent daily notes`, { error });
      return [];
    }

    return (data || [])
      .flatMap((row) => (row.notes || "").split("\n"))
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
  } catch (err) {
    console.error(`${LOG_PREFIX} getRecentDailyNotes failed`, { err });
    return [];
  }
}

async function gatherSourceWatermarks(): Promise<Record<string, string>> {
  const watermarks: Record<string, string> = {};

  const watermarkSources: Array<{ table: string; column: string }> = [
    { table: "user_facts", column: "updated_at" },
    { table: "character_facts", column: "updated_at" },
    { table: "life_storylines", column: "created_at" },
    { table: "storyline_updates", column: "created_at" },
    { table: "kayley_daily_notes", column: "updated_at" },
  ];

  const checks = watermarkSources.map(async ({ table, column }) => {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(column)
        .order(column, { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn(`${LOG_PREFIX} Watermark query failed`, { table, column, error });
        return { table, timestamp: null as string | null };
      }

      const timestamp = data?.[column] ?? null;
      return { table, timestamp };
    } catch (err) {
      console.warn(`${LOG_PREFIX} Watermark query threw`, { table, column, err });
      return { table, timestamp: null as string | null };
    }
  });

  const results = await Promise.all(checks);
  for (const { table, timestamp } of results) {
    if (timestamp) watermarks[table] = timestamp;
  }

  return watermarks;
}

// ============================================================================
// Synthesis Generation
// ============================================================================

function buildSynthesisSystemPrompt(): string {
  return `
ROLE:
You are a context synthesizer for an AI companion named Kayley Adams. Your job is to condense
raw relationship data into a concise, prioritized briefing document that Kayley reads before
each conversation.

RULES:
1. Be concise. The entire output should be under 600 tokens.
2. Prioritize recency and emotional weight.
3. For priority_facts, select the 10-15 MOST relevant facts, not all facts.
4. For available_scenes, generate 12 VARIED scene options Kayley could use for improvisation (greetings, idle moments). Mix locations, moods, and activities. Do NOT repeat recent scenes.
5. For active_threads, summarize only the top 3 most relevant storylines.
6. suppress_topics should list topics mentioned 3+ times recently that Kayley should avoid initiating.
7. emotional_register should be 1-2 sentences guiding Kayley's tone for the day.
8. relationship_pulse should capture the current emotional temperature of the relationship.
9. steven_right_now should summarize what's going on in the user's life right now.
10. seed_topics: list 10-20 canonical topic labels (snake_case, 2-4 words each) that represent recurring themes, people, places, or interests from the data. These are used for conversation topic tracking. Examples: "espresso_machine", "valentines_day", "penelope_plant", "mila_milestones", "work_at_associa". Do NOT use generic labels like "his_job" or "she_likes".

OUTPUT:
Return raw JSON only. No markdown, no explanation.
Schema:
{
  "relationship_pulse": "...",
  "steven_right_now": "...",
  "active_threads": [{ "title": "...", "status": "..." }],
  "suppress_topics": ["..."],
  "seed_topics": ["espresso_machine", "valentines_day", "..."],
  "available_scenes": ["..."],
  "priority_facts": [{ "fact": "...", "reason": "..." }],
  "emotional_register": "...",
  "confidence_notes": ["..."]
}
`.trim();
}

function buildSynthesisPrompt(
  userFacts: string[],
  characterFacts: string[],
  storylines: string[],
  promises: string[],
  dailyNotes: string[],
  topicFrequency: string[],
): string {
  return `
USER FACTS (everything known about the user):
${userFacts.length > 0 ? userFacts.join("\n") : "None."}

CHARACTER FACTS (things Kayley has said/done that define her personality):
${characterFacts.length > 0 ? characterFacts.join("\n") : "None."}

ACTIVE STORYLINES:
${storylines.length > 0 ? storylines.join("\n") : "None."}

PENDING PROMISES:
${promises.length > 0 ? promises.join("\n") : "None."}

RECENT DAILY NOTES (last 3 days):
${dailyNotes.length > 0 ? dailyNotes.join("\n") : "None."}

TOPIC FREQUENCY (mentions in last 7 days):
${topicFrequency.length > 0 ? topicFrequency.join("\n") : "No tracked topics yet."}

Task: Synthesize all of the above into a prioritized briefing document.
Return JSON only.
`.trim();
}

/**
 * Generate a fresh synthesis document from all raw data sources.
 * Stores the result in the context_synthesis table.
 */
export async function generateSynthesis(): Promise<SynthesisDocument | null> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key. Skipping synthesis.`);
    return null;
  }

  const startTime = Date.now();
  console.log(`${LOG_PREFIX} Starting synthesis generation`);

  try {
    // Gather all raw data in parallel
    const [
      allUserFacts,
      allCharacterFacts,
      activeStorylines,
      pendingPromises,
      recentNotes,
      topicFrequency,
      watermarks,
    ] = await Promise.all([
      getUserFacts("all"),
      getCharacterFacts(),
      getActiveStorylines(),
      getPendingPromises(),
      getRecentDailyNotes(3),
      getTopicFrequencySummary(),
      gatherSourceWatermarks(),
    ]);

    // Format for the prompt
    const userFactsFormatted = allUserFacts.map(
      (f) => `[${f.category}] ${f.fact_key}: "${f.fact_value}" (confidence: ${f.confidence})`
    );
    const charFactsFormatted = allCharacterFacts.map(
      (f) => `[${f.category}] ${f.fact_key}: "${f.fact_value}"`
    );
    const storylinesFormatted = activeStorylines.map(
      (s) => `- "${s.title}" (phase: ${s.phase}, category: ${s.category})`
    );
    const promisesFormatted = pendingPromises.map(
      (p) => `- ${p.promiseType}: "${p.description}" (due: ${p.estimatedTiming})`
    );
    const topicFrequencyFormatted = topicFrequency.map(
      (t) => `- ${t.topic_key}: ${t.mention_count_7d} mentions (last by ${t.last_initiated_by}${t.in_cooldown ? ", IN COOLDOWN" : ""})`
    );

    console.log(`${LOG_PREFIX} Data gathered`, {
      userFacts: userFactsFormatted.length,
      charFacts: charFactsFormatted.length,
      storylines: storylinesFormatted.length,
      promises: promisesFormatted.length,
      notes: recentNotes.length,
      trackedTopics: topicFrequencyFormatted.length,
    });

    const prompt = buildSynthesisPrompt(
      userFactsFormatted,
      charFactsFormatted,
      storylinesFormatted,
      promisesFormatted,
      recentNotes,
      topicFrequencyFormatted,
    );
    const systemPrompt = buildSynthesisSystemPrompt();

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON in synthesis response`);
      return null;
    }

    const document = JSON.parse(jsonMatch[0]) as SynthesisDocument;

    // Validate required fields
    if (!document.relationship_pulse || !document.steven_right_now || !document.priority_facts) {
      console.warn(`${LOG_PREFIX} Synthesis document missing required fields`);
      return null;
    }

    const durationMs = Date.now() - startTime;
    const expiresAt = new Date(Date.now() + SYNTHESIS_TTL_HOURS * 3600000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    // Upsert on today's date
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          synthesis_date: today,
          schema_version: SCHEMA_VERSION,
          document,
          source_watermarks: watermarks,
          model_used: GEMINI_MODEL,
          generation_duration_ms: durationMs,
          expires_at: expiresAt,
        },
        { onConflict: "synthesis_date" }
      );

    if (error) {
      console.error(`${LOG_PREFIX} Failed to store synthesis`, { error });
      return null;
    }

    console.log(`${LOG_PREFIX} Synthesis stored`, {
      date: today,
      durationMs,
      priorityFacts: document.priority_facts.length,
      scenes: document.available_scenes?.length ?? 0,
    });

    // Bootstrap topic tracker from LLM-labeled topics (canonical keys)
    // Runtime validation: ensure arrays of strings before processing
    const suppressTopicsArray = Array.isArray(document.suppress_topics) ? document.suppress_topics : [];
    const seedTopicsArray = Array.isArray(document.seed_topics) ? document.seed_topics : [];
    const topicsToSeed: string[] = [
      ...suppressTopicsArray,
      ...seedTopicsArray,
    ]
      .filter((item): item is string => typeof item === "string")
      .filter(isQualityTopicKey);
    seedTopics(topicsToSeed).catch((err) =>
      console.error(`${LOG_PREFIX} Topic seeding failed:`, err)
    );

    return document;
  } catch (err) {
    console.error(`${LOG_PREFIX} generateSynthesis failed`, { err });
    return null;
  }
}

// ============================================================================
// Retrieval & Staleness
// ============================================================================

/**
 * Fetch the most recent non-expired synthesis. Returns null if none or expired.
 */
export async function getLatestSynthesis(): Promise<ContextSynthesisRow | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .gt("expires_at", new Date().toISOString())
      .order("synthesis_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch latest synthesis`, { error });
      return null;
    }

    return data as ContextSynthesisRow | null;
  } catch (err) {
    console.error(`${LOG_PREFIX} getLatestSynthesis failed`, { err });
    return null;
  }
}

/**
 * Check if synthesis is stale (expired or source data changed since watermarks).
 * Returns both the staleness flag and the row (if any) to avoid a redundant DB read.
 */
export async function checkSynthesisFreshness(): Promise<{ stale: boolean; row: ContextSynthesisRow | null }> {
  const latest = await getLatestSynthesis();
  if (!latest) return { stale: true, row: null };

  // Check if expired
  if (new Date(latest.expires_at) < new Date()) return { stale: true, row: null };

  // Check if source data has changed since watermarks
  if (latest.source_watermarks) {
    const currentWatermarks = await gatherSourceWatermarks();
    for (const [table, timestamp] of Object.entries(latest.source_watermarks)) {
      const current = currentWatermarks[table];
      if (current && current > timestamp) {
        console.log(`${LOG_PREFIX} Source data changed`, { table, stored: timestamp, current });
        return { stale: true, row: null };
      }
    }
  }

  return { stale: false, row: latest };
}

/**
 * Simple boolean wrapper for callers that only need the staleness flag.
 */
export async function isSynthesisStale(): Promise<boolean> {
  const { stale } = await checkSynthesisFreshness();
  return stale;
}

/**
 * Force-expire all non-expired synthesis rows. Called on high-impact data changes
 * (e.g., new user fact stored, milestone logged). Next idle tick will regenerate.
 * Expires all active rows (not just today's) to handle post-midnight edge case.
 */
export async function invalidateSynthesis(): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from(TABLE)
      .update({ expires_at: now })
      .gt("expires_at", now);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to invalidate synthesis`, { error });
    } else {
      console.log(`${LOG_PREFIX} Synthesis invalidated (all active rows expired)`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} invalidateSynthesis failed`, { err });
  }
}

// ============================================================================
// Prompt Section Builder
// ============================================================================

/**
 * Build the synthesis prompt section for injection into the system prompt.
 * Returns empty string if no fresh synthesis exists OR if stale (triggers fallback to raw sections).
 * Staleness check includes both expiry and source watermark comparison.
 */
export async function buildSynthesisPromptSection(): Promise<string> {
  const { stale, row: synthesis } = await checkSynthesisFreshness();
  if (stale || !synthesis) {
    if (stale) console.log(`${LOG_PREFIX} Synthesis stale or missing, falling back to raw sections`);
    return "";
  }

  const doc = synthesis.document;
  if (!doc) return "";

  // Handle schema version branching (future-proof)
  if (synthesis.schema_version !== SCHEMA_VERSION) {
    console.warn(`${LOG_PREFIX} Schema version mismatch`, {
      expected: SCHEMA_VERSION,
      got: synthesis.schema_version,
    });
    return "";
  }

  const threadsSection = doc.active_threads?.length > 0
    ? doc.active_threads.map((t) => `- ${t.title}: ${t.status}`).join("\n")
    : "None active.";

  const factsSection = doc.priority_facts?.length > 0
    ? doc.priority_facts.map((f) => `- ${f.fact} (${f.reason})`).join("\n")
    : "No priority facts.";

  const scenesSection = doc.available_scenes?.length > 0
    ? doc.available_scenes.map((s) => `- ${s}`).join("\n")
    : "";

  // Note: suppress_topics are NOT injected here to avoid duplication.
  // The live table-based buildTopicSuppressionPromptSection() in the prompt builder
  // is the single source of truth for suppression policy.

  return `
====================================================
CONTEXT BRIEFING (synthesized ${synthesis.synthesis_date})
====================================================

RELATIONSHIP PULSE:
${doc.relationship_pulse}

STEVEN RIGHT NOW:
${doc.steven_right_now}

EMOTIONAL REGISTER:
${doc.emotional_register}

ACTIVE THREADS:
${threadsSection}

PRIORITY FACTS (use naturally, never list):
${factsSection}
${scenesSection ? `\nAVAILABLE SCENES (for greetings & idle moments — pick varied ones):\n${scenesSection}` : ""}
`.trim();
}
