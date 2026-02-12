/**
 * X Tweet Generation Service
 *
 * Uses Gemini LLM to compose in-character tweets for Kayley.
 * Gathers context (character profile, character facts, past tweets,
 * active storylines, recent browse notes) and generates authentic content.
 */

import { GoogleGenAI } from "@google/genai";
import { KAYLEY_FULL_PROFILE } from "../domain/characters/kayleyCharacterProfile";
import { getCharacterFacts } from "./characterFactsService";
import { getActiveStorylines } from "./storylineService";
import { supabase } from "./supabaseClient";
import {
  createDraft,
  getRecentPostedTweets,
  type XTweetDraft,
} from "./xTwitterService";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

const LOG_PREFIX = "🐦 [TweetGen]";
const MAX_TWEET_LENGTH = 280;
const MAX_RECENT_TWEETS_FOR_CONTEXT = 20;
const MAX_BROWSE_NOTES_FOR_CONTEXT = 5;

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

// ============================================
// Context Gathering
// ============================================

export interface TweetGenerationContext {
  characterProfile: string;
  characterFacts: string[];
  recentTweets: string[];
  activeStorylines: string[];
  storylineTweetHistory: Record<string, string[]>;
  recentBrowseNotes: string[];
  timeOfDay: string;
  dayOfWeek: string;
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function getDayOfWeek(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

async function getRecentBrowseNotes(): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const { data, error } = await supabase
    .from("idle_browse_notes")
    .select("topic, summary")
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_BROWSE_NOTES_FOR_CONTEXT);

  if (error || !data) return [];
  return data.map((row) => `${row.topic}: ${row.summary}`);
}

/**
 * Builds a map of storyline title → past tweets related to that storyline.
 * Uses keyword matching from the storyline title against posted tweet text.
 */
function buildStorylineTweetHistory(
  storylines: { title: string; category: string }[],
  recentTweets: XTweetDraft[],
): Record<string, string[]> {
  if (storylines.length === 0 || recentTweets.length === 0) return {};

  const history: Record<string, string[]> = {};

  for (const storyline of storylines) {
    // Extract meaningful keywords from the title (3+ chars, skip common words)
    const stopWords = new Set(["the", "a", "an", "for", "and", "but", "with", "from", "about"]);
    const keywords = storyline.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    if (keywords.length === 0) continue;

    const matchingTweets = recentTweets.filter((tweet) => {
      const lower = tweet.tweetText.toLowerCase();
      // Match if any keyword appears in the tweet OR if the tweet's generation_context
      // references this storyline
      const keywordMatch = keywords.some((kw) => lower.includes(kw));
      const contextMatch = tweet.generationContext?.storylineTitle === storyline.title;
      return keywordMatch || contextMatch;
    });

    if (matchingTweets.length > 0) {
      history[storyline.title] = matchingTweets.map((t) => t.tweetText);
    }
  }

  return history;
}

async function gatherContext(): Promise<TweetGenerationContext> {
  const [characterFacts, recentTweets, storylines, browseNotes] = await Promise.all([
    getCharacterFacts(),
    getRecentPostedTweets(MAX_RECENT_TWEETS_FOR_CONTEXT),
    getActiveStorylines(),
    getRecentBrowseNotes(),
  ]);

  const storylineTweetHistory = buildStorylineTweetHistory(storylines, recentTweets);

  return {
    characterProfile: KAYLEY_FULL_PROFILE,
    characterFacts: characterFacts.map(
      (f) => `${f.category}: ${f.fact_key} = ${f.fact_value}`,
    ),
    recentTweets: recentTweets.map((t) => t.tweetText),
    activeStorylines: storylines.map(
      (s) => `[${s.category}] ${s.title} (phase: ${s.phase})`,
    ),
    storylineTweetHistory,
    recentBrowseNotes: browseNotes,
    timeOfDay: getTimeOfDay(),
    dayOfWeek: getDayOfWeek(),
  };
}

