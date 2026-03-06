import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addDays, addMonths, lastDayOfMonth, set } from "date-fns";
import { log } from "../runtimeLogger";
import { ai, GEMINI_MODEL } from "../services/ai/geminiClient";
import { runCodeCleanerBatch } from "./codeCleanerHandler";
import { runTidyBranchCleanup } from "./tidyBranchCleanupHandler";

const LOG_PREFIX = "[CronScheduler]";
const DEFAULT_TICK_MS = 60_000;
const MAX_DUE_JOBS_PER_TICK = 10;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_HOUR = 12;
const DEFAULT_DAILY_MINUTE = 0;

type CronScheduleType = "daily" | "one_time" | "monthly" | "weekly";
type CronJobStatus = "active" | "paused" | "running" | "completed" | "failed";
type CronRunStatus = "running" | "success" | "failed";

interface CronJobRow {
  id: string;
  title: string;
  action_type: string;
  instruction: string;
  payload: any;
  search_query?: string;
  summary_instruction?: string;
  schedule_type: CronScheduleType;
  timezone: string;
  schedule_hour: number | null;
  schedule_minute: number | null;
  one_time_run_at: string | null;
  next_run_at: string | null;
  status: CronJobStatus;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface PromiseRow {
  id: string;
  promise_type: string;
  description: string;
  trigger_event: string;
  fulfillment_data: Record<string, unknown> | null;
  status: string;
}

interface StartCronSchedulerOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tickMs?: number;
  schedulerId?: string;
}

interface StartedCronScheduler {
  stop: () => void;
}

const CRON_JOBS_TABLE = "cron_jobs";
const CRON_JOB_RUNS_TABLE = "cron_job_runs";
const CRON_JOB_EVENTS_TABLE = "cron_job_events";
const PROMISES_TABLE = "promises";
const PENDING_MESSAGES_TABLE = "pending_messages";
const MONTHLY_NOTES_TABLE = "kayley_monthly_notes";
const SOUL_PATH = "server/agent/kayley/SOUL.md";
const IDENTITY_PATH = "server/agent/kayley/IDENTITY.md";

// ==========================================
// 1. Timezone Engine (Powered by date-fns-tz)
// ==========================================

function isValidTimeZone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function clampHour(hour: number | null | undefined): number {
  if (typeof hour !== "number" || !Number.isFinite(hour)) return DEFAULT_DAILY_HOUR;
  return Math.max(0, Math.min(23, Math.floor(hour)));
}

function clampMinute(minute: number | null | undefined): number {
  if (typeof minute !== "number" || !Number.isFinite(minute)) return DEFAULT_DAILY_MINUTE;
  return Math.max(0, Math.min(59, Math.floor(minute)));
}

function computeNextDailyRunAt(
  timezone: string,
  hour: number,
  minute: number,
  fromDate: Date = new Date()
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);

  const zonedNow = toZonedTime(fromDate, tz);
  let targetZoned = set(zonedNow, { hours: h, minutes: m, seconds: 0, milliseconds: 0 });

  if (targetZoned.getTime() <= zonedNow.getTime()) {
    targetZoned = addDays(targetZoned, 1);
  }

  return fromZonedTime(targetZoned, tz).toISOString();
}

function getMonthKey(date: Date, timezone: string): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const zoned = toZonedTime(date, tz);
  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getPreviousMonthKey(date: Date, timezone: string): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const zoned = toZonedTime(date, tz);
  const year = zoned.getFullYear();
  const month = zoned.getMonth() + 1;
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

function computeNextWeeklyRunAt(
  timezone: string,
  anchorIso: string,
  hour: number,
  minute: number,
  fromDate: Date = new Date()
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const anchorDate = new Date(anchorIso);
  if (Number.isNaN(anchorDate.getTime())) {
    throw new Error("Invalid one_time_run_at value for weekly schedule.");
  }

  const anchorZoned = toZonedTime(anchorDate, tz);
  const anchorWeekday = anchorZoned.getDay();
  const nowZoned = toZonedTime(fromDate, tz);
  const currentWeekday = nowZoned.getDay();
  const daysUntil = (anchorWeekday - currentWeekday + 7) % 7;
  let targetZoned = addDays(set(nowZoned, { hours: h, minutes: m, seconds: 0, milliseconds: 0 }), daysUntil);

  if (targetZoned.getTime() <= nowZoned.getTime()) {
    targetZoned = addDays(targetZoned, 7);
  }

  return fromZonedTime(targetZoned, tz).toISOString();
}

function computeNextMonthlyRunAt(
  timezone: string,
  anchorDay: number,
  hour: number,
  minute: number,
  fromDate: Date = new Date()
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);

  const zonedNow = toZonedTime(fromDate, tz);
  const daysThisMonth = lastDayOfMonth(zonedNow).getDate();
  const targetDay = Math.min(Math.max(1, Math.floor(anchorDay)), daysThisMonth);
  let targetZoned = set(zonedNow, { date: targetDay, hours: h, minutes: m, seconds: 0, milliseconds: 0 });

  if (targetZoned.getTime() <= zonedNow.getTime()) {
    const nextMonth = addMonths(zonedNow, 1);
    const nextMonthDays = lastDayOfMonth(nextMonth).getDate();
    const nextDay = Math.min(Math.max(1, Math.floor(anchorDay)), nextMonthDays);
    targetZoned = set(nextMonth, { date: nextDay, hours: h, minutes: m, seconds: 0, milliseconds: 0 });
  }

  return fromZonedTime(targetZoned, tz).toISOString();
}

