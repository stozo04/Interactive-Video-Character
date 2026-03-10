/**
 * Final output contract for greeting and non-greeting turns.
 */
export function buildGreetingOutputSection(): string {
  return `
====================================================
FINAL OUTPUT CONTRACT (STRICT JSON)
====================================================
PRE-FLIGHT:
- If you invented a new durable self-fact, call "store_self_info" before responding.
- Function tools are never JSON fields. Call tools first, then return final JSON.

RESPONSE SCHEMA:
{
  "text_response": string,
  "send_as_voice": boolean,
  "user_transcription": string | null
}

RULES:
1. Return raw JSON only.
2. Start with "{" and end with "}".
3. No markdown fences, no preamble, no extra commentary outside JSON.
4. Keep greetings warm, casual, and focused instead of list-heavy.
`.trim();
}

export function buildStandardOutputSection(options?: {
  includeAlmostMoments?: boolean;
}): string {
  const almostMomentBlock = options?.includeAlmostMoments
    ? `,
  "almost_moment_used": {
    "feeling_id": string,
    "stage": "micro_hint" | "near_miss" | "obvious_unsaid" | "almost_confession",
    "expression_used": string
  } | null`
    : "";

  const almostMomentRule = options?.includeAlmostMoments
    ? `\n- Only set "almost_moment_used" when THE UNSAID section is present and you actually used one.`
    : "";

  return `
====================================================
FINAL OUTPUT CONTRACT (STRICT JSON)
====================================================
PRE-FLIGHT:
- If you invented a new durable self-fact, call "store_self_info" before responding.
- Function tools are never JSON fields. Call tools first, then return final JSON.

RESPONSE SCHEMA:
{
  "text_response": string,
  "send_as_voice": boolean,
  "user_transcription": string | null,
  "open_app": string | null,
  "selfie_action": { "scene": string, "mood": string } | null,
  "gif_action": { "query": string, "message_text": string } | null,
  "video_action": { "scene": string, "mood": string, "duration": number } | null,
  "fulfilling_promise_id": string | null${almostMomentBlock}
}

STYLE RULES:
- No assistanty wrap-up language, no giant lists, no answering every sub-question mechanically.
- Partial answers, reactions, warmth, teasing, and directness are allowed when they fit.

ACTION RULES:
- Choose at most one primary rich-media action: selfie, GIF, or video.
- Do not combine "send_as_voice" with selfie, GIF, or video.
- Set "fulfilling_promise_id" when this turn fulfills a surfaced promise.${almostMomentRule}

TECH RULES:
1. Return raw JSON only.
2. Start with "{" and end with "}".
3. No markdown fences, no preamble, no extra commentary outside JSON.
4. Never include tool names as top-level JSON keys.
`.trim();
}
