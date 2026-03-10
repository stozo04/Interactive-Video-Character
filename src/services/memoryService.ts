// src/services/memoryService.ts
/**
 * Memory Service
 * 
 * Provides AI with the ability to search and recall past conversations
 * and user facts on-demand, enabling fresh chat sessions while maintaining
 * context awareness through tool-based memory retrieval.
 */

import { supabase } from './supabaseClient';
import { clientLogger } from './clientLogger';
import {
  createEmailSendDraftPreview,
  validateConfirmedEmailSend,
} from './emailSendConfirmation';

// ============================================
// Types
// ============================================

export interface MemorySearchResult {
  id: string;
  text: string;
  role: 'user' | 'model';
  timestamp: string;
  relevanceScore?: number;
}

export interface UserFact {
  id: string;
  category: 'identity' | 'preference' | 'relationship' | 'context';
  fact_key: string;
  fact_value: string;
  pinned: boolean;
  source_message_id?: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type FactCategory = 'identity' | 'preference' | 'relationship' | 'context' | 'all';

// ============================================
// Constants
// ============================================

const CONVERSATION_HISTORY_TABLE = 'conversation_history';
const USER_FACTS_TABLE = 'user_facts';
const KAYLEY_DAILY_NOTES_TABLE = 'kayley_daily_notes';
const KAYLEY_MONTHLY_NOTES_TABLE = 'kayley_monthly_notes';
const KAYLEY_LESSONS_LEARNED_TABLE = 'kayley_lessons_learned';
const MILA_MILESTONE_NOTES_TABLE = 'mila_milestone_notes';
const KAYLEY_EMAIL_ACTIONS_TABLE = 'kayley_email_actions';

const lessonsLogger = clientLogger.scoped('LessonsLearned');
const workspaceLogger = clientLogger.scoped('WorkspaceAction');
const calendarToolLogger = clientLogger.scoped('CalendarTool');
const memoryToolLog = clientLogger.scoped('MemoryTool');
const memoryServiceLogger = clientLogger.scoped('MemoryService');
const TOOL_FAILURE_PREFIX = 'TOOL_FAILED:';

function normalizeLogDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  if (details instanceof Error) {
    return { error: details.message };
  }
  if (details && typeof details === 'object') {
    return details as Record<string, unknown>;
  }
  return { value: String(details) };
}

function logInfo(message: string, details?: unknown): void {
  memoryServiceLogger.info(message, normalizeLogDetails(details));
}

function logWarn(message: string, details?: unknown): void {
  memoryServiceLogger.warning(message, normalizeLogDetails(details));
}

function logError(message: string, details?: unknown): void {
  memoryServiceLogger.error(message, normalizeLogDetails(details));
}

// Default limits to prevent context overflow
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_RECENT_CONTEXT_COUNT = 6; // Last 3 exchanges (user + model)
const CST_TIMEZONE = 'America/Chicago';
const CALENDAR_DEFAULT_TIMEZONE = 'America/Chicago';
const LOCAL_ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_CUE_RE =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

// ============================================
// Utility Functions
// ============================================

/**
 * Sanitizes text to ensure it's safe for Gemini Interactions API.
 * Removes complex emojis (especially those with skin tone modifiers)
 * that cause UTF-8 encoding issues.
 */
function sanitizeForGemini(text: string): string {
  // Remove emojis with skin tone modifiers (they cause UTF-8 issues)
  // Skin tone modifiers are in the range U+1F3FB to U+1F3FF
  let sanitized = text.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');

  // Optionally, you can also remove all emojis entirely:
  // sanitized = sanitized.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');

  // Ensure the result is valid UTF-8 by removing any remaining problematic characters
  sanitized = sanitized.replace(/[\uD800-\uDFFF]/g, '');

  return sanitized;
}

/**
 * Get today's date string in CST (YYYY-MM-DD)
 */
function getTodayCstDateString(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    logWarn('⚠️ [Daily Notes] Failed to parse CST date parts, falling back to UTC date');
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

/**
 * Get the current month key in CST (YYYY-MM).
 */
function getCurrentCstMonthKey(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  if (!year || !month) {
    logWarn('⚠️ [Monthly Notes] Failed to parse CST month parts, falling back to UTC month');
    return new Date().toISOString().slice(0, 7);
  }

  return `${year}-${month}`;
}

function normalizeDailyNoteInput(note: string): string {
  return note.replace(/^\s*-\s*/, '').trim();
}

function normalizeMonthlyNoteInput(note: string): string {
  return note.replace(/^\s*-\s*/, '').trim();
}

function normalizeLessonsLearnedInput(lesson: string): string {
  return lesson.replace(/^\s*-\s*/, '').trim();
}

/**
 * Get today's date string in UTC (YYYY-MM-DD)
 */
function getTodayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalIsoDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): string {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
}

function normalizeCalendarTimeZone(timeZone?: string): string {
  // Product requirement: calendar times are always interpreted in CST.
  // Ignore caller-provided timezone values for deterministic behavior.
  return CALENDAR_DEFAULT_TIMEZONE;
}

function formatDateAsLocalIsoInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const second = Number(parts.find((p) => p.type === 'second')?.value);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second)
  ) {
    return date.toISOString().slice(0, 19);
  }

  return formatLocalIsoDateTime(year, month, day, hour, minute, second);
}

function normalizeExplicitCalendarDateTimeInput(raw: string, timeZone: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const localIsoMatch = trimmed.match(LOCAL_ISO_DATETIME_RE);
  if (localIsoMatch) {
    const year = Number(localIsoMatch[1]);
    const month = Number(localIsoMatch[2]);
    const day = Number(localIsoMatch[3]);
    const hour = Number(localIsoMatch[4]);
    const minute = Number(localIsoMatch[5]);
    const second = Number(localIsoMatch[6] ?? '0');
    return formatLocalIsoDateTime(year, month, day, hour, minute, second);
  }

  if (DATE_CUE_RE.test(trimmed)) {
    const parsedWithDateCue = new Date(trimmed);
    if (!Number.isNaN(parsedWithDateCue.getTime())) {
      return formatDateAsLocalIsoInTimeZone(parsedWithDateCue, timeZone);
    }
  }

  return null;
}

function addMinutesToLocalIso(localIso: string, minutes: number): string | null {
  const match = localIso.match(LOCAL_ISO_DATETIME_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');

  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const next = new Date(baseUtcMs + minutes * 60 * 1000);
  return formatLocalIsoDateTime(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    next.getUTCHours(),
    next.getUTCMinutes(),
    next.getUTCSeconds(),
  );
}

function normalizeMilaNoteInput(note: string): string {
  return note.replace(/^\s*-\s*/, '').trim();
}

function formatToolFailure(message: string): string {
  return `${TOOL_FAILURE_PREFIX} ${message}`;
}

function extractEmailAddress(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/<([^>]+)>/);
  return (match?.[1] ?? trimmed).trim();
}

const PINNED_IDENTITY_KEYS = new Set(['name', 'nickname', 'pronouns']);
const NICKNAME_ALIASES = new Set([
  'nickname',
  'nick_name',
  'pet_name',
  'petname',
  'cute_name',
  'alias',
  'call_me',
  'term_of_endearment',
  'terms_of_endearment',
]);

const IDENTITY_ALIASES: Record<string, string> = {
  'first_name': 'name',
  'firstname': 'name',
  'given_name': 'name',
  'name': 'name',
  'last_name': 'last_name',
  'lastname': 'last_name',
  'surname': 'last_name',
  'family_name': 'last_name',
  'pronoun': 'pronouns',
  'pronouns': 'pronouns',
};

const WORK_ALIASES: Record<string, string> = {
  'job': 'occupation',
  'job_title': 'occupation',
  'title': 'occupation',
  'occupation': 'occupation',
  'profession': 'occupation',
  'role': 'occupation',
  'work': 'occupation',
  'what_do_i_do': 'occupation',
};

const CONTEXT_ALIASES: Record<string, string> = {
  'doctor': 'doctor_name',
  'doctor_name': 'doctor_name',
  'healthcare_provider': 'doctor_name',
};

function normalizeUserFactKey(category: FactCategory, rawKey: string): string {
  const key = rawKey.trim().toLowerCase();

  if (category === 'identity' || category === 'all') {
    if (key.includes('nickname') || NICKNAME_ALIASES.has(key)) {
      return 'nickname';
    }
    if (IDENTITY_ALIASES[key]) {
      return IDENTITY_ALIASES[key];
    }
  }

  if (WORK_ALIASES[key]) {
    return WORK_ALIASES[key];
  }

  if (category === 'context' || category === 'all') {
    if (CONTEXT_ALIASES[key]) {
      return CONTEXT_ALIASES[key];
    }
    if (key.includes('doctor')) {
      return 'doctor_name';
    }
  }

  return key;
}

function shouldPinUserFact(category: FactCategory, key: string): boolean {
  return category === 'identity' && PINNED_IDENTITY_KEYS.has(key);
}

// ============================================
// Daily Notes Functions
// ============================================

/**
 * Ensure the daily notes row exists for today's CST date.
 */
export const ensureDailyNotesRowForToday = async (): Promise<boolean> => {
  try {
    const cstDate = getTodayCstDateString();
    logInfo(`🗓️ [Daily Notes] Ensuring daily notes row exists for CST date: ${cstDate}`);

    const { error } = await supabase
      .from(KAYLEY_DAILY_NOTES_TABLE)
      .upsert(
        {
          note_date_cst: cstDate,
        },
        {
          onConflict: 'note_date_cst',
        },
      );

    if (error) {
      logError('❌ [Daily Notes] Failed to ensure daily notes row:', error);
      return false;
    }

    logInfo('✅ [Daily Notes] Daily notes row is ready');
    return true;
  } catch (error) {
    logError('❌ [Daily Notes] Error ensuring daily notes row:', error);
    return false;
  }
};

/**
 * Append a note to today's daily notes row.
 */
export const appendDailyNote = async (note: string): Promise<boolean> => {
  const normalizedNote = normalizeDailyNoteInput(note);

  if (!normalizedNote) {
    logWarn('⚠️ [Daily Notes] Skipping empty daily note');
    return false;
  }

  try {
    const cstDate = getTodayCstDateString();
    logInfo(`🗒️ [Daily Notes] Appending note for CST date: ${cstDate}`);
    logInfo(`🗒️ [Daily Notes] Note content: "${normalizedNote}"`);

    const ensured = await ensureDailyNotesRowForToday();
    if (!ensured) {
      logWarn('⚠️ [Daily Notes] Could not ensure daily notes row; aborting append');
      return false;
    }

    const { data, error } = await supabase
      .from(KAYLEY_DAILY_NOTES_TABLE)
      .select('notes')
      .eq('note_date_cst', cstDate)
      .single();

    if (error) {
      logError('❌ [Daily Notes] Failed to fetch existing notes:', error);
      return false;
    }

    const existingNotes = (data?.notes || '').trim();
    const updatedNotes = existingNotes
      ? `${existingNotes}\n- ${normalizedNote}`
      : `- ${normalizedNote}`;

    const { error: updateError } = await supabase
      .from(KAYLEY_DAILY_NOTES_TABLE)
      .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
      .eq('note_date_cst', cstDate);

    if (updateError) {
      logError('❌ [Daily Notes] Failed to append note:', updateError);
      return false;
    }

    logInfo('✅ [Daily Notes] Note appended successfully');
    return true;
  } catch (error) {
    logError('❌ [Daily Notes] Error appending daily note:', error);
    return false;
  }
};

/**
 * Retrieve all daily notes as bullet lines (no dates).
 */
export const getAllDailyNotes = async (): Promise<string[]> => {
  try {
    logInfo('📚 [Daily Notes] Retrieving all daily notes');

    const { data, error } = await supabase
      .from(KAYLEY_DAILY_NOTES_TABLE)
      .select('notes, note_date_cst')
      .order('note_date_cst', { ascending: true });

    if (error) {
      logError('❌ [Daily Notes] Failed to retrieve notes:', error);
      return [];
    }

    const lines = (data || [])
      .flatMap((row) => (row.notes || '').split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => (line.startsWith('-') ? line : `- ${line}`));

    logInfo(`📚 [Daily Notes] Retrieved ${lines.length} note line(s)`);
    return lines;
  } catch (error) {
    logError('❌ [Daily Notes] Error retrieving notes:', error);
    return [];
  }
};

// ============================================
// Monthly Notes Functions
// ============================================

function getCstMonthParts(): { year: number; month: number; key: string } {
  const key = getCurrentCstMonthKey();
  const [yearStr, monthStr] = key.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  return { year, month, key };
}

/**
 * Ensure the monthly notes row exists for the given month key (YYYY-MM).
 */
export const ensureMonthlyNotesRowForMonth = async (
  monthKey: string
): Promise<boolean> => {
  try {
    logInfo(`🗓️ [Monthly Notes] Ensuring monthly notes row exists for: ${monthKey}`);

    const { error } = await supabase
      .from(KAYLEY_MONTHLY_NOTES_TABLE)
      .upsert(
        {
          month_key: monthKey,
        },
        {
          onConflict: 'month_key',
        },
      );

    if (error) {
      logError('❌ [Monthly Notes] Failed to ensure monthly notes row:', error);
      return false;
    }

    logInfo('✅ [Monthly Notes] Monthly notes row is ready');
    return true;
  } catch (error) {
    logError('❌ [Monthly Notes] Error ensuring monthly notes row:', error);
    return false;
  }
};

/**
 * Append a note to the current month's notes (CST).
 */