// ==========================================
// 2. Job Handlers (The Registry Pattern)
// ==========================================

type JobHandlerResult = { summary: string; metadata: any; skipSuccessMessage?: boolean };
type JobHandler = (job: CronJobRow, client: SupabaseClient, schedulerId: string) => Promise<JobHandlerResult>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  "web_search": async (job) => {
    log.info("Executing web_search job handler", {
      source: "JobHandler",
      jobId: job.id,
      jobTitle: job.title,
      actionType: "web_search",
    });

    const query = job.payload?.query || job.search_query || "technology news";
    log.info("Web search query extracted", {
      source: "JobHandler",
      jobId: job.id,
      query,
      usingDefault: !job.payload?.query,
    });

    const results = await runWebSearch(query);
    log.info("Web search results received", {
      source: "JobHandler",
      jobId: job.id,
      resultCount: results.length,
    });

    const summary = await summarizeSearchResults(job, results, query);
    log.info("Web search summary generated", {
      source: "JobHandler",
      jobId: job.id,
      summaryLength: summary.length,
    });

    return { summary, metadata: results, skipSuccessMessage: false };
  },

  "maintenance_reminder": async (job, client, schedulerId) => {
    log.info("Executing maintenance reminder job handler", {
      source: "JobHandler",
      jobId: job.id,
      jobTitle: job.title,
      actionType: "maintenance_reminder",
      schedulerId,
    });

    const instruction =
      typeof job.instruction === "string" && job.instruction.trim().length > 0
        ? job.instruction.trim()
        : typeof job.payload?.instruction === "string"
          ? job.payload.instruction.trim()
          : job.title;

    const messageText = instruction.length > 0
      ? instruction
      : `Maintenance reminder for "${job.title}".`;

    log.info("Queueing maintenance reminder message", {
      source: "JobHandler",
      jobId: job.id,
      jobTitle: job.title,
      messageLength: messageText.length,
      schedulerId,
    });

    const { error: queueError } = await client.from(PENDING_MESSAGES_TABLE).insert({
      message_text: messageText,
      message_type: "text",
      trigger: "maintenance",
      trigger_event_id: job.id,
      trigger_event_title: job.title,
      priority: "normal",
      metadata: {
        source: "cron_scheduler",
        actionType: "maintenance_reminder",
        cronJobId: job.id,
      },
    });

    if (queueError) {
      const error = `Failed to queue maintenance reminder: ${queueError.message}`;
      log.error(error, {
        source: "JobHandler",
        jobId: job.id,
        schedulerId,
        errorCode: queueError.code,
      });
      throw new Error(error);
    }

    const summary = `Maintenance reminder queued for "${job.title}".`;
    log.info("Maintenance reminder queued", {
      source: "JobHandler",
      jobId: job.id,
      schedulerId,
    });

    return { summary, metadata: { instruction }, skipSuccessMessage: true };
  },

  "monthly_memory_rollover": async (job, client, schedulerId) => {
    log.info("Executing monthly memory rollover handler", {
      source: "JobHandler",
      jobId: job.id,
      jobTitle: job.title,
      actionType: "monthly_memory_rollover",
      schedulerId,
    });

    const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
    const previousMonthKey = getPreviousMonthKey(new Date(), timezone);
    const currentMonthKey = getMonthKey(new Date(), timezone);

    const monthlyNotes = await fetchMonthlyNotes(client, previousMonthKey);
    if (!monthlyNotes.trim()) {
      const summary = `Monthly memory rollover skipped: no notes found for ${previousMonthKey}.`;
      log.warning("Monthly notes missing; skipping rollover", {
        source: "JobHandler",
        jobId: job.id,
        monthKey: previousMonthKey,
      });
      return { summary, metadata: { previousMonthKey, currentMonthKey, skipped: true }, skipSuccessMessage: true };
    }

    const workspaceRoot = process.cwd();
    const soulPath = path.resolve(workspaceRoot, SOUL_PATH);
    const identityPath = path.resolve(workspaceRoot, IDENTITY_PATH);

    const soulContent = await fs.readFile(soulPath, "utf8");
    const identityContent = await fs.readFile(identityPath, "utf8");

    const rollover = await requestMonthlyMemoryRollover({
      monthKey: previousMonthKey,
      notes: monthlyNotes,
      soulContent,
      identityContent,
    });

    await fs.writeFile(soulPath, rollover.updatedSoul, "utf8");
    await fs.writeFile(identityPath, rollover.updatedIdentity, "utf8");

    const summaryNote = `Monthly rollover: updated ${SOUL_PATH} and ${IDENTITY_PATH} based on archived monthly notes. ${rollover.changeSummary}`.trim();
    await appendMonthlyNote(client, currentMonthKey, summaryNote);

    const summary = `Monthly memory rollover completed for ${previousMonthKey}.`;
    log.info("Monthly memory rollover completed", {
      source: "JobHandler",
      jobId: job.id,
      monthKey: previousMonthKey,
      summaryLength: summary.length,
    });

    return {
      summary,
      metadata: {
        previousMonthKey,
        currentMonthKey,
        changeSummary: rollover.changeSummary,
      },
      skipSuccessMessage: true,
    };
  },

  "promise_mirror": async (job, client, schedulerId) => {
    log.info("Executing promise_mirror job handler", {
      source: "JobHandler",
      jobId: job.id,
      jobTitle: job.title,
      actionType: "promise_mirror",
      schedulerId,
    });

    const promiseId = job.payload?.promiseId;
    log.info("Promise ID extracted from job payload", {
      source: "JobHandler",
      jobId: job.id,
      promiseId,
      hasPayload: !!job.payload,
    });

    const summary = await fulfillPromiseMirrorJob(client, schedulerId, promiseId, job.title);
    log.info("Promise mirror job completed", {
      source: "JobHandler",
      jobId: job.id,
      promiseId,
      summaryLength: summary.length,
    });

    return { summary, metadata: { promiseId }, skipSuccessMessage: true };
  },

  "code_cleaner": async (job, client) => {
    return runCodeCleanerBatch(job, client);
  },

  "tidy_branch_cleanup": async (job, client) => {
    return runTidyBranchCleanup(job, client);
  },

  // Future skills (e.g., "bug_finder", "tiktok_scraper") get dropped right here!
};

