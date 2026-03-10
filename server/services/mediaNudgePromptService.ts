import { supabaseAdmin as supabase } from "./supabaseAdmin";

export enum MediaRecommendationType {
  SELFIE = "selfie",
  VIDEO = "video",
  VOICE_NOTE = "voice_note",
}

export enum NudgeStrength {
  NONE = "none",
  GENTLE = "gentle",
  STRONG = "strong",
}

type PromptTone =
  | "playful"
  | "affectionate"
  | "emotional"
  | "supportive"
  | "neutral"
  | "logistical"
  | "serious";

interface ConversationHistoryRow {
  message_role: "user" | "model";
  message_text: string;
  created_at: string;
}

interface DeliveredMediaRow {
  delivered_at: string | null;
}

interface MediaSnapshot {
  countToday: number;
  lastDeliveredAt: string | null;
}

function getCstDayRange(now: Date = new Date()): { startIso: string; endIso: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear().toString();
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  const start = new Date(`${year}-${month}-${day}T00:00:00-06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function toneFromText(rawText: string): PromptTone {
  const text = rawText.toLowerCase();

  if (/\b(schedule|calendar|meeting|invoice|email|task|todo|remind|pickup|dropoff|tomorrow at|today at)\b/.test(text)) {
    return "logistical";
  }
  if (/\b(sad|miss you|need you|anxious|overwhelmed|scared|cry|hurts|lonely)\b/.test(text)) {
    return "emotional";
  }
  if (/\b(you got this|proud of you|here for you|breathe|it's okay|i'm with you|i've got you)\b/.test(text)) {
    return "supportive";
  }
  if (/\b(love|miss you|baby|babe|veevee|cute|sweet|kiss|cuddle|snuggle)\b/.test(text)) {
    return "affectionate";
  }
  if (/[😉😘😏😂🤣]|\\b(tease|brat|haha|lol|lmao|bored|track me down|hot girl walk|hehe)\\b/.test(text)) {
    return "playful";
  }
  if (/\b(argument|upset|angry|mad|serious|stop|boundary)\b/.test(text)) {
    return "serious";
  }
  return "neutral";
}

function summarizeTone(messages: ConversationHistoryRow[], currentUserMessage?: string): PromptTone {
  const currentTone = currentUserMessage ? toneFromText(currentUserMessage) : "neutral";
  if (currentTone !== "neutral") {
    return currentTone;
  }

  const recentTurns = messages.slice(-4);
  const recentUserText = recentTurns
    .filter((row) => row.message_role === "user")
    .map((row) => row.message_text)
    .join("\n");
  const recentUserTone = recentUserText ? toneFromText(recentUserText) : "neutral";
  if (recentUserTone !== "neutral") {
    return recentUserTone;
  }

  const recentAssistantText = recentTurns
    .filter((row) => row.message_role === "model")
    .map((row) => row.message_text)
    .join("\n");
  const recentAssistantTone = recentAssistantText ? toneFromText(recentAssistantText) : "neutral";
  if (recentAssistantTone !== "neutral") {
    return recentAssistantTone;
  }

  const fallbackText = recentTurns.map((row) => row.message_text).join("\n");
  return fallbackText ? toneFromText(fallbackText) : "neutral";
}

function countModelRepliesSince(messages: ConversationHistoryRow[], sinceIso: string | null): number {
  return messages.filter((row) => {
    if (row.message_role !== "model") return false;
    if (!sinceIso) return true;
    return new Date(row.created_at).getTime() > new Date(sinceIso).getTime();
  }).length;
}

function pickRecommendation(params: {
  tone: PromptTone;
  textOnlyRepliesSinceAnyMedia: number;
  selfiesSentToday: number;
  videosSentToday: number;
  voiceNotesSentToday: number;
  textOnlyRepliesSinceSelfie: number;
  textOnlyRepliesSinceVideo: number;
  textOnlyRepliesSinceVoiceNote: number;
}): { recommendedMedia: MediaRecommendationType | null; nudgeStrength: NudgeStrength; rationale: string } {
  const overdue = params.textOnlyRepliesSinceAnyMedia >= 4;
  const veryOverdue = params.textOnlyRepliesSinceAnyMedia >= 8;

  if (params.tone === "logistical" || params.tone === "serious") {
    return {
      recommendedMedia: null,
      nudgeStrength: NudgeStrength.NONE,
      rationale: "This moment reads more practical than intimate.",
    };
  }

  if (params.tone === "emotional" || params.tone === "supportive") {
    return {
      recommendedMedia: overdue ? MediaRecommendationType.VOICE_NOTE : null,
      nudgeStrength: veryOverdue ? NudgeStrength.STRONG : overdue ? NudgeStrength.GENTLE : NudgeStrength.NONE,
      rationale: "A voice note would feel more grounding than more text.",
    };
  }

  if (params.tone === "playful" || params.tone === "affectionate") {
    if (params.selfiesSentToday === 0 || params.textOnlyRepliesSinceSelfie >= 6) {
      return {
        recommendedMedia: MediaRecommendationType.SELFIE,
        nudgeStrength: veryOverdue ? NudgeStrength.STRONG : overdue ? NudgeStrength.GENTLE : NudgeStrength.NONE,
        rationale: "A spontaneous selfie fits the current vibe best.",
      };
    }

    if (params.voiceNotesSentToday === 0 && params.textOnlyRepliesSinceVoiceNote >= 8) {
      return {
        recommendedMedia: MediaRecommendationType.VOICE_NOTE,
        nudgeStrength: overdue ? NudgeStrength.GENTLE : NudgeStrength.NONE,
        rationale: "A quick voice note could add warmth without forcing a photo.",
      };
    }
  }

  if (params.textOnlyRepliesSinceVideo >= 12 && params.videosSentToday === 0 && params.tone === "playful") {
    return {
      recommendedMedia: MediaRecommendationType.VIDEO,
      nudgeStrength: NudgeStrength.GENTLE,
      rationale: "A short video fits if motion genuinely adds to the moment.",
    };
  }

  return {
    recommendedMedia: null,
    nudgeStrength: NudgeStrength.NONE,
    rationale: "Text is still a natural fit right now.",
  };
}

async function getMediaSnapshot(
  tableName: string,
  startIso: string,
  endIso: string,
): Promise<MediaSnapshot> {
  const [countResult, lastResult] = await Promise.all([
    supabase
      .from(tableName)
      .select("*", { count: "exact", head: true })
      .eq("delivery_status", "delivered")
      .gte("delivered_at", startIso)
      .lt("delivered_at", endIso),
    supabase
      .from(tableName)
      .select("delivered_at")
      .eq("delivery_status", "delivered")
      .order("delivered_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    countToday: countResult.count ?? 0,
    lastDeliveredAt: (lastResult.data as DeliveredMediaRow | null)?.delivered_at ?? null,
  };
}

function formatRecommendationLine(recommendation: MediaRecommendationType | null): string {
  if (!recommendation) {
    return "Recommendation: no rich media right now.";
  }

  return `Recommendation: ${recommendation.replace("_", " ")}.`;
}

export async function buildMediaNudgePromptSection(currentUserMessage?: string): Promise<string> {
  const { startIso, endIso } = getCstDayRange();

  const [conversationResult, selfieSnapshot, videoSnapshot, voiceSnapshot] = await Promise.all([
    supabase
      .from("conversation_history")
      .select("message_role, message_text, created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true }),
    getMediaSnapshot("selfie_generation_history", startIso, endIso),
    getMediaSnapshot("video_generation_history", startIso, endIso),
    getMediaSnapshot("voice_note_generation_history", startIso, endIso),
  ]);

  const messages = (conversationResult.data as ConversationHistoryRow[] | null) ?? [];
  if (messages.length === 0 && !currentUserMessage) {
    return "";
  }

  const assistantRepliesToday = messages.filter((row) => row.message_role === "model").length;
  const lastAnyMediaAt = [selfieSnapshot.lastDeliveredAt, videoSnapshot.lastDeliveredAt, voiceSnapshot.lastDeliveredAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const currentTone = summarizeTone(messages, currentUserMessage);
  const textOnlyRepliesSinceAnyMedia = countModelRepliesSince(messages, lastAnyMediaAt);
  const textOnlyRepliesSinceSelfie = countModelRepliesSince(messages, selfieSnapshot.lastDeliveredAt);
  const textOnlyRepliesSinceVideo = countModelRepliesSince(messages, videoSnapshot.lastDeliveredAt);
  const textOnlyRepliesSinceVoiceNote = countModelRepliesSince(messages, voiceSnapshot.lastDeliveredAt);

  const recommendation = pickRecommendation({
    tone: currentTone,
    textOnlyRepliesSinceAnyMedia,
    selfiesSentToday: selfieSnapshot.countToday,
    videosSentToday: videoSnapshot.countToday,
    voiceNotesSentToday: voiceSnapshot.countToday,
    textOnlyRepliesSinceSelfie,
    textOnlyRepliesSinceVideo,
    textOnlyRepliesSinceVoiceNote,
  });

  const selfieLine =
    selfieSnapshot.countToday === 0
      ? "Selfies today: 0"
      : `Selfies today: ${selfieSnapshot.countToday}`;

  return `
====================================================
RICH MEDIA NUDGE
====================================================
- Assistant replies today: ${assistantRepliesToday}
- Text-only assistant replies since last rich-media moment: ${textOnlyRepliesSinceAnyMedia}
- ${selfieLine} | Videos today: ${videoSnapshot.countToday} | Voice notes today: ${voiceSnapshot.countToday}
- Current moment: ${currentTone}
- ${formatRecommendationLine(recommendation.recommendedMedia)}
- Reason: ${recommendation.rationale}
- Rule: only send rich media if it naturally deepens this reply. Do not force it into logistical, tense, or mismatched moments.
`.trim();
}