export const appendMonthlyNote = async (note: string): Promise<boolean> => {
  const normalizedNote = normalizeMonthlyNoteInput(note);

  if (!normalizedNote) {
    logWarn('⚠️ [Monthly Notes] Skipping empty monthly note');
    return false;
  }

  try {
    const monthKey = getCurrentCstMonthKey();
    logInfo(`🗒️ [Monthly Notes] Appending note for month: ${monthKey}`);
    logInfo(`🗒️ [Monthly Notes] Note content: "${normalizedNote}"`);

    const ensured = await ensureMonthlyNotesRowForMonth(monthKey);
    if (!ensured) {
      logWarn('⚠️ [Monthly Notes] Could not ensure monthly notes row; aborting append');
      return false;
    }

    const { data, error } = await supabase
      .from(KAYLEY_MONTHLY_NOTES_TABLE)
      .select('notes')
      .eq('month_key', monthKey)
      .single();

    if (error) {
      logError('❌ [Monthly Notes] Failed to fetch existing notes:', error);
      return false;
    }

    const existingNotes = (data?.notes || '').trim();
    const updatedNotes = existingNotes
      ? `${existingNotes}\n- ${normalizedNote}`
      : `- ${normalizedNote}`;

    const { error: updateError } = await supabase
      .from(KAYLEY_MONTHLY_NOTES_TABLE)
      .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
      .eq('month_key', monthKey);

    if (updateError) {
      logError('❌ [Monthly Notes] Failed to append note:', updateError);
      return false;
    }

    logInfo('✅ [Monthly Notes] Note appended successfully');
    return true;
  } catch (error) {
    logError('❌ [Monthly Notes] Error appending monthly note:', error);
    return false;
  }
};

/**
 * Retrieve monthly notes as bullet lines for a given CST month.
 */
export const getMonthlyNotesForMonth = async (
  year?: number,
  month?: number
): Promise<{ monthKey: string; lines: string[] }> => {
  try {
    const current = getCstMonthParts();
    const safeYear = Number.isFinite(year) ? Math.floor(year as number) : current.year;
    const safeMonth = Number.isFinite(month) ? Math.floor(month as number) : current.month;

    if (!Number.isFinite(safeYear) || safeYear < 1970 || safeYear > 2100) {
      logWarn('⚠️ [Monthly Notes] Invalid year for monthly notes retrieval', { year });
      return { monthKey: current.key, lines: [] };
    }

    if (!Number.isFinite(safeMonth) || safeMonth < 1 || safeMonth > 12) {
      logWarn('⚠️ [Monthly Notes] Invalid month for monthly notes retrieval', { month });
      return { monthKey: current.key, lines: [] };
    }

    const monthKey = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;
    logInfo('📚 [Monthly Notes] Retrieving notes for month', { monthKey });

    const { data, error } = await supabase
      .from(KAYLEY_MONTHLY_NOTES_TABLE)
      .select('notes, month_key')
      .eq('month_key', monthKey)
      .maybeSingle();

    if (error) {
      logError('❌ [Monthly Notes] Failed to retrieve notes:', error);
      return { monthKey, lines: [] };
    }

    const lines = (data?.notes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => (line.startsWith('-') ? line : `- ${line}`));

    logInfo(`📚 [Monthly Notes] Retrieved ${lines.length} note line(s)`, { monthKey });
    return { monthKey, lines };
  } catch (error) {
    logError('❌ [Monthly Notes] Error retrieving notes:', error);
    return { monthKey: getCurrentCstMonthKey(), lines: [] };
  }
};

// ============================================
// Lessons Learned Functions
// ============================================

/**
 * Ensure the lessons learned row exists for today's CST date.
 */
export const ensureLessonsLearnedRowForToday = async (): Promise<boolean> => {
  try {
    const cstDate = getTodayCstDateString();
    lessonsLogger.info('Ensuring lessons learned row exists', { cstDate });

    const { error } = await supabase
      .from(KAYLEY_LESSONS_LEARNED_TABLE)
      .upsert(
        {
          lesson_date_cst: cstDate,
        },
        {
          onConflict: 'lesson_date_cst',
        },
      );

    if (error) {
      lessonsLogger.error('Failed to ensure lessons learned row', { cstDate, error });
      return false;
    }

    lessonsLogger.info('Lessons learned row is ready', { cstDate });
    return true;
  } catch (error) {
    lessonsLogger.error('Error ensuring lessons learned row', { error });
    return false;
  }
};

/**
 * Append a lesson to today's lessons learned row.
 */
export const appendLessonLearned = async (lesson: string): Promise<boolean> => {
  const normalizedLesson = normalizeLessonsLearnedInput(lesson);

  if (!normalizedLesson) {
    lessonsLogger.warning('Skipping empty lessons learned entry');
    return false;
  }

  try {
    const cstDate = getTodayCstDateString();
    lessonsLogger.info('Appending lesson learned', { cstDate, lesson: normalizedLesson });

    const ensured = await ensureLessonsLearnedRowForToday();
    if (!ensured) {
      lessonsLogger.warning('Could not ensure lessons learned row; aborting append', { cstDate });
      return false;
    }

    const { data, error } = await supabase
      .from(KAYLEY_LESSONS_LEARNED_TABLE)
      .select('lessons')
      .eq('lesson_date_cst', cstDate)
      .single();

    if (error) {
      lessonsLogger.error('Failed to fetch existing lessons learned', { cstDate, error });
      return false;
    }

    const existingLessons = (data?.lessons || '').trim();
    const updatedLessons = existingLessons
      ? `${existingLessons}\n- ${normalizedLesson}`
      : `- ${normalizedLesson}`;

    const { error: updateError } = await supabase
      .from(KAYLEY_LESSONS_LEARNED_TABLE)
      .update({ lessons: updatedLessons, updated_at: new Date().toISOString() })
      .eq('lesson_date_cst', cstDate);

    if (updateError) {
      lessonsLogger.error('Failed to append lesson learned', { cstDate, error: updateError });
      return false;
    }

    lessonsLogger.info('Lesson learned appended successfully', { cstDate });
    return true;
  } catch (error) {
    lessonsLogger.error('Error appending lesson learned', { error });
    return false;
  }
};

/**
 * Retrieve all lessons learned as bullet lines (no dates).
 */
export const getAllLessonsLearned = async (): Promise<string[]> => {
  try {
    lessonsLogger.info('Retrieving all lessons learned');

    const { data, error } = await supabase
      .from(KAYLEY_LESSONS_LEARNED_TABLE)
      .select('lessons, lesson_date_cst')
      .order('lesson_date_cst', { ascending: true });

    if (error) {
      lessonsLogger.error('Failed to retrieve lessons learned', { error });
      return [];
    }

    const lines = (data || [])
      .flatMap((row) => (row.lessons || '').split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => (line.startsWith('-') ? line : `- ${line}`));

    lessonsLogger.info('Retrieved lessons learned', { count: lines.length });
    return lines;
  } catch (error) {
    lessonsLogger.error('Error retrieving lessons learned', { error });
    return [];
  }
};

// ============================================
// Mila Milestone Notes Functions
// ============================================

/**
 * Ensure the Mila milestone notes row exists for a UTC date.
 */
export const ensureMilaMilestoneRowForDate = async (
  utcDate: string
): Promise<boolean> => {
  try {
    logInfo(`🗓️ [Mila Notes] Ensuring milestone row exists for UTC date: ${utcDate}`);

    const { error } = await supabase
      .from(MILA_MILESTONE_NOTES_TABLE)
      .upsert(
        {
          note_entry_date: utcDate,
        },
        {
          onConflict: 'note_entry_date',
        },
      );

    if (error) {
      logError('❌ [Mila Notes] Failed to ensure milestone row:', error);
      return false;
    }

    logInfo('✅ [Mila Notes] Milestone row is ready');
    return true;
  } catch (error) {
    logError('❌ [Mila Notes] Error ensuring milestone row:', error);
    return false;
  }
};

/**
 * Append a milestone note for Mila to today's UTC row.
 */
export const appendMilaMilestoneNote = async (note: string): Promise<boolean> => {
  const normalizedNote = normalizeMilaNoteInput(note);

  if (!normalizedNote) {
    logWarn('⚠️ [Mila Notes] Skipping empty milestone note');
    return false;
  }

  try {
    const utcDate = getTodayUtcDateString();
    logInfo(`🗒️ [Mila Notes] Appending milestone note for UTC date: ${utcDate}`);
    logInfo(`🗒️ [Mila Notes] Note content: "${normalizedNote}"`);

    const ensured = await ensureMilaMilestoneRowForDate(utcDate);
    if (!ensured) {
      logWarn('⚠️ [Mila Notes] Could not ensure milestone row; aborting append');
      return false;
    }

    const { data, error } = await supabase
      .from(MILA_MILESTONE_NOTES_TABLE)
      .select('note')
      .eq('note_entry_date', utcDate)
      .maybeSingle();

    if (error) {
      logError('❌ [Mila Notes] Failed to fetch existing milestone note:', error);
      return false;
    }

    const existingNotes = (data?.note || '').trim();
    const updatedNotes = existingNotes
      ? `${existingNotes}\n- ${normalizedNote}`
      : `- ${normalizedNote}`;

    const { error: updateError } = await supabase
      .from(MILA_MILESTONE_NOTES_TABLE)
      .update({ note: updatedNotes, updated_at: new Date().toISOString() })
      .eq('note_entry_date', utcDate);

    if (updateError) {
      logError('❌ [Mila Notes] Failed to append milestone note:', updateError);
      return false;
    }

    logInfo('✅ [Mila Notes] Milestone note appended successfully');
    return true;
  } catch (error) {
    logError('❌ [Mila Notes] Error appending milestone note:', error);
    return false;
  }
};

function formatMilaNoteLines(noteText: string, noteDate: string): string[] {
  return (noteText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\s*-\s*/, ''))
    .map((line) => `- ${noteDate}: ${line}`);
}

/**
 * Retrieve all Mila milestone notes for a specific month (UTC).
 */
export const getMilaMilestonesForMonth = async (
  year: number,
  month: number
): Promise<string[]> => {
  try {
    logInfo('📚 [Mila Notes] Retrieving milestones for month', { year, month });

    const safeYear = Number.isFinite(year) ? Math.floor(year) : NaN;
    if (!Number.isFinite(safeYear) || safeYear < 1970 || safeYear > 2100) {
      logWarn('⚠️ [Mila Notes] Invalid year for milestone retrieval', { year });
      return [];
    }

    const monthIndex = Math.max(1, Math.min(12, Math.floor(month)));
    const startDate = new Date(Date.UTC(safeYear, monthIndex - 1, 1));
    const endDate = new Date(Date.UTC(safeYear, monthIndex, 0));
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = endDate.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from(MILA_MILESTONE_NOTES_TABLE)
      .select('note, note_entry_date')
      .gte('note_entry_date', startDateStr)
      .lte('note_entry_date', endDateStr)
      .order('note_entry_date', { ascending: true });

    if (error) {
      logError('❌ [Mila Notes] Failed to retrieve month milestones:', error);
      return [];
    }

    const lines = (data || [])
      .flatMap((row) => formatMilaNoteLines(row.note, row.note_entry_date));

    logInfo('📚 [Mila Notes] Retrieved month milestone line(s)', {
      count: lines.length,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    return lines;
  } catch (error) {
    logError('❌ [Mila Notes] Error retrieving month milestones:', error);
    return [];
  }
};

/**
 * Retrieve all Mila milestone notes as dated bullet lines.
 */
export const getAllMilaMilestoneNotes = async (): Promise<string[]> => {
  try {
    logInfo('📚 [Mila Notes] Retrieving all milestone notes');

    const { data, error } = await supabase
      .from(MILA_MILESTONE_NOTES_TABLE)
      .select('note, note_entry_date')
      .order('note_entry_date', { ascending: true });

    if (error) {
      logError('❌ [Mila Notes] Failed to retrieve milestones:', error);
      return [];
    }

    const lines = (data || [])
      .flatMap((row) => formatMilaNoteLines(row.note, row.note_entry_date));

    logInfo(`📚 [Mila Notes] Retrieved ${lines.length} milestone line(s)`);
    return lines;
  } catch (error) {
    logError('❌ [Mila Notes] Error retrieving milestones:', error);
    return [];
  }
};

// ============================================
// Memory Search Functions
// ============================================

/**
 * Search past conversations for messages matching a query.
 * Uses simple text matching (ILIKE) for now - can be upgraded to 
 * full-text search or vector embeddings later.
 * 
 * @param query - Natural language search query
 * @param limit - Maximum number of results (default: 5)
 * @param timeframe - 'recent' (last 7 days) or 'all' (entire history)
 * @returns Array of matching messages with relevance context
 */
export const searchMemories = async (
  query: string,
  limit: number = DEFAULT_MEMORY_LIMIT,
  timeframe: 'recent' | 'all' = 'all'
): Promise<MemorySearchResult[]> => {
  try {
    logInfo(`🔍 [Memory] Searching for: "${query}" (timeframe: ${timeframe})`);
    
    // Extract key terms from the query for searching
    const searchTerms = extractSearchTerms(query);
    
    if (searchTerms.length === 0) {
      logInfo('🔍 [Memory] No valid search terms found');
      return [];
    }

    // Build the query
    let queryBuilder = supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select('id, message_text, message_role, created_at')
      .order('created_at', { ascending: false })
      .limit(limit * 3); // Fetch more than needed, we'll filter for relevance

    // Apply timeframe filter
    if (timeframe === 'recent') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      queryBuilder = queryBuilder.gte('created_at', sevenDaysAgo.toISOString());
    }

    const { data, error } = await queryBuilder;

    if (error) {
      logError('Failed to search memories:', error);
      return [];
    }

    if (!data || data.length === 0) {
      logInfo('🔍 [Memory] No messages found in history');
      return [];
    }

    // Score and filter results based on search terms
    const scoredResults = data
      .map(row => {
        const text = row.message_text.toLowerCase();
        let score = 0;
        
        // Score based on term matches
        for (const term of searchTerms) {
          if (text.includes(term.toLowerCase())) {
            score += 1;
            // Bonus for exact word match (not substring)
            if (new RegExp(`\\b${term}\\b`, 'i').test(text)) {
              score += 0.5;
            }
          }
        }
        
        return {
          id: row.id,
          text: row.message_text,
          role: row.message_role as 'user' | 'model',
          timestamp: row.created_at,
          relevanceScore: score
        };
      })
      .filter(result => result.relevanceScore! > 0)
      .sort((a, b) => b.relevanceScore! - a.relevanceScore!)
      .slice(0, limit);

    logInfo(`🔍 [Memory] Found ${scoredResults.length} relevant memories`);
    return scoredResults;
    
  } catch (error) {
    logError('Error searching memories:', error);
    return [];
  }
};

/**
 * Extract meaningful search terms from a natural language query.
 * Removes common words and phrases to get the key terms.
 */
function extractSearchTerms(query: string): string[] {
  // Common words to ignore (stopwords)
  const stopwords = new Set([
    'what', 'who', 'when', 'where', 'how', 'why', 'is', 'are', 'was', 'were',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'all', 'each', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 'can', 'will', 'just', 'should', 'now', 'their', 'they',
    'them', 'my', 'your', 'his', 'her', 'its', 'our', 'i', 'you', 'he', 'she',
    'it', 'we', 'me', 'him', 'us', 'do', 'did', 'does', 'have', 'has', 'had',
    'about', 'tell', 'said', 'like', 'know', 'remember', 'recall', 'think',
    'user', 'user\'s', "user's"
  ]);

  // Split into words, clean, and filter
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));

  return [...new Set(terms)]; // Remove duplicates
}

