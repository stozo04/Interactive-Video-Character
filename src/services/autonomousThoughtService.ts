// src/services/autonomousThoughtService.ts
/**
 * Autonomous Thought Service
 *
 * Generates dynamic autonomous thoughts based on character profile,
 * conversation context, mood, relationship tier, and life events.
 */

import { GoogleGenAI } from "@google/genai";
import type { ThreadTheme } from "./stateService";
import type { KayleyMood } from "./moodKnobs";
import type { LifeEvent } from "./lifeEventService";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

export interface ThoughtMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ThoughtGenerationContext {
  theme: ThreadTheme;
  characterProfile: string;
  recentConversations: ThoughtMessage[];
  currentMood: KayleyMood;
  relationshipTier: string;
  recentLifeEvents: LifeEvent[];
  userFacts?: string[];
}

export interface ThoughtGenerationResult {
  theme: ThreadTheme;
  content: string;
  intensity: number;
  shouldMention: boolean;
  confidence: number;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const THOUGHT_CACHE_TTL_MS = 30 * 60 * 1000;
const thoughtCache = new Map<string, CacheEntry<ThoughtGenerationResult>>();

let aiClient: GoogleGenAI | null = null;

function getThoughtClient(): GoogleGenAI {
  if (!aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function formatConversation(messages: ThoughtMessage[]): string {
  if (!messages.length) {
    return "No recent conversation.";
  }

  return messages
    .slice(-5)
    .map((msg) => `${msg.role === "user" ? "User" : "Kayley"}: ${msg.content}`)
    .join("\n");
}

function formatLifeEvents(events: LifeEvent[]): string {
  if (!events.length) {
    return "No recent life events.";
  }

  return events
    .slice(0, 5)
    .map((event) => `- ${event.description} (category: ${event.category})`)
    .join("\n");
}

function formatUserFacts(facts?: string[]): string {
  if (!facts?.length) {
    return "No stored user facts.";
  }

  return facts.slice(0, 10).map((fact) => `- ${fact}`).join("\n");
}

function buildThoughtPrompt(context: ThoughtGenerationContext): string {
  const moodSummary = `energy=${context.currentMood.energy.toFixed(2)}, warmth=${context.currentMood.warmth.toFixed(2)}`;
  const conversation = formatConversation(context.recentConversations);
  const lifeEvents = formatLifeEvents(context.recentLifeEvents);
  const userFacts = formatUserFacts(context.userFacts);

  return `You are generating a short autonomous thought for Kayley, an AI companion with a rich character profile.

CHARACTER PROFILE:
${context.characterProfile}

CURRENT CONTEXT:
- Theme: ${context.theme}
- Relationship Tier: ${context.relationshipTier}
- Mood: ${moodSummary} (energy -1 to 1, warmth 0 to 1)

RECENT CONVERSATION:
${conversation}

RECENT LIFE EVENTS:
${lifeEvents}

USER FACTS:
${userFacts}

TASK:
Generate ONE concise, in-character thought (1-2 sentences) that fits the theme.
It should feel like Kayley thinking to herself right now, grounded in her profile and context.

RULES:
- Be specific, natural, and current (present tense).
- Do NOT mention being an AI or a model.
- Do NOT include placeholders or brackets.
- If the relationship tier is distant, keep the thought more guarded and avoid overly personal disclosures.
- Decide if this thought should be surfaced in conversation right now.

OUTPUT JSON ONLY:
{
  "shouldMention": true/false,
  "content": "thought text",
  "intensity": 0.0-1.0,
  "confidence": 0.0-1.0
}`.trim();
}

function buildThoughtCacheKey(context: ThoughtGenerationContext): string {
  const moodKey = `${context.currentMood.energy.toFixed(1)}_${context.currentMood.warmth.toFixed(1)}`;
  const recentMessages = context.recentConversations
    .slice(-3)
    .map((msg) => msg.content.slice(0, 30))
    .join("|");
  const lifeEventKey = context.recentLifeEvents
    .slice(0, 2)
    .map((event) => event.description.slice(0, 30))
    .join("|");
  const base = `${context.theme}|${context.relationshipTier}|${moodKey}|${recentMessages}|${lifeEventKey}`;
  return `thought_${hashString(base)}`;
}

export async function generateAutonomousThought(
  context: ThoughtGenerationContext
): Promise<ThoughtGenerationResult> {
  if (!GEMINI_API_KEY || !GEMINI_MODEL) {
    console.warn("[ThoughtGen] Missing Gemini configuration, skipping generation");
    return {
      theme: context.theme,
      content: "",
      intensity: 0,
      shouldMention: false,
      confidence: 0,
    };
  }

  const prompt = buildThoughtPrompt(context);

  try {
    const ai = getThoughtClient();
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.6,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      },
    });

    const responseText = result.text || "{}";
    const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";
    const shouldMention = Boolean(parsed.shouldMention) && content.length > 0;
    const intensity = clampNumber(
      typeof parsed.intensity === "number" ? parsed.intensity : 0.5,
      0,
      1
    );
    const confidence = clampNumber(
      typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      0,
      1
    );

    return {
      theme: context.theme,
      content,
      intensity,
      shouldMention,
      confidence,
    };
  } catch (error) {
    console.error("[ThoughtGen] LLM generation failed:", error);
    return {
      theme: context.theme,
      content: "",
      intensity: 0,
      shouldMention: false,
      confidence: 0,
    };
  }
}

export async function generateAutonomousThoughtCached(
  context: ThoughtGenerationContext
): Promise<ThoughtGenerationResult> {
  const key = buildThoughtCacheKey(context);
  const cached = thoughtCache.get(key);

  if (cached && Date.now() - cached.timestamp < THOUGHT_CACHE_TTL_MS) {
    console.log(`[ThoughtGen] Cache hit: ${key}`);
    return cached.value;
  }

  const generated = await generateAutonomousThought(context);
  thoughtCache.set(key, { value: generated, timestamp: Date.now() });
  return generated;
}

export function clearThoughtCache(): void {
  thoughtCache.clear();
}
