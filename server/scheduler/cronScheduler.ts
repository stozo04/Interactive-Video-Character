import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  search_query: string;
  summary_instruction: string;
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
const PROMISE_CRON_QUERY_PREFIX = "promise_reminder:";

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
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

function getTimeZoneDateParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    second: getPart("second"),
  };
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = getTimeZoneDateParts(date, timezone);
  const utcEquivalent = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return utcEquivalent - date.getTime();
}

function zonedLocalTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const firstOffset = getTimeZoneOffsetMs(localAsUtc, timezone);
  let candidate = new Date(localAsUtc.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(candidate, timezone);
  if (secondOffset !== firstOffset) {
    candidate = new Date(localAsUtc.getTime() - secondOffset);
  }
  return candidate;
}

function addOneDay(year: number, month: number, day: number): {
  year: number;
  month: number;
  day: number;
} {
  const next = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function computeNextDailyRunAt(
  timezone: string,
  hour: number,
  minute: number,
  fromDate: Date = new Date(),
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const localNow = getTimeZoneDateParts(fromDate, tz);
  const h = clampHour(hour);
  const m = clampMinute(minute);

  let candidate = zonedLocalTimeToUtc(
    tz,
    localNow.year,
    localNow.month,
    localNow.day,
    h,
    m,
  );

  if (candidate.getTime() <= fromDate.getTime()) {
    const tomorrow = addOneDay(localNow.year, localNow.month, localNow.day);
    candidate = zonedLocalTimeToUtc(
      tz,
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      h,
      m,
    );
  }

  return candidate.toISOString();
}

function getTavilyApiKey(): string | null {
  const apiKey = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY;
  return apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
}

function getGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  return apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
}

function buildFallbackSummary(jobTitle: string, results: TavilyResult[]): string {
  if (!results.length) {
    return `I checked the web for "${jobTitle}" but did not find strong results right now.`;
  }

  const topItems = results.slice(0, 3).map((result, index) => {
    const title = result.title || "Untitled result";
    const url = result.url || "N/A";
    return `${index + 1}. ${title} (${url})`;
  });

  return `Quick scheduled digest:\n${topItems.join("\n")}`;
}

async function runWebSearch(query: string): Promise<TavilyResult[]> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    throw new Error("Missing Tavily API key (TAVILY_API_KEY or VITE_TAVILY_API_KEY).");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 6,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.results)) {
    return [];
  }

  return data.results.map((item: any) => ({
    title: typeof item?.title === "string" ? item.title : undefined,
    url: typeof item?.url === "string" ? item.url : undefined,
    content: typeof item?.content === "string" ? item.content : undefined,
    score: typeof item?.score === "number" ? item.score : undefined,
  }));
}

async function summarizeSearchResults(
  job: CronJobRow,
  results: TavilyResult[],
): Promise<string> {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    return buildFallbackSummary(job.title, results);
  }

  if (!results.length) {
    return `I looked up "${job.search_query}" and found no major updates right now.`;
  }

  const model = process.env.GEMINI_TEXT_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-2.0-flash";
  const context = results
    .slice(0, 5)
    .map((result, index) => {
      return [
        `Result ${index + 1}:`,
        `Title: ${result.title || "N/A"}`,
        `URL: ${result.url || "N/A"}`,
        `Snippet: ${result.content || "N/A"}`,
      ].join("\n");
    })
    .join("\n\n");

  const instruction = job.summary_instruction?.trim().length
    ? job.summary_instruction.trim()
    : "Summarize what matters in the world right now in clear language.";

  const prompt = `
You are Kayley preparing a scheduled digest for Steven.

Task:
- Use the search results below.
- Give a concise, readable summary of the most important developments.
- Keep it practical and human.
- Include 3-5 bullet points.
- Mention sources naturally when relevant.

Instruction from schedule:
${instruction}

Search Query:
${job.search_query}

Results:
${context}
`.trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    console.warn(`${LOG_PREFIX} Gemini summarize failed; using fallback`, {
      status: response.status,
    });
    return buildFallbackSummary(job.title, results);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  if (!text) {
    return buildFallbackSummary(job.title, results);
  }

  return text;
}

class CronScheduler {
  private readonly client: SupabaseClient;
  private readonly tickMs: number;
  private readonly schedulerId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  public constructor(options: StartCronSchedulerOptions) {
    this.client = createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.tickMs = Math.max(10_000, options.tickMs ?? DEFAULT_TICK_MS);
    this.schedulerId = options.schedulerId || `scheduler_${process.pid}`;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    console.log(`${LOG_PREFIX} Starting`, {
      tickMs: this.tickMs,
      schedulerId: this.schedulerId,
    });

    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);

