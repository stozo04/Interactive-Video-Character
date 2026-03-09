/**
 * Server-side X tweet generation service.
 */

import { toZonedTime } from "date-fns-tz";
import { log } from "../runtimeLogger";
import { ai, GEMINI_MODEL } from "./ai/geminiClient";
import { supabaseAdmin as supabase } from "./supabaseAdmin";
import {
  createDraft,
  getRecentPostedTweets,
  type XTweetDraft,
} from "./xTwitterServerService";
import { getCharacterFacts } from "../../src/services/characterFactsService";
import { getActiveStorylines } from "../../src/services/storylineService";
import { KAYLEY_FULL_PROFILE } from "../../src/domain/characters/kayleyCharacterProfile";

const runtimeLog = log.fromContext({ source: "xTweetGenerationService" });
const TIMEZONE = "America/Chicago";
const MAX_TWEET_LENGTH = 280;
const MAX_RECENT_TWEETS_FOR_CONTEXT = 20;
const MAX_BROWSE_NOTES_FOR_CONTEXT = 5;

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
  const hour = toZonedTime(new Date(), TIMEZONE).getHours();
  if (hour < 6) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function getDayOfWeek(): string {
  return toZonedTime(new Date(), TIMEZONE).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: TIMEZONE,
  });
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

function buildStorylineTweetHistory(
  storylines: { title: string; category: string }[],
  recentTweets: XTweetDraft[],
): Record<string, string[]> {
  if (storylines.length === 0 || recentTweets.length === 0) return {};

  const history: Record<string, string[]> = {};

  for (const storyline of storylines) {
    const stopWords = new Set(["the", "a", "an", "for", "and", "but", "with", "from", "about"]);
    const keywords = storyline.title
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !stopWords.has(word));

    if (keywords.length === 0) continue;

    const matchingTweets = recentTweets.filter((tweet) => {
      const lower = tweet.tweetText.toLowerCase();
      const keywordMatch = keywords.some((keyword) => lower.includes(keyword));
      const contextMatch = tweet.generationContext?.storylineTitle === storyline.title;
      return keywordMatch || contextMatch;
    });

    if (matchingTweets.length > 0) {
      history[storyline.title] = matchingTweets.map((tweet) => tweet.tweetText);
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
    characterFacts: characterFacts.map((fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`),
    recentTweets: recentTweets.map((tweet) => tweet.tweetText),
    activeStorylines: storylines.map((storyline) => `[${storyline.category}] ${storyline.title} (phase: ${storyline.phase})`),
    storylineTweetHistory,
    recentBrowseNotes: browseNotes,
    timeOfDay: getTimeOfDay(),
    dayOfWeek: getDayOfWeek(),
  };
}

function buildTweetSystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams composing a tweet for your personal X account.
You are posting as yourself - this is your feed, your voice, your personality.

RULES:
1. Stay 100% in character as Kayley Adams.
2. Maximum 280 characters. This is a hard limit.
3. Write like a real person - not a brand, not an influencer, not an AI.
4. Match Kayley's communication style from the character profile.
5. Topics can include personal thoughts, reactions, life updates, humor, opinions, and observations.
6. Do not repeat themes from recent tweets.
7. Do not mention the user by name or reference private conversations.
8. Do not overuse hashtags.
9. Vary tweet style.
10. Do not reveal you are an AI.

OUTPUT:
Return raw JSON only.
Schema:
{
  "tweet_text": "the tweet content (max 280 chars)",
  "intent": "thought" | "reaction" | "life_update" | "humor" | "observation" | "quote",
  "reasoning": "brief explanation of why this tweet fits right now",
  "include_selfie": true | false,
  "selfie_scene": "short scene description for image generation"
}
`.trim();
}

function buildStorylineContinuityBlock(context: TweetGenerationContext): string {
  const entries = Object.entries(context.storylineTweetHistory);
  if (entries.length === 0) return "";

  const lines = entries.map(([title, tweets]) => {
    const tweetLines = tweets.map((tweet, index) => `  - Tweet ${index + 1}: "${tweet}"`).join("\n");
    return `[${title}]:\n${tweetLines}\n  - Show progression instead of repeating yourself.`;
  });

  return `
STORYLINE CONTINUITY:
For each active storyline, here are tweets you've already posted about it.
Build on these instead of repeating them.

${lines.join("\n\n")}`;
}

function buildTweetUserPrompt(context: TweetGenerationContext): string {
  const characterFactsBlock = context.characterFacts.length > 0 ? context.characterFacts.join("\n") : "None yet.";
  const storylinesBlock = context.activeStorylines.length > 0 ? context.activeStorylines.join("\n") : "None active.";
  const browseNotesBlock = context.recentBrowseNotes.length > 0 ? context.recentBrowseNotes.join("\n") : "None recent.";
  const recentTweetsBlock = context.recentTweets.length > 0
    ? context.recentTweets.map((tweet, index) => `${index + 1}. ${tweet}`).join("\n")
    : "No previous tweets.";

  return `
CHARACTER PROFILE:
${context.characterProfile}

CHARACTER FACTS:
${characterFactsBlock}

CONTEXT:
- Time: ${context.timeOfDay}, ${context.dayOfWeek}

ACTIVE STORYLINES:
${storylinesBlock}
${buildStorylineContinuityBlock(context)}

RECENT BROWSING NOTES:
${browseNotesBlock}

PAST TWEETS:
${recentTweetsBlock}

Task: Compose one tweet as Kayley Adams. Return JSON only.
`.trim();
}

function validateTweetText(text: string, recentTweets: string[]): boolean {
  if (!text || text.trim().length === 0) {
    runtimeLog.warning("Generated tweet text was empty");
    return false;
  }

  if (text.length > MAX_TWEET_LENGTH) {
    runtimeLog.warning("Generated tweet exceeded max length", {
      length: text.length,
      maxLength: MAX_TWEET_LENGTH,
    });
    return false;
  }

  const normalized = text.trim().toLowerCase();
  const isDuplicate = recentTweets.some((tweet) => tweet.trim().toLowerCase() === normalized);
  if (isDuplicate) {
    runtimeLog.warning("Generated tweet duplicated a recent post");
    return false;
  }

  return true;
}

export async function generateTweet(
  status: "pending_approval" | "queued" = "pending_approval",
): Promise<XTweetDraft | null> {
  if (!process.env.GEMINI_API_KEY && !process.env.VITE_GEMINI_API_KEY) {
    runtimeLog.warning("No Gemini API key configured; skipping tweet generation");
    return null;
  }

  try {
    const context = await gatherContext();
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
      runtimeLog.warning("Tweet generation returned no JSON payload");
      return null;
    }

    let parsed: {
      tweet_text?: string;
      intent?: string;
      reasoning?: string;
      include_selfie?: boolean;
      selfie_scene?: string | null;
    };
    try {
      parsed = JSON.parse(jsonMatch[0]) as {
        tweet_text?: string;
        intent?: string;
        reasoning?: string;
        include_selfie?: boolean;
        selfie_scene?: string | null;
      };
    } catch (error) {
      runtimeLog.warning("Tweet generation returned malformed JSON payload", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    const tweetText = typeof parsed.tweet_text === "string" ? parsed.tweet_text.trim() : "";
    const intent = typeof parsed.intent === "string" ? parsed.intent : "thought";
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    const includeSelfie = parsed.include_selfie === true;
    const selfieScene = typeof parsed.selfie_scene === "string" ? parsed.selfie_scene : null;

    if (!validateTweetText(tweetText, context.recentTweets)) {
      return null;
    }

    let matchedStorylineTitle: string | null = null;
    const lowerTweet = tweetText.toLowerCase();
    for (const [title] of Object.entries(context.storylineTweetHistory)) {
      const keywords = title.toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
      if (keywords.some((keyword) => lowerTweet.includes(keyword))) {
        matchedStorylineTitle = title;
        break;
      }
    }

    return await createDraft(
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
      {
        include_selfie: includeSelfie,
        selfie_scene: selfieScene,
      },
    );
  } catch (error) {
    runtimeLog.error("Tweet generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
