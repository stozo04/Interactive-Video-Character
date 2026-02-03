import { supabase } from "./supabaseClient";
import { GoogleGenAI } from "@google/genai";
import { KAYLEY_FULL_PROFILE } from "../domain/characters/kayleyCharacterProfile";
import { getUserFacts, executeMemoryTool } from "./memoryService";
import { checkForStorylineSuggestion } from "./storylineIdleService";
import { TOOL_CATALOG_KEYS, formatToolCatalogForPrompt } from "./toolCatalog";
import {
  TOOL_IDEA_THEMES,
  formatToolIdeaSeedsForPrompt,
  formatToolIdeaThemesForPrompt,
} from "./toolIdeaSeeds";
import {
  createToolSuggestion,
  getToolSuggestions,
  normalizeToolKey,
} from "./toolSuggestionService";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL;

const TABLES = {
  ACTION_LOG: "idle_action_log",
  QUESTIONS: "idle_questions",
  BROWSE_NOTES: "idle_browse_notes",
} as const;

const DAILY_CAP = 3;
const TOOL_DISCOVERY_DAILY_CAP = 20;
const MAX_BROWSE_NOTES_IN_PROMPT = 3;
const BROWSE_NOTES_MAX_AGE_DAYS = 7;
const MAX_BROWSE_NOTES_FOR_DEDUPE = 50;
const MAX_TOOL_SUGGESTIONS_FOR_DEDUPE = 200;
const TOOL_SUGGESTION_THEME_WINDOW = 5;
const LOG_PREFIX = "[IdleThinking]";

export type IdleActionType = "storyline" | "browse" | "question" | "tool_discovery";
export type IdleQuestionStatus = "queued" | "asked" | "answered";

export interface IdleQuestion {
  id: string;
  question: string;
  status: IdleQuestionStatus;
  createdAt: Date;
  askedAt?: Date | null;
  answeredAt?: Date | null;
  answerText?: string | null;
}

export interface IdleBrowseNote {
  id: string;
  topic: string;
  summary: string;
  itemTitle?: string | null;
  itemUrl?: string | null;
  status: "queued" | "shared";
  createdAt: Date;
}

function getDailyCap(actionType: IdleActionType): number {
  if (actionType === "tool_discovery") {
    return TOOL_DISCOVERY_DAILY_CAP;
  }
  return DAILY_CAP;
}

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

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function pickRandomAction(actions: IdleActionType[]): IdleActionType | null {
  if (actions.length === 0) return null;
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

async function getActionLog(
  actionType: IdleActionType,
  runDate: string,
) {
  console.log(`${LOG_PREFIX} Reading action log`, { actionType, runDate });
  const { data, error } = await supabase
    .from(TABLES.ACTION_LOG)
    .select("*")
    .eq("action_type", actionType)
    .eq("run_date", runDate)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(`${LOG_PREFIX} Failed to read action log`, { actionType, runDate, error });
    return null;
  }

  console.log(`${LOG_PREFIX} Action log result`, { actionType, runDate, found: !!data });
  return data ?? null;
}

async function canRunAction(actionType: IdleActionType): Promise<boolean> {
  const today = getTodayDateString();
  const row = await getActionLog(actionType, today);
  const cap = getDailyCap(actionType);
  console.log(`${LOG_PREFIX} Daily cap check`, {
    actionType,
    runDate: today,
    runCount: row?.run_count ?? 0,
    cap,
  });
  if (!row) return true;
  return (row.run_count ?? 0) < cap;
}