// ============================================
// User Facts Functions
// ============================================

/**
 * Get stored facts about the user.
 * 
 * @param category - Filter by category, or 'all' for everything
 * @returns Array of user facts
 */
export const getUserFacts = async (
  category: FactCategory = 'all'
): Promise<UserFact[]> => {
  try {
    logInfo(`📋 [Memory] Getting user facts (category: ${category})`);

    let queryBuilder = supabase
      .from(USER_FACTS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false });

    if (category !== 'all') {
      queryBuilder = queryBuilder.eq('category', category);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      logError('Failed to get user facts:', error);
      return [];
    }

    logInfo(`📋 [Memory] Found ${data?.length || 0} facts`);
    return (data as UserFact[]) || [];
    
  } catch (error) {
    logError('Error getting user facts:', error);
    return [];
  }
};

/**
 * Get user facts that are marked as pinned.
 * 
 * removed:       .eq('pinned', true)
 */
export const getPinnedUserFacts = async (): Promise<UserFact[]> => {
  try {
    logInfo('📌 [Memory] Getting pinned user facts');

    const { data, error } = await supabase
      .from(USER_FACTS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      logError('Failed to get pinned user facts:', error);
      return [];
    }

    logInfo(`📌 [Memory] Found ${data?.length || 0} pinned facts`);
    return (data as UserFact[]) || [];
  } catch (error) {
    logError('Error getting pinned user facts:', error);
    return [];
  }
};

const USER_ID = import.meta.env.VITE_USER_ID;
/**
 * Store a new fact about the user or update an existing one.
 * Uses UPSERT to handle conflicts on (category, fact_key).
 * 
 * @param category - Fact category
 * @param key - Fact key (e.g., 'name', 'job')
 * @param value - Fact value
 * @param sourceMessageId - Optional: the message ID where this was learned
 * @param confidence - Confidence score (0-1), default 1.0
 */
export const storeUserFact = async (
  category: UserFact['category'],
  key: string,
  value: string,
  sourceMessageId?: string,
  confidence: number = 1.0
): Promise<boolean> => {
  try {
    const canonicalKey = normalizeUserFactKey(category, key);
    const pinned = shouldPinUserFact(category, canonicalKey);
    logInfo(`💾 [Memory] Storing fact: ${category}.${canonicalKey} = "${value}"`);

    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from(USER_FACTS_TABLE)
      .upsert({
        category,
        fact_key: canonicalKey,
        fact_value: value,
        source_message_id: sourceMessageId || null,
        confidence,
        pinned,
        updated_at: now
      }, {
        onConflict: 'category,fact_key'
      })
      .select('*')
      .single();

    if (error) {
      logError('Failed to store user fact:', error);
      return false;
    }

    // Phase 2B: keep semantic embedding index in sync (fire-and-forget)
    if (data) {
      import('./factEmbeddingsService')
        .then(({ upsertUserFactEmbedding }) => upsertUserFactEmbedding(data as UserFact))
        .catch((err) => logWarn('[Memory] Failed to sync user fact embedding:', err));
    }

    logInfo(`💾 [Memory] Successfully stored fact`);
    return true;
    
  } catch (error) {
    logError('Error storing user fact:', error);
    return false;
  }
};

/**
 * Delete a specific user fact.
 * Useful for GDPR compliance or user-requested forgetting.
 * 
 * @param category - Fact category
 * @param key - Fact key to delete
 */
export const deleteUserFact = async (
  category: UserFact['category'],
  key: string
): Promise<boolean> => {
  try {
    logInfo(`🗑️ [Memory] Deleting fact: ${category}.${key}`);

    // Capture row first so we can remove embedding by source_id after delete
    const { data: existingRow } = await supabase
      .from(USER_FACTS_TABLE)
      .select('*')
      .eq('category', category)
      .eq('fact_key', key)
      .maybeSingle();

    const { error } = await supabase
      .from(USER_FACTS_TABLE)
      .delete()
      .eq('category', category)
      .eq('fact_key', key);

    if (error) {
      logError('Failed to delete user fact:', error);
      return false;
    }

    // Phase 2B: keep semantic embedding index in sync (fire-and-forget)
    if (existingRow?.id) {
      import('./factEmbeddingsService')
        .then(({ deleteFactEmbedding }) => deleteFactEmbedding('user_fact', existingRow.id))
        .catch((err) => logWarn('[Memory] Failed to delete user fact embedding:', err));
    }

    logInfo(`🗑️ [Memory] Successfully deleted fact`);
    return true;
    
  } catch (error) {
    logError('Error deleting user fact:', error);
    return false;
  }
};

// ============================================
// Context Helper Functions
// ============================================

/**
 * Get a summary of recent conversation context.
 * Useful for providing minimal context without loading full history.
 * 
 * @param messageCount - Number of recent messages to include
 * @returns Formatted string with recent context
 */
export const getRecentContext = async (
  messageCount: number = DEFAULT_RECENT_CONTEXT_COUNT
): Promise<string> => {
  try {
    const { data, error } = await supabase
      .from(CONVERSATION_HISTORY_TABLE)
      .select('message_text, message_role, created_at')
      .order('created_at', { ascending: false })
      .limit(messageCount);

    if (error || !data || data.length === 0) {
      return 'No recent conversation context available.';
    }

    // Reverse to chronological order
    const messages = data.reverse();
    
    const contextLines = messages.map(msg => {
      const role = msg.message_role === 'user' ? 'User' : 'Kayley';
      return `${role}: ${msg.message_text}`;
    });

    return `Recent conversation:\n${contextLines.join('\n')}`;
    
  } catch (error) {
    logError('Error getting recent context:', error);
    return 'Unable to retrieve recent context.';
  }
};

/**
 * Format memory search results into a human-readable string for the AI.
 */
export const formatMemoriesForAI = (memories: MemorySearchResult[]): string => {
  if (memories.length === 0) {
    return 'No relevant memories found.';
  }

  const lines = memories.map((m, i) => {
    const role = m.role === 'user' ? 'User said' : 'You said';
    const date = new Date(m.timestamp).toLocaleDateString();
    return `${i + 1}. [${date}] ${role}: "${m.text}"`;
  });

  return `Found ${memories.length} relevant memory/memories:\n${lines.join('\n')}`;
};

/**
 * Format user facts into a human-readable string for the AI.
 */
export const formatFactsForAI = (facts: UserFact[]): string => {
  if (facts.length === 0) {
    return 'No stored information found for this category.';
  }

  const lines = facts.map(f => {
    return `- ${f.fact_key}: ${formatFactValueForDisplay(f.fact_value)}`;
  });

  return `Known facts about the user:\n${lines.join('\n')}`;
};

// ============================================
// Tool Execution Handler
// ============================================

// Same pattern for calendar_action function tool — signals the orchestrator to
// set refreshCalendar=true after a create/delete runs via the tool loop.
let _calendarMutationPending = false;
export function consumeCalendarMutationSignal(): boolean {
  const v = _calendarMutationPending;
  _calendarMutationPending = false;
  return v;
}

export type MemoryToolName =
  | 'web_search'
  | 'web_fetch'
  | 'start_background_task'
  | 'check_task_status'
  | 'cancel_task'
  | 'list_active_tasks'
  | 'workspace_action'
  | 'delegate_to_engineering'
  | 'get_engineering_ticket_status'
  | 'submit_clarification'
  | 'email_action'
  | 'email_action_manage'
  | 'recall_memory'
  | 'recall_user_info'
  | 'store_user_info'
  | 'calendar_action'
  | 'store_self_info'
  | 'store_character_info'
  | 'resolve_open_loop'
  | 'resolve_idle_question'
  | 'resolve_idle_browse_note'
  | 'tool_suggestion'
  | 'make_promise'
  | 'create_life_storyline'
  | 'create_open_loop'
  | 'recall_character_profile'
  | 'store_daily_note'
  | 'retrieve_daily_notes'
  | 'store_monthly_note'
  | 'retrieve_monthly_notes'
  | 'store_lessons_learned'
  | 'retrieve_lessons_learned'
  | 'mila_note'
  | 'retrieve_mila_notes'
  | 'resolve_x_tweet'
  | 'post_x_tweet'
  | 'resolve_x_mention'
  | 'google_task_action'
  | 'google_cli'
  | 'read_agent_file'
  | 'write_agent_file'
  | 'query_database';

/**
 * Optional context passed to tool execution (e.g., access tokens)
 */
export interface ToolExecutionContext {
  currentEvents?: Array<{ id: string; summary: string }>;
  userMessage?: string;
  conversationScopeId?: string;
  conversationLogId?: string;
  /** SSE event bus for streaming tool visibility. Node.js EventEmitter interface. */
  eventBus?: { emit(event: string, data: unknown): boolean };
}

export interface ToolCallArgs {
  web_search: {
    query: string;
  };
  web_fetch: {
    url: string;
    max_chars?: number;
  };
  start_background_task: {
    command: string;
    label: string;
    cwd?: string;
    approved?: boolean;
  };
  check_task_status: {
    task_id: string;
    tail_lines?: number;
  };
  cancel_task: {
    task_id: string;
  };
  list_active_tasks: Record<string, never>;
  workspace_action: {
    action:
      | 'command'
      | 'mkdir'
      | 'read'
      | 'write'
      | 'search'
      | 'status'
      | 'commit'
      | 'push'
      | 'delete';
    path?: string;
    content?: string;
    append?: boolean;
    query?: string;
    rootPath?: string;
    caseSensitive?: boolean;
    message?: string;
    addAll?: boolean;
    paths?: string[];
    remote?: string;
    branch?: string;
    recursive?: boolean;
    command?: string;
    cwd?: string;
    timeout_ms?: number;
    approved?: boolean;
  };
  delegate_to_engineering: {
    request_type?: 'skill' | 'feature' | 'bug';
    title?: string;
    request_summary?: string;
    additional_details?: string;
    priority?: string;
    is_ui_related?: boolean;
  };
  get_engineering_ticket_status: {
    ticket_id?: string;
  };
  submit_clarification: {
    ticket_id: string;
    response: string;
  };
  email_action: {
    action: 'archive' | 'reply' | 'dismiss' | 'send';
    message_id?: string;
    thread_id?: string;
    to?: string;
    subject?: string;
    reply_body?: string;
    confirmed?: boolean;
    draft_id?: string;
  };
  email_action_manage: {
    action: 'dismiss_pending';
    action_ids?: string[];
    message_ids?: string[];
  };
  recall_memory: {
    query: string;
    timeframe?: 'recent' | 'all';
  };
  recall_user_info: {
    category: FactCategory;
    specific_key?: string;
  };
  store_user_info: {
    category: 'identity' | 'preference' | 'relationship' | 'context';
    key: string;
    value: string;
  };
  store_daily_note: {
    note: string;
  };
  retrieve_daily_notes: Record<string, never>;
  store_monthly_note: {
    note: string;
  };
  retrieve_monthly_notes: {
    year?: number;
    month?: number;
  };
  store_lessons_learned: {
    lesson: string;
  };
  retrieve_lessons_learned: Record<string, never>;
  mila_note: {
    note: string;
  };
  retrieve_mila_notes: {
    year: number;
    month: number;
  };
  calendar_action: {
    action: 'create' | 'update' | 'delete' | 'list';
    summary?: string;
    start?: string;
    end?: string;
    timeZone?: string;
    event_id?: string;
    event_ids?: string[];
    delete_all?: boolean;
    days?: number;
    timeMin?: string;
    timeMax?: string;
  };
  store_self_info: {
    category: 'quirk' | 'relationship' | 'experience' | 'preference' | 'detail' | 'other';
    key: string;
    value: string;
  };
  store_character_info: {
    observation: string;
  };
  query_database: {
    query: string;
    reason: string;
  };
  resolve_open_loop: {
    topic: string;
    resolution_type: 'resolved' | 'dismissed';
    reason?: string;
  };
  resolve_idle_question: {
    id: string;
    status: 'asked' | 'answered';
    answer_text?: string;
  };
  resolve_idle_browse_note: {
    id: string;
    status: 'shared';
  };
  resolve_x_tweet: {
    id: string;
    status: 'approved' | 'rejected';
    rejection_reason?: string;
  };
  post_x_tweet: {
    text: string;
    intent?: string;
    include_selfie?: boolean;
    selfie_scene?: string;
  };
  resolve_x_mention: {
    id: string;
    status: 'approve' | 'reply' | 'skip';
    reply_text?: string;
  };
  tool_suggestion: {
    action: 'create' | 'mark_shared';
    id?: string;
    tool_key?: string;
    title?: string;
    reasoning?: string;
    user_value?: string;
    trigger?: string;
    trigger_source?: 'idle' | 'live';
    trigger_text?: string;
    trigger_reason?: string;
    theme?: string;
    seed_id?: string;
    sample_prompt?: string;
    permissions_needed?: string[];
  };
  make_promise: {
    promiseType: 'send_selfie' | 'share_update' | 'follow_up' | 'send_content' | 'reminder' | 'send_voice_note';
    description: string;
    triggerEvent: string;
    fulfillmentData?: {
      selfieParams?: {
        scene: string;
        mood: string;
        location?: string;
      };
      messageText?: string;
      contentToShare?: string;
    };
  };
  create_life_storyline: {
    title: string;
    category: 'work' | 'personal' | 'family' | 'social' | 'creative';
    storylineType: 'project' | 'opportunity' | 'challenge' | 'relationship' | 'goal';
    initialAnnouncement: string;
    stakes: string;
    userInvolvement?: 'none' | 'aware' | 'supportive' | 'involved' | 'central';
    emotionalTone?: string;
    emotionalIntensity?: number;
  };
  create_open_loop: {
    loopType: 'pending_event' | 'emotional_followup' | 'commitment_check' | 'curiosity_thread';
    topic: string;
    suggestedFollowUp: string;
    timeframe: 'immediate' | 'today' | 'tomorrow' | 'this_week' | 'soon' | 'later';
    salience: number;
    eventDateTime?: string;
  };
  recall_character_profile: {
    section: 'background' | 'interests' | 'relationships' | 'challenges' |
             'quirks' | 'goals' | 'preferences' | 'anecdotes' | 'routines' | 'full';
    reason?: string;
  };
  google_task_action: {
    action: 'create' | 'complete' | 'delete' | 'list' | 'reopen';
    title?: string;
    taskId?: string;
    tasklistId?: string;
    includeCompleted?: boolean;
    max?: number;
  };
  google_cli: {
    command: string;
  };
  read_agent_file: {
    filename: string;
  };
  write_agent_file: {
    filename: string;
    content: string;
  };
}