// ==========================================
// 3. Action Execution Logic
// ==========================================

function getTavilyApiKey(): string | null {
  const apiKey = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY;
  return apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
}

function buildFallbackSummary(jobTitle: string, results: TavilyResult[]): string {
  if (!results.length) return `I checked the web for "${jobTitle}" but did not find strong results right now.`;
  const topItems = results.slice(0, 3).map((r, i) => `${i + 1}. ${r.title || "Untitled result"} (${r.url || "N/A"})`);
  return `Quick scheduled digest:\n${topItems.join("\n")}`;
}

async function runWebSearch(query: string): Promise<TavilyResult[]> {
  log.info("Starting web search", {
    source: "WebSearch",
    query,
  });

  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    const error = "Missing Tavily API key.";
    log.error(error, { source: "WebSearch" });
    throw new Error(error);
  }

  log.info("Executing Tavily API request", {
    source: "WebSearch",
    query,
    searchDepth: "basic",
    maxResults: 6,
  });

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 6 }),
  });

  if (!response.ok) {
    const error = `Tavily search failed (${response.status}).`;
    log.error(error, {
      source: "WebSearch",
      query,
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(error);
  }

  const data = await response.json();
  if (!Array.isArray(data?.results)) {
    log.warning("Tavily API returned empty or malformed results", {
      source: "WebSearch",
      query,
      resultsType: typeof data?.results,
    });
    return [];
  }

  const results = data.results.map((item: any) => ({
    title: typeof item?.title === "string" ? item.title : undefined,
    url: typeof item?.url === "string" ? item.url : undefined,
    content: typeof item?.content === "string" ? item.content : undefined,
    score: typeof item?.score === "number" ? item.score : undefined,
  }));

  log.info("Web search completed successfully", {
    source: "WebSearch",
    query,
    resultCount: results.length,
  });

  return results;
}

async function summarizeSearchResults(job: CronJobRow, results: TavilyResult[], query: string): Promise<string> {
  log.info("Starting search results summarization", {
    source: "SearchSummarizer",
    jobId: job.id,
    jobTitle: job.title,
    query,
    resultCount: results.length,
  });

  if (!results.length) {
    const message = `I looked up "${query}" and found no major updates right now.`;
    log.info("Search returned no results", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
      query,
    });
    return message;
  }

  const model = GEMINI_MODEL;
  const context = results.slice(0, 5).map((r, i) => `Result ${i + 1}:\nTitle: ${r.title || "N/A"}\nURL: ${r.url || "N/A"}\nSnippet: ${r.content || "N/A"}`).join("\n\n");
  const instruction = job.instruction?.trim().length
    ? job.instruction.trim()
    : job.summary_instruction?.trim().length
      ? job.summary_instruction.trim()
      : "Summarize what matters in the world right now in clear language.";

  log.info("Preparing Gemini summarization request", {
    source: "SearchSummarizer",
    jobId: job.id,
    jobTitle: job.title,
    model,
    resultCount: results.length,
    contextLength: context.length,
    instructionLength: instruction.length,
  });

  const prompt = `You are Kayley preparing a scheduled digest for Steven.
Task: Use the search results below. Give a concise, readable summary of the most important developments. Keep it practical and human. Include 3-5 bullet points.
Instruction from schedule: ${instruction}
Search Query: ${query}
Results: ${context}`.trim();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const text = response.text?.trim();
    if (!text) {
      log.warning("Gemini returned empty response, using fallback summary", {
        source: "SearchSummarizer",
        jobId: job.id,
        jobTitle: job.title,
      });
      return buildFallbackSummary(job.title, results);
    }

    log.info("Gemini summarization completed successfully", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
      summaryLength: text.length,
      model,
    });

    return text;
  } catch (error) {
    log.warning("Gemini API request failed, using fallback summary", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
      error: error instanceof Error ? error.message : String(error),
    });
    return buildFallbackSummary(job.title, results);
  }
}