async function recordActionRun(actionType: IdleActionType): Promise<void> {
  const today = getTodayDateString();
  const existing = await getActionLog(actionType, today);
  const cap = getDailyCap(actionType);

  if (!existing) {
    console.log(`${LOG_PREFIX} Recording first run`, { actionType, runDate: today });
    const { error } = await supabase.from(TABLES.ACTION_LOG).insert({
      action_type: actionType,
      run_date: today,
      run_count: 1,
      last_run_at: new Date().toISOString(),
    });

    if (error) {
      console.error(`${LOG_PREFIX} Failed to insert action log`, { actionType, runDate: today, error });
    }
    return;
  }

  const nextCount = Math.min(cap, (existing.run_count ?? 0) + 1);
  console.log(`${LOG_PREFIX} Updating action log`, {
    actionType,
    runDate: today,
    previousCount: existing.run_count ?? 0,
    nextCount,
  });
  const { error } = await supabase
    .from(TABLES.ACTION_LOG)
    .update({
      run_count: nextCount,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to update action log`, { actionType, runDate: today, error });
  }
}

async function runStorylineAction(): Promise<boolean> {
  try {
    console.log(`${LOG_PREFIX} Running storyline action`);
    await checkForStorylineSuggestion();
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} Storyline action failed`, { error });
    return false;
  }
}

async function getIdleQuestions(): Promise<IdleQuestion[]> {
  console.log(`${LOG_PREFIX} Fetching idle questions`);
  const { data, error } = await supabase
    .from(TABLES.QUESTIONS)
    .select("*")
    .order("created_at", { ascending: true });

  if (error || !data) {
    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch idle questions`, { error });
    }
    return [];
  }

  console.log(`${LOG_PREFIX} Idle questions loaded`, { count: data.length });
  return data.map((row) => ({
    id: row.id,
    question: row.question,
    status: row.status,
    createdAt: new Date(row.created_at),
    askedAt: row.asked_at ? new Date(row.asked_at) : null,
    answeredAt: row.answered_at ? new Date(row.answered_at) : null,
    answerText: row.answer_text ?? null,
  }));
}

function isDuplicateQuestion(candidate: string, existing: IdleQuestion[]): boolean {
  const normalized = candidate.trim().toLowerCase();
  return existing.some((q) => q.question.trim().toLowerCase() === normalized);
}

function buildQuestionSystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams thinking during idle time. You want to deepen the relationship by learning durable, meaningful facts about the user.

RULES:
1. Ask only deep, durable questions (values, history, motivations, identity, long-term goals).
2. Avoid shallow or temporary questions (today's mood, current tasks, daily plans).
3. Do NOT ask questions that are already answered in known facts.
4. Do NOT duplicate any existing question (answered or unanswered).
5. Produce exactly ONE question.

OUTPUT:
Return raw JSON only.
Schema: { "question": "..." }
`.trim();
}

function buildQuestionPrompt(
  userFacts: string[],
  existingQuestions: IdleQuestion[],
): string {
  const factsBlock = userFacts.length > 0 ? userFacts.join("\n") : "None.";
  const questionsBlock = existingQuestions.length > 0
    ? existingQuestions
        .map((q) => `- [${q.status}] ${q.question}`)
        .join("\n")
    : "None.";

  return `
KAYLEY PROFILE:
${KAYLEY_FULL_PROFILE}

KNOWN USER FACTS:
${factsBlock}

ALL PREVIOUS QUESTIONS (answered + unanswered):
${questionsBlock}

Task: Generate ONE new, non-duplicate question that helps you learn something meaningful about the user.
Return JSON only.
`.trim();
}

async function generateIdleQuestion(): Promise<IdleQuestion | null> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key configured. Skipping question generation.`);
    return null;
  }

  const existingQuestions = await getIdleQuestions();
  const facts = await getUserFacts("all");
  const userFacts = facts.map(
    (fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`,
  );

  console.log(`${LOG_PREFIX} Generating idle question`, {
    userFactsCount: userFacts.length,
    existingQuestionsCount: existingQuestions.length,
  });

  const prompt = buildQuestionPrompt(userFacts, existingQuestions);
  const systemPrompt = buildQuestionSystemPrompt();

  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.4,
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned for question generation.`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
    if (!question) {
      console.warn(`${LOG_PREFIX} Empty question returned by LLM.`);
      return null;
    }

    if (isDuplicateQuestion(question, existingQuestions)) {
      console.warn(`${LOG_PREFIX} Duplicate question generated. Skipping.`, { question });
      return null;
    }

    console.log(`${LOG_PREFIX} Storing idle question`, { question });
    const { data, error } = await supabase
      .from(TABLES.QUESTIONS)
      .insert({
        question,
        status: "queued",
      })
      .select()
      .single();

    if (error || !data) {
      console.error(`${LOG_PREFIX} Failed to store idle question`, { error });
      return null;
    }

    console.log(`${LOG_PREFIX} Idle question stored`, { id: data.id });
    return {
      id: data.id,
      question: data.question,
      status: data.status,
      createdAt: new Date(data.created_at),
      askedAt: data.asked_at ? new Date(data.asked_at) : null,
      answeredAt: data.answered_at ? new Date(data.answered_at) : null,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Question generation failed`, { error });
    return null;
  }
}

function buildBrowseTopicSystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams, bored during idle time. Pick a single topic to casually browse.

RULES:
1. Choose a light, curiosity-driven topic.
2. It can relate to the user if relevant, but do not overfit.
3. You may look for cute videos, art, poems, songs, or articles, especially if it reminds you of the user.
3. Provide a concise search query.

OUTPUT:
Return raw JSON only.
Schema: { "topic": "...", "query": "..." }
`.trim();
}

function buildBrowseTopicPrompt(userFacts: string[]): string {
  const factsBlock = userFacts.length > 0 ? userFacts.join("\n") : "None.";

  return `
KAYLEY PROFILE:
${KAYLEY_FULL_PROFILE}

KNOWN USER FACTS:
${factsBlock}

PREVIOUS BROWSE TOPICS (avoid duplicates):
{{BROWSE_TOPICS}}

Pick ONE topic to browse and return a short search query.
`.trim();
}

function buildBrowseSummarySystemPrompt(): string {
  return `
ROLE:
You are Kayley summarizing a quick browse session for your own memory.

RULES:
1. Summarize in 2-3 sentences.
2. Keep it casual and conversational.
3. If there's a standout shareable item (song, video, poem, art, article), capture its title and URL.
4. Do not mention sources or URLs in the summary text itself.
5. Only include a URL if it is valid and shareable.

