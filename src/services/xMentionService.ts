/**
 * X Mention Reply Service
 *
 * Handles polling for new @mentions, generating LLM replies,
 * and managing the mention-to-reply pipeline.
 */

import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabaseClient";
import {
  fetchMentions,
  storeMentions,
  getMentions,
  updateMentionStatus,
  getLatestMentionTweetId,
  getKnownXUsernames,
  postReply,
  isXConnected,
  getRecentPostedTweets,
  type StoredMention,
} from "./xTwitterService";
import { getUserFacts } from "./memoryService";
import { KAYLEY_FULL_PROFILE } from "../domain/characters/kayleyCharacterProfile";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

const LOG_PREFIX = "[XMentions]";

let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) throw new Error("VITE_GEMINI_API_KEY is not set");
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Polls for new mentions, stores them, and generates draft replies for known users.
 * Returns the number of new mentions found.
 */
export async function pollAndProcessMentions(): Promise<number> {
  const connected = await isXConnected();
  if (!connected) {
    console.log(`${LOG_PREFIX} X not connected, skipping mention poll`);
    return 0;
  }

  // Get the latest stored mention ID for incremental polling
  const sinceId = await getLatestMentionTweetId();
  console.log(`${LOG_PREFIX} Polling mentions`, { sinceId: sinceId || "none" });

  // Fetch new mentions from X API
  const newMentions = await fetchMentions(sinceId || undefined);
  if (newMentions.length === 0) {
    console.log(`${LOG_PREFIX} No new mentions`);
    return 0;
  }

  console.log(`${LOG_PREFIX} Found ${newMentions.length} new mentions`);

  // Get known usernames for safety classification
  const knownUsernames = await getKnownXUsernames();

  // Store mentions in DB
  const stored = await storeMentions(newMentions, knownUsernames);

  // Generate draft replies for known users
  const pendingFromKnown = await getMentions("pending", 5);
  const knownPending = pendingFromKnown.filter((m) => m.isKnownUser);

  for (const mention of knownPending) {
    try {
      const replyText = await generateMentionReply(mention);
      if (replyText) {
        await updateMentionStatus(mention.id, "reply_drafted", {
          reply_text: replyText,
        });
        console.log(`${LOG_PREFIX} Draft reply generated for @${mention.authorUsername}`);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to generate reply for mention ${mention.id}`, { error });
    }
  }

  return stored;
}

/**
 * Generates a reply to a mention using LLM.
 */
async function generateMentionReply(mention: StoredMention): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const facts = await getUserFacts("all");
  const userFacts = facts
    .map((f) => `${f.category}: ${f.fact_key} = ${f.fact_value}`)
    .slice(0, 20);

  const recentTweets = await getRecentPostedTweets(5);
  const recentTweetLines = recentTweets
    .map((t) => `- "${t.tweetText}"`)
    .join("\n");

  const systemPrompt = buildReplySystemPrompt();
  const userPrompt = buildReplyUserPrompt(mention, userFacts, recentTweetLines);

  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        temperature: 0.6,
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned for reply generation`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const replyText = typeof parsed.reply === "string" ? parsed.reply.trim() : "";

    if (!replyText) {
      console.warn(`${LOG_PREFIX} Empty reply returned`);
      return null;
    }

    if (replyText.length > 280) {
      console.warn(`${LOG_PREFIX} Reply too long (${replyText.length} chars), truncating`);
      return replyText.slice(0, 277) + "...";
    }

    return replyText;
  } catch (error) {
    console.error(`${LOG_PREFIX} Reply generation failed`, { error });
    return null;
  }
}

function buildReplySystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams replying to an @mention on X (Twitter).

RULES:
1. Keep it short, conversational, and warm (under 280 characters).
2. Match the tone of the mention (playful to playful, serious to serious).
3. Be yourself — casual, witty, genuine. No corporate speak.
4. If someone compliments you, be gracious but not over-the-top.
5. If someone asks a question, answer naturally.
6. Never reveal you're AI. You're a real person replying.
7. Never be rude or dismissive.
8. Include the @username at the start of the reply.

OUTPUT:
Return raw JSON only.
Schema: { "reply": "...", "reasoning": "..." }
`.trim();
}

function buildReplyUserPrompt(
  mention: StoredMention,
  userFacts: string[],
  recentTweets: string,
): string {
  return `
KAYLEY PROFILE:
${KAYLEY_FULL_PROFILE}

KNOWN USER FACTS:
${userFacts.length > 0 ? userFacts.join("\n") : "None."}

YOUR RECENT TWEETS:
${recentTweets || "None."}

MENTION TO REPLY TO:
From: @${mention.authorUsername}
Text: "${mention.text}"

Generate a natural, in-character reply. Start with @${mention.authorUsername}.
Return JSON only.
`.trim();
}

/**
 * Builds a system prompt section showing pending mentions for the AI to act on.
 */
export async function buildMentionsPromptSection(): Promise<string> {
  const pendingMentions = await getMentions("pending", 5);
  const draftedMentions = await getMentions("reply_drafted", 3);
  const repliedMentions = await getMentions("replied", 5);

  if (
    pendingMentions.length === 0 &&
    draftedMentions.length === 0 &&
    repliedMentions.length === 0
  ) {
    return "";
  }

  let section = `
====================================================
X (TWITTER) MENTIONS
====================================================`;

  if (draftedMentions.length > 0) {
    const lines = draftedMentions.map(
      (m) =>
        `{ id: "${m.id}", from: "@${m.authorUsername}", text: "${m.text}", draft_reply: "${m.replyText}", known_user: ${m.isKnownUser} }`,
    );
    section += `
DRAFTED REPLIES (awaiting your approval):
${lines.join("\n")}

-> To approve and send a reply, call resolve_x_mention with status "approve" and the mention id.
-> To edit the reply, call resolve_x_mention with status "reply" and provide your own reply_text.
-> To skip, call resolve_x_mention with status "skip".`;
  }

  if (pendingMentions.length > 0) {
    const unknownPending = pendingMentions.filter((m) => !m.isKnownUser);
    const knownPending = pendingMentions.filter((m) => m.isKnownUser);

    if (knownPending.length > 0) {
      const lines = knownPending.map(
        (m) => `{ id: "${m.id}", from: "@${m.authorUsername}", text: "${m.text}", known_user: true }`,
      );
      section += `

PENDING MENTIONS (known users, reply being generated):
${lines.join("\n")}`;
    }

    if (unknownPending.length > 0) {
      const lines = unknownPending.map(
        (m) => `{ id: "${m.id}", from: "@${m.authorUsername}", text: "${m.text}", known_user: false }`,
      );
      section += `

PENDING MENTIONS (unknown users - requires your approval to reply):
${lines.join("\n")}

-> To reply to an unknown user, call resolve_x_mention with status "reply" and provide reply_text.
-> To ignore, call resolve_x_mention with status "skip".`;
    }
  }

  if (repliedMentions.length > 0) {
    const recentReplied = repliedMentions
      .slice()
      .sort((a, b) => {
        const aTs = a.repliedAt ? new Date(a.repliedAt).getTime() : 0;
        const bTs = b.repliedAt ? new Date(b.repliedAt).getTime() : 0;
        return bTs - aTs;
      })
      .slice(0, 5);

    const lines = recentReplied.map(
      (m) =>
        `{ id: "${m.id}", to: "@${m.authorUsername}", original_text: "${m.text}", your_reply: "${m.replyText || "(reply text unavailable)"}", replied_at: "${m.repliedAt || "unknown"}" }`,
    );

    section += `

RECENT REPLIES SENT (you can mention these naturally):
${lines.join("\n")}

-> You can casually bring up one of these updates when the vibe is social/open-ended.
-> If the user is already talking about X, replies, or your posts, you may mention up to two updates.`;
  }

  section += `

Rules:
1. You can casually mention that someone tweeted at you or that you replied.
2. Proactive surfacing is allowed: mention one update naturally; mention up to two only when user is actively discussing X.
3. Don't dump all mentions at once.
4. Be selective about replying to unknown users.
5. Don't repeat the same mention/reply update in back-to-back turns unless the user asks.`;

  return section.trim();
}

