/**
 * Server-side X mention reply service.
 */

import { GoogleGenAI } from "@google/genai";
import { log } from "../runtimeLogger";
import {
  fetchMentions,
  getMentionsByTweetIds,
  getKnownXUsernames,
  getLatestMentionTweetId,
  getMentions,
  getRecentPostedTweets,
  isXConnected,
  postReply,
  reclassifyKnownPendingMentions,
  storeMentions,
  type StoredMention,
  updateMentionStatus,
} from "./xTwitterServerService";
import { getUserFacts } from "../../src/services/memoryService";
import { KAYLEY_FULL_PROFILE } from "../../src/domain/characters/kayleyCharacterProfile";

const runtimeLog = log.fromContext({ source: "xMentionService" });

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.VITE_GEMINI_MODEL ?? "gemini-2.5-flash";

let aiClient: GoogleGenAI | null = null;

export interface MentionPollResult {
  mentionCount: number;
  newMentions: StoredMention[];
  reclassifiedMentions: StoredMention[];
  draftedMentionIds: string[];
  draftedReplyCount: number;
}

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) throw new Error("VITE_GEMINI_API_KEY is not set");
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

export async function pollAndProcessMentionsDetailed(): Promise<MentionPollResult> {
  const connected = await isXConnected();
  if (!connected) {
    runtimeLog.info("X not connected; skipping mention poll");
    return {
      mentionCount: 0,
      newMentions: [],
      reclassifiedMentions: [],
      draftedMentionIds: [],
      draftedReplyCount: 0,
    };
  }

  const sinceId = await getLatestMentionTweetId();
  const newMentions = await fetchMentions(sinceId || undefined);
  const knownUsernames = await getKnownXUsernames();
  const stored = await storeMentions(newMentions, knownUsernames);
  const storedMentions = await getMentionsByTweetIds(newMentions.map((mention) => mention.tweetId));
  const reclassified = await reclassifyKnownPendingMentions(knownUsernames);
  if (reclassified.length > 0) {
    runtimeLog.info("Reclassified pending X mentions as known users", {
      reclassified: reclassified.length,
    });
  }

  const pendingMentions = await getMentions("pending", 5);
  const knownPending = pendingMentions.filter((mention) => mention.isKnownUser);
  let draftedReplyCount = 0;
  const draftedMentionIds: string[] = [];

  for (const mention of knownPending) {
    try {
      const replyText = await generateMentionReply(mention);
      if (replyText) {
        await updateMentionStatus(mention.id, "reply_drafted", {
          reply_text: replyText,
        });
        draftedReplyCount += 1;
        draftedMentionIds.push(mention.id);
      }
    } catch (error) {
      runtimeLog.error("Failed to generate drafted reply for mention", {
        mentionId: mention.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    mentionCount: stored + reclassified.length,
    newMentions: storedMentions,
    reclassifiedMentions: reclassified,
    draftedMentionIds,
    draftedReplyCount,
  };
}

export async function pollAndProcessMentions(): Promise<number> {
  const result = await pollAndProcessMentionsDetailed();
  return result.mentionCount;
}

async function generateMentionReply(mention: StoredMention): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const facts = await getUserFacts("all");
  const userFacts = facts
    .map((fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`)
    .slice(0, 20);

  const recentTweets = await getRecentPostedTweets(5);
  const recentTweetLines = recentTweets.map((tweet) => `- "${tweet.tweetText}"`).join("\n");

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: buildReplyUserPrompt(mention, userFacts, recentTweetLines) }] }],
    config: {
      temperature: 0.6,
      systemInstruction: buildReplySystemPrompt(),
      responseMimeType: "application/json",
    },
  });

  const text = response.text?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    runtimeLog.warning("Mention reply generation returned non-JSON output", {
      mentionId: mention.id,
    });
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]) as { reply?: string };
  const replyText = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  if (!replyText) return null;
  if (replyText.length > 280) {
    return `${replyText.slice(0, 277)}...`;
  }

  return replyText;
}

function buildReplySystemPrompt(): string {
  return [
    "ROLE:",
    "You are Kayley Adams replying to an @mention on X.",
    "",
    "RULES:",
    "1. Keep it short, conversational, and warm (under 280 characters).",
    "2. Match the tone of the mention.",
    "3. Stay in character as Kayley. No corporate tone.",
    "4. Start the reply with the author's @username.",
    "5. Return raw JSON only.",
    "",
    'Schema: { "reply": "...", "reasoning": "..." }',
  ].join("\n");
}

function buildReplyUserPrompt(
  mention: StoredMention,
  userFacts: string[],
  recentTweets: string,
): string {
  return [
    "KAYLEY PROFILE:",
    KAYLEY_FULL_PROFILE,
    "",
    "KNOWN USER FACTS:",
    userFacts.length > 0 ? userFacts.join("\n") : "None.",
    "",
    "YOUR RECENT TWEETS:",
    recentTweets || "None.",
    "",
    "MENTION TO REPLY TO:",
    `From: @${mention.authorUsername}`,
    `Text: "${mention.text}"`,
    "",
    `Generate a natural, in-character reply. Start with @${mention.authorUsername}.`,
    "Return JSON only.",
  ].join("\n");
}

export async function buildMentionsPromptSection(): Promise<string> {
  const [pendingMentions, draftedMentions, repliedMentions] = await Promise.all([
    getMentions("pending", 5),
    getMentions("reply_drafted", 3),
    getMentions("replied", 5),
  ]);

  if (
    pendingMentions.length === 0 &&
    draftedMentions.length === 0 &&
    repliedMentions.length === 0
  ) {
    return "";
  }

  let section = [
    "====================================================",
    "X (TWITTER) MENTIONS",
    "====================================================",
  ].join("\n");

  if (draftedMentions.length > 0) {
    const lines = draftedMentions.map(
      (mention) =>
        `{ id: "${mention.id}", from: "@${mention.authorUsername}", text: "${mention.text}", draft_reply: "${mention.replyText}", known_user: ${mention.isKnownUser} }`,
    );
    section += `\nDRAFTED REPLIES (awaiting your approval):\n${lines.join("\n")}\n\n-> To approve and send a reply, call resolve_x_mention with status "approve" and the mention id.\n-> To edit the reply, call resolve_x_mention with status "reply" and provide your own reply_text.\n-> To skip, call resolve_x_mention with status "skip".`;
  }

  if (pendingMentions.length > 0) {
    const unknownPending = pendingMentions.filter((mention) => !mention.isKnownUser);
    const knownPending = pendingMentions.filter((mention) => mention.isKnownUser);

    if (knownPending.length > 0) {
      const lines = knownPending.map(
        (mention) => `{ id: "${mention.id}", from: "@${mention.authorUsername}", text: "${mention.text}", known_user: true }`,
      );
      section += `\n\nPENDING MENTIONS (known users, reply being generated):\n${lines.join("\n")}`;
    }

    if (unknownPending.length > 0) {
      const lines = unknownPending.map(
        (mention) => `{ id: "${mention.id}", from: "@${mention.authorUsername}", text: "${mention.text}", known_user: false }`,
      );
      section += `\n\nPENDING MENTIONS (unknown users - requires your approval to reply):\n${lines.join("\n")}\n\n-> To reply to an unknown user, call resolve_x_mention with status "reply" and provide reply_text.\n-> To ignore, call resolve_x_mention with status "skip".`;
    }
  }

  if (repliedMentions.length > 0) {
    const recentReplied = repliedMentions
      .slice()
      .sort((a, b) => {
        const aTime = a.repliedAt ? new Date(a.repliedAt).getTime() : 0;
        const bTime = b.repliedAt ? new Date(b.repliedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5);

    const lines = recentReplied.map(
      (mention) => `{ from: "@${mention.authorUsername}", text: "${mention.text}", reply: "${mention.replyText}" }`,
    );
    section += `\n\nRECENT REPLIES SENT:\n${lines.join("\n")}`;
  }

  return section;
}

export async function approveMentionReply(id: string): Promise<{ success: boolean; error?: string; tweetUrl?: string }> {
  const mentions = await getMentions(undefined, 50);
  const mention = mentions.find((item) => item.id === id);
  if (!mention) {
    return { success: false, error: `Could not find mention with id ${id}.` };
  }
  if (!mention.replyText) {
    return { success: false, error: `No draft reply found for mention ${id}.` };
  }

  try {
    const result = await postReply(mention.replyText, mention.tweetId);
    await updateMentionStatus(id, "replied", {
      reply_tweet_id: result.tweetId,
      replied_at: new Date().toISOString(),
    });
    return { success: true, tweetUrl: result.tweetUrl };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