// ============================================
// Prompt Construction
// ============================================

function buildTweetSystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams composing a tweet for your personal X account.
You are posting as yourself — this is YOUR feed, YOUR voice, YOUR personality.

RULES:
1. Stay 100% in character as Kayley Adams.
2. Maximum 280 characters. This is a HARD limit — tweets over 280 characters will be rejected.
3. Write like a real person — not a brand, not an influencer, not an AI.
4. Match Kayley's communication style from the character profile.
5. Topics can include: personal thoughts, reactions to things you've read/seen,
   life updates, humor, opinions, quotes you like, observations.
6. Do NOT repeat themes from recent tweets.
7. Do NOT mention the user by name or reference private conversations.
8. Do NOT use hashtags excessively (0-1 max, and only if natural).
9. Vary tweet style: some short & punchy, some longer thoughts, some questions.
10. Do NOT reveal you are an AI. These tweets are public on your X feed.

OUTPUT:
Return raw JSON only. No markdown fences, no explanation.
Schema:
{
  "tweet_text": "the tweet content (max 280 chars)",
  "intent": "thought" | "reaction" | "life_update" | "humor" | "observation" | "quote",
  "reasoning": "brief explanation of why this tweet fits right now",
  "include_selfie": true | false,
  "selfie_scene": "short scene description for image generation (only if include_selfie is true)"
}

SELFIE GUIDANCE:
- Set include_selfie to true when the tweet would benefit from a visual (30-40% of tweets).
- Good selfie tweets: life updates, mood posts, outfit/look mentions, location vibes.
- Bad selfie tweets: retweet-style commentary, pure text thoughts, quotes.
- selfie_scene should describe where you are and the vibe (e.g., "cozy bedroom with fairy lights", "coffee shop window seat").
`.trim();
}

function buildStorylineContinuityBlock(context: TweetGenerationContext): string {
  const entries = Object.entries(context.storylineTweetHistory);
  if (entries.length === 0) return "";

  const lines = entries.map(([title, tweets]) => {
    const tweetLines = tweets.map((t, i) => `  - Tweet ${i + 1}: "${t}"`).join("\n");
    return `[${title}]:\n${tweetLines}\n  → (You're here now — show progression, don't repeat.)`;
  });

  return `
STORYLINE CONTINUITY:
For each active storyline, here are tweets you've already posted about it.
Build on these — show progression, development, or a new angle. Don't rehash.

${lines.join("\n\n")}`;
}

function buildTweetUserPrompt(context: TweetGenerationContext): string {
  const characterFactsBlock = context.characterFacts.length > 0
    ? context.characterFacts.join("\n")
    : "None yet.";

  const storylinesBlock = context.activeStorylines.length > 0
    ? context.activeStorylines.join("\n")
    : "None active.";

  const browseNotesBlock = context.recentBrowseNotes.length > 0
    ? context.recentBrowseNotes.join("\n")
    : "None recent.";

  const recentTweetsBlock = context.recentTweets.length > 0
    ? context.recentTweets.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "No previous tweets.";

  const storylineContinuityBlock = buildStorylineContinuityBlock(context);

  return `
CHARACTER PROFILE:
${context.characterProfile}

CHARACTER FACTS (your emergent self-knowledge — quirks, preferences, experiences):
${characterFactsBlock}

CONTEXT:
- Time: ${context.timeOfDay}, ${context.dayOfWeek}

ACTIVE STORYLINES (things happening in your life right now):
${storylinesBlock}
${storylineContinuityBlock}