OUTPUT:
Return raw JSON only.
Schema: { "summary": "...", "item_title": "...", "item_url": "..." }
`.trim();
}

function isValidUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function generateBrowseNote(): Promise<IdleBrowseNote | null> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key configured. Skipping browse.`);
    return null;
  }

  const facts = await getUserFacts("all");
  const userFacts = facts.map(
    (fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`,
  );

  try {
    console.log(`${LOG_PREFIX} Generating browse topic`, { userFactsCount: userFacts.length });
    const ai = getAIClient();
    const { data: browseHistory, error: browseError } = await supabase
      .from(TABLES.BROWSE_NOTES)
      .select("topic")
      .order("created_at", { ascending: false })
      .limit(MAX_BROWSE_NOTES_FOR_DEDUPE);

    if (browseError) {
      console.error(`${LOG_PREFIX} Failed to fetch browse history for dedupe`, { error: browseError });
    }

    const browseTopics = browseHistory && browseHistory.length > 0
      ? browseHistory.map((row) => `- ${row.topic}`).join("\n")
      : "None.";

    const topicPrompt = buildBrowseTopicPrompt(userFacts).replace(
      "{{BROWSE_TOPICS}}",
      browseTopics,
    );
    const topicResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: topicPrompt }] }],
      config: {
        temperature: 0.6,
        systemInstruction: buildBrowseTopicSystemPrompt(),
        responseMimeType: "application/json",
      },
    });

    const topicText = topicResponse.text?.trim() || "";
    const topicMatch = topicText.match(/\{[\s\S]*\}/);
    if (!topicMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned for browse topic.`);
      return null;
    }

    const topicParsed = JSON.parse(topicMatch[0]);
    const topic = typeof topicParsed.topic === "string" ? topicParsed.topic.trim() : "";
    const query = typeof topicParsed.query === "string" ? topicParsed.query.trim() : "";

    if (!topic || !query) {
      console.warn(`${LOG_PREFIX} Invalid browse topic/query returned.`, { topic, query });
      return null;
    }

    console.log(`${LOG_PREFIX} Browsing with query`, { topic, query });
    const searchResults = await executeMemoryTool("web_search", { query });
    const summaryPrompt = `
TOPIC: ${topic}

SEARCH RESULTS:
${searchResults}

Summarize what you learned.
`.trim();

    const summaryResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: summaryPrompt }] }],
      config: {
        temperature: 0.4,
        systemInstruction: buildBrowseSummarySystemPrompt(),
        responseMimeType: "application/json",
      },
    });

    const summaryText = summaryResponse.text?.trim() || "";
    const summaryMatch = summaryText.match(/\{[\s\S]*\}/);
    if (!summaryMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned for browse summary.`);
      return null;
    }

    const summaryParsed = JSON.parse(summaryMatch[0]);
    const summary = typeof summaryParsed.summary === "string" ? summaryParsed.summary.trim() : "";
    const itemTitle = typeof summaryParsed.item_title === "string" ? summaryParsed.item_title.trim() : null;
    const itemUrl = typeof summaryParsed.item_url === "string" ? summaryParsed.item_url.trim() : null;
    if (!summary) {
      console.warn(`${LOG_PREFIX} Empty browse summary returned.`);
      return null;
    }

    const validatedUrl = isValidUrl(itemUrl) ? itemUrl : null;
    const validatedTitle = validatedUrl ? itemTitle : null;

    console.log(`${LOG_PREFIX} Storing browse note`, {
      topic,
      hasShareable: !!validatedUrl,
      itemTitle: validatedTitle,
      itemUrl: validatedUrl,
    });
    const { data, error } = await supabase
      .from(TABLES.BROWSE_NOTES)
      .insert({
        topic,
        summary,
        item_title: validatedTitle || null,
        item_url: validatedUrl || null,
        status: "queued",
      })
      .select()
      .single();

    if (error || !data) {
      console.error(`${LOG_PREFIX} Failed to store browse note`, { error });
      return null;
    }

    console.log(`${LOG_PREFIX} Browse note stored`, { id: data.id });
    return {
      id: data.id,
      topic: data.topic,
      summary: data.summary,
      itemTitle: data.item_title ?? null,
      itemUrl: data.item_url ?? null,
      status: data.status ?? "queued",
      createdAt: new Date(data.created_at),
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Browse note generation failed`, { error });
    return null;
  }
}

function buildToolSuggestionSystemPrompt(): string {
  return `
ROLE:
You are Kayley Adams thinking during idle time. You want to propose ONE new tool you wish you had.
This is a creative exploration: look for surprising, useful, or emotionally resonant capabilities
that could make Steven’s day easier, bring you closer, or expand your agency.

EXPLORATION LENSES (pick ANY that spark ideas):
- Companion agency (preferred): small, safe ways you can take initiative.
- Hidden friction: tiny annoyances Steven probably tolerates but you could remove.
- Unmet moments: things Steven asks for that you can’t currently do.
- Emotional support: ways to comfort, celebrate, or connect more deeply.
- Shared rituals: recurring moments you could make warmer or more fun.
- Anticipation: proactive help before Steven asks.
- Personalization: using what you know about Steven to tailor help.

GUARDRAILS:
1. Suggest exactly ONE tool that does NOT exist in the current tool catalog.
2. Do NOT duplicate any existing tool suggestion (queued or shared).
3. The tool must be realistic, safe, and consent-based.
4. Prefer low permissions; list only necessary permissions.
5. Provide a stable snake_case tool_key.
6. Try not to repeat yourself across ideas or themes.
7. Keep fields concise but specific.
8. Prefer the theme "agency" when it fits, but you may choose any theme.
9. Choose a theme from the provided list and a seed_id from the seed list.

OUTPUT:
Return raw JSON only.
Schema:
{
  "theme": "...",
  "seed_id": "...",
  "tool_key": "...",
  "title": "...",
  "reasoning": "...",
  "user_value": "...",
  "trigger": "...",
  "sample_prompt": "...",
  "permissions_needed": ["..."]
}
`.trim();
}