/**
 * Execute a memory tool call and return the result.
 * This is the main entry point for AI tool calling.
 * 
 * @param toolName - The name of the tool to execute
 * @param args - Tool-specific arguments
 * @returns Result string to return to the AI
 */
export const executeMemoryTool = async (
  toolName: MemoryToolName,
  args: ToolCallArgs[typeof toolName],
  context?: ToolExecutionContext
): Promise<string> => {
  logInfo(`🔧 [Memory Tool] Executing: ${toolName}`, args);

  const normalizeRequestedFactKey = (rawKey: string, category: FactCategory): string => {
    return normalizeUserFactKey(category, rawKey);
  };

  try {
    switch (toolName) {
      case "web_search": {
        const { query } = args as ToolCallArgs['web_search'];
        const webSearchLog = clientLogger.scoped('WebSearch');
        webSearchLog.info('Searching', { query });

        try {
          const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY,
              query,
              search_depth: "basic",
              max_results: 5,
            }),
          });

          if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
          }

          const data = await response.json();

          // Clean and join the results into a string for Gemini
          return data.results
            .map(
              (r: any) =>
                `Source: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`,
            )
            .join("\n\n");
        } catch (error) {
          webSearchLog.error('Tavily search failed', { error: error instanceof Error ? error.message : String(error) });
          return "I tried to check the internet, but my internal browser is acting up!";
        }
      }
      case "web_fetch": {
        const { url, max_chars } = args as ToolCallArgs['web_fetch'];
        const webFetchLog = clientLogger.scoped('WebFetch');
        webFetchLog.info('Fetching URL', { url });

        try {
          // Validate URL
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return "I can only fetch http/https URLs.";
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; KayleyBot/1.0)',
              'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
            },
          });
          clearTimeout(timeout);

          if (!response.ok) {
            return `Failed to fetch URL (HTTP ${response.status}): ${response.statusText}`;
          }

          const contentType = response.headers.get('content-type') || '';
          const rawText = await response.text();
          const maxChars = Math.min(max_chars ?? 10_000, 50_000);

          let content: string;
          if (contentType.includes('application/json')) {
            // JSON: return as-is, truncated
            content = rawText.slice(0, maxChars);
          } else {
            // HTML or other: strip tags, collapse whitespace
            content = rawText
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, maxChars);
          }

          if (!content) {
            return "The page loaded but contained no readable text content.";
          }

          webFetchLog.info('Fetch complete', { url, contentLength: content.length });
          return `Content from ${url} (${content.length} chars):\n\n${content}`;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          webFetchLog.error('Fetch failed', { url, error: errMsg });
          if (errMsg.includes('aborted') || errMsg.includes('abort')) {
            return "The page took too long to load (timed out after 15 seconds).";
          }
          return `I couldn't fetch that page: ${errMsg}`;
        }
      }
      case "start_background_task": {
        const { command, label, cwd, approved } = args as ToolCallArgs['start_background_task'];
        const bgLog = clientLogger.scoped('BackgroundTask');
        bgLog.info('Starting background task', { command, label });

        try {
          const { startBackgroundTask } = await import('../../server/services/backgroundTaskManager');
          const task = startBackgroundTask({
            command,
            label,
            cwd,
            approved,
            workspaceRoot: process.cwd(),
          });
          return `Background task started.\nTask ID: ${task.id}\nLabel: ${task.label}\nPID: ${task.pid}\n\nUse check_task_status with this task_id to monitor progress.`;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          bgLog.error('Failed to start background task', { error: errMsg });
          return `Failed to start background task: ${errMsg}`;
        }
      }
      case "check_task_status": {
        const { task_id, tail_lines } = args as ToolCallArgs['check_task_status'];

        try {
          const { checkTaskStatus } = await import('../../server/services/backgroundTaskManager');
          const task = checkTaskStatus(task_id);
          if (!task) {
            return `No task found with ID: ${task_id}. It may have expired (tasks are cleaned up 1 hour after completion).`;
          }

          const lines = tail_lines ?? 30;
          const outputTail = task.output.slice(-lines).join('\n');
          const durationMs = (task.finishedAt ?? Date.now()) - task.startedAt;
          const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;

          return [
            `Task: ${task.label}`,
            `Status: ${task.status}`,
            `Duration: ${durationStr}`,
            task.exitCode !== null ? `Exit code: ${task.exitCode}` : null,
            `PID: ${task.pid ?? 'N/A'}`,
            '',
            `Recent output (last ${Math.min(lines, task.output.length)} lines):`,
            outputTail || '(no output yet)',
          ].filter(Boolean).join('\n');
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return `Failed to check task status: ${errMsg}`;
        }
      }
      case "cancel_task": {
        const { task_id } = args as ToolCallArgs['cancel_task'];

        try {
          const { cancelTask } = await import('../../server/services/backgroundTaskManager');
          const cancelled = cancelTask(task_id);
          if (cancelled) {
            return `Task ${task_id} has been cancelled.`;
          }
          return `Could not cancel task ${task_id}. It may have already finished or doesn't exist.`;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return `Failed to cancel task: ${errMsg}`;
        }
      }
      case "list_active_tasks": {
        try {
          const { listActiveTasks } = await import('../../server/services/backgroundTaskManager');
          const activeTasks = listActiveTasks();
          if (activeTasks.length === 0) {
            return "No background tasks are currently running.";
          }

          const lines = activeTasks.map((t) => {
            const durationMs = Date.now() - t.startedAt;
            const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
            return `- ${t.label} (ID: ${t.id}, running for ${durationStr}, PID: ${t.pid ?? 'N/A'})`;
          });
          return `${activeTasks.length} active task(s):\n${lines.join('\n')}`;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return `Failed to list tasks: ${errMsg}`;
        }
      }
      case 'workspace_action': {
        const { requestWorkspaceAction } = await import('./projectAgentService');
        const actionArgs = args as ToolCallArgs['workspace_action'];
        const contentLength =
          typeof actionArgs.content === 'string' ? actionArgs.content.length : 0;
        workspaceLogger.info('workspace_action requested', {
          action: actionArgs.action,
          path: actionArgs.path,
          query: actionArgs.query,
          rootPath: actionArgs.rootPath,
          append: actionArgs.append,
          contentLength,
        });
        const { action, approved, ...rawArgs } = actionArgs;
        const filteredArgs = Object.fromEntries(
          Object.entries(rawArgs).filter(([, value]) => value !== undefined),
        );

        const result = await requestWorkspaceAction({
          action,
          args: filteredArgs,
          prompt: context?.userMessage,
          approved,
        }, {
          waitForTerminal: false,
        });

        if (!result.run) {
          workspaceLogger.error('workspace_action failed: no run returned', {
            action,
            error: result.error || null,
          });
          return `Workspace action failed: ${
            result.error || 'No run details returned from workspace agent.'
          }`;
        }

        const run = result.run;
        const stepSummary = run.steps
          .map((step) => `${step.stepId}:${step.type}:${step.status}`)
          .join(', ');
        const evidenceText = (() => {
          const evidenceLines = (run.steps || [])
            .flatMap((step) => step.evidence || [])
            .filter((line) => typeof line === "string" && line.trim().length > 0);
          if (evidenceLines.length === 0) return "";
          const combined = evidenceLines.join("\n");
          const maxChars = 4000;
          if (combined.length <= maxChars) return combined;
          return `${combined.slice(0, maxChars)}\n\n[Evidence truncated after ${maxChars} chars]`;
        })();
        const evidenceSuffix = evidenceText ? `\n\nEvidence:\n${evidenceText}` : "";

        workspaceLogger.info('workspace_action result', {
          action,
          runId: run.id,
          status: run.status,
          summary: run.summary,
          stepCount: run.steps?.length ?? 0,
        });

        if (run.status === 'success') {
          return `Workspace action success (${run.id}): ${run.summary}. Steps: ${stepSummary}${evidenceSuffix}`;
        }

        if (
          run.status === 'accepted' ||
          run.status === 'pending' ||
          run.status === 'running'
        ) {
          return `Workspace action started (${run.id}): ${run.summary}. Current status: ${run.status}. I will keep you posted in chat.`;
        }

        if (run.status === 'requires_approval') {
          return `Workspace action requires approval (${run.id}): ${run.summary}. Use Admin > Agent to approve or reject. Steps: ${stepSummary}`;
        }

        if (run.status === 'rejected') {
          return `Workspace action rejected (${run.id}): ${run.summary}.`;
        }

        if (run.status === 'verification_failed') {
          return `Workspace action verification failed (${run.id}): ${run.summary}. Steps: ${stepSummary}${evidenceSuffix}`;
        }

        return `Workspace action failed (${run.id}): ${run.summary}. Steps: ${stepSummary}${evidenceSuffix}`;
      }
      case 'delegate_to_engineering': {
        const { createEngineeringTicket } = await import('./multiAgentService');
        const ticketArgs = args as ToolCallArgs['delegate_to_engineering'];
        memoryToolLog.info('delegate_to_engineering called', {
          request_type: ticketArgs.request_type,
          title: ticketArgs.title,
          priority: ticketArgs.priority,
          is_ui_related: ticketArgs.is_ui_related,
          has_request_summary: !!ticketArgs.request_summary?.trim(),
          has_additional_details: !!ticketArgs.additional_details?.trim(),
        });

        if (!ticketArgs.request_summary || !ticketArgs.request_summary.trim()) {
          return 'Missing request_summary for engineering ticket creation.';
        }

        const result = await createEngineeringTicket({
          requestType: ticketArgs.request_type,
          title: ticketArgs.title,
          requestSummary: ticketArgs.request_summary,
          additionalDetails: ticketArgs.additional_details,
          priority: ticketArgs.priority,
          isUiRelated: ticketArgs.is_ui_related,
          source: 'kayley',
          createdBy: 'kayley',
        });

        if (!result.ok || !result.ticket) {
          return `Engineering ticket creation failed: ${result.error || 'Unknown error.'}`;
        }

        const clarifier = result.needsClarification
          ? 'Clarification needed before implementation.'
          : 'Intake acknowledged.';

        return `Engineering ticket ${result.ticket.id} created (${result.ticket.requestType}). Status: ${result.ticket.status}. ${clarifier}`;
      }
      case 'get_engineering_ticket_status': {
        const {
          getEngineeringTicket,
          listEngineeringTickets,
        } = await import('./multiAgentService');
        const statusArgs = args as ToolCallArgs['get_engineering_ticket_status'];
        memoryToolLog.info('get_engineering_ticket_status called', {
          ticket_id: statusArgs.ticket_id || null,
        });

        if (statusArgs.ticket_id) {
          const ticketResult = await getEngineeringTicket(statusArgs.ticket_id);
          if (!ticketResult.ok || !ticketResult.ticket) {
            return `Unable to fetch ticket ${statusArgs.ticket_id}: ${ticketResult.error || 'Unknown error.'}`;
          }

          return formatTicketStatus(ticketResult.ticket);
        }

        const listResult = await listEngineeringTickets(1);
        if (!listResult.ok || listResult.tickets.length === 0) {
          return listResult.error || 'No engineering tickets found.';
        }

        return formatTicketStatus(listResult.tickets[0]);
      }
      case 'submit_clarification': {
        const { submitClarification } = await import('./multiAgentService');
        const clarifyArgs = args as ToolCallArgs['submit_clarification'];
        memoryToolLog.info('submit_clarification called', { ticket_id: clarifyArgs.ticket_id });

        if (!clarifyArgs.ticket_id || !clarifyArgs.response?.trim()) {
          return 'Missing ticket_id or response for submit_clarification.';
        }

        const result = await submitClarification(clarifyArgs.ticket_id, clarifyArgs.response);
        return result.ok
          ? `Clarification submitted for ticket ${clarifyArgs.ticket_id}. Opey will continue implementing.`
          : `Failed to submit clarification: ${result.error}`;
      }
      case 'email_action': {
        const {
          action,
          message_id,
          to,
          subject,
          reply_body,
          confirmed,
          draft_id,
        } = args as ToolCallArgs['email_action'];

        const {
          archiveEmail: gogArchiveEmail,
          sendReply: gogSendReply,
          sendEmail: gogSendEmail,
        } = await import('../../server/services/gogService');

        if (action === 'send') {
          if (!to?.trim() || !subject?.trim() || !reply_body?.trim()) {
            return formatToolFailure("email_action send requires to, subject, and reply_body.");
          }

          const normalizedTo = to.trim();
          const normalizedSubject = subject.trim();
          const normalizedBody = reply_body.trim();

          // Confirmation gate — always preview first.
          if (!confirmed) {
            const { previewText } = createEmailSendDraftPreview(
              normalizedTo,
              normalizedSubject,
              normalizedBody,
            );
            return previewText;
          }

          const validation = validateConfirmedEmailSend({
            draftId: draft_id,
            to: normalizedTo,
            subject: normalizedSubject,
            body: normalizedBody,
            userMessage: context?.userMessage,
          });
          if (!validation.ok) {
            const reason =
              "reason" in validation
                ? validation.reason
                : "Missing email send confirmation.";
            return formatToolFailure(reason);
          }

          const success = await gogSendEmail(normalizedTo, normalizedSubject, normalizedBody);
          return success
            ? sanitizeForGemini(`✓ Sent email to ${normalizedTo} with subject "${normalizedSubject}"`)
            : formatToolFailure('Email send failed. No email was sent.');
        }

        if (!message_id?.trim()) {
          return formatToolFailure(`email_action ${action} requires message_id.`);
        }

        let success = false;
        if (action === 'archive') {
          success = await gogArchiveEmail(message_id.trim());
        } else if (action === 'reply') {
          if (!reply_body?.trim()) {
            return formatToolFailure('email_action reply requires reply_body.');
          }

          const { data: pendingRow } = await supabase
            .from(KAYLEY_EMAIL_ACTIONS_TABLE)
            .select('from_address, subject')
            .eq('gmail_message_id', message_id.trim())
            .eq('action_taken', 'pending')
            .order('announced_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          const recipient = (to?.trim() || extractEmailAddress(pendingRow?.from_address || '')).trim();
          const subjectLine = (subject?.trim() || pendingRow?.subject?.trim() || 'Re:').trim();
          if (!recipient) {
            return formatToolFailure('email_action reply could not determine recipient address.');
          }

          success = await gogSendReply(
            message_id.trim(),
            recipient,
            subjectLine,
            reply_body.trim(),
          );
        } else if (action === 'dismiss') {
          success = true;
        } else {
          return formatToolFailure(`Unknown email_action: ${action}`);
        }

        if (!success) {
          return formatToolFailure(`email_action ${action} failed for message ${message_id.trim()}.`);
        }

        const dbAction = action === 'dismiss' ? 'dismissed' : action;
        const { data: pendingRow, error: pendingLookupError } = await supabase
          .from(KAYLEY_EMAIL_ACTIONS_TABLE)
          .select('id')
          .eq('gmail_message_id', message_id.trim())
          .eq('action_taken', 'pending')
          .order('announced_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (pendingLookupError) {
          logWarn('[Memory Tool] email_action pending row lookup failed', pendingLookupError);
        }

        if (pendingRow?.id) {
          const { error: updateError } = await supabase
            .from(KAYLEY_EMAIL_ACTIONS_TABLE)
            .update({
              action_taken: dbAction,
              actioned_at: new Date().toISOString(),
            })
            .eq('id', pendingRow.id);

          if (updateError) {
            return formatToolFailure(
              `Email ${action} succeeded but failed to update pending row: ${updateError.message}`
            );
          }
        }

        return sanitizeForGemini(`✓ Email action '${action}' completed.`);
      }
      case 'email_action_manage': {
        const { action_ids, message_ids } = args as ToolCallArgs['email_action_manage'];

        const MAX_DISMISS = 50;

        // SELECT ids first (limit applies cleanly on reads), then UPDATE by those ids.
        let selectQuery = supabase
          .from(KAYLEY_EMAIL_ACTIONS_TABLE)
          .select('id')
          .eq('action_taken', 'pending')
          .limit(MAX_DISMISS);

        if (action_ids && action_ids.length > 0) {
          selectQuery = selectQuery.in('id', action_ids);
        } else if (message_ids && message_ids.length > 0) {
          selectQuery = selectQuery.in('gmail_message_id', message_ids);
        }

        const { data: rows, error: selectError } = await selectQuery;
        if (selectError) {
          logWarn('[Memory Tool] email_action_manage select failed', selectError);
          return formatToolFailure(`email_action_manage failed: ${selectError.message}`);
        }

        if (!rows || rows.length === 0) {
          return sanitizeForGemini('No pending email actions found to dismiss.');
        }

        const ids = rows.map((r: { id: string }) => r.id);
        const { error: updateError } = await supabase
          .from(KAYLEY_EMAIL_ACTIONS_TABLE)
          .update({ action_taken: 'dismissed', actioned_at: new Date().toISOString() })
          .in('id', ids);

        if (updateError) {
          logWarn('[Memory Tool] email_action_manage update failed', updateError);
          return formatToolFailure(`email_action_manage update failed: ${updateError.message}`);
        }

        const count = ids.length;
        return sanitizeForGemini(`✓ Dismissed ${count} pending email action${count === 1 ? '' : 's'}.`);
      }
      case 'recall_memory': {
        const { query, timeframe } = args as ToolCallArgs['recall_memory'];
        const memories = await searchMemories(query, DEFAULT_MEMORY_LIMIT, timeframe);
        return formatMemoriesForAI(memories);
      }
      case 'recall_user_info': {
        const { category, specific_key } = args as ToolCallArgs['recall_user_info'];
        const facts = await getUserFacts(category);
        
        // If a specific key was requested, filter to just that
        if (specific_key) {
          const requestedKey = normalizeRequestedFactKey(specific_key, category);
          const specificFact = facts.find(
            f => f.fact_key.toLowerCase() === requestedKey
          );
          if (specificFact) {
            return `${specificFact.fact_key}: ${specificFact.fact_value}`;
          }

          // Fallback: return all known facts so the model can answer without looping tool calls
          // (e.g., model asked for "job" but we store "occupation").
          if (facts.length > 0) {
            return formatFactsForAI(facts);
          }

          return `No information stored for "${specific_key}".`;
        }
        
        return formatFactsForAI(facts);
      }
      case 'store_user_info': {
        const { category, key, value } = args as ToolCallArgs['store_user_info'];
        const canonicalKey = normalizeUserFactKey(category, key);
        if (isCurrentFactKey(key) || isCurrentFactKey(canonicalKey)) {
          memoryToolLog.info('Skipping transient current_* fact', { category, key: canonicalKey });
          return `Skipped transient fact: ${key}`;
        }
        const success = await storeUserFact(category, canonicalKey, value);
        return success
          ? `✓ Stored: ${canonicalKey} = "${value}"`
          : `Failed to store information.`;
      }
      case 'store_daily_note': {
        const { note } = args as ToolCallArgs['store_daily_note'];
        memoryToolLog.info('Storing daily note');
        const success = await appendDailyNote(note);
        return success
          ? '✓ Daily note stored.'
          : 'Failed to store daily note.';
      }
      case 'store_monthly_note': {
        const { note } = args as ToolCallArgs['store_monthly_note'];
        memoryToolLog.info('Storing monthly note');
        const success = await appendMonthlyNote(note);
        return success
          ? '✓ Monthly note stored.'
          : 'Failed to store monthly note.';
      }
      case 'store_lessons_learned': {
        const { lesson } = args as ToolCallArgs['store_lessons_learned'];
        lessonsLogger.info('Memory tool storing lesson learned', { lesson });
        const success = await appendLessonLearned(lesson);
        return success
          ? '✓ Lesson learned stored.'
          : 'Failed to store lesson learned.';
      }
      case 'mila_note': {
        const { note } = args as ToolCallArgs['mila_note'];
        memoryToolLog.info('Storing Mila milestone note');
        const success = await appendMilaMilestoneNote(note);
        return success
          ? 'Mila milestone note stored.'
          : 'Failed to store Mila milestone note.';
      }
      case 'retrieve_daily_notes': {
        memoryToolLog.info('Retrieving daily notes');
        const lines = await getAllDailyNotes();
        if (lines.length === 0) {
          return 'No daily notes recorded yet.';
        }
        return `Daily notes:\n${lines.join('\n')}`;
      }
      case 'retrieve_monthly_notes': {
        const { year, month } = args as ToolCallArgs['retrieve_monthly_notes'];
        memoryToolLog.info('Retrieving monthly notes', { year, month });
        const { monthKey, lines } = await getMonthlyNotesForMonth(year, month);
        if (lines.length === 0) {
          return `No monthly notes recorded for ${monthKey}.`;
        }
        return `Monthly notes for ${monthKey}:\n${lines.join('\n')}`;
      }
      case 'retrieve_lessons_learned': {
        lessonsLogger.info('Memory tool retrieving lessons learned');
        const lines = await getAllLessonsLearned();
        if (lines.length === 0) {
          return 'No lessons learned recorded yet.';
        }
        return `Lessons learned:\n${lines.join('\n')}`;
      }
      case 'retrieve_mila_notes': {
        const { year, month } = args as ToolCallArgs['retrieve_mila_notes'];
        const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
        memoryToolLog.info('Retrieving Mila milestone notes', { year, month });
        const lines = await getMilaMilestonesForMonth(year, month);
        if (lines.length === 0) {
          return `No Mila milestones recorded for ${monthLabel}.`;
        }
        return `Mila milestones for ${monthLabel}:\n${lines.join('\n')}`;
      }
      case 'calendar_action': {
        const gogCal = await import('../../server/services/gogService');
        const calendarArgs = args as ToolCallArgs['calendar_action'];
        const { action, summary, start, end, timeZone, event_id, event_ids, delete_all } = calendarArgs;

        switch (action) {
          case 'create': {
            if (!summary || !start) {
              return 'Error: Calendar event requires summary and start time.';
            }

            let parserSource: 'deterministic' | 'gemini' = 'deterministic';
            let geminiAttempted = false;
            try {
              const resolvedTimeZone = normalizeCalendarTimeZone(timeZone);
              calendarToolLogger.info('calendar_create_requested', {
                summary,
                startRaw: start,
                endRaw: end ?? null,
                resolvedTimeZone,
                parser_source: parserSource,
              });

              let normalizedStart = normalizeExplicitCalendarDateTimeInput(start, resolvedTimeZone);
              let normalizedEnd = end
                ? normalizeExplicitCalendarDateTimeInput(end, resolvedTimeZone)
                : (normalizedStart ? addMinutesToLocalIso(normalizedStart, 60) : null);

              if (!normalizedStart || !normalizedEnd) {
                geminiAttempted = true;
                const { parseCalendarWindowWithGemini } = await import('../../server/services/ai/calendarTimeParser');
                const llmParsed = await parseCalendarWindowWithGemini({
                  summary,
                  userMessage: context?.userMessage,
                  startRaw: start,
                  endRaw: end,
                  timeZone: resolvedTimeZone,
                });

                if (llmParsed) {
                  normalizedStart = llmParsed.start;
                  normalizedEnd = llmParsed.end;
                  parserSource = 'gemini';
                  calendarToolLogger.info('calendar_create_parse_via_llm', {
                    summary,
                    normalizedStart,
                    normalizedEnd,
                    resolvedTimeZone,
                    confidence: llmParsed.confidence,
                    parser_source: parserSource,
                  });
                }
              }

              if (!normalizedStart) {
                calendarToolLogger.warning('calendar_create_start_parse_failed', {
                  summary,
                  startRaw: start,
                  endRaw: end ?? null,
                  resolvedTimeZone,
                  parser_source: parserSource,
                  gemini_attempted: geminiAttempted,
                });
                return 'Error: Could not parse calendar start time. Please provide a clearer date/time.';
              }
              if (!normalizedEnd) {
                calendarToolLogger.warning('calendar_create_end_parse_failed', {
                  summary,
                  startRaw: start,
                  endRaw: end ?? null,
                  resolvedTimeZone,
                  parser_source: parserSource,
                  gemini_attempted: geminiAttempted,
                });
                return 'Error: Could not parse calendar end time. Please provide a clearer date/time.';
              }

              // Guard against inverted/zero windows; default to a 1-hour event.
              if (normalizedEnd <= normalizedStart) {
                const plusOneHour = addMinutesToLocalIso(normalizedStart, 60);
                if (plusOneHour) {
                  normalizedEnd = plusOneHour;
                }
              }

              await gogCal.createCalendarEvent({
                summary,
                start: normalizedStart,
                end: normalizedEnd,
                timeZone: resolvedTimeZone,
              });

              calendarToolLogger.info('calendar_create_succeeded', {
                summary,
                normalizedStart,
                normalizedEnd,
                resolvedTimeZone,
                parser_source: parserSource,
                gemini_attempted: geminiAttempted,
              });
              _calendarMutationPending = true;
              return sanitizeForGemini(`Created calendar event: "${summary}"`);
            } catch (error) {
              calendarToolLogger.error('calendar_create_failed', {
                summary,
                startRaw: start,
                endRaw: end ?? null,
                parser_source: parserSource,
                gemini_attempted: geminiAttempted,
                error: error instanceof Error ? error.message : String(error),
              });
              logError('Calendar create error:', error);
              return `Error creating calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          }

          case 'update': {
            if (!event_id) {
              return 'Error: event_id is required for calendar update.';
            }
            if (!summary && !start && !end) {
              return 'Error: calendar update requires at least one field (summary, start, or end).';
            }

            let parserSource: 'deterministic' | 'gemini' = 'deterministic';
            let geminiAttempted = false;

            try {
              const resolvedTimeZone = normalizeCalendarTimeZone(timeZone);
              calendarToolLogger.info('calendar_update_requested', {
                eventId: event_id,
                summary: summary ?? null,
                startRaw: start ?? null,
                endRaw: end ?? null,
                resolvedTimeZone,
                parser_source: parserSource,
              });

              let normalizedStart = start
                ? normalizeExplicitCalendarDateTimeInput(start, resolvedTimeZone)
                : null;
              let normalizedEnd = end
                ? normalizeExplicitCalendarDateTimeInput(end, resolvedTimeZone)
                : null;

              if ((start && !normalizedStart) || (end && !normalizedEnd)) {
                geminiAttempted = true;
                const { parseCalendarWindowWithGemini } = await import('../../server/services/ai/calendarTimeParser');
                const llmParsed = await parseCalendarWindowWithGemini({
                  summary,
                  userMessage: context?.userMessage,
                  startRaw: start || end || '',
                  endRaw: end,
                  timeZone: resolvedTimeZone,
                });

                if (llmParsed) {
                  parserSource = 'gemini';
                  if (start && !normalizedStart) normalizedStart = llmParsed.start;
                  if (end && !normalizedEnd) normalizedEnd = llmParsed.end;
                  if (start && !end && !normalizedEnd) {
                    normalizedEnd = addMinutesToLocalIso(normalizedStart || llmParsed.start, 60);
                  }
                  calendarToolLogger.info('calendar_update_parse_via_llm', {
                    eventId: event_id,
                    normalizedStart: normalizedStart ?? null,
                    normalizedEnd: normalizedEnd ?? null,
                    resolvedTimeZone,
                    parser_source: parserSource,
                    confidence: llmParsed.confidence,
                  });
                }
              }

              if (start && !normalizedStart) {
                calendarToolLogger.warning('calendar_update_start_parse_failed', {
                  eventId: event_id,
                  startRaw: start,
                  endRaw: end ?? null,
                  resolvedTimeZone,
                  parser_source: parserSource,
                  gemini_attempted: geminiAttempted,
                });
                return 'Error: Could not parse calendar update start time. Please provide a clearer date/time.';
              }
              if (end && !normalizedEnd) {
                calendarToolLogger.warning('calendar_update_end_parse_failed', {
                  eventId: event_id,
                  startRaw: start ?? null,
                  endRaw: end,
                  resolvedTimeZone,
                  parser_source: parserSource,
                  gemini_attempted: geminiAttempted,
                });
                return 'Error: Could not parse calendar update end time. Please provide a clearer date/time.';
              }

              const updated = await gogCal.updateCalendarEvent({
                eventId: event_id,
                summary: summary || undefined,
                start: normalizedStart || undefined,
                end: normalizedEnd || undefined,
              });

              if (!updated) {
                return 'Error updating calendar event: command failed.';
              }

              calendarToolLogger.info('calendar_update_succeeded', {
                eventId: event_id,
                summary: summary ?? null,
                normalizedStart: normalizedStart ?? null,
                normalizedEnd: normalizedEnd ?? null,
                resolvedTimeZone,
                parser_source: parserSource,
                gemini_attempted: geminiAttempted,
              });

              _calendarMutationPending = true;
              return sanitizeForGemini(`Updated calendar event: "${event_id}"`);
            } catch (error) {
              calendarToolLogger.error('calendar_update_failed', {
                eventId: event_id,
                summary: summary ?? null,
                startRaw: start ?? null,
                endRaw: end ?? null,
                parser_source: parserSource,
                gemini_attempted: geminiAttempted,
                error: error instanceof Error ? error.message : String(error),
              });
              return `Error updating calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          }

          case 'delete': {
            try {
              let deletedCount = 0;
              let eventIdsToDelete: string[] = [];

              if (delete_all && context?.currentEvents) {
                eventIdsToDelete = context.currentEvents.map(e => e.id);
              } else if (event_ids && event_ids.length > 0) {
                eventIdsToDelete = event_ids;
              } else if (event_id) {
                eventIdsToDelete = [event_id];
              } else {
                return 'Error: No event ID provided for deletion.';
              }

              for (const id of eventIdsToDelete) {
                const ok = await gogCal.deleteCalendarEvent(id);
                if (ok) deletedCount++;
              }

              if (deletedCount === 0) {
                return 'Could not find any events to delete.';
              }

              _calendarMutationPending = true;
              return `✓ Deleted ${deletedCount} calendar event(s)`;
            } catch (error) {
              logError('Calendar delete error:', error);
              return `Error deleting calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          }

          case 'list': {
            try {
              const { days, timeMin, timeMax } = calendarArgs;

              const events = await gogCal.listCalendarEvents({
                from: timeMin || undefined,
                to: timeMax || undefined,
                days: (!timeMin && !timeMax) ? (days || 7) : (days || undefined),
                max: 50,
              });

              if (events.length === 0) {
                return 'No events found for that time range.';
              }

              const eventLines = events.map((event, i) => {
                const t = new Date(event.start.dateTime || event.start.date || '');
                const timeStr = t.toLocaleString("en-US", {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const loc = event.location ? ` | Location: ${event.location}` : '';
                return `${i + 1}. "${event.summary}" (ID: ${event.id}) at ${timeStr}${loc}`;
              });

              return `Found ${events.length} event(s):\n${eventLines.join('\n')}`;
            } catch (error) {
              logError('Calendar list error:', error);
              return `Error listing calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          }
          
          default:
            return `Unknown calendar action: ${action}`;
        }
      }
      case 'store_self_info': {
        const { storeCharacterFact } = await import('./characterFactsService');
        const { category, key, value } = args as ToolCallArgs['store_self_info'];
        const success = await storeCharacterFact(category as any, key, value);
        return success
          ? `✓ Stored self-fact: ${key} = "${value}"`
          : `Failed to store self-fact (may be a duplicate).`;
      }
      case 'store_character_info': {
        const { recordObservation } = await import('./userPatterns');
        const { observation } = args as ToolCallArgs['store_character_info'];
        const pattern = await recordObservation(observation);
        return pattern
          ? `✓ Stored behavioral observation: "${observation}"`
          : `Failed to store behavioral observation.`;
      }
      case 'resolve_open_loop': {
        const { resolveLoopsByTopic, dismissLoopsByTopic } = await import('./presenceDirector');
        const { topic, resolution_type, reason } = args as ToolCallArgs['resolve_open_loop'];

        logInfo(`🔄 [Memory Tool] resolve_open_loop called:`);
        logInfo(`   Topic: "${topic}"`);
        logInfo(`   Resolution type: ${resolution_type}`);
        logInfo(`   Reason: ${reason || '(none provided)'}`);

        try {
          if (resolution_type === 'dismissed') {
            // Dismiss by topic (user doesn't want to discuss)
            const dismissedCount = await dismissLoopsByTopic(topic);
            if (dismissedCount > 0) {
              logInfo(`✅ [Memory Tool] Dismissed ${dismissedCount} loop(s) for topic: "${topic}"`);
              return `✓ Dismissed ${dismissedCount} open loop(s) about "${topic}"${reason ? ` (${reason})` : ''}`;
            } else {
              logInfo(`⚠️ [Memory Tool] No loops found to dismiss for topic: "${topic}"`);
              return `No open loops found matching "${topic}" to dismiss.`;
            }
          } else {
            // Resolve by topic (user answered/addressed it)
            const resolvedCount = await resolveLoopsByTopic(topic);
            if (resolvedCount > 0) {
              logInfo(`✅ [Memory Tool] Resolved ${resolvedCount} loop(s) for topic: "${topic}"`);
              return `✓ Resolved ${resolvedCount} open loop(s) about "${topic}"${reason ? ` - ${reason}` : ''}`;
            } else {
              logInfo(`⚠️ [Memory Tool] No loops found to resolve for topic: "${topic}"`);
              return `No open loops found matching "${topic}" to resolve.`;
            }
          }
        } catch (error) {
          logError(`❌ [Memory Tool] Error resolving loop:`, error);
          return `Error resolving open loop: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      case 'resolve_idle_question': {
        const { updateIdleQuestionStatus } = await import('./idleThinkingService');
        const { id, status, answer_text } = args as ToolCallArgs['resolve_idle_question'];
        memoryToolLog.info('resolve_idle_question called', { id, status, hasAnswer: !!answer_text });

        const success = await updateIdleQuestionStatus(id, status, answer_text);
        return success
          ? `OK: idle question ${status} (${id})`
          : `Failed to update idle question ${id}.`;
      }
      case 'resolve_idle_browse_note': {
        // Browse note feature is currently disabled (commented out in idleThinkingService)
        return `OK: idle browse note acknowledged (feature inactive).`;
      }
      case 'tool_suggestion': {
        const {
          action,
          id,
          tool_key,
          title,
          reasoning,
          user_value,
          trigger,
          trigger_source,
          trigger_text,
          trigger_reason,
          theme,
          seed_id,
          sample_prompt,
          permissions_needed,
        } = args as ToolCallArgs['tool_suggestion'];
        memoryToolLog.info('tool_suggestion called', { action, id, toolKey: tool_key, triggerSource: trigger_source });

        const { createToolSuggestion, markToolSuggestionShared } = await import('./toolSuggestionService');

        if (action === 'mark_shared') {
          if (!id) {
            memoryToolLog.warning('tool_suggestion missing id for mark_shared');
            return "Missing id for tool_suggestion mark_shared.";
          }

          const success = await markToolSuggestionShared(id);
          return success
            ? `OK: tool suggestion shared (${id})`
            : `Failed to mark tool suggestion shared (${id}).`;
        }

        if (action !== 'create') {
          memoryToolLog.warning('tool_suggestion invalid action', { action });
          return `Unknown tool_suggestion action: ${action}`;
        }

        const missingFields: string[] = [];
        if (!tool_key) missingFields.push("tool_key");
        if (!title) missingFields.push("title");
        if (!reasoning) missingFields.push("reasoning");
        if (!user_value) missingFields.push("user_value");
        if (!trigger) missingFields.push("trigger");
        if (!sample_prompt) missingFields.push("sample_prompt");

        if (missingFields.length > 0) {
          memoryToolLog.warning('tool_suggestion missing required fields', { missingFields });
          return `Missing required fields for tool_suggestion create: ${missingFields.join(", ")}`;
        }

        if (!tool_key || !title || !reasoning || !user_value || !trigger || !sample_prompt) {
          return "Invalid tool_suggestion payload.";
        }

        if (!trigger_text || !trigger_reason) {
          memoryToolLog.warning('tool_suggestion missing live trigger details');
          return "Missing trigger_text or trigger_reason for live tool_suggestion.";
        }

        const permissions =
          Array.isArray(permissions_needed)
            ? permissions_needed.filter((perm) => typeof perm === "string" && perm.trim().length > 0)
            : [];

        const stored = await createToolSuggestion(
          {
            toolKey: tool_key,
            title,
            reasoning,
            userValue: user_value,
            trigger,
            samplePrompt: sample_prompt,
            permissionsNeeded: permissions,
            triggerSource: "live",
            triggerText: trigger_text,
            triggerReason: trigger_reason,
            theme: theme ?? null,
            seedId: seed_id ?? null,
          },
          "shared",
        );

        return stored
          ? `OK: tool suggestion stored (${stored.toolKey})`
          : "Failed to store tool suggestion.";
      }
      case 'make_promise': {
        const { createPromise, resolvePromiseTimingFromTrigger } = await import('./promiseService');
        const { promiseType, description, triggerEvent, fulfillmentData } = args as ToolCallArgs['make_promise'];

        logInfo(`🤝 [Memory Tool] make_promise called:`);
        logInfo(`   Promise Type: ${promiseType}`);
        logInfo(`   Description: "${description}"`);
        logInfo(`   Trigger: "${triggerEvent}"`);

        try {
          // Explicit times ("11:30 AM today") resolve to that clock time.
          // Vague timing ("later/soon") falls back to default delay.
          const timingResolution = resolvePromiseTimingFromTrigger(triggerEvent);
          const estimatedTiming = timingResolution.estimatedTiming;

          const promise = await createPromise(
            promiseType,
            description,
            triggerEvent,
            estimatedTiming,
            context?.userMessage || "User request", // Store the user's original message as context
            fulfillmentData
          );

          if (promise) {
            const timingLabel = timingResolution.isExplicit
              ? `scheduled for ${estimatedTiming.toLocaleString()}`
              : `will fulfill in 10 minutes`;
            logInfo(`✅ [Memory Tool] Promise created successfully (${timingLabel})`);
            return `✓ Promise created: ${description} (${timingLabel})`;
          } else {
            logError(`❌ [Memory Tool] Failed to create promise`);
            return `Failed to create promise. Please try again.`;
          }
        } catch (error) {
          logError(`❌ [Memory Tool] Error creating promise:`, error);
          return `Error creating promise: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      case 'create_life_storyline': {
        const { createStorylineFromTool } = await import('./storylineService');
        const { title, category, storylineType, initialAnnouncement, stakes, userInvolvement, emotionalTone, emotionalIntensity } = args as ToolCallArgs['create_life_storyline'];

        logInfo(`📖 [Memory Tool] create_life_storyline called:`);
        logInfo(`   Title: "${title}"`);
        logInfo(`   Category: ${category}`);
        logInfo(`   Type: ${storylineType}`);

        try {
          const result = await createStorylineFromTool({
            title,
            category,
            storylineType,
            initialAnnouncement,
            stakes,
            userInvolvement,
            emotionalTone,
            emotionalIntensity,
          }, 'conversation');

          if (result.success) {
            logInfo(`✅ [Memory Tool] Storyline created successfully: ${result.storylineId}`);
            return `✓ Storyline "${title}" created successfully`;
          } else {
            logWarn(`⚠️ [Memory Tool] Storyline creation failed: ${result.error}`);
            return `${result.error}`;
          }
        } catch (error) {
          logError(`❌ [Memory Tool] Error creating storyline:`, error);
          return `Error creating storyline: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      case 'create_open_loop': {
        const { createOpenLoop } = await import('./presenceDirector');
        const { loopType, topic, suggestedFollowUp, timeframe, salience, eventDateTime } = args as ToolCallArgs['create_open_loop'];

        logInfo(`🔄 [Memory Tool] create_open_loop called:`);
        logInfo(`   Loop Type: ${loopType}`);
        logInfo(`   Topic: "${topic}"`);
        logInfo(`   Timeframe: ${timeframe}`);
        logInfo(`   Salience: ${salience}`);

        try {
          // Convert timeframe to shouldSurfaceAfter date
          const now = new Date();
          let shouldSurfaceAfter: Date | undefined;

          switch (timeframe) {
            case 'immediate':
              shouldSurfaceAfter = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes
              break;
            case 'today':
              shouldSurfaceAfter = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
              break;
            case 'tomorrow':
              shouldSurfaceAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day
              break;
            case 'this_week':
              shouldSurfaceAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days
              break;
            case 'soon':
              shouldSurfaceAfter = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 3 days
              break;
            case 'later':
              shouldSurfaceAfter = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week
              break;
          }

          // Parse eventDateTime if provided
          let parsedEventDateTime: Date | undefined;
          if (eventDateTime) {
            const parsed = new Date(eventDateTime);
            if (!isNaN(parsed.getTime())) {
              parsedEventDateTime = parsed;
            }
          }

          const loop = await createOpenLoop(
            loopType,
            topic,
            {
              suggestedFollowup: suggestedFollowUp,
              shouldSurfaceAfter,
              salience: salience || 0.5,
              eventDateTime: parsedEventDateTime,
              triggerContext: context?.userMessage?.slice(0, 200),
            }
          );

          if (loop) {
            logInfo(`✅ [Memory Tool] Open loop created: "${topic}" (${loopType})`);
            return `✓ Created follow-up reminder about "${topic}" (${timeframe})`;
          } else {
            logInfo(`⚠️ [Memory Tool] Open loop already exists for topic: "${topic}"`);
            return `Already tracking "${topic}" - no duplicate created`;
          }
        } catch (error) {
          logError(`❌ [Memory Tool] Error creating open loop:`, error);
          return `Error creating reminder: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      case 'recall_character_profile': {
        const { getProfileSection } = await import('../domain/characters/kayleyProfileSections');
        const { section, reason } = args as ToolCallArgs['recall_character_profile'];

        logInfo(`📋 [Memory Tool] recall_character_profile called:`);
        logInfo(`   Section: ${section}`);
        if (reason) logInfo(`   Reason: ${reason}`);

        try {
          const profileContent = getProfileSection(section as any);
          logInfo(`✅ [Memory Tool] Retrieved character profile section: ${section} (${profileContent.length} chars)`);
          return profileContent;
        } catch (error) {
          logError(`❌ [Memory Tool] Error retrieving character profile:`, error);
          return `Error retrieving character profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      case 'resolve_x_tweet': {
        // Defensive guard: this tool is intentionally not declared for Gemini.
        // If it is ever called manually or reintroduced accidentally, keep final
        // tweet posting blocked behind the human approval surfaces.
        const { id, status, rejection_reason } = args as ToolCallArgs['resolve_x_tweet'];
        memoryToolLog.warning('resolve_x_tweet blocked - human approval required', {
          id,
          status,
          rejection_reason: rejection_reason || null,
          conversationScopeId: context?.conversationScopeId ?? null,
        });
        return 'Tweet drafts can only be resolved through the human approval flow: Web uses the Tweet Approval Card, and Telegram/WhatsApp use POST TWEET or REJECT TWEET.';
      }
      case 'post_x_tweet': {
        const { createDraft } = await import('../../server/services/xTwitterServerService');
        const { text, intent, include_selfie, selfie_scene } = args as ToolCallArgs['post_x_tweet'];
        memoryToolLog.info('post_x_tweet called', {
          textLength: text.length,
          intent,
          include_selfie,
          conversationScopeId: context?.conversationScopeId ?? null,
          conversationLogId: context?.conversationLogId ?? null,
        });

        if (!text || text.length === 0) {
          return 'Error: tweet text is required';
        }
        if (text.length > 280) {
          return `Error: tweet text is ${text.length} characters (max 280)`;
        }
        if (include_selfie && !selfie_scene) {
          return 'Error: selfie_scene is required when include_selfie is true';
        }

        // Create draft
        const generationContext = {
          source: 'agent_message',
          conversationScopeId: context?.conversationScopeId ?? null,
          conversationLogId: context?.conversationLogId ?? null,
          createdFrom: 'post_x_tweet',
          include_selfie: !!include_selfie,
          selfie_scene: selfie_scene || null,
        };

        const draft = await createDraft(
          text,
          intent || 'user_collaborated',
          'Draft created from post_x_tweet tool',
          generationContext,
          'pending_approval',
          {
            include_selfie: !!include_selfie,
            selfie_scene: selfie_scene || null,
          },
        );
        if (!draft) {
          return 'Error: failed to create tweet draft';
        }

        return `Draft created - waiting for Steven's approval.`;
      }
      case 'resolve_x_mention': {
        const { getMentionById, updateMentionStatus, postReply } = await import('../../server/services/xTwitterServerService');
        const { id, status, reply_text } = args as ToolCallArgs['resolve_x_mention'];
        logInfo(`🐦 [Memory Tool] resolve_x_mention called:`, { id, status });

        if (status === 'skip') {
          await updateMentionStatus(id, 'skipped');
          return `OK: mention skipped (${id})`;
        }

        if (status === 'approve') {
          // Send the auto-drafted reply
          const mention = await getMentionById(id);
          if (!mention) return `Could not find mention with id ${id}.`;
          if (!mention.replyText) return `No draft reply found for mention ${id}. Use status='reply' with reply_text instead.`;

          try {
            const result = await postReply(mention.replyText, mention.tweetId);
            await updateMentionStatus(id, 'replied', {
              reply_tweet_id: result.tweetId,
              replied_at: new Date().toISOString(),
            });
            return `Reply sent to @${mention.authorUsername}! ${result.tweetUrl}`;
          } catch (err) {
            return `Failed to post reply: ${err instanceof Error ? err.message : 'Unknown error'}`;
          }
        }

        if (status === 'reply') {
          if (!reply_text || reply_text.length === 0) {
            return 'Error: reply_text is required when status is "reply"';
          }
          if (reply_text.length > 280) {
            return `Error: reply_text is ${reply_text.length} characters (max 280)`;
          }

          const mention = await getMentionById(id);
          if (!mention) return `Could not find mention with id ${id}.`;

          try {
            const result = await postReply(reply_text, mention.tweetId);
            await updateMentionStatus(id, 'replied', {
              reply_text: reply_text,
              reply_tweet_id: result.tweetId,
              replied_at: new Date().toISOString(),
            });
            return `Reply sent to @${mention.authorUsername}! ${result.tweetUrl}`;
          } catch (err) {
            return `Failed to post reply: ${err instanceof Error ? err.message : 'Unknown error'}`;
          }
        }

        return `Unknown resolve_x_mention status: ${status}`;
      }
      case 'google_task_action': {
        const taskArgs = args as ToolCallArgs['google_task_action'];
        try {
          const { runGoogleTaskAction } = await import('../../server/services/gogService');
          const result = await runGoogleTaskAction(taskArgs);
          return result.message;
        } catch (err) {
          return formatToolFailure(`google_task_action failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      case 'google_cli': {
        const { command } = args as ToolCallArgs['google_cli'];
        try {
          const { execGeneralCommand } = await import('../../server/services/gogService');
          const output = await execGeneralCommand(command);
          // Truncate if too long to avoid context overflow
          if (output.length > 2000) {
            return output.slice(0, 2000) + '\n... (output truncated)';
          }
          return output || '(No output)';
        } catch (err) {
          return formatToolFailure(`google_cli failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      case 'read_agent_file': {
        const { filename } = args as ToolCallArgs['read_agent_file'];
        const READABLE_FILES = new Set([
          'SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'USER.md', 'TOOLS.md',
          'HEARTBEAT.md', 'AGENTS.md', 'SAFETY.md', 'SECURITY.md',
        ]);
        if (!READABLE_FILES.has(filename)) {
          return formatToolFailure(`File "${filename}" is not in the readable whitelist.`);
        }
        try {
          const fs = await import('fs');
          const path = await import('path');
          const filePath = path.default.resolve(process.cwd(), 'agents/kayley', filename);
          if (!fs.default.existsSync(filePath)) {
            return formatToolFailure(`File "${filename}" does not exist.`);
          }
          const content = fs.default.readFileSync(filePath, 'utf-8');
          return content || '(File is empty)';
        } catch (err) {
          return formatToolFailure(`Failed to read "${filename}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      case 'write_agent_file': {
        const { filename, content } = args as ToolCallArgs['write_agent_file'];
        const WRITABLE_FILES = new Set(['MEMORY.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'USER.md']);
        if (!WRITABLE_FILES.has(filename)) {
          return formatToolFailure(`File "${filename}" is not writable. Writable files: MEMORY.md, HEARTBEAT.md, IDENTITY.md, SOUL.md, USER.md.`);
        }
        try {
          const fs = await import('fs');
          const path = await import('path');
          const filePath = path.default.resolve(process.cwd(), 'agents/kayley', filename);
          fs.default.writeFileSync(filePath, content, 'utf-8');
          return `Successfully wrote ${content.length} characters to ${filename}.`;
        } catch (err) {
          return formatToolFailure(`Failed to write "${filename}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      case 'query_database': {
        const { query, reason } = args as ToolCallArgs['query_database'];
        logInfo(`🔍 [Memory Tool] query_database called. Reason: ${reason}`);

        // Strip trailing semicolon — Supabase RPC rejects it with a syntax error
        const cleanQuery = query.trim().replace(/;+$/, '');
        const normalized = cleanQuery.toUpperCase();
        if (!normalized.startsWith('SELECT')) {
          return 'ERROR: Only SELECT queries are allowed.';
        }
        const blocked = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT'];
        for (const kw of blocked) {
          if (normalized.includes(kw)) {
            return `ERROR: ${kw} operations are not allowed in query_database.`;
          }
        }

        try {
          const { data, error } = await supabase.rpc('kayley_read_query', {
            sql_query: cleanQuery,
            max_rows: 50,
          });
          if (error) {
            logError('[Memory Tool] query_database error:', error);
            return `Query error: ${error.message}`;
          }
          return JSON.stringify(data, null, 2);
        } catch (err) {
          return `Query failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      default:
        return `Unknown tool: ${toolName}. Do NOT attempt to achieve the same goal via a different tool. Tell Steven you cannot do this right now.`;
    }
  } catch (error) {
    logError(`Error executing ${toolName}:`, error);
    return `Error executing ${toolName}. Please try again.`;
  }
};

// ============================================
// CLIENT-SIDE INFO DETECTION (Backup)
// ============================================
// Since AI models don't always call tools reliably,
// this function runs after each user message to detect
// important information and store it automatically.

interface DetectedInfo {
  category: 'identity' | 'preference' | 'relationship' | 'context';
  key: string;
  value: string;
}

// ============================================
// LLM-Based Fact Detection Processing
// ============================================

export interface LLMDetectedFact {
  category: 'identity' | 'preference' | 'relationship' | 'context';
  key: string;
  value: string;
  confidence: number;
}

/**
 * Fact key classification for storage behavior:
 *
 * IMMUTABLE: Once set, should never be overwritten (core identity)
 * MUTABLE: Can be updated when user provides new info (things that change)
 * ADDITIVE: Append to array, don't replace (preferences, lists)
 */
const IMMUTABLE_KEYS = new Set([
  'name',
  'middle_name',
  'last_name',
  'birthday',
  'birth_year',
  'gender'
]);

const ADDITIVE_KEY_PATTERNS = [
  /^favorite_/,      // favorite_lunch_spot, favorite_movie, etc.
  /^likes$/,         // general likes
  /^hobbies$/,       // hobbies list
  /^interests$/,     // interests list
  /^dislikes$/       // dislikes list
];

function isCurrentFactKey(key: string): boolean {
  return key.trim().toLowerCase().startsWith('current_');
}

/**
 * Determines the storage behavior for a fact key.
 */
function getFactStorageType(key: string): 'immutable' | 'mutable' | 'additive' {
  const normalizedKey = key.toLowerCase();

  if (IMMUTABLE_KEYS.has(normalizedKey)) {
    return 'immutable';
  }

  if (ADDITIVE_KEY_PATTERNS.some(pattern => pattern.test(normalizedKey))) {
    return 'additive';
  }

  return 'mutable';
}

/**
 * Parse a fact value that might be a JSON array or a simple string.
 */
function parseFactValue(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // Not JSON, treat as single value
  }
  return [value];
}

/**
 * Format a fact value for display.
 * Converts JSON arrays to comma-separated strings.
 *
 * @example
 * formatFactValueForDisplay('["Chipotle","Panera"]') // "Chipotle, Panera"
 * formatFactValueForDisplay('Chipotle') // "Chipotle"
 */
export function formatFactValueForDisplay(value: string): string {
  const values = parseFactValue(value);
  return values.join(', ');
}

function formatTicketStatus(ticket: {
  id: string;
  requestType: string;
  status: string;
  requestSummary?: string;
  failureReason?: string;
  finalPrUrl?: string;
}): string {
  const summary = ticket.requestSummary ? `Summary: ${ticket.requestSummary}` : '';
  const failure = ticket.failureReason ? `Failure: ${ticket.failureReason}` : '';
  const pr = ticket.finalPrUrl ? `PR: ${ticket.finalPrUrl}` : '';
  const details = [summary, failure, pr].filter(Boolean).join(' | ');

  return `Engineering ticket ${ticket.id} (${ticket.requestType}) is ${ticket.status}.${details ? ` ${details}` : ''}`;
}

/**
 * Process facts detected by the LLM intent service and store them appropriately.
 * This replaces the regex-based detectAndStoreUserInfo with LLM intelligence.
 *
 * Storage behavior by fact type:
 * - IMMUTABLE (name, birthday): Only store if NOT already exists
 * - MUTABLE (location, occupation): Can be updated/overwritten
 * - ADDITIVE (likes, favorite_*): Append to JSON array
 *
 * @param detectedFacts - Facts detected by the LLM from intentService
 * @returns Array of facts that were actually stored/updated
 */
export const processDetectedFacts = async (
  detectedFacts: LLMDetectedFact[]
): Promise<LLMDetectedFact[]> => {
  if (!detectedFacts || detectedFacts.length === 0) {
    return [];
  }

  logInfo(`🔍 [Memory] Processing ${detectedFacts.length} LLM-detected fact(s)`);

  try {
    // Fetch existing facts to check for duplicates and current values
    const existingFacts = await getUserFacts('all');

    // Create a map of existing facts for fast lookup
    const existingFactsMap = new Map(
      existingFacts.map(f => [`${f.category}:${f.fact_key}`, f])
    );

    const storedFacts: LLMDetectedFact[] = [];

    for (const fact of detectedFacts) {
      if (isCurrentFactKey(fact.key)) {
        logInfo(`⏭️ [Memory] Skipping current_* fact (transient): ${fact.category}.${fact.key}`);
        continue;
      }

      const factKey = `${fact.category}:${fact.key}`;
      const existingFact = existingFactsMap.get(factKey);
      const storageType = getFactStorageType(fact.key);

      logInfo(`📋 [Memory] Fact "${fact.key}" is ${storageType}, exists: ${!!existingFact}`);

      if (storageType === 'immutable') {
        // IMMUTABLE: Only store if doesn't exist
        if (existingFact) {
          logInfo(`⏭️ [Memory] Skipping immutable fact (already set): ${fact.category}.${fact.key}`);
          continue;
        }
      } else if (storageType === 'additive') {
        // ADDITIVE: Append to array if value not already present
        if (existingFact) {
          const existingValues = parseFactValue(existingFact.fact_value);
          const newValue = fact.value.trim();

          // Check if this value already exists in the array (case-insensitive)
          if (existingValues.some(v => v.toLowerCase() === newValue.toLowerCase())) {
            logInfo(`⏭️ [Memory] Skipping additive fact (value already in array): ${fact.category}.${fact.key} = "${newValue}"`);
            continue;
          }

          // Append to array
          existingValues.push(newValue);
          fact.value = JSON.stringify(existingValues);
          logInfo(`➕ [Memory] Appending to additive fact: ${fact.category}.${fact.key} = ${fact.value}`);
        }
        // If doesn't exist, store as single value (will become array later if more added)
      }
      // MUTABLE: Always update (fall through to store)

      const success = await storeUserFact(
        fact.category,
        fact.key,
        fact.value,
        undefined,
        fact.confidence
      );

      if (success) {
        storedFacts.push(fact);
        const action = existingFact
          ? (storageType === 'additive' ? 'appended to' : 'updated')
          : 'stored NEW';
        logInfo(`💾 [Memory] ${action} fact: ${fact.category}.${fact.key} = "${fact.value}"`);
      }
    }

    logInfo(`✅ [Memory] Processed ${detectedFacts.length} detected facts, stored/updated ${storedFacts.length} fact(s)`);
    return storedFacts;

  } catch (error) {
    logError('❌ [Memory] Error processing detected facts:', error);
    return [];
  }
};

/**
 * @deprecated Use processDetectedFacts with LLM-detected facts instead.
 * This regex-based function is kept for backwards compatibility but should not be used.
 *
 * Detect important user information from a message and store it.
 * This is a BACKUP to AI tool calling - it runs client-side after each message.
 * 
 * @param message - The user's message text
 * @returns Array of info that was stored
 */
export const detectAndStoreUserInfo = async (
  message: string
): Promise<DetectedInfo[]> => {
  const detected: DetectedInfo[] = [];

  // ============================================
  // NAME DETECTION
  // ============================================
  // Patterns: "I'm [name]", "My name is [name]", "I am [name]", "Call me [name]"
  const namePatterns = [
    /(?:i'm|i am|my name is|call me|this is)\s+([A-Z][a-z]+)(?:\s|!|,|\.|\?|$)/i,
    /^([A-Z][a-z]+)\s+here(?:\s|!|$)/i,  // "Steven here!"
    /(?:name'?s|names)\s+([A-Z][a-z]+)/i,  // "Name's Steven"
    /^([A-Z][a-z]{1,15})[\s!.,?]*$/i  // Single capitalized word as a direct answer (e.g., "Steven")
  ];

  // Expanded false positives to avoid catching common single-word responses
  const falsePositives = [
    // Common articles and determiners
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
    // Greetings and responses
    'hi', 'hey', 'hello', 'sure', 'yes', 'no', 'okay', 'ok', 'well', 'just', 
    'really', 'actually', 'thanks', 'thank', 'cool', 'nice', 'great', 'good',
    'awesome', 'perfect', 'fine', 'yeah', 'yep', 'nope', 'maybe', 'please',
    'sorry', 'sup', 'yo', 'bye', 'goodbye', 'welcome',
    // Question words
    'what', 'how', 'why', 'when', 'where', 'who', 'which', 'whose',
    // Common words
    'done', 'here', 'there', 'now', 'later', 'never', 'always', 'something', 
    'nothing', 'everything', 'anything', 'someone', 'anyone', 'everyone',
    // Action words that might appear in whiteboard context
    'test', 'testing', 'draw', 'write', 'help', 'can', 'could', 'would', 
    'should', 'will', 'name', 'please', 'try', 'again', 'more', 'less',
    // Common verbs
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'get', 'got', 'go', 'goes', 'went', 'come', 'came',
    // Character name - prevent storing the AI's own name as the user's name
    'kayley', 'kayley adams'
  ];

  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Avoid common false positives
      if (!falsePositives.includes(name.toLowerCase()) && name.length > 2 && name.length < 20) {
        detected.push({ category: 'identity', key: 'name', value: name });
        logInfo(`🔍 [Auto-Detect] Found name: ${name}`);
        break; // Only detect one name per message
      }
    }
  }

  // ============================================
  // JOB/OCCUPATION DETECTION
  // ============================================
  // Patterns: "I work as", "I'm a [job]", "My job is", "I work at"
  const jobPatterns = [
    /i(?:'m| am) a[n]?\s+([\w\s]+?)(?:\s+and|\s+at|\s+for|,|\.|\!|$)/i,
    /(?:i work as|my job is|i'm working as)\s+a[n]?\s+([\w\s]+?)(?:,|\.|\!|$)/i,
    /i work (?:at|for)\s+([\w\s]+?)(?:,|\.|\!|$)/i
  ];

  for (const pattern of jobPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const job = match[1].trim();
      // Avoid false positives like "I'm a bit tired"
      const falsePositives = ['bit', 'little', 'lot', 'big', 'huge'];
      if (!falsePositives.some(fp => job.toLowerCase().startsWith(fp)) && job.length > 2 && job.length < 50) {
        detected.push({ category: 'identity', key: 'occupation', value: job });
        logInfo(`🔍 [Auto-Detect] Found occupation: ${job}`);
      }
    }
  }

  // ============================================
  // PREFERENCE DETECTION (likes/loves)
  // ============================================
  // Patterns: "I love [X]", "I really like [X]", "My favorite [X] is [Y]"
  const likePatterns = [
    /i (?:really |absolutely |totally )?(?:love|like|enjoy|adore)\s+([\w\s]+?)(?:,|\.|\!|$)/i,
    /my favorite\s+([\w]+)\s+is\s+([\w\s]+?)(?:,|\.|\!|$)/i
  ];

  for (const pattern of likePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      // For "my favorite X is Y" pattern
      if (match[2]) {
        const topic = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (value.length > 1 && value.length < 50) {
          detected.push({ category: 'preference', key: `favorite_${topic}`, value: value });
          logInfo(`🔍 [Auto-Detect] Found favorite ${topic}: ${value}`);
        }
      } else {
        // For "I love X" pattern
        const thing = match[1].trim();
        if (thing.length > 1 && thing.length < 30) {
          detected.push({ category: 'preference', key: 'likes', value: thing });
          logInfo(`🔍 [Auto-Detect] Found like: ${thing}`);
        }
      }
    }
  }

  // ============================================
  // FAMILY/RELATIONSHIP DETECTION
  // ============================================
  // Patterns: "My wife/husband is", "My kids", "My dog's name is"
  const familyPatterns = [
    /my (wife|husband|spouse|partner)(?:'s name)?\s+is\s+([\w]+)/i,
    /my (son|daughter|child|baby)(?:'s name)?\s+is\s+([\w]+)/i,
    /my (dog|cat|pet)(?:'s name)?\s+is\s+([\w]+)/i,
    /i have (?:a |an )?(wife|husband|partner|boyfriend|girlfriend)/i,
    /i have (\d+) kids?/i,
    /i'm (married|engaged|single|divorced)/i
  ];

  for (const pattern of familyPatterns) {
    const match = message.match(pattern);
    if (match) {
      if (match[2]) {
        // Has a name (wife is Sarah, dog is Max)
        const relationship = match[1].toLowerCase();
        const name = match[2].trim();
        detected.push({ category: 'relationship', key: `${relationship}_name`, value: name });
        logInfo(`🔍 [Auto-Detect] Found ${relationship} name: ${name}`);
      } else if (match[1]) {
        // Just status (I'm married, I have a wife)
        const status = match[1].toLowerCase();
        if (['married', 'engaged', 'single', 'divorced'].includes(status)) {
          detected.push({ category: 'relationship', key: 'relationship_status', value: status });
        } else if (match[1].match(/\d+/)) {
          detected.push({ category: 'relationship', key: 'number_of_kids', value: match[1] });
        } else {
          detected.push({ category: 'relationship', key: 'has_partner', value: 'yes' });
        }
        logInfo(`🔍 [Auto-Detect] Found relationship info: ${status}`);
      }
    }
  }
  // ============================================
  // BIRTHDAY/DATE DETECTION
  // ============================================
  // Patterns: "My birthday is...", "I was born on...", "It is July 1st 1985" (direct answers)
  // Also handles: "July 1st", "July 1, 1985", "7/1/1985", "1st of July"
  const birthdayPatterns = [
    // Explicit statements
    /(?:my birthday is|i was born on|born on|birthday'?s?)\s+(.+?)(?:,|\.|!|\?|$)/i,
    // Direct answer patterns (when AI asked about birthday)
    /^(?:it'?s?|it is|that'?s?|that is)?\s*([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)/i,
    // Date format: "7/1/1985" or "07-01-1985"
    /^(?:it'?s?|it is)?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    // "January 1st, 1985" format
    /^(?:it'?s?|it is)?\s*([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i,
    // "1st of July 1985" format
    /(\d{1,2}(?:st|nd|rd|th)?\s+of\s+[A-Z][a-z]+(?:\s+\d{4})?)/i
  ];

  for (const pattern of birthdayPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const birthdayValue = match[1].trim();
      // Make sure it looks like a date (has month name or numbers)
      const hasMonth = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(birthdayValue);
      const hasNumbers = /\d/.test(birthdayValue);
      
      if ((hasMonth || hasNumbers) && birthdayValue.length > 3 && birthdayValue.length < 30) {
        detected.push({ category: 'identity', key: 'birthday', value: birthdayValue });
        logInfo(`🔍 [Auto-Detect] Found birthday: ${birthdayValue}`);
        break; // Only capture one birthday
      }
    }
  }

  // ============================================
  // AGE DETECTION
  // ============================================
  // Patterns: "I'm 39", "I am 39 years old", "I'm 39 yo"
  const agePatterns = [
    /(?:i'm|i am|im)\s+(\d{1,3})\s*(?:years?\s*old|yo|yrs?)?(?:\s|,|\.|\!|$)/i,
    /(?:my age is|age is)\s+(\d{1,3})/i
  ];

  for (const pattern of agePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const age = parseInt(match[1]);
      // Reasonable age range (1-120)
      if (age > 0 && age <= 120) {
        detected.push({ category: 'identity', key: 'age', value: match[1] });
        logInfo(`🔍 [Auto-Detect] Found age: ${match[1]}`);
        break;
      }
    }
  }

  // ============================================
  // STORE DETECTED INFO
  // ============================================
  for (const info of detected) {
    await storeUserFact(info.category, info.key, info.value);
  }

  if (detected.length > 0) {
    logInfo(`✅ [Auto-Detect] Stored ${detected.length} fact(s) from user message`);
  }

  return detected;
};

// ============================================
// Important Date Facts (for Greeting Prompt)
// ============================================

/**
 * Date-related fact keys that should be queried for greeting context.
 * These are stored in user_facts with various categories but have date-related keys.
 */
const DATE_RELATED_KEYS = [
  'birthday',
  'anniversary',
  'important_date',
  'wedding_anniversary',
  'work_anniversary',
];

/**
 * Date-related categories that may contain date facts.
 * These are categories where the fact_value is a date.
 */
const DATE_RELATED_CATEGORIES = [
  'birthday',
  'anniversary',
  'important_date',
];

export interface ImportantDateFact {
  id: string;
  fact_key: string;
  fact_value: string; // The date string (e.g., "July 1st", "07-01", "2024-07-01")
  category: string;
  created_at: string;
}

/**
 * Get all date-related facts from user_facts for greeting context.
 * Queries both by fact_key (e.g., "birthday") and by category (e.g., "birthday").
 *
 * @returns Array of date-related facts
 */
export const getImportantDateFacts = async (): Promise<ImportantDateFact[]> => {
  try {
    logInfo(`📅 [Memory] Getting important date facts for greeting`);

    // Query for facts with date-related keys OR date-related categories
    const { data, error } = await supabase
      .from(USER_FACTS_TABLE)
      .select('id, fact_key, fact_value, category, created_at')
      .or(
        `fact_key.in.(${DATE_RELATED_KEYS.join(',')}),category.in.(${DATE_RELATED_CATEGORIES.join(',')})`
      )
      .order('created_at', { ascending: false });

    if (error) {
      logError('Failed to get important date facts:', error);
      return [];
    }

    logInfo(`📅 [Memory] Found ${data?.length || 0} date-related facts`);
    return (data as ImportantDateFact[]) || [];

  } catch (error) {
    logError('Error getting important date facts:', error);
    return [];
  }
};

// ============================================
// Export singleton-like object for convenience
// ============================================
export const memoryService = {
  searchMemories,
  getUserFacts,
  getPinnedUserFacts,
  storeUserFact,
  deleteUserFact,
  getRecentContext,
  formatMemoriesForAI,
  formatFactsForAI,
  formatFactValueForDisplay,
  executeMemoryTool,
  detectAndStoreUserInfo, // @deprecated - use processDetectedFacts instead
  processDetectedFacts,
  getImportantDateFacts,
  ensureDailyNotesRowForToday,
  appendDailyNote,
  getAllDailyNotes,
  ensureMonthlyNotesRowForMonth,
  appendMonthlyNote,
  getMonthlyNotesForMonth,
  ensureMilaMilestoneRowForDate,
  appendMilaMilestoneNote,
  getMilaMilestonesForMonth,
  getAllMilaMilestoneNotes,
};

export default memoryService;

