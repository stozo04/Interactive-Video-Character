import { GoogleGenAI } from "@google/genai";
import type { ChatMessage } from "../types";

const LOG_PREFIX = "[SelfieIntent]";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-3.1-flash-lite-preview";

type SelfieIntentType = "immediate_selfie" | "later_selfie" | "none";

export interface SelfieIntentDecision {
  intent: SelfieIntentType;
  confidence: number;
  sceneHint?: string;
  moodHint?: string;
  suppressUnrelatedFollowUps: boolean;
  reason?: string;
}

const DEFAULT_DECISION: SelfieIntentDecision = {
  intent: "none",
  confidence: 0,
  suppressUnrelatedFollowUps: false,
};

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return geminiClient;
}

function clampConfidence(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function formatRecentTurns(chatHistory: ChatMessage[], maxMessages = 12): string {
  const recent = chatHistory.slice(-maxMessages);
  if (recent.length === 0) return "(none)";
  return recent
    .map((m) => {
      const role = m.role === "model" || m.role === "assistant" ? "assistant" : m.role;
      return `${role}: ${m.text || ""}`;
    })
    .join("\n");
}

function quickPotentialSignal(userMessage: string, chatHistory: ChatMessage[]): boolean {
  const directCue =
    /\b(selfie|photo|pic|picture|send one|one please|show me|let'?s see|go ahead|real quick)\b/i.test(
      userMessage
    );
  if (directCue) return true;

  const shortFollowup = userMessage.trim().split(/\s+/).length <= 5;
  if (!shortFollowup) return false;

  const recent = chatHistory.slice(-8).map((m) => m.text || "").join("\n");
  return /\b(selfie|photo|pic|picture)\b/i.test(recent);
}

function fallbackDecision(userMessage: string, chatHistory: ChatMessage[]): SelfieIntentDecision {
  const msg = userMessage.trim().toLowerCase();
  const immediateDirect =
    /\b(send (me )?(a )?(selfie|photo|pic|picture)|send one|one please|show me|let'?s see|go ahead)\b/i.test(
      msg
    );

  if (immediateDirect) {
    return {
      intent: "immediate_selfie",
      confidence: 0.72,
      suppressUnrelatedFollowUps: true,
      reason: "fallback_direct_signal",
    };
  }

  const isShortFollowup = msg.split(/\s+/).length <= 5;
  const recentText = chatHistory
    .slice(-8)
    .map((m) => m.text || "")
    .join("\n")
    .toLowerCase();
  const recentSelfieContext = /\b(selfie|photo|pic|picture)\b/.test(recentText);

  if (isShortFollowup && recentSelfieContext) {
    return {
      intent: "immediate_selfie",
      confidence: 0.62,
      suppressUnrelatedFollowUps: true,
      reason: "fallback_contextual_followup",
    };
  }

  const laterCue = /\b(later|tonight|when i|get home|after)\b/.test(msg);
  if (laterCue && recentSelfieContext) {
    return {
      intent: "later_selfie",
      confidence: 0.61,
      suppressUnrelatedFollowUps: false,
      reason: "fallback_later_signal",
    };
  }

  return DEFAULT_DECISION;
}

function parseDecision(responseText: string): SelfieIntentDecision {
  const cleaned = responseText.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const intentRaw = String(parsed.intent || "none").trim();
  const intent: SelfieIntentType =
    intentRaw === "immediate_selfie" || intentRaw === "later_selfie" || intentRaw === "none"
      ? intentRaw
      : "none";

  const sceneHint =
    typeof parsed.scene_hint === "string" && parsed.scene_hint.trim().length > 0
      ? parsed.scene_hint.trim()
      : undefined;
  const moodHint =
    typeof parsed.mood_hint === "string" && parsed.mood_hint.trim().length > 0
      ? parsed.mood_hint.trim()
      : undefined;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : undefined;

  return {
    intent,
    confidence: clampConfidence(parsed.confidence),
    sceneHint,
    moodHint,
    suppressUnrelatedFollowUps:
      intent === "immediate_selfie"
        ? true
        : Boolean(parsed.suppress_unrelated_followups),
    reason,
  };
}

export async function detectSelfieIntent(params: {
  userMessage: string;
  chatHistory: ChatMessage[];
}): Promise<SelfieIntentDecision> {
  const { userMessage, chatHistory } = params;
  if (!quickPotentialSignal(userMessage, chatHistory)) {
    return DEFAULT_DECISION;
  }

  const systemPrompt = `
You classify selfie intent in chat.
Focus on conversational context, not just literal keywords.

Return JSON only:
{
  "intent": "immediate_selfie" | "later_selfie" | "none",
  "confidence": number,
  "scene_hint": string,
  "mood_hint": string,
  "suppress_unrelated_followups": boolean,
  "reason": string
}

Rules:
- immediate_selfie: user is asking to send a selfie/pic now, including implied follow-ups like "send one", "let's see", "go ahead", "now".
- later_selfie: user asks for a selfie at a later time.
- none: no selfie intent.
- suppress_unrelated_followups should be true for immediate_selfie.
- Keep scene_hint and mood_hint short and practical.
`.trim();

  const prompt = `
Recent conversation:
${formatRecentTurns(chatHistory)}

Current user message:
${userMessage}
`.trim();

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });
    const responseText = response.text || "{}";
    const decision = parseDecision(responseText);
    console.log(`${LOG_PREFIX} Classified intent`, {
      intent: decision.intent,
      confidence: decision.confidence,
      suppressUnrelatedFollowUps: decision.suppressUnrelatedFollowUps,
      reason: decision.reason,
    });
    return decision;
  } catch (error) {
    console.warn(`${LOG_PREFIX} LLM classification failed, using fallback`, { error });
    return fallbackDecision(userMessage, chatHistory);
  }
}
