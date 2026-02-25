import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addDays, set } from "date-fns";
import { log } from "../runtimeLogger";

const LOG_PREFIX = "[CronScheduler]";
const DEFAULT_TICK_MS = 60_000;
const MAX_DUE_JOBS_PER_TICK = 10;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_HOUR = 12;
const DEFAULT_DAILY_MINUTE = 0;

type CronScheduleType = "daily" | "one_time";
type CronJobStatus = "active" | "paused" | "running" | "completed" | "failed";
type CronRunStatus = "running" | "success" | "failed";

interface CronJobRow {
  id: string;
  title: string;
  action_type: string;
  instruction: string;
  payload: any;
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

    const query = job.payload?.query || "technology news";
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
  }

  // Future skills (e.g., "bug_finder", "tiktok_scraper") get dropped right here!
};

// ==========================================
// 3. Action Execution Logic
// ==========================================

function getTavilyApiKey(): string | null {
  const apiKey = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY;
  return apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
}

function getGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
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

  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    log.warning("Gemini API key missing, using fallback summary", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
    });
    return buildFallbackSummary(job.title, results);
  }

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

  const model = process.env.GEMINI_TEXT_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-2.0-flash";
  const context = results.slice(0, 5).map((r, i) => `Result ${i + 1}:\nTitle: ${r.title || "N/A"}\nURL: ${r.url || "N/A"}\nSnippet: ${r.content || "N/A"}`).join("\n\n");
  const instruction = job.instruction?.trim().length ? job.instruction.trim() : "Summarize what matters in the world right now in clear language.";

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

  log.info("Sending request to Gemini API", {
    source: "SearchSummarizer",
    jobId: job.id,
    jobTitle: job.title,
    model,
    promptLength: prompt.length,
  });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    log.warning("Gemini API request failed, using fallback summary", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
      status: response.status,
      statusText: response.statusText,
    });
    return buildFallbackSummary(job.title, results);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("\n").trim();

  if (!text) {
    log.warning("Gemini returned empty response, using fallback summary", {
      source: "SearchSummarizer",
      jobId: job.id,
      jobTitle: job.title,
      responseStructure: data?.candidates ? "valid" : "invalid",
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
      .select("id,title,action_type,instruction,payload,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status")
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
      .select("id,title,action_type,instruction,payload,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status")
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

    const nextState = job.schedule_type === "daily"
      ? { status: "active" as CronJobStatus, nextRunAt: computeNextDailyRunAt(isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE, clampHour(job.schedule_hour), clampMinute(job.schedule_minute)) }
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