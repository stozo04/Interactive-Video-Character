import { supabase } from "./supabaseClient";

const LOG_PREFIX = "[CronJobService]";
const CRON_JOBS_TABLE = "cron_jobs";
const CRON_JOB_RUNS_TABLE = "cron_job_runs";
const CRON_JOB_EVENTS_TABLE = "cron_job_events";
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_DAILY_HOUR = 12;
const DEFAULT_DAILY_MINUTE = 0;

export enum CronScheduleType {
  Daily = "daily",
  OneTime = "one_time",
  Monthly = "monthly",
  Weekly = "weekly",
}

export enum CronJobStatus {
  Active = "active",
  Paused = "paused",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export enum CronJobRunStatus {
  Running = "running",
  Success = "success",
  Failed = "failed",
}

export enum CronJobEventType {
  Created = "created",
  Updated = "updated",
  Deleted = "deleted",
  Paused = "paused",
  Resumed = "resumed",
  RunTriggered = "run_triggered",
  RunSuccess = "run_success",
  RunFailed = "run_failed",
  DigestDelivered = "digest_delivered",
  FailureAlertDelivered = "failure_alert_delivered",
}

interface CronJobRow {
  id: string;
  title: string;
  search_query: string;
  summary_instruction: string;
  action_type?: string;
  instruction?: string;
  payload?: Record<string, unknown> | null;
  schedule_type: CronScheduleType;
  timezone: string;
  schedule_hour: number | null;
  schedule_minute: number | null;
  one_time_run_at: string | null;
  next_run_at: string | null;
  status: CronJobStatus;
  created_by: string;
  last_run_at: string | null;
  last_run_status: "success" | "failed" | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface CronJobRunRow {
  id: string;
  cron_job_id: string;
  scheduled_for: string;
  started_at: string;
  finished_at: string | null;
  status: CronJobRunStatus;
  search_query: string;
  search_results: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
  summary: string | null;
  error: string | null;
  delivered: boolean;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CronJobEventRow {
  id: string;
  cron_job_id: string | null;
  cron_run_id: string | null;
  event_type: string;
  actor: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CronJob {
  id: string;
  title: string;
  searchQuery: string;
  summaryInstruction: string;
  actionType: string;
  instruction: string;
  payload: Record<string, unknown>;
  scheduleType: CronScheduleType;
  timezone: string;
  scheduleHour: number | null;
  scheduleMinute: number | null;
  oneTimeRunAt: string | null;
  nextRunAt: string | null;
  status: CronJobStatus;
  createdBy: string;
  lastRunAt: string | null;
  lastRunStatus: "success" | "failed" | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobRun {
  id: string;
  cronJobId: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  status: CronJobRunStatus;
  searchQuery: string;
  searchResults: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
  summary: string | null;
  error: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobEvent {
  id: string;
  cronJobId: string | null;
  cronRunId: string | null;
  eventType: string;
  actor: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateCronJobInput {
  title: string;
  searchQuery: string;
  summaryInstruction?: string;
  actionType?: string;
  instruction?: string;
  payload?: Record<string, unknown>;
  scheduleType: CronScheduleType;
  timezone?: string;
  hour?: number;
  minute?: number;
  oneTimeAt?: string;
  createdBy?: string;
}

export interface UpdateCronJobInput {
  title?: string;
  searchQuery?: string;
  summaryInstruction?: string;
  actionType?: string;
  instruction?: string;
  payload?: Record<string, unknown>;
  scheduleType?: CronScheduleType;
  timezone?: string;
  hour?: number;
  minute?: number;
  oneTimeAt?: string;
  status?: CronJobStatus;
}

export interface PendingScheduledDigest {
  runId: string;
  cronJobId: string;
  title: string;
  scheduledFor: string;
  summary: string;
}

export interface PendingCronFailureAlert {
  runId: string;
  cronJobId: string;
  title: string;
  scheduledFor: string;
  error: string;
}

function mapCronJobRow(row: CronJobRow): CronJob {
  return {
    id: row.id,
    title: row.title,
    searchQuery: row.search_query,
    summaryInstruction: row.summary_instruction || "",
    actionType: row.action_type || "web_search",
    instruction: row.instruction || "",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    scheduleType: row.schedule_type,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    scheduleHour: row.schedule_hour,
    scheduleMinute: row.schedule_minute,
    oneTimeRunAt: row.one_time_run_at,
    nextRunAt: row.next_run_at,
    status: row.status,
    createdBy: row.created_by,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCronJobRunRow(row: CronJobRunRow): CronJobRun {
  return {
    id: row.id,
    cronJobId: row.cron_job_id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    searchQuery: row.search_query,
    searchResults: Array.isArray(row.search_results) ? row.search_results : [],
    summary: row.summary,
    error: row.error,
    delivered: Boolean(row.delivered),
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCronJobEventRow(row: CronJobEventRow): CronJobEvent {
  return {
    id: row.id,
    cronJobId: row.cron_job_id,
    cronRunId: row.cron_run_id,
    eventType: row.event_type,
    actor: row.actor,
    message: row.message,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: row.created_at,
  };
}

async function logCronJobEvent(input: {
  cronJobId?: string | null;
  cronRunId?: string | null;
  eventType: CronJobEventType;
  actor?: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const payload = {
    cron_job_id: input.cronJobId || null,
    cron_run_id: input.cronRunId || null,
    event_type: input.eventType,
    actor: input.actor || "system",
    message: input.message,
    metadata: input.metadata || {},
  };

  const { error } = await supabase.from(CRON_JOB_EVENTS_TABLE).insert(payload);
  if (error) {
    console.error(`${LOG_PREFIX} Failed to insert cron job event`, {
      error,
      payload,
    });
  }
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function clampHour(hour: number | undefined): number {
  if (!Number.isFinite(hour)) return DEFAULT_DAILY_HOUR;
  return Math.min(23, Math.max(0, Math.floor(hour!)));
}

function clampMinute(minute: number | undefined): number {
  if (!Number.isFinite(minute)) return DEFAULT_DAILY_MINUTE;
  return Math.min(59, Math.max(0, Math.floor(minute!)));
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
  const getPart = (type: string) =>
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

function addOneMonth(year: number, month: number): { year: number; month: number } {
  if (month >= 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 0, 0, 0, 0)).getUTCDate();
}

export function computeNextDailyRunAt(
  timezone: string,
  hour: number,
  minute: number,
  fromDate: Date = new Date(),
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const localNow = getTimeZoneDateParts(fromDate, tz);

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

export function computeNextMonthlyRunAt(
  timezone: string,
  anchorDay: number,
  hour: number,
  minute: number,
  fromDate: Date = new Date(),
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const localNow = getTimeZoneDateParts(fromDate, tz);
  const daysThisMonth = getDaysInMonth(localNow.year, localNow.month);
  const targetDay = Math.min(Math.max(1, Math.floor(anchorDay)), daysThisMonth);

  let candidate = zonedLocalTimeToUtc(
    tz,
    localNow.year,
    localNow.month,
    targetDay,
    h,
    m,
  );

  if (candidate.getTime() <= fromDate.getTime()) {
    const next = addOneMonth(localNow.year, localNow.month);
    const nextMonthDays = getDaysInMonth(next.year, next.month);
    const nextDay = Math.min(Math.max(1, Math.floor(anchorDay)), nextMonthDays);
    candidate = zonedLocalTimeToUtc(
      tz,
      next.year,
      next.month,
      nextDay,
      h,
      m,
    );
  }

  return candidate.toISOString();
}

export function computeNextWeeklyRunAt(
  timezone: string,
  anchorIso: string,
  hour: number,
  minute: number,
  fromDate: Date = new Date(),
): string {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const anchorDate = new Date(anchorIso);
  if (Number.isNaN(anchorDate.getTime())) {
    throw new Error("Invalid one_time_at value.");
  }

  const anchorParts = getTimeZoneDateParts(anchorDate, tz);
  const localNow = getTimeZoneDateParts(fromDate, tz);
  const anchorWeekday = new Date(Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day, 0, 0, 0, 0)).getUTCDay();
  const currentWeekday = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day, 0, 0, 0, 0)).getUTCDay();
  const daysUntil = (anchorWeekday - currentWeekday + 7) % 7;
  const candidateDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day + daysUntil, 0, 0, 0, 0));
  let candidate = zonedLocalTimeToUtc(
    tz,
    candidateDate.getUTCFullYear(),
    candidateDate.getUTCMonth() + 1,
    candidateDate.getUTCDate(),
    h,
    m,
  );

  if (candidate.getTime() <= fromDate.getTime()) {
    const nextWeek = new Date(candidate.getTime() + 7 * 24 * 60 * 60 * 1000);
    candidate = zonedLocalTimeToUtc(
      tz,
      nextWeek.getUTCFullYear(),
      nextWeek.getUTCMonth() + 1,
      nextWeek.getUTCDate(),
      h,
      m,
    );
  }

  return candidate.toISOString();
}

function resolveOneTimeRunAt(
  timezone: string,
  hour: number | undefined,
  minute: number | undefined,
  oneTimeAt: string | undefined,
): string {
  if (oneTimeAt) {
    const parsed = new Date(oneTimeAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid one_time_at value.");
    }
    return parsed.toISOString();
  }

  const targetHour = clampHour(hour);
  const targetMinute = clampMinute(minute);
  return computeNextDailyRunAt(timezone, targetHour, targetMinute, new Date());
}

function resolveMonthlyAnchor(input: {
  timezone: string;
  hour?: number;
  minute?: number;
  oneTimeAt?: string;
}): { anchorIso: string; anchorDay: number; anchorHour: number; anchorMinute: number } {
  if (!input.oneTimeAt) {
    throw new Error("Missing one_time_at for monthly schedule.");
  }
  const parsed = new Date(input.oneTimeAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid one_time_at value.");
  }
  const parts = getTimeZoneDateParts(parsed, input.timezone);
  const anchorHour =
    input.hour === undefined ? clampHour(parts.hour) : clampHour(input.hour);
  const anchorMinute =
    input.minute === undefined ? clampMinute(parts.minute) : clampMinute(input.minute);
  return {
    anchorIso: parsed.toISOString(),
    anchorDay: parts.day,
    anchorHour,
    anchorMinute,
  };
}

function resolveWeeklyAnchor(input: {
  timezone: string;
  hour?: number;
  minute?: number;
  oneTimeAt?: string;
}): { anchorIso: string; anchorHour: number; anchorMinute: number } {
  if (!input.oneTimeAt) {
    throw new Error("Missing one_time_at for weekly schedule.");
  }
  const parsed = new Date(input.oneTimeAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid one_time_at value.");
  }
  const parts = getTimeZoneDateParts(parsed, input.timezone);
  const anchorHour =
    input.hour === undefined ? clampHour(parts.hour) : clampHour(input.hour);
  const anchorMinute =
    input.minute === undefined ? clampMinute(parts.minute) : clampMinute(input.minute);
  return {
    anchorIso: parsed.toISOString(),
    anchorHour,
    anchorMinute,
  };
}
export async function listCronJobs(): Promise<CronJob[]> {
  const { data, error } = await supabase
    .from(CRON_JOBS_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`${LOG_PREFIX} Failed to list cron jobs`, { error });
    return [];
  }

  return ((data as CronJobRow[]) || []).map(mapCronJobRow);
}

export async function listCronJobRuns(limit = 50): Promise<CronJobRun[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
  const { data, error } = await supabase
    .from(CRON_JOB_RUNS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to list cron job runs`, { error });
    return [];
  }

  return ((data as CronJobRunRow[]) || []).map(mapCronJobRunRow);
}

export async function listCronJobEvents(limit = 120): Promise<CronJobEvent[]> {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(500, Math.floor(limit)))
    : 120;

  const { data, error } = await supabase
    .from(CRON_JOB_EVENTS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to list cron job events`, { error });
    return [];
  }

  return ((data as CronJobEventRow[]) || []).map(mapCronJobEventRow);
}

export async function createCronJob(input: CreateCronJobInput): Promise<CronJob | null> {
  try {
    const timezone = isValidTimeZone(input.timezone || "") ? input.timezone! : DEFAULT_TIMEZONE;
    const scheduleType = input.scheduleType;
    const hour = clampHour(input.hour);
    const minute = clampMinute(input.minute);
    const actionType = input.actionType?.trim() || "web_search";
    const instruction = (input.instruction ?? input.summaryInstruction ?? "").trim();
    const actionPayload = input.payload && typeof input.payload === "object"
      ? input.payload
      : actionType === "web_search"
        ? { query: input.searchQuery }
        : {};

    let oneTimeRunAt: string | null = null;
    let nextRunAt: string | null = null;
    let scheduleHour: number | null = null;
    let scheduleMinute: number | null = null;

    if (scheduleType === CronScheduleType.Daily) {
      scheduleHour = hour;
      scheduleMinute = minute;
      nextRunAt = computeNextDailyRunAt(timezone, hour, minute);
    } else if (scheduleType === CronScheduleType.OneTime) {
      oneTimeRunAt = resolveOneTimeRunAt(timezone, input.hour, input.minute, input.oneTimeAt);
      nextRunAt = oneTimeRunAt;
    } else if (scheduleType === CronScheduleType.Monthly) {
      const anchor = resolveMonthlyAnchor({
        timezone,
        hour: input.hour,
        minute: input.minute,
        oneTimeAt: input.oneTimeAt,
      });
      oneTimeRunAt = anchor.anchorIso;
      scheduleHour = anchor.anchorHour;
      scheduleMinute = anchor.anchorMinute;
      nextRunAt = computeNextMonthlyRunAt(
        timezone,
        anchor.anchorDay,
        anchor.anchorHour,
        anchor.anchorMinute,
      );
    } else {
      const anchor = resolveWeeklyAnchor({
        timezone,
        hour: input.hour,
        minute: input.minute,
        oneTimeAt: input.oneTimeAt,
      });
      oneTimeRunAt = anchor.anchorIso;
      scheduleHour = anchor.anchorHour;
      scheduleMinute = anchor.anchorMinute;
      nextRunAt = computeNextWeeklyRunAt(
        timezone,
        anchor.anchorIso,
        anchor.anchorHour,
        anchor.anchorMinute,
      );
    }

    const payload = {
      title: input.title.trim(),
      search_query: input.searchQuery.trim(),
      summary_instruction: (input.summaryInstruction || "").trim(),
      action_type: actionType,
      instruction,
      payload: actionPayload,
      schedule_type: scheduleType,
      timezone,
      schedule_hour: scheduleHour,
      schedule_minute: scheduleMinute,
      one_time_run_at: oneTimeRunAt,
      next_run_at: nextRunAt,
      status: CronJobStatus.Active,
      created_by: input.createdBy || "user",
    };

    const { data, error } = await supabase
      .from(CRON_JOBS_TABLE)
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error(`${LOG_PREFIX} Failed to create cron job`, { error, payload });
      return null;
    }

    const created = mapCronJobRow(data as CronJobRow);
    await logCronJobEvent({
      cronJobId: created.id,
      eventType: CronJobEventType.Created,
      actor: input.createdBy || "user",
      message: `Created cron job "${created.title}" (${created.scheduleType}).`,
      metadata: {
        searchQuery: created.searchQuery,
        actionType: created.actionType,
        scheduleType: created.scheduleType,
        timezone: created.timezone,
        nextRunAt: created.nextRunAt,
      },
    });

    return created;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to create cron job`, { error });
    return null;
  }
}

export async function updateCronJob(
  id: string,
  updates: UpdateCronJobInput,
): Promise<CronJob | null> {
  try {
    const { data: existingData, error: existingError } = await supabase
      .from(CRON_JOBS_TABLE)
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existingData) {
      console.error(`${LOG_PREFIX} Failed to load cron job for update`, {
        id,
        existingError,
      });
      return null;
    }

    const existing = mapCronJobRow(existingData as CronJobRow);
    const scheduleType = updates.scheduleType || existing.scheduleType;
    const timezone = isValidTimeZone(updates.timezone || "")
      ? updates.timezone!
      : existing.timezone || DEFAULT_TIMEZONE;
    const actionType = updates.actionType?.trim() || existing.actionType;
    const instruction = updates.instruction !== undefined
      ? updates.instruction.trim()
      : existing.instruction;
    const payload = updates.payload !== undefined && updates.payload !== null
      ? updates.payload
      : existing.payload;

    const hour = clampHour(
      updates.hour ?? existing.scheduleHour ?? DEFAULT_DAILY_HOUR,
    );
    const minute = clampMinute(
      updates.minute ?? existing.scheduleMinute ?? DEFAULT_DAILY_MINUTE,
    );

    let oneTimeRunAt = existing.oneTimeRunAt;
    let nextRunAt = existing.nextRunAt;
    let scheduleHour = existing.scheduleHour;
    let scheduleMinute = existing.scheduleMinute;

    const scheduleChanged =
      updates.scheduleType !== undefined ||
      updates.hour !== undefined ||
      updates.minute !== undefined ||
      updates.oneTimeAt !== undefined ||
      updates.timezone !== undefined;

    if (scheduleType === CronScheduleType.Daily) {
      scheduleHour = hour;
      scheduleMinute = minute;
      oneTimeRunAt = null;

      if (scheduleChanged || !nextRunAt) {
        nextRunAt = computeNextDailyRunAt(timezone, hour, minute);
      }
    } else if (scheduleType === CronScheduleType.OneTime) {
      scheduleHour = null;
      scheduleMinute = null;
      oneTimeRunAt = resolveOneTimeRunAt(
        timezone,
        updates.hour,
        updates.minute,
        updates.oneTimeAt,
      );

      if (scheduleChanged || !nextRunAt) {
        nextRunAt = oneTimeRunAt;
      }
    } else if (scheduleType === CronScheduleType.Monthly) {
      const anchor = resolveMonthlyAnchor({
        timezone,
        hour: updates.hour,
        minute: updates.minute,
        oneTimeAt: updates.oneTimeAt ?? existing.oneTimeRunAt ?? undefined,
      });
      oneTimeRunAt = anchor.anchorIso;
      scheduleHour = anchor.anchorHour;
      scheduleMinute = anchor.anchorMinute;
      if (scheduleChanged || !nextRunAt) {
        nextRunAt = computeNextMonthlyRunAt(
          timezone,
          anchor.anchorDay,
          anchor.anchorHour,
          anchor.anchorMinute,
        );
      }
    } else {
      const anchor = resolveWeeklyAnchor({
        timezone,
        hour: updates.hour,
        minute: updates.minute,
        oneTimeAt: updates.oneTimeAt ?? existing.oneTimeRunAt ?? undefined,
      });
      oneTimeRunAt = anchor.anchorIso;
      scheduleHour = anchor.anchorHour;
      scheduleMinute = anchor.anchorMinute;
      if (scheduleChanged || !nextRunAt) {
        nextRunAt = computeNextWeeklyRunAt(
          timezone,
          anchor.anchorIso,
          anchor.anchorHour,
          anchor.anchorMinute,
        );
      }
    }

    const updatePayload: Partial<CronJobRow> = {
      title: updates.title?.trim() ?? existing.title,
      search_query: updates.searchQuery?.trim() ?? existing.searchQuery,
      summary_instruction:
        updates.summaryInstruction?.trim() ?? existing.summaryInstruction,
      action_type: actionType,
      instruction,
      payload,
      schedule_type: scheduleType,
      timezone,
      schedule_hour: scheduleHour,
      schedule_minute: scheduleMinute,
      one_time_run_at: oneTimeRunAt,
      next_run_at: nextRunAt,
      status: updates.status ?? existing.status,
    };

    const { data, error } = await supabase
      .from(CRON_JOBS_TABLE)
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      console.error(`${LOG_PREFIX} Failed to update cron job`, {
        id,
        error,
        updatePayload,
      });
      return null;
    }

    const updated = mapCronJobRow(data as CronJobRow);
    await logCronJobEvent({
      cronJobId: updated.id,
      eventType: CronJobEventType.Updated,
      actor: "user",
      message: `Updated cron job "${updated.title}".`,
      metadata: {
        scheduleType: updated.scheduleType,
        timezone: updated.timezone,
        nextRunAt: updated.nextRunAt,
      },
    });

    return updated;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to update cron job`, { id, error });
    return null;
  }
}

export async function deleteCronJob(id: string): Promise<boolean> {
  const { data: existingData } = await supabase
    .from(CRON_JOBS_TABLE)
    .select("id,title")
    .eq("id", id)
    .maybeSingle();

  const existingTitle =
    existingData && typeof (existingData as any).title === "string"
      ? (existingData as any).title
      : id;

  const { error } = await supabase.from(CRON_JOBS_TABLE).delete().eq("id", id);
  if (error) {
    console.error(`${LOG_PREFIX} Failed to delete cron job`, { id, error });
    return false;
  }
  await logCronJobEvent({
    cronJobId: null,
    eventType: CronJobEventType.Deleted,
    actor: "user",
    message: `Deleted cron job "${existingTitle}".`,
    metadata: {
      deletedCronJobId: id,
      title: existingTitle,
    },
  });
  return true;
}

export async function setCronJobStatus(
  id: string,
  status: CronJobStatus,
): Promise<CronJob | null> {
  const { data, error } = await supabase
    .from(CRON_JOBS_TABLE)
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error(`${LOG_PREFIX} Failed to set cron job status`, {
      id,
      status,
      error,
    });
    return null;
  }

  const updated = mapCronJobRow(data as CronJobRow);
  const eventType =
    status === CronJobStatus.Paused
      ? CronJobEventType.Paused
      : CronJobEventType.Resumed;
  await logCronJobEvent({
    cronJobId: updated.id,
    eventType,
    actor: "user",
    message: `${status === CronJobStatus.Paused ? "Paused" : "Resumed"} cron job "${updated.title}".`,
    metadata: {
      status: updated.status,
      nextRunAt: updated.nextRunAt,
    },
  });

  return updated;
}

export async function runCronJobNow(id: string): Promise<CronJob | null> {
  const nowIso = new Date().toISOString();
  const { data: existingData, error: existingError } = await supabase
    .from(CRON_JOBS_TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (existingError || !existingData) {
    console.error(`${LOG_PREFIX} Failed to load cron job for run-now`, {
      id,
      existingError,
    });
    return null;
  }

  const existing = mapCronJobRow(existingData as CronJobRow);
  const updatePayload: Partial<CronJobRow> = {
    next_run_at: nowIso,
    status: CronJobStatus.Active,
    last_error: null,
  };

  if (existing.scheduleType === CronScheduleType.OneTime) {
    updatePayload.one_time_run_at = nowIso;
  }

  const { data, error } = await supabase
    .from(CRON_JOBS_TABLE)
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error(`${LOG_PREFIX} Failed to run cron job now`, {
      id,
      error,
      updatePayload,
    });
    return null;
  }

  const updated = mapCronJobRow(data as CronJobRow);
  await logCronJobEvent({
    cronJobId: updated.id,
    eventType: CronJobEventType.RunTriggered,
    actor: "user",
    message: `Triggered cron job "${updated.title}" to run now.`,
    metadata: {
      nextRunAt: updated.nextRunAt,
      scheduleType: updated.scheduleType,
    },
  });

  return updated;
}

export async function listPendingScheduledDigests(
  limit = 3,
): Promise<PendingScheduledDigest[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 3;
  const { data, error } = await supabase
    .from(CRON_JOB_RUNS_TABLE)
    .select("id, cron_job_id, scheduled_for, summary, status, delivered, cron_jobs!inner(title)")
    .eq("status", CronJobRunStatus.Success)
    .eq("delivered", false)
    .not("summary", "is", null)
    .order("scheduled_for", { ascending: true })
    .limit(normalizedLimit);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to list pending scheduled digests`, {
      error,
    });
    return [];
  }

  const mapped = (data || []).map((row: any) => ({
    runId: row.id,
    cronJobId: row.cron_job_id,
    title: row.cron_jobs?.title || "Scheduled update",
    scheduledFor: row.scheduled_for,
    summary: typeof row.summary === "string" ? row.summary : "",
  }));

  // Internal mirror jobs exist for promise timing migration and should not
  // appear in news/scheduled-digest context.
  return mapped.filter((digest) => !digest.title.toLowerCase().startsWith("promise reminder:"));
}

export async function listPendingFailedCronAlerts(
  limit = 3,
): Promise<PendingCronFailureAlert[]> {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(10, Math.floor(limit)))
    : 3;
  const { data, error } = await supabase
    .from(CRON_JOB_RUNS_TABLE)
    .select("id, cron_job_id, scheduled_for, error, status, delivered, cron_jobs!inner(title)")
    .eq("status", CronJobRunStatus.Failed)
    .eq("delivered", false)
    .not("error", "is", null)
    .order("scheduled_for", { ascending: true })
    .limit(normalizedLimit);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to list pending cron failures`, {
      error,
    });
    return [];
  }

  const mapped = (data || []).map((row: any) => ({
    runId: row.id,
    cronJobId: row.cron_job_id,
    title: row.cron_jobs?.title || "Scheduled update",
    scheduledFor: row.scheduled_for,
    error: typeof row.error === "string" ? row.error : "Unknown error",
  }));

  return mapped.filter((entry) => !entry.title.toLowerCase().startsWith("promise reminder:"));
}

export async function markScheduledDigestDelivered(runId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(CRON_JOB_RUNS_TABLE)
    .update({
      delivered: true,
      delivered_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .select("status")
    .single();

  if (error) {
    console.error(`${LOG_PREFIX} Failed to mark digest delivered`, {
      runId,
      error,
    });
    return false;
  }

  const runStatus =
    data && typeof (data as any).status === "string"
      ? String((data as any).status)
      : "";

  await logCronJobEvent({
    cronRunId: runId,
    eventType:
      runStatus === CronJobRunStatus.Failed
        ? CronJobEventType.FailureAlertDelivered
        : CronJobEventType.DigestDelivered,
    actor: "kayley_tool",
    message:
      runStatus === CronJobRunStatus.Failed
        ? `Marked cron failure alert ${runId} as delivered.`
        : `Marked cron digest ${runId} as delivered.`,
  });

  return true;
}

function formatJobSchedule(job: CronJob): string {
  if (job.scheduleType === CronScheduleType.Daily) {
    const hour = job.scheduleHour ?? DEFAULT_DAILY_HOUR;
    const minute = job.scheduleMinute ?? DEFAULT_DAILY_MINUTE;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    return `daily ${hh}:${mm} (${job.timezone})`;
  }
  if (job.scheduleType === CronScheduleType.Monthly) {
    const hour = job.scheduleHour ?? DEFAULT_DAILY_HOUR;
    const minute = job.scheduleMinute ?? DEFAULT_DAILY_MINUTE;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const anchor = job.oneTimeRunAt || "unspecified";
    const tz = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
    const anchorDay = job.oneTimeRunAt
      ? getTimeZoneDateParts(new Date(job.oneTimeRunAt), tz).day
      : "unspecified";
    return `monthly on day ${anchorDay} at ${hh}:${mm} (${tz}, anchor ${anchor})`;
  }
  if (job.scheduleType === CronScheduleType.Weekly) {
    const hour = job.scheduleHour ?? DEFAULT_DAILY_HOUR;
    const minute = job.scheduleMinute ?? DEFAULT_DAILY_MINUTE;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const tz = isValidTimeZone(job.timezone) ? job.timezone : DEFAULT_TIMEZONE;
    const anchor = job.oneTimeRunAt || "unspecified";
    const anchorDate = job.oneTimeRunAt ? new Date(job.oneTimeRunAt) : null;
    const anchorLabel = anchorDate ? anchorDate.toLocaleDateString("en-US", { weekday: "long", timeZone: tz }) : "unspecified";
    return `weekly on ${anchorLabel} at ${hh}:${mm} (${tz}, anchor ${anchor})`;
  }

  return `one-time ${job.oneTimeRunAt || "unspecified"}`;
}

export function formatCronJobsForTool(jobs: CronJob[]): string {
  if (!jobs.length) {
    return "No cron jobs found.";
  }

  const lines = jobs.map((job) => {
    const nextRun = job.nextRunAt || "none";
    return `- [${job.id}] ${job.title} | ${job.status} | ${formatJobSchedule(job)} | next_run=${nextRun}`;
  });

  return `Cron jobs:\n${lines.join("\n")}`;
}