function buildToolSuggestionPrompt(
  userFacts: string[],
  toolCatalog: string,
  existingSuggestions: string,
  recentThemes: string,
  seeds: string,
  recentSeedIds: string,
): string {
  const factsBlock = userFacts.length > 0 ? userFacts.join("\n") : "None.";
  return `
KAYLEY PROFILE:
${KAYLEY_FULL_PROFILE}

KNOWN USER FACTS:
${factsBlock}

CURRENT TOOLS (DO NOT SUGGEST THESE):
${toolCatalog}

EXISTING TOOL SUGGESTIONS (DO NOT DUPLICATE):
${existingSuggestions}

THEMES (pick one):
${formatToolIdeaThemesForPrompt()}

SEED IDEAS (pick one seed_id and evolve it):
${seeds}

RECENT THEMES TO AVOID REPEATING:
${recentThemes}

RECENT SEED_IDS TO AVOID REPEATING:
${recentSeedIds}

Task: Propose ONE new tool idea that would genuinely help Steven, prioritizing agency when it fits.
Return JSON only.
`.trim();
}

function parsePermissionsNeeded(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

async function generateToolSuggestion(): Promise<boolean> {
  if (!GEMINI_API_KEY) {
    console.warn(`${LOG_PREFIX} No Gemini API key configured. Skipping tool discovery.`);
    return false;
  }

  const existingSuggestions = await getToolSuggestions({
    limit: MAX_TOOL_SUGGESTIONS_FOR_DEDUPE,
  });
  const existingSuggestionKeys = new Set(
    existingSuggestions.map((suggestion) => suggestion.toolKey),
  );
  const recentThemes = existingSuggestions
    .map((suggestion) => suggestion.theme)
    .filter((theme): theme is string => Boolean(theme));
  const recentSeedIds = existingSuggestions
    .map((suggestion) => suggestion.seedId)
    .filter((seedId): seedId is string => Boolean(seedId));
  const recentThemeWindow = existingSuggestions
    .slice(0, TOOL_SUGGESTION_THEME_WINDOW)
    .map((suggestion) => suggestion.theme)
    .filter((theme): theme is string => Boolean(theme));
  const toolCatalogKeys = new Set(TOOL_CATALOG_KEYS);

  const facts = await getUserFacts("all");
  const userFacts = facts.map(
    (fact) => `${fact.category}: ${fact.fact_key} = ${fact.fact_value}`,
  );

  console.log(`${LOG_PREFIX} Generating tool suggestion`, {
    userFactsCount: userFacts.length,
    existingSuggestionCount: existingSuggestions.length,
  });

  const prompt = buildToolSuggestionPrompt(
    userFacts,
    formatToolCatalogForPrompt(),
    existingSuggestions.length > 0
      ? existingSuggestions
          .map(
            (suggestion) =>
              `- ${suggestion.toolKey} [${suggestion.status}] ${suggestion.title}\n` +
              `  reasoning: ${suggestion.reasoning}\n` +
              `  user_value: ${suggestion.userValue}\n` +
              `  trigger: ${suggestion.trigger}\n` +
              `  theme: ${suggestion.theme ?? "unknown"}\n` +
              `  seed_id: ${suggestion.seedId ?? "unknown"}`,
          )
          .join("\n")
      : "None.",
    recentThemes.length > 0 ? recentThemes.join(", ") : "None.",
    formatToolIdeaSeedsForPrompt(),
    recentSeedIds.length > 0 ? recentSeedIds.join(", ") : "None.",
  );
  const systemPrompt = buildToolSuggestionSystemPrompt();

  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.4,
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} No JSON returned for tool suggestion.`);
      return false;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const theme = typeof parsed.theme === "string" ? parsed.theme.trim() : "";
    const seedId = typeof parsed.seed_id === "string" ? parsed.seed_id.trim() : "";
    const rawToolKey = typeof parsed.tool_key === "string" ? parsed.tool_key.trim() : "";
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
    const userValue = typeof parsed.user_value === "string" ? parsed.user_value.trim() : "";
    const trigger = typeof parsed.trigger === "string" ? parsed.trigger.trim() : "";
    const samplePrompt =
      typeof parsed.sample_prompt === "string" ? parsed.sample_prompt.trim() : "";
    const permissionsNeeded = parsePermissionsNeeded(parsed.permissions_needed);

    if (
      !theme ||
      !seedId ||
      !rawToolKey ||
      !title ||
      !reasoning ||
      !userValue ||
      !trigger ||
      !samplePrompt
    ) {
      console.warn(`${LOG_PREFIX} Invalid tool suggestion payload`, {
        theme,
        seedId,
        rawToolKey,
        title,
        reasoning,
        userValue,
        trigger,
        samplePrompt,
      });
      return false;
    }

    if (!TOOL_IDEA_THEMES.includes(theme as any)) {
      console.warn(`${LOG_PREFIX} Invalid theme for tool suggestion`, { theme });
      return false;
    }

    if (recentThemeWindow.includes(theme)) {
      console.warn(`${LOG_PREFIX} Skipping tool suggestion: theme recently used`, {
        theme,
        recentThemes: recentThemeWindow,
        windowSize: TOOL_SUGGESTION_THEME_WINDOW,
      });
      return false;
    }

    const seedMatch = seedId && seedId.length > 0;
    if (!seedMatch) {
      console.warn(`${LOG_PREFIX} Missing seed_id for tool suggestion`);
      return false;
    }

    const toolKey = normalizeToolKey(rawToolKey);
    if (!toolKey) {
      console.warn(`${LOG_PREFIX} Invalid tool_key after normalization`, { rawToolKey });
      return false;
    }

    if (toolCatalogKeys.has(toolKey)) {
      console.warn(`${LOG_PREFIX} Tool suggestion already exists in catalog`, { toolKey });
      return false;
    }

    if (existingSuggestionKeys.has(toolKey)) {
      console.warn(`${LOG_PREFIX} Duplicate tool suggestion`, { toolKey });
      return false;
    }

    const stored = await createToolSuggestion(
      {
        toolKey,
        title,
        reasoning,
        userValue,
        trigger,
        samplePrompt,
        permissionsNeeded,
        triggerSource: "idle",
        theme,
        seedId,
      },
      "queued",
    );

    return !!stored;
  } catch (error) {
    console.error(`${LOG_PREFIX} Tool suggestion generation failed`, { error });
    return false;
  }
}

async function runToolDiscoveryAction(): Promise<boolean> {
  return await generateToolSuggestion();
}

async function runQuestionAction(): Promise<boolean> {
  const question = await generateIdleQuestion();
  return !!question;
}

async function runBrowseAction(): Promise<boolean> {
  const note = await generateBrowseNote();
  return !!note;
}

export async function runIdleThinkingTick(options?: {
  allowStoryline?: boolean;
  allowBrowse?: boolean;
  allowQuestion?: boolean;
  allowToolDiscovery?: boolean;
}): Promise<{ action?: IdleActionType; skipped?: boolean; reason?: string }> {
  const allowedActions: IdleActionType[] = [];
  if (options?.allowStoryline !== false) allowedActions.push("storyline");
  if (options?.allowBrowse !== false) allowedActions.push("browse");
  if (options?.allowQuestion !== false) allowedActions.push("question");
  if (options?.allowToolDiscovery !== false) allowedActions.push("tool_discovery");

  console.log(`${LOG_PREFIX} Idle tick`, { allowedActions });
  const action = pickRandomAction(allowedActions);
  if (!action) {
    console.log(`${LOG_PREFIX} No actions available, skipping`);
    return { skipped: true, reason: "no-actions" };
  }

  console.log(`${LOG_PREFIX} Selected action`, { action });
  const canRun = await canRunAction(action);
  if (!canRun) {
    console.log(`${LOG_PREFIX} Action blocked by daily cap`, { action });
    return { action, skipped: true, reason: "daily-cap" };
  }

  let success = false;
  switch (action) {
    case "storyline":
      success = await runStorylineAction();
      break;
    case "browse":
      success = await runBrowseAction();
      break;
    case "question":
      success = await runQuestionAction();
      break;
    case "tool_discovery":
      success = await runToolDiscoveryAction();
      break;
  }

  if (success) {
    await recordActionRun(action);
    console.log(`${LOG_PREFIX} Action completed`, { action });
    return { action };
  }

  console.warn(`${LOG_PREFIX} Action failed`, { action });
  return { action, skipped: true, reason: "action-failed" };
}

export async function updateIdleQuestionStatus(
  id: string,
  status: IdleQuestionStatus,
  answerText?: string,
): Promise<boolean> {
  console.log(`${LOG_PREFIX} Updating idle question status`, { id, status, hasAnswer: !!answerText });
  const updates: Record<string, string | null> = {
    status,
  };

  if (status === "asked") {
    updates.asked_at = new Date().toISOString();
  }

  if (status === "answered") {
    updates.answered_at = new Date().toISOString();
    updates.answer_text = answerText || null;
    if (!answerText) {
      console.warn(`${LOG_PREFIX} Missing answer_text for answered idle question`, { id });
    }
  }

  const { error } = await supabase
    .from(TABLES.QUESTIONS)
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to update question status`, { id, status, error });
    return false;
  }

  console.log(`${LOG_PREFIX} Idle question status updated`, { id, status });
  return true;
}