RECENT BROWSING NOTES (things you've been reading about):
${browseNotesBlock}

PAST TWEETS (most recent first — do NOT repeat themes):
${recentTweetsBlock}

Task: Compose ONE tweet as Kayley Adams. Stay in character. Be authentic.
If an active storyline has continuity data above, consider building on that arc.
Return JSON only.
`.trim();
}

// ============================================
// Validation
// ============================================

function validateTweetText(text: string, recentTweets: string[]): boolean {
  if (!text || text.trim().length === 0) {
    console.warn(`${LOG_PREFIX} Empty tweet text`);
    return false;
  }

  if (text.length > MAX_TWEET_LENGTH) {
    console.warn(`${LOG_PREFIX} Tweet exceeds ${MAX_TWEET_LENGTH} chars`, { length: text.length });
    return false;
  }

  // Check for exact duplicates
  const normalized = text.trim().toLowerCase();
  const isDuplicate = recentTweets.some(
    (t) => t.trim().toLowerCase() === normalized,
  );
  if (isDuplicate) {
    console.warn(`${LOG_PREFIX} Duplicate tweet detected`);
    return false;
  }

  return true;
}

// ============================================
// Main Generation Pipeline
// ============================================

/**
 * Full tweet generation pipeline:
 * 1. Gather context (character facts, storylines, past tweets, browse notes)
 * 2. Build prompt and call Gemini
 * 3. Parse and validate the response
 * 4. Store as a draft in the database
 *
 * Returns the draft if successful, null if generation failed.
 */
export async function generateTweet(
  status: "pending_approval" | "queued" = "pending_approval",
): Promise<XTweetDraft | null> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key configured. Skipping tweet generation.`);
    return null;
  }

  try {
    console.log(`${LOG_PREFIX} Starting tweet generation`);
    const context = await gatherContext();

    console.log(`${LOG_PREFIX} Context gathered`, {
      characterFacts: context.characterFacts.length,
      recentTweets: context.recentTweets.length,
      storylines: context.activeStorylines.length,
      browseNotes: context.recentBrowseNotes.length,
      timeOfDay: context.timeOfDay,
      dayOfWeek: context.dayOfWeek,
    });

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: buildTweetUserPrompt(context) }] }],
      config: {
        temperature: 0.8,
        systemInstruction: buildTweetSystemPrompt(),
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text?.trim() || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned from LLM`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const tweetText = typeof parsed.tweet_text === "string" ? parsed.tweet_text.trim() : "";
    const intent = typeof parsed.intent === "string" ? parsed.intent : "thought";
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    const includeSelfie = parsed.include_selfie === true;
    const selfieScene = typeof parsed.selfie_scene === "string" ? parsed.selfie_scene : null;

    if (!validateTweetText(tweetText, context.recentTweets)) {
      return null;
    }

    console.log(`${LOG_PREFIX} Tweet generated`, {
      length: tweetText.length,
      intent,
      preview: tweetText.substring(0, 60) + (tweetText.length > 60 ? "..." : ""),
    });

    // Try to detect which storyline this tweet relates to (for future continuity lookups)
    let matchedStorylineTitle: string | null = null;
    const lowerTweet = tweetText.toLowerCase();
    for (const [title] of Object.entries(context.storylineTweetHistory)) {
      const keywords = title.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      if (keywords.some((kw) => lowerTweet.includes(kw))) {
        matchedStorylineTitle = title;
        break;
      }
    }

    // Store as draft
    const draft = await createDraft(
      tweetText,
      intent,
      reasoning,
      {
        characterFactsCount: context.characterFacts.length,
        recentTweetsCount: context.recentTweets.length,
        storylinesCount: context.activeStorylines.length,
        browseNotesCount: context.recentBrowseNotes.length,
        timeOfDay: context.timeOfDay,
        dayOfWeek: context.dayOfWeek,
        include_selfie: includeSelfie,
        selfie_scene: selfieScene,
        ...(matchedStorylineTitle ? { storylineTitle: matchedStorylineTitle } : {}),
      },
      status,
    );

    return draft;
  } catch (error) {
    console.error(`${LOG_PREFIX} Tweet generation failed`, { error });
    return null;
  }
}