async function fetchMonthlyNotes(client: SupabaseClient, monthKey: string): Promise<string> {
  log.info("Fetching monthly notes", {
    source: "MonthlyMemory",
    monthKey,
  });

  const { data, error } = await client
    .from(MONTHLY_NOTES_TABLE)
    .select("notes")
    .eq("month_key", monthKey)
    .maybeSingle();

  if (error) {
    log.error("Failed to fetch monthly notes", {
      source: "MonthlyMemory",
      monthKey,
      error: error.message,
      errorCode: error.code,
    });
    return "";
  }

  return typeof data?.notes === "string" ? data.notes.trim() : "";
}

async function appendMonthlyNote(
  client: SupabaseClient,
  monthKey: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;

  const ensureResult = await client
    .from(MONTHLY_NOTES_TABLE)
    .upsert({ month_key: monthKey }, { onConflict: "month_key" });

  if (ensureResult.error) {
    log.error("Failed to ensure monthly notes row", {
      source: "MonthlyMemory",
      monthKey,
      error: ensureResult.error.message,
    });
    return;
  }

  const { data, error } = await client
    .from(MONTHLY_NOTES_TABLE)
    .select("notes")
    .eq("month_key", monthKey)
    .single();

  if (error) {
    log.error("Failed to read monthly notes row", {
      source: "MonthlyMemory",
      monthKey,
      error: error.message,
    });
    return;
  }

  const existingNotes = typeof data?.notes === "string" ? data.notes.trim() : "";
  const updatedNotes = existingNotes
    ? `${existingNotes}\n- ${trimmed}`
    : `- ${trimmed}`;

  const updateResult = await client
    .from(MONTHLY_NOTES_TABLE)
    .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
    .eq("month_key", monthKey);

  if (updateResult.error) {
    log.error("Failed to append monthly note", {
      source: "MonthlyMemory",
      monthKey,
      error: updateResult.error.message,
    });
  }
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response did not contain JSON.");
  }
  return trimmed.slice(start, end + 1);
}

async function requestMonthlyMemoryRollover(input: {
  monthKey: string;
  notes: string;
  soulContent: string;
  identityContent: string;
}): Promise<{ updatedSoul: string; updatedIdentity: string; changeSummary: string }> {
  const model = GEMINI_MODEL;
  const prompt = `You are Kayley performing a monthly memory rollover.
Use ONLY the provided monthly notes as the source of truth. Do not invent new facts.
Task:
1) Update SOUL.md and IDENTITY.md so they reflect the notes (add/reword/delete as needed).
2) Keep formatting clean and close to the original style.
3) If no changes are needed, return the original content unchanged.
4) Provide a concise change summary (1-3 sentences, no dates, mention file paths).

Return JSON only, with keys:
- updatedSoul
- updatedIdentity
- changeSummary

Monthly Notes (from kayley_monthly_notes, month ${input.monthKey}):
${input.notes}

Current SOUL.md:
${input.soulContent}

Current IDENTITY.md:
${input.identityContent}
`.trim();

  log.info("Requesting monthly memory rollover from Gemini", {
    source: "MonthlyMemory",
    model,
    monthKey: input.monthKey,
    promptLength: prompt.length,
  });

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini rollover response was empty.");
  }

  const json = JSON.parse(extractJsonPayload(text));
  const updatedSoul = typeof json.updatedSoul === "string" ? json.updatedSoul.trim() : "";
  const updatedIdentity = typeof json.updatedIdentity === "string" ? json.updatedIdentity.trim() : "";
  const changeSummary = typeof json.changeSummary === "string" ? json.changeSummary.trim() : "";

  if (!updatedSoul || !updatedIdentity || !changeSummary) {
    throw new Error("Gemini rollover response missing required fields.");
  }

  return { updatedSoul, updatedIdentity, changeSummary };
}