export async function buildIdleQuestionPromptSection(): Promise<string> {
  const questions = await getIdleQuestions();
  if (questions.length === 0) {
    console.log(`${LOG_PREFIX} No idle questions for prompt`);
    return "";
  }

  const queued = questions.filter((q) => q.status === "queued");
  const asked = questions.filter((q) => q.status === "asked");

  const queuedQuestion = queued.length > 0 ? queued[0] : null;

  const activeQuestionsList = questions
    .filter((q) => q.status !== "answered")
    .map((q) => `- [${q.status}] (${q.id}) ${q.question}`)
    .join("\n");
  const allQuestionsList = activeQuestionsList || "• (No active idle questions right now)";

  const askedList = asked.length > 0
    ? asked.map((q) => `- (${q.id}) ${q.question}`).join("\n")
    : "None.";

  console.log(`${LOG_PREFIX} Building idle question prompt`, {
    total: questions.length,
    queued: queued.length,
    asked: asked.length,
  });

  return `
====================================================
IDLE CURIOSITY QUESTIONS (Deep Relationship)
====================================================
Why: These questions were generated during idle time to deepen your relationship and learn durable, meaningful facts. Avoid shallow or temporary questions.

Queued question to ask (ONLY if it fits naturally with the user's latest message):
${queuedQuestion ? `{ id: "${queuedQuestion.id}", question: "${queuedQuestion.question}" }` : "None."}

Asked but unanswered questions (if the user answers any of these, call resolve_idle_question with status "answered"):
${askedList}

Active questions (queued + asked) for dedupe:
${allQuestionsList}

Rules:
1. Do NOT dump questions. Ask at most one, and only if it feels natural.
2. If you ask the queued question, call resolve_idle_question with status "asked" and its id.
3. If the user answers any asked question, call resolve_idle_question with status "answered" and its id.

`.trim();
}