    void this.tick();
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    console.log(`${LOG_PREFIX} Stopped`, {
      schedulerId: this.schedulerId,
    });
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      return;
    }

    this.isTicking = true;
    try {
      const dueJobs = await this.fetchDueJobs();
      if (dueJobs.length === 0) {
        return;
      }

      console.log(`${LOG_PREFIX} Processing due jobs`, {
        dueCount: dueJobs.length,
      });

      for (const dueJob of dueJobs) {
        await this.processDueJob(dueJob);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Tick failed`, { error });
    } finally {
      this.isTicking = false;
    }
  }

  private async fetchDueJobs(): Promise<CronJobRow[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from(CRON_JOBS_TABLE)
      .select(
        "id,title,search_query,summary_instruction,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status",
      )
      .eq("status", "active")
      .not("next_run_at", "is", null)
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .limit(MAX_DUE_JOBS_PER_TICK);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch due jobs`, { error });
      return [];
    }

    return (data as CronJobRow[]) || [];
  }

  private async processDueJob(dueJob: CronJobRow): Promise<void> {
    const claimAttempt = await this.claimJob(dueJob.id);
    if (!claimAttempt) {
      return;
    }

    const scheduledFor = claimAttempt.next_run_at || new Date().toISOString();
    const runInsert = await this.client
      .from(CRON_JOB_RUNS_TABLE)
      .insert({
        cron_job_id: claimAttempt.id,
        scheduled_for: scheduledFor,
        status: "running",
        search_query: claimAttempt.search_query,
        search_results: [],
      })
      .select("id")
      .single();

    if (runInsert.error || !runInsert.data?.id) {
      const runLogErrorMessage = `Failed to create run log: ${runInsert.error?.message || "unknown error"}`;
      console.error(`${LOG_PREFIX} Failed to create run log`, {
        jobId: claimAttempt.id,
        error: runInsert.error,
      });
      await this.logCronEvent({
        cronJobId: claimAttempt.id,
        eventType: "run_failed",
        actor: this.schedulerId,
        message: `Run failed for "${claimAttempt.title}": ${runLogErrorMessage}`,
        metadata: {
          reason: "run_insert_failed",
        },
      });
      await this.failJob(claimAttempt, runLogErrorMessage);
      await this.queueCronTextMessage({
        messageText: `Scheduled update failed: "${claimAttempt.title}"\nError: ${runLogErrorMessage}`,
        triggerEventTitle: claimAttempt.title,
        metadata: {
          cronJobId: claimAttempt.id,
          kind: "cron_failure",
        },
      });
      return;
    }

    const runId = String(runInsert.data.id);
    try {
      const isPromiseMirrorJob = claimAttempt.search_query.startsWith(PROMISE_CRON_QUERY_PREFIX);
      const results = isPromiseMirrorJob ? [] : await runWebSearch(claimAttempt.search_query);
      const summary = isPromiseMirrorJob
        ? await this.fulfillPromiseMirrorJob(claimAttempt.search_query, claimAttempt.title)
        : await summarizeSearchResults(claimAttempt, results);
      const finishedAt = new Date().toISOString();

      const { error: runUpdateError } = await this.client
        .from(CRON_JOB_RUNS_TABLE)
        .update({
          status: "success" as CronRunStatus,
          finished_at: finishedAt,
          search_results: results,
          summary,
          error: null,
        })
        .eq("id", runId);

      if (runUpdateError) {
        console.error(`${LOG_PREFIX} Failed to finalize success run`, {
          runId,
          runUpdateError,
        });
      }

      const nextState = this.getJobSuccessState(claimAttempt);
      const { error: jobUpdateError } = await this.client
        .from(CRON_JOBS_TABLE)
        .update({
          status: nextState.status,
          next_run_at: nextState.nextRunAt,
          last_run_at: finishedAt,
          last_run_status: "success",
          last_error: null,
        })
        .eq("id", claimAttempt.id);

      if (jobUpdateError) {
        console.error(`${LOG_PREFIX} Failed to update job after success`, {
          jobId: claimAttempt.id,
          jobUpdateError,
        });
      }

      console.log(`${LOG_PREFIX} Completed job`, {
        jobId: claimAttempt.id,
        runId,
        status: nextState.status,
        nextRunAt: nextState.nextRunAt,
      });

      if (!isPromiseMirrorJob) {
        await this.queueCronTextMessage({
          messageText: this.buildCronSuccessMessage(claimAttempt.title, summary),
          triggerEventId: runId,
          triggerEventTitle: claimAttempt.title,
          metadata: {
            cronJobId: claimAttempt.id,
            cronRunId: runId,
            scheduleType: claimAttempt.schedule_type,
          },
        });
      }

      await this.logCronEvent({
        cronJobId: claimAttempt.id,
        cronRunId: runId,
        eventType: "run_success",
        actor: this.schedulerId,
        message: `Cron job "${claimAttempt.title}" emitted successfully.`,
        metadata: {
          nextRunAt: nextState.nextRunAt,
          scheduleType: claimAttempt.schedule_type,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution error";
      const finishedAt = new Date().toISOString();

      await this.client
        .from(CRON_JOB_RUNS_TABLE)
        .update({
          status: "failed" as CronRunStatus,
          finished_at: finishedAt,
          error: message,
        })
        .eq("id", runId);

      await this.failJob(claimAttempt, message);
      await this.logCronEvent({
        cronJobId: claimAttempt.id,
        cronRunId: runId,
        eventType: "run_failed",
        actor: this.schedulerId,
        message: `Run failed for "${claimAttempt.title}": ${message}`,
      });
      await this.queueCronTextMessage({
        messageText: `Scheduled update failed: "${claimAttempt.title}"\nError: ${message}`,
        triggerEventId: runId,
        triggerEventTitle: claimAttempt.title,
        metadata: {
          cronJobId: claimAttempt.id,
          cronRunId: runId,
          kind: "cron_failure",
        },
      });
    }
  }

  private async claimJob(jobId: string): Promise<CronJobRow | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from(CRON_JOBS_TABLE)
      .update({ status: "running" as CronJobStatus })
      .eq("id", jobId)
      .eq("status", "active")
      .lte("next_run_at", nowIso)
      .select(
        "id,title,search_query,summary_instruction,schedule_type,timezone,schedule_hour,schedule_minute,one_time_run_at,next_run_at,status",
      )
      .maybeSingle();

    if (error) {
      console.error(`${LOG_PREFIX} Failed to claim job`, {
        jobId,
        error,
      });
      return null;
    }

    if (!data) {
      return null;
    }

    return data as CronJobRow;
  }

  private getJobSuccessState(job: CronJobRow): {
    status: CronJobStatus;
    nextRunAt: string | null;
  } {
    if (job.schedule_type === "daily") {
      const timezone = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
      const nextRunAt = computeNextDailyRunAt(
        timezone,
        clampHour(job.schedule_hour),
        clampMinute(job.schedule_minute),
      );
      return {
        status: "active",
        nextRunAt,
      };
    }

    return {
      status: "completed",
      nextRunAt: null,
    };
  }

  private async failJob(job: CronJobRow, errorMessage: string): Promise<void> {
    const finishedAt = new Date().toISOString();
    const nextState =
      job.schedule_type === "daily"
        ? {
            status: "active" as CronJobStatus,
            nextRunAt: computeNextDailyRunAt(
              isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE,
              clampHour(job.schedule_hour),
              clampMinute(job.schedule_minute),
            ),
          }
        : {
            status: "failed" as CronJobStatus,
            nextRunAt: null,
          };

    const { error } = await this.client
      .from(CRON_JOBS_TABLE)
      .update({
        status: nextState.status,
        next_run_at: nextState.nextRunAt,
        last_run_at: finishedAt,
        last_run_status: "failed",
        last_error: errorMessage,
      })
      .eq("id", job.id);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to persist job failure`, {
        jobId: job.id,
        error,
      });
    } else {
      console.warn(`${LOG_PREFIX} Job failed`, {
        jobId: job.id,
        errorMessage,
        nextRunAt: nextState.nextRunAt,
      });
    }
  }

  private async logCronEvent(input: {
    cronJobId?: string;
    cronRunId?: string;
    eventType: string;
    actor?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const payload = {
      cron_job_id: input.cronJobId || null,
      cron_run_id: input.cronRunId || null,
      event_type: input.eventType,
      actor: input.actor || "scheduler",
      message: input.message,
      metadata: input.metadata || {},
    };
    const { error } = await this.client.from(CRON_JOB_EVENTS_TABLE).insert(payload);
    if (error) {
      console.error(`${LOG_PREFIX} Failed to insert cron event`, { error, payload });
    }
  }

  private buildCronSuccessMessage(jobTitle: string, summary: string): string {
    const trimmedSummary = (summary || "").trim();
    if (!trimmedSummary) {
      return `Scheduled update: "${jobTitle}" ran successfully.`;
    }
    return `Scheduled update: "${jobTitle}"\n${trimmedSummary}`;
  }

  private async queueCronTextMessage(input: {
    messageText: string;
    triggerEventId?: string;
    triggerEventTitle?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const payload = {
      message_text: input.messageText,
      message_type: "text",
      trigger: "promise",
      trigger_event_id: input.triggerEventId || null,
      trigger_event_title: input.triggerEventTitle || null,
      priority: "normal",
      metadata: {
        source: "cron_scheduler",
        ...(input.metadata || {}),
      },
    };

    const { error } = await this.client.from(PENDING_MESSAGES_TABLE).insert(payload);
    if (error) {
      console.error(`${LOG_PREFIX} Failed to queue cron text message`, {
        error,
        payload,
      });
    }
  }

  private async fulfillPromiseMirrorJob(
    searchQuery: string,
    jobTitle: string,
  ): Promise<string> {
    const promiseId = searchQuery.slice(PROMISE_CRON_QUERY_PREFIX.length).trim();
    if (!promiseId) {
      return `Promise reminder executed for "${jobTitle}", but promise id was missing.`;
    }

    const { data: promiseData, error: promiseError } = await this.client
      .from(PROMISES_TABLE)
      .select("id,promise_type,description,trigger_event,fulfillment_data,status")
      .eq("id", promiseId)
      .maybeSingle();

    if (promiseError) {
      throw new Error(`Failed to load promise ${promiseId}: ${promiseError.message}`);
    }

    if (!promiseData) {
      return `Promise reminder executed, but promise ${promiseId} was not found.`;
    }

    const promise = promiseData as PromiseRow;
    if (promise.status !== "pending") {
      return `Promise reminder executed. Promise ${promise.id} already ${promise.status}.`;
    }

    const fulfillmentData =
      promise.fulfillment_data && typeof promise.fulfillment_data === "object"
        ? promise.fulfillment_data
        : {};
    const selfieParams =
      fulfillmentData.selfieParams && typeof fulfillmentData.selfieParams === "object"
        ? (fulfillmentData.selfieParams as Record<string, unknown>)
        : {};

    const defaultMessage =
      promise.promise_type === "send_selfie"
        ? "Okay heading out now! Here's your selfie."
        : `Following up on: ${promise.description}`;
    const messageText =
      typeof fulfillmentData.messageText === "string" && fulfillmentData.messageText.trim().length > 0
        ? fulfillmentData.messageText.trim()
        : defaultMessage;

    const messageType = promise.promise_type === "send_selfie" ? "photo" : "text";
    const metadata: Record<string, unknown> = {
      promiseId: promise.id,
      promiseType: promise.promise_type,
      triggerEvent: promise.trigger_event,
    };

    if (messageType === "photo") {
      metadata.selfieParams = {
        scene:
          typeof selfieParams.scene === "string" && selfieParams.scene.trim().length > 0
            ? selfieParams.scene
            : "casual outdoor selfie",
        mood:
          typeof selfieParams.mood === "string" && selfieParams.mood.trim().length > 0
            ? selfieParams.mood
            : "happy smile",
        location:
          typeof selfieParams.location === "string" ? selfieParams.location : undefined,
      };
    }

    const { error: queueError } = await this.client.from(PENDING_MESSAGES_TABLE).insert({
      message_text: messageText,
      message_type: messageType,
      trigger: "promise",
      trigger_event_id: promise.id,
      trigger_event_title: promise.description,
      priority: "normal",
      metadata: {
        source: "cron_scheduler",
        ...metadata,
      },
    });

    if (queueError) {
      throw new Error(`Failed to queue promise pending message: ${queueError.message}`);
    }

    const { error: fulfillError } = await this.client
      .from(PROMISES_TABLE)
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
      })
      .eq("id", promise.id)
      .eq("status", "pending");

    if (fulfillError) {
      throw new Error(`Failed to mark promise fulfilled: ${fulfillError.message}`);
    }

    await this.logCronEvent({
      eventType: "promise_fulfilled",
      actor: this.schedulerId,
      message: `Promise ${promise.id} queued for delivery (${promise.promise_type}).`,
      metadata: {
        promiseId: promise.id,
        promiseType: promise.promise_type,
      },
    });

    return `Promise reminder executed for ${promise.promise_type}. Queued pending delivery.`;
  }
}

export function startCronScheduler(
  options: StartCronSchedulerOptions,
): StartedCronScheduler {
  const scheduler = new CronScheduler(options);
  scheduler.start();
  return {
    stop: () => scheduler.stop(),
  };
}