async function fulfillPromiseMirrorJob(client: SupabaseClient, schedulerId: string, promiseId: string | undefined, jobTitle: string): Promise<string> {
  log.info("Starting promise mirror job execution", {
    source: "PromiseMirror",
    jobTitle,
    promiseId,
    schedulerId,
  });

  if (!promiseId) {
    const message = `Promise reminder executed for "${jobTitle}", but promise id was missing in payload.`;
    log.warning("Promise ID missing from job payload", {
      source: "PromiseMirror",
      jobTitle,
      schedulerId,
    });
    return message;
  }

  log.info("Fetching promise record from database", {
    source: "PromiseMirror",
    promiseId,
    jobTitle,
    schedulerId,
  });

  const { data: promiseData, error: promiseError } = await client.from(PROMISES_TABLE).select("id,promise_type,description,trigger_event,fulfillment_data,status").eq("id", promiseId).maybeSingle();

  if (promiseError) {
    const error = `Failed to load promise ${promiseId}: ${promiseError.message}`;
    log.error(error, {
      source: "PromiseMirror",
      promiseId,
      schedulerId,
      errorCode: promiseError.code,
    });
    throw new Error(error);
  }

  if (!promiseData) {
    const message = `Promise reminder executed, but promise ${promiseId} was not found.`;
    log.warning("Promise not found in database", {
      source: "PromiseMirror",
      promiseId,
      jobTitle,
      schedulerId,
    });
    return message;
  }

  const promise = promiseData as PromiseRow;
  log.info("Promise record loaded", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    status: promise.status,
    jobTitle,
    schedulerId,
  });

  if (promise.status !== "pending") {
    const message = `Promise reminder executed. Promise ${promise.id} already ${promise.status}.`;
    log.info("Promise already fulfilled, skipping execution", {
      source: "PromiseMirror",
      promiseId: promise.id,
      promiseType: promise.promise_type,
      currentStatus: promise.status,
      jobTitle,
      schedulerId,
    });
    return message;
  }

  const fulfillmentData = promise.fulfillment_data && typeof promise.fulfillment_data === "object" ? promise.fulfillment_data : {};
  const selfieParams = fulfillmentData.selfieParams && typeof fulfillmentData.selfieParams === "object" ? (fulfillmentData.selfieParams as Record<string, unknown>) : {};

  const defaultMessage = promise.promise_type === "send_selfie" ? "Okay heading out now! Here's your selfie." : `Following up on: ${promise.description}`;
  const messageText = typeof fulfillmentData.messageText === "string" && fulfillmentData.messageText.trim().length > 0 ? fulfillmentData.messageText.trim() : defaultMessage;
  const messageType = promise.promise_type === "send_selfie" ? "photo" : "text";

  log.info("Preparing promise fulfillment message", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    messageType,
    messageLength: messageText.length,
    usingDefaultMessage: messageText === defaultMessage,
    schedulerId,
  });

  const metadata: Record<string, unknown> = { promiseId: promise.id, promiseType: promise.promise_type, triggerEvent: promise.trigger_event };
  if (messageType === "photo") {
    metadata.selfieParams = {
      scene: typeof selfieParams.scene === "string" && selfieParams.scene.trim().length > 0 ? selfieParams.scene : "casual outdoor selfie",
      mood: typeof selfieParams.mood === "string" && selfieParams.mood.trim().length > 0 ? selfieParams.mood : "happy smile",
      location: typeof selfieParams.location === "string" ? selfieParams.location : undefined,
    };
    log.info("Photo metadata prepared", {
      source: "PromiseMirror",
      promiseId: promise.id,
      scene: (metadata.selfieParams as any).scene,
      mood: (metadata.selfieParams as any).mood,
      location: (metadata.selfieParams as any).location,
    });
  }

  log.info("Queueing pending message for promise fulfillment", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    messageType,
    schedulerId,
  });

  const { error: queueError } = await client.from(PENDING_MESSAGES_TABLE).insert({
    message_text: messageText,
    message_type: messageType,
    trigger: "promise",
    trigger_event_id: promise.id,
    trigger_event_title: promise.description,
    priority: "normal",
    metadata: { source: "cron_scheduler", ...metadata },
  });

  if (queueError) {
    const error = `Failed to queue promise pending message: ${queueError.message}`;
    log.error(error, {
      source: "PromiseMirror",
      promiseId: promise.id,
      promiseType: promise.promise_type,
      errorCode: queueError.code,
      schedulerId,
    });
    throw new Error(error);
  }

  log.info("Pending message queued successfully", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    schedulerId,
  });

  log.info("Marking promise as fulfilled in database", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    schedulerId,
  });

  const { error: fulfillError } = await client.from(PROMISES_TABLE).update({ status: "fulfilled", fulfilled_at: new Date().toISOString() }).eq("id", promise.id).eq("status", "pending");

  if (fulfillError) {
    const error = `Failed to mark promise fulfilled: ${fulfillError.message}`;
    log.error(error, {
      source: "PromiseMirror",
      promiseId: promise.id,
      promiseType: promise.promise_type,
      errorCode: fulfillError.code,
      schedulerId,
    });
    throw new Error(error);
  }

  log.info("Promise marked as fulfilled", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    schedulerId,
  });

  log.info("Logging promise fulfillment event", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    schedulerId,
  });

  // Log to cron events
  await client.from(CRON_JOB_EVENTS_TABLE).insert({
    event_type: "promise_fulfilled",
    actor: schedulerId,
    message: `Promise ${promise.id} queued for delivery (${promise.promise_type}).`,
    metadata: { promiseId: promise.id, promiseType: promise.promise_type },
  });

  const result = `Promise reminder executed for ${promise.promise_type}. Queued pending delivery.`;
  log.info("Promise mirror job completed successfully", {
    source: "PromiseMirror",
    promiseId: promise.id,
    promiseType: promise.promise_type,
    result,
    schedulerId,
  });

  return result;
}

// ==========================================
// 4. The Orchestrator
// ==========================================

class CronScheduler {
  private readonly client: SupabaseClient;
  private readonly tickMs: number;
  private readonly schedulerId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  public constructor(options: StartCronSchedulerOptions) {
    this.client = createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.tickMs = Math.max(10_000, options.tickMs ?? DEFAULT_TICK_MS);
    this.schedulerId = options.schedulerId || `scheduler_${process.pid}`;
  }