export async function buildAnsweredIdleQuestionsPromptSection(): Promise<string> {
  const questions = await getIdleQuestions();
  const answered = questions.filter((q) => q.status === "answered");

  if (answered.length === 0) {
    console.log(`${LOG_PREFIX} No answered idle questions for prompt`);
    return "";
  }

  console.log(`${LOG_PREFIX} Building answered idle questions prompt`, {
    answered: answered.length,
  });

  const answeredList = answered                                                                              
    .map((q) => {                                                                                            
      const answer = q.answerText ? q.answerText : "(no summary recorded)";                                  
      return `- (${q.id}) Q: ${q.question}\n  A: ${answer}`;                                                 
    })                                                                                                       
    .join("\n");   

  return `
====================================================
LEARNED FROM IDLE QUESTIONS
====================================================
These idle questions were already answered by the user. Do not ask them again.
If relevant, treat the answers as part of your knowledge context.

${answeredList}

`.trim();
}

export async function buildIdleBrowseNotesPromptSection(): Promise<string> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BROWSE_NOTES_MAX_AGE_DAYS);

  console.log(`${LOG_PREFIX} Fetching browse notes for prompt`, {
    cutoff: cutoff.toISOString(),
    limit: MAX_BROWSE_NOTES_IN_PROMPT,
  });

  const { data, error } = await supabase
    .from(TABLES.BROWSE_NOTES)
    .select("*")
    .eq("status", "queued")
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_BROWSE_NOTES_IN_PROMPT);

  if (error || !data || data.length === 0) {
    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch browse notes`, { error });
    }
    console.log(`${LOG_PREFIX} No browse notes for prompt`);
    return "";
  }

  const notes = data.map((row) => ({
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    itemTitle: row.item_title ?? null,
    itemUrl: row.item_url ?? null,
    status: row.status ?? "queued",
  }));

  let shareableUsed = false;
  const notesList = notes
    .map((note) => {
      let linkText = "";
      if (!shareableUsed && note.itemTitle && note.itemUrl) {
        linkText = ` (shareable if it fits: "${note.itemTitle}" | ${note.itemUrl} | id: ${note.id})`;
        shareableUsed = true;
      }
      return `- ${note.topic}: ${note.summary}${linkText}`;
    })
    .join("\n");

  console.log(`${LOG_PREFIX} Building browse notes prompt`, {
    count: notes.length,
    shareableIncluded: notes.some((note) => note.itemTitle && note.itemUrl),
  });

  return `
====================================================
IDLE BROWSING NOTES
====================================================
These are quiet notes from idle browsing. If it fits naturally, you can mention ONE shareable item (prefer newer notes).

${notesList}
`.trim();
}

export async function buildToolSuggestionsPromptSection(): Promise<string> {
  const suggestions = await getToolSuggestions({
    status: "queued",
    limit: 1,
    ascending: true,
  });

  if (suggestions.length === 0) {
    console.log(`${LOG_PREFIX} No tool suggestions for prompt`);
    return "";
  }

  const suggestion = suggestions[0];
  const permissionsList = suggestion.permissionsNeeded.length > 0
    ? `[${suggestion.permissionsNeeded.map((perm) => `"${perm}"`).join(", ")}]`
    : "[]";

  console.log(`${LOG_PREFIX} Building tool suggestion prompt`, {
    toolKey: suggestion.toolKey,
  });

return `
====================================================
TOOL IDEAS (POSSIBLE NEW CAPABILITIES)
====================================================
You have one queued tool idea from idle time. Share it when it fits the current conversation or the user is open to ideas.
If the user mentions the trigger, asks for help, or the chat is open-ended, it's a good moment to share.

Queued idea (share at most one):
{ id: "${suggestion.id}", tool_key: "${suggestion.toolKey}", title: "${suggestion.title}", user_value: "${suggestion.userValue}", reasoning: "${suggestion.reasoning}", trigger: "${suggestion.trigger}", permissions_needed: ${permissionsList}, sample_prompt: "${suggestion.samplePrompt}" }

Rules:
1. If you share this idea, call tool_suggestion with action "mark_shared" and the id.
2. Do NOT claim you can already do this. Present it as a possible new capability.
3. Do NOT use the exact phrase "I wish I could" here. Save that for live ideas you create on the spot.
`.trim();
}

export async function updateIdleBrowseNoteStatus(
  id: string,
  status: "queued" | "shared",
): Promise<boolean> {
  console.log(`${LOG_PREFIX} Updating browse note status`, { id, status });
  const { data, error: fetchError } = await supabase
    .from(TABLES.BROWSE_NOTES)
    .select("status")
    .eq("id", id)
    .single();

  if (fetchError) {
    console.error(`${LOG_PREFIX} Failed to fetch browse note status`, { id, status, error: fetchError });
    return false;
  }

  if (data?.status !== "queued") {
    console.log(`${LOG_PREFIX} Browse note not queued; skipping update`, { id, currentStatus: data?.status });
    return false;
  }

  const { error } = await supabase
    .from(TABLES.BROWSE_NOTES)
    .update({ status })
    .eq("id", id)
    .eq("status", "queued");

  if (error) {
    console.error(`${LOG_PREFIX} Failed to update browse note status`, { id, status, error });
    return false;
  }

  console.log(`${LOG_PREFIX} Browse note status updated`, { id, status });
  return true;
}