  public start(): void {
    if (this.timer) {
      log.warning("CronScheduler.start() called but scheduler is already running", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
      });
      return;
    }
    log.info("CronScheduler starting", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      tickMs: this.tickMs,
    });
    this.timer = setInterval(() => { void this.tick(); }, this.tickMs);
    void this.tick();
  }

  public stop(): void {
    if (!this.timer) {
      log.warning("CronScheduler.stop() called but scheduler was not running", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
      });
      return;
    }
    log.info("CronScheduler stopping", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
    });
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      log.warning("Tick already in progress, skipping concurrent tick", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
      });
      return;
    }
    this.isTicking = true;
    log.info("Tick cycle started", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
    });
    try {
      const dueJobs = await this.fetchDueJobs();
      if (dueJobs.length === 0) {
        log.info("No due jobs found in tick cycle", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
        });
        return;
      }

      log.info("Processing due jobs", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        dueCount: dueJobs.length,
        jobIds: dueJobs.map(j => j.id).join(", "),
      });
      for (const dueJob of dueJobs) {
        await this.processDueJob(dueJob);
      }
      log.info("Tick cycle completed successfully", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        processedCount: dueJobs.length,
      });
    } catch (error) {
      log.error("Tick cycle failed with exception", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : "unknown",
      });
    } finally {
      this.isTicking = false;
    }
  }

  private async fetchDueJobs(): Promise<CronJobRow[]> {
    const nowIso = new Date().toISOString();
    log.info("Fetching due cron jobs", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      now: nowIso,
      maxDuePerTick: MAX_DUE_JOBS_PER_TICK,
    });

    const { data, error } = await this.client
      .from(CRON_JOBS_TABLE)
      .select("id,title,action_type,instruction,payload,search_query,summary_instruction,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status")
      .eq("status", "active")
      .not("next_run_at", "is", null)
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .limit(MAX_DUE_JOBS_PER_TICK);

    if (error) {
      log.error("Failed to fetch due cron jobs from database", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        error: error.message,
        errorCode: error.code,
      });
      return [];
    }

    const jobs = (data as CronJobRow[]) || [];
    log.info("Fetched cron jobs successfully", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobCount: jobs.length,
      jobIds: jobs.map(j => j.id).join(", "),
      jobTitles: jobs.map(j => j.title).join(", "),
    });
    return jobs;
  }

  private async processDueJob(dueJob: CronJobRow): Promise<void> {
    log.info("Processing due cron job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: dueJob.id,
      jobTitle: dueJob.title,
      actionType: dueJob.action_type,
      scheduleType: dueJob.schedule_type,
    });

    const claimAttempt = await this.claimJob(dueJob.id);
    if (!claimAttempt) {
      log.warning("Failed to claim cron job or job already claimed", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: dueJob.id,
        jobTitle: dueJob.title,
      });
      return;
    }

    log.info("Successfully claimed cron job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: claimAttempt.id,
      jobTitle: claimAttempt.title,
      status: claimAttempt.status,
    });

    const scheduledFor = claimAttempt.next_run_at || new Date().toISOString();
    log.info("Creating cron job run record", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: claimAttempt.id,
      jobTitle: claimAttempt.title,
      scheduledFor,
      actionType: claimAttempt.action_type,
    });

    const runInsert = await this.client
      .from(CRON_JOB_RUNS_TABLE)
      .insert({
        cron_job_id: claimAttempt.id,
        scheduled_for: scheduledFor,
        status: "running",
        search_query: claimAttempt.search_query || claimAttempt.payload?.query || "",
        search_results: [],
        action_type: claimAttempt.action_type,
        execution_metadata: {},
      })
      .select("id")
      .single();

    if (runInsert.error || !runInsert.data?.id) {
      const runLogErrorMessage = `Failed to create run log: ${runInsert.error?.message || "unknown error"}`;
      log.error("Failed to create cron job run record", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        error: runInsert.error?.message || "unknown error",
        errorCode: runInsert.error?.code,
      });
      await this.logCronEvent({ cronJobId: claimAttempt.id, eventType: "run_failed", actor: this.schedulerId, message: `Run failed for "${claimAttempt.title}": ${runLogErrorMessage}`, metadata: { reason: "run_insert_failed" } });
      await this.failJob(claimAttempt, runLogErrorMessage);
      await this.queueCronTextMessage({ messageText: `Scheduled update failed: "${claimAttempt.title}"\nError: ${runLogErrorMessage}`, triggerEventTitle: claimAttempt.title, metadata: { cronJobId: claimAttempt.id, kind: "cron_failure" } });
      return;
    }

    const runId = String(runInsert.data.id);
    log.info("Cron job run record created", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: claimAttempt.id,
      jobTitle: claimAttempt.title,
      runId,
    });

    try {
      // Look up the handler in our Registry
      log.info("Looking up job handler", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        runId,
        actionType: claimAttempt.action_type,
      });

      const handler = JOB_HANDLERS[claimAttempt.action_type];
      if (!handler) throw new Error(`Unknown action_type: ${claimAttempt.action_type}`);

      log.info("Executing job handler", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        runId,
        actionType: claimAttempt.action_type,
      });

      // Execute the handler!
      const { summary, metadata, skipSuccessMessage } = await handler(claimAttempt, this.client, this.schedulerId);
      const finishedAt = new Date().toISOString();

      log.info("Job handler execution completed", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        runId,
        summaryLength: summary.length,
        finishedAt,
      });

      const { error: runUpdateError } = await this.client
        .from(CRON_JOB_RUNS_TABLE)
        .update({ status: "success" as CronRunStatus, finished_at: finishedAt, execution_metadata: metadata, summary, error: null })
        .eq("id", runId);

      if (runUpdateError) {
        log.error("Failed to finalize successful cron job run", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
          error: runUpdateError.message,
          errorCode: runUpdateError.code,
        });
      } else {
        log.info("Cron job run finalized as success", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
        });
      }

      const nextState = this.getJobSuccessState(claimAttempt);
      log.info("Computed next job state", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        nextStatus: nextState.status,
        nextRunAt: nextState.nextRunAt,
        scheduleType: claimAttempt.schedule_type,
      });

      const { error: jobUpdateError } = await this.client
        .from(CRON_JOBS_TABLE)
        .update({ status: nextState.status, next_run_at: nextState.nextRunAt, last_run_at: finishedAt, last_run_status: "success", last_error: null })
        .eq("id", claimAttempt.id);

      if (jobUpdateError) {
        log.error("Failed to update cron job after successful run", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
          error: jobUpdateError.message,
          errorCode: jobUpdateError.code,
        });
      } else {
        log.info("Cron job updated after success", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
          newStatus: nextState.status,
          nextRunAt: nextState.nextRunAt,
        });
      }

      if (!skipSuccessMessage) {
        log.info("Queueing cron success message", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
        });
        await this.queueCronTextMessage({
          messageText: this.buildCronSuccessMessage(claimAttempt.title, summary),
          triggerEventId: runId,
          triggerEventTitle: claimAttempt.title,
          metadata: { cronJobId: claimAttempt.id, cronRunId: runId, scheduleType: claimAttempt.schedule_type },
        });
      } else {
        log.info("Skipping success message for cron job", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
          actionType: claimAttempt.action_type,
        });
      }

      await this.logCronEvent({ cronJobId: claimAttempt.id, cronRunId: runId, eventType: "run_success", actor: this.schedulerId, message: `Cron job "${claimAttempt.title}" emitted successfully.`, metadata: { nextRunAt: nextState.nextRunAt, scheduleType: claimAttempt.schedule_type } });

      log.info("Cron job processing completed successfully", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        runId,
        actionType: claimAttempt.action_type,
        scheduleType: claimAttempt.schedule_type,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution error";
      const finishedAt = new Date().toISOString();

      log.error("Cron job execution failed with exception", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: claimAttempt.id,
        jobTitle: claimAttempt.title,
        runId,
        error: message,
        errorType: error instanceof Error ? error.constructor.name : "unknown",
      });

      const updateRunResult = await this.client.from(CRON_JOB_RUNS_TABLE).update({ status: "failed" as CronRunStatus, finished_at: finishedAt, error: message }).eq("id", runId);
      if (updateRunResult.error) {
        log.error("Failed to update run record to failed status", {
          source: "CronScheduler",
          schedulerId: this.schedulerId,
          jobId: claimAttempt.id,
          jobTitle: claimAttempt.title,
          runId,
          error: updateRunResult.error.message,
        });
      }

      await this.failJob(claimAttempt, message);
      await this.logCronEvent({ cronJobId: claimAttempt.id, cronRunId: runId, eventType: "run_failed", actor: this.schedulerId, message: `Run failed for "${claimAttempt.title}": ${message}` });
      await this.queueCronTextMessage({ messageText: `Scheduled update failed: "${claimAttempt.title}"\nError: ${message}`, triggerEventId: runId, triggerEventTitle: claimAttempt.title, metadata: { cronJobId: claimAttempt.id, cronRunId: runId, kind: "cron_failure" } });
    }
  }

  private async claimJob(jobId: string): Promise<CronJobRow | null> {
    const nowIso = new Date().toISOString();
    log.info("Attempting to claim cron job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId,
      now: nowIso,
    });

    const { data, error } = await this.client
      .from(CRON_JOBS_TABLE)
      .update({ status: "running" as CronJobStatus })
      .eq("id", jobId)
      .eq("status", "active")
      .lte("next_run_at", nowIso)
      .select("id,title,action_type,instruction,payload,search_query,summary_instruction,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status")
      .maybeSingle();

    if (error) {
      log.error("Failed to claim cron job - database error", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId,
        error: error.message,
        errorCode: error.code,
      });
      return null;
    }

    if (!data) {
      log.warning("Failed to claim cron job - not found or not eligible", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId,
        reason: "Job may have been already claimed or its status is not active",
      });
      return null;
    }

    log.info("Successfully claimed cron job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: data.id,
      jobTitle: data.title,
      actionType: data.action_type,
    });
    return data as CronJobRow;
  }

  private getJobSuccessState(job: CronJobRow): { status: CronJobStatus; nextRunAt: string | null } {
    if (job.schedule_type === "daily") {
      const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
      const nextRunAt = computeNextDailyRunAt(timezone, clampHour(job.schedule_hour), clampMinute(job.schedule_minute));
      return { status: "active", nextRunAt };
    }
    if (job.schedule_type === "weekly") {
      const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
      const anchorIso = job.one_time_run_at || new Date().toISOString();
      const nextRunAt = computeNextWeeklyRunAt(timezone, anchorIso, clampHour(job.schedule_hour), clampMinute(job.schedule_minute));
      return { status: "active", nextRunAt };
    }
    if (job.schedule_type === "monthly") {
      const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
      const anchorDate = job.one_time_run_at ? toZonedTime(new Date(job.one_time_run_at), timezone) : toZonedTime(new Date(), timezone);
      const anchorDay = anchorDate.getDate();
      const nextRunAt = computeNextMonthlyRunAt(timezone, anchorDay, clampHour(job.schedule_hour), clampMinute(job.schedule_minute));
      return { status: "active", nextRunAt };
    }
    return { status: "completed", nextRunAt: null };
  }

  private async failJob(job: CronJobRow, errorMessage: string): Promise<void> {
    const finishedAt = new Date().toISOString();
    log.warning("Failing cron job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: job.id,
      jobTitle: job.title,
      error: errorMessage,
      scheduleType: job.schedule_type,
    });

    const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
    const nextState =
      job.schedule_type === "daily"
        ? { status: "active" as CronJobStatus, nextRunAt: computeNextDailyRunAt(timezone, clampHour(job.schedule_hour), clampMinute(job.schedule_minute)) }
        : job.schedule_type === "weekly"
          ? {
              status: "active" as CronJobStatus,
              nextRunAt: computeNextWeeklyRunAt(
                timezone,
                job.one_time_run_at || new Date().toISOString(),
                clampHour(job.schedule_hour),
                clampMinute(job.schedule_minute),
              ),
            }
          : job.schedule_type === "monthly"
            ? {
                status: "active" as CronJobStatus,
                nextRunAt: computeNextMonthlyRunAt(
                  timezone,
                  job.one_time_run_at ? toZonedTime(new Date(job.one_time_run_at), timezone).getDate() : toZonedTime(new Date(), timezone).getDate(),
                  clampHour(job.schedule_hour),
                  clampMinute(job.schedule_minute),
                ),
              }
            : { status: "failed" as CronJobStatus, nextRunAt: null };

    log.info("Computed next state for failed job", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      jobId: job.id,
      jobTitle: job.title,
      nextStatus: nextState.status,
      nextRunAt: nextState.nextRunAt,
      scheduleType: job.schedule_type,
    });

    const { error } = await this.client.from(CRON_JOBS_TABLE).update({ status: nextState.status, next_run_at: nextState.nextRunAt, last_run_at: finishedAt, last_run_status: "failed", last_error: errorMessage }).eq("id", job.id);

    if (error) {
      log.error("Failed to persist cron job failure to database", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: job.id,
        jobTitle: job.title,
        error: error.message,
        errorCode: error.code,
      });
    } else {
      log.info("Persisted cron job failure to database", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        jobId: job.id,
        jobTitle: job.title,
        newStatus: nextState.status,
        nextRunAt: nextState.nextRunAt,
      });
    }
  }

  private async logCronEvent(input: { cronJobId?: string; cronRunId?: string; eventType: string; actor?: string; message: string; metadata?: Record<string, unknown> }): Promise<void> {
    const payload = { cron_job_id: input.cronJobId || null, cron_run_id: input.cronRunId || null, event_type: input.eventType, actor: input.actor || "scheduler", message: input.message, metadata: input.metadata || {} };

    log.info("Inserting cron event", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      eventType: input.eventType,
      cronJobId: input.cronJobId,
      cronRunId: input.cronRunId,
      actor: input.actor || "scheduler",
      message: input.message,
    });

    const { error } = await this.client.from(CRON_JOB_EVENTS_TABLE).insert(payload);

    if (error) {
      log.error("Failed to insert cron event", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        eventType: input.eventType,
        cronJobId: input.cronJobId,
        cronRunId: input.cronRunId,
        error: error.message,
        errorCode: error.code,
      });
    } else {
      log.info("Cron event inserted successfully", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        eventType: input.eventType,
        cronJobId: input.cronJobId,
        cronRunId: input.cronRunId,
      });
    }
  }

  private buildCronSuccessMessage(jobTitle: string, summary: string): string {
    const trimmedSummary = (summary || "").trim();
    if (!trimmedSummary) return `Scheduled update: "${jobTitle}" ran successfully.`;
    return `Scheduled update: "${jobTitle}"\n${trimmedSummary}`;
  }

  private async queueCronTextMessage(input: { messageText: string; triggerEventId?: string; triggerEventTitle?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const payload = { message_text: input.messageText, message_type: "text", trigger: "promise", trigger_event_id: input.triggerEventId || null, trigger_event_title: input.triggerEventTitle || null, priority: "normal", metadata: { source: "cron_scheduler", ...(input.metadata || {}) } };

    log.info("Queueing cron text message", {
      source: "CronScheduler",
      schedulerId: this.schedulerId,
      triggerEventId: input.triggerEventId,
      triggerEventTitle: input.triggerEventTitle,
      messageLength: input.messageText.length,
      priority: "normal",
    });

    const { error } = await this.client.from(PENDING_MESSAGES_TABLE).insert(payload);

    if (error) {
      log.error("Failed to queue cron text message", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        triggerEventId: input.triggerEventId,
        triggerEventTitle: input.triggerEventTitle,
        error: error.message,
        errorCode: error.code,
      });
    } else {
      log.info("Cron text message queued successfully", {
        source: "CronScheduler",
        schedulerId: this.schedulerId,
        triggerEventId: input.triggerEventId,
        triggerEventTitle: input.triggerEventTitle,
      });
    }
  }
}

export function startCronScheduler(options: StartCronSchedulerOptions): StartedCronScheduler {
  const scheduler = new CronScheduler(options);
  scheduler.start();
  return { stop: () => scheduler.stop() };
}
