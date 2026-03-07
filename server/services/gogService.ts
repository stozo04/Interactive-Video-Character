// server/services/gogService.ts
//
// Facade around gogcli with separated concerns:
// - Gmail operations live in gogGmailService.ts
// - Calendar operations live in gogCalendarService.ts
// - This file owns Google Tasks helpers + generic google_cli execution.

import { log } from '../runtimeLogger';
import {
  deleteTaskIndex,
  findOpenIndexedTaskByTitle,
  markTaskIndexStatus,
  upsertTaskIndex,
  upsertTaskIndexBatch,
} from './googleTasksIndexService';
import {
  DEFAULT_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  GogError,
  execGogJson,
  execGogRaw,
} from './gogCore';

export * from './gogGmailService';
export * from './gogCalendarService';
export { GogError } from './gogCore';

const runtimeLog = log.fromContext({ source: 'gogService', route: 'server/gog' });

// ============================================================================
// General CLI (for google_cli tool)
// ============================================================================

// Top-level commands allowed for the google_cli tool
const ALLOWED_COMMANDS = new Set([
  'gmail', 'calendar', 'contacts', 'drive', 'tasks', 'time',
]);

// Per-service write permissions. Services not listed here are read-only.
// Maps service -> set of allowed write subcommands.
const ALLOWED_WRITE_SUBCOMMANDS: Record<string, Set<string>> = {
  gmail: new Set(['send', 'modify', 'batch']),               // send + archive (modify/batch for label changes). No delete.
  calendar: new Set(['create', 'update', 'delete']),         // full CRUD
  tasks: new Set(['create', 'add', 'update', 'done', 'undo', 'delete', 'clear']), // full CRUD
  contacts: new Set(['create', 'update']),                   // CRU - no delete
  drive: new Set(['create', 'upload', 'update', 'mkdir']),   // CRU - no delete
};

// Subcommands that are ALWAYS blocked regardless of service
const ALWAYS_BLOCKED = new Set([
  'vacation', 'delegates', 'filters',  // gmail admin settings
]);

/**
 * Split a CLI command string into argv-like parts while preserving quoted values.
 * Supports single quotes, double quotes, and basic escaping inside quoted strings.
 */
function splitCommandArgs(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of command.trim()) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaped) {
    current += '\\';
  }

  if (quote) {
    throw new GogError(`Unterminated quote in command: ${command}`, 1, '');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function stripForcedJsonFlags(parts: string[]): string[] {
  return parts.filter((part) => part !== '--json');
}

async function resolveDefaultTaskListId(): Promise<string | null> {
  try {
    const raw = await execGogJson<any>(['tasks', 'lists', 'list'], DEFAULT_TIMEOUT_MS, 'gogService');
    const lists = parseTaskLists(raw);

    if (!Array.isArray(lists) || lists.length === 0) {
      return null;
    }

    const preferred = lists.find((item) => item?.isDefault || item?.default);
    const chosen = preferred || lists[0];
    return String(chosen?.id || '').trim() || null;
  } catch {
    return null;
  }
}

interface GogTaskListLike {
  id?: string;
  isDefault?: boolean;
  default?: boolean;
}

interface GogTaskLike {
  id?: string;
  title?: string;
  status?: string;
  completed?: string | null;
}

interface ResolvedTaskRef {
  tasklistId: string;
  taskId: string;
}

function parseTaskLists(raw: any): GogTaskListLike[] {
  if (Array.isArray(raw)) {
    return raw as GogTaskListLike[];
  }
  return (raw?.tasklists || raw?.items || raw?.lists || []) as GogTaskListLike[];
}

function parseTasks(raw: any): GogTaskLike[] {
  if (Array.isArray(raw)) {
    return raw as GogTaskLike[];
  }
  return (raw?.tasks || raw?.items || []) as GogTaskLike[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickTaskByTitle(tasks: GogTaskLike[], wantedTitle: string): GogTaskLike | null {
  const wanted = normalizeText(wantedTitle);
  if (!wanted) return null;

  const candidates = tasks.filter((task) => {
    const status = String(task.status || '').toLowerCase();
    return status !== 'completed';
  });

  const exact = candidates.find((task) => normalizeText(String(task.title || '')) === wanted);
  if (exact) return exact;

  const contains = candidates.find((task) => normalizeText(String(task.title || '')).includes(wanted));
  if (contains) return contains;

  const reverseContains = candidates.find((task) => wanted.includes(normalizeText(String(task.title || ''))));
  return reverseContains || null;
}

async function resolveTaskRefByTitle(taskTitle: string): Promise<ResolvedTaskRef | null> {
  const cached = await findOpenIndexedTaskByTitle(taskTitle);
  if (cached) {
    if (cached.ambiguousCount > 1) {
      throw new GogError(
        `Found multiple active Google Tasks named "${taskTitle}". Please be more specific.`,
        1,
        '',
      );
    }
    return {
      tasklistId: cached.tasklistId,
      taskId: cached.taskId,
    };
  }

  const rawLists = await execGogJson<any>(['tasks', 'lists', 'list'], DEFAULT_TIMEOUT_MS, 'gogService');
  const lists = parseTaskLists(rawLists);

  for (const list of lists) {
    const tasklistId = String(list.id || '').trim();
    if (!tasklistId) continue;

    const rawTasks = await execGogJson<any>(['tasks', 'list', tasklistId], DEFAULT_TIMEOUT_MS, 'gogService');
    const tasks = parseTasks(rawTasks);
    await upsertTaskIndexBatch(tasklistId, tasks);
    const match = pickTaskByTitle(tasks, taskTitle);
    if (!match) continue;

    const taskId = String(match.id || '').trim();
    if (!taskId) continue;

    await upsertTaskIndex({
      tasklistId,
      taskId,
      title: String(match.title || taskTitle),
      status: String(match.status || 'needsAction'),
      completedAt: match.completed ?? null,
    });

    return { tasklistId, taskId };
  }

  return null;
}

type CommandNormalizer = (parts: string[]) => Promise<string[]>;

async function normalizeTasksListCommand(parts: string[]): Promise<string[]> {
  // Back-compat for old prompt examples: "tasks list" meant list task-lists.
  if (parts.length === 2 && parts[1] === 'list') {
    return ['tasks', 'lists', 'list'];
  }
  return parts;
}

async function normalizeTasksAddCommand(parts: string[]): Promise<string[]> {
  if (parts[1] !== 'add') {
    return parts;
  }

  if (parts.includes('--title')) {
    return parts;
  }

  // Compat for positional title style:
  //   tasks add <tasklistId> "Buy groceries"
  if (parts.length >= 4) {
    const tasklistId = parts[2];
    const title = parts.slice(3).join(' ').trim();
    if (tasklistId && title) {
      return ['tasks', 'add', tasklistId, '--title', title];
    }
  }

  // Friendly shorthand:
  //   tasks add "Buy groceries"
  if (parts.length >= 3) {
    const title = parts.slice(2).join(' ').trim();
    if (!title) {
      return parts;
    }

    const defaultTaskListId = await resolveDefaultTaskListId();
    if (!defaultTaskListId) {
      throw new GogError(
        'Could not resolve a Google Task list. Run "tasks lists list" first and pass a tasklistId.',
        1,
        '',
      );
    }

    return ['tasks', 'add', defaultTaskListId, '--title', title];
  }

  return parts;
}

async function normalizeTasksCommand(parts: string[]): Promise<string[]> {
  const taskNormalizers: CommandNormalizer[] = [
    normalizeTasksListCommand,
    normalizeTasksAddCommand,
  ];

  let normalized = parts;
  for (const normalize of taskNormalizers) {
    normalized = await normalize(normalized);
  }
  return normalized;
}

async function normalizeGeneralCommand(parts: string[]): Promise<string[]> {
  const generalNormalizers: CommandNormalizer[] = [
    async (value) => stripForcedJsonFlags(value),
  ];
  const serviceNormalizers: Record<string, CommandNormalizer[]> = {
    tasks: [normalizeTasksCommand],
  };

  let normalized = parts;
  for (const normalize of generalNormalizers) {
    normalized = await normalize(normalized);
  }
  if (normalized.length === 0) {
    return normalized;
  }

  const service = normalized[0];
  const pipeline = serviceNormalizers[service] || [];
  for (const normalize of pipeline) {
    normalized = await normalize(normalized);
  }

  return normalized;
}

function tryParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTaskFromCommandResult(raw: any): GogTaskLike | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidates: any[] = [
    raw,
    raw.task,
    raw.item,
    raw.data,
    Array.isArray(raw.tasks) ? raw.tasks[0] : null,
    Array.isArray(raw.items) ? raw.items[0] : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const taskId = String(candidate?.id || candidate?.taskId || '').trim();
    const title = String(candidate?.title || '').trim();
    if (!taskId || !title) continue;
    return {
      id: taskId,
      title,
      status: String(candidate?.status || 'needsAction'),
      completed: candidate?.completed ?? null,
    };
  }

  return null;
}

export interface GoogleTaskActionInput {
  action: 'create' | 'complete' | 'delete' | 'list' | 'reopen';
  title?: string;
  taskId?: string;
  tasklistId?: string;
  includeCompleted?: boolean;
  max?: number;
}

export interface GoogleTaskActionResult {
  ok: boolean;
  message: string;
  tasks?: Array<{ tasklistId: string; taskId: string; title: string; status: string }>;
}

async function resolveTaskRef(
  input: Pick<GoogleTaskActionInput, 'title' | 'taskId' | 'tasklistId'>,
): Promise<ResolvedTaskRef | null> {
  const taskId = String(input.taskId || '').trim();
  const tasklistId = String(input.tasklistId || '').trim();
  if (taskId && tasklistId) {
    return { taskId, tasklistId };
  }

  const title = String(input.title || '').trim();
  if (!title) {
    return null;
  }
  return resolveTaskRefByTitle(title);
}

export async function runGoogleTaskAction(
  input: GoogleTaskActionInput,
): Promise<GoogleTaskActionResult> {
  const action = input.action;

  if (action === 'create') {
    const title = String(input.title || '').trim();
    if (!title) {
      throw new GogError('google_task_action(create) requires a title.', 1, '');
    }

    const tasklistId = String(input.tasklistId || '').trim() || await resolveDefaultTaskListId();
    if (!tasklistId) {
      throw new GogError(
        'Could not resolve a Google Task list. Provide tasklistId or create a list first.',
        1,
        '',
      );
    }

    const raw = await execGogJson<any>(
      ['tasks', 'add', tasklistId, '--title', title],
      WRITE_TIMEOUT_MS,
      'gogService',
    );
    const created = extractTaskFromCommandResult(raw);
    if (created?.id && created?.title) {
      await upsertTaskIndex({
        tasklistId,
        taskId: created.id,
        title: created.title,
        status: created.status || 'needsAction',
        completedAt: created.completed ?? null,
      });
    }

    return {
      ok: true,
      message: `Created Google Task: "${created?.title || title}".`,
    };
  }

  if (action === 'complete' || action === 'reopen' || action === 'delete') {
    const resolved = await resolveTaskRef(input);
    if (!resolved) {
      throw new GogError(
        `Could not find a Google Task to ${action}. Provide tasklistId+taskId or an existing title.`,
        1,
        '',
      );
    }

    const verb = action === 'complete' ? 'done' : action === 'reopen' ? 'undo' : 'delete';
    await execGogRaw(['tasks', verb, resolved.tasklistId, resolved.taskId], WRITE_TIMEOUT_MS, 'gogService');

    if (action === 'complete') {
      await markTaskIndexStatus(resolved.tasklistId, resolved.taskId, 'completed');
    } else if (action === 'reopen') {
      await markTaskIndexStatus(resolved.tasklistId, resolved.taskId, 'needsAction');
    } else {
      await deleteTaskIndex(resolved.tasklistId, resolved.taskId);
    }

    return {
      ok: true,
      message:
        action === 'complete'
          ? 'Marked Google Task complete.'
          : action === 'reopen'
            ? 'Reopened Google Task.'
            : 'Deleted Google Task.',
    };
  }

  // list
  const includeCompleted = input.includeCompleted ?? false;
  const max = Math.min(Math.max(input.max || 25, 1), 100);
  const resultTasks: Array<{ tasklistId: string; taskId: string; title: string; status: string }> = [];

  const explicitTasklistId = String(input.tasklistId || '').trim();
  if (explicitTasklistId) {
    const raw = await execGogJson<any>(['tasks', 'list', explicitTasklistId], DEFAULT_TIMEOUT_MS, 'gogService');
    const tasks = parseTasks(raw);
    await upsertTaskIndexBatch(explicitTasklistId, tasks);
    for (const task of tasks) {
      const status = String(task.status || 'needsAction');
      if (!includeCompleted && status === 'completed') continue;
      const taskId = String(task.id || '').trim();
      const title = String(task.title || '').trim();
      if (!taskId || !title) continue;
      resultTasks.push({ tasklistId: explicitTasklistId, taskId, title, status });
      if (resultTasks.length >= max) break;
    }
  } else {
    const rawLists = await execGogJson<any>(['tasks', 'lists', 'list'], DEFAULT_TIMEOUT_MS, 'gogService');
    const lists = parseTaskLists(rawLists);
    for (const list of lists) {
      const tasklistId = String(list.id || '').trim();
      if (!tasklistId) continue;
      const raw = await execGogJson<any>(['tasks', 'list', tasklistId], DEFAULT_TIMEOUT_MS, 'gogService');
      const tasks = parseTasks(raw);
      await upsertTaskIndexBatch(tasklistId, tasks);
      for (const task of tasks) {
        const status = String(task.status || 'needsAction');
        if (!includeCompleted && status === 'completed') continue;
        const taskId = String(task.id || '').trim();
        const title = String(task.title || '').trim();
        if (!taskId || !title) continue;
        resultTasks.push({ tasklistId, taskId, title, status });
        if (resultTasks.length >= max) break;
      }
      if (resultTasks.length >= max) break;
    }
  }

  if (resultTasks.length === 0) {
    return {
      ok: true,
      message: includeCompleted ? 'No Google Tasks found.' : 'No open Google Tasks found.',
      tasks: [],
    };
  }

  const lines = resultTasks
    .slice(0, max)
    .map((task, idx) => `${idx + 1}. [${task.status === 'completed' ? 'x' : ' '}] ${task.title}`)
    .join('\n');

  return {
    ok: true,
    message: `Google Tasks:\n${lines}`,
    tasks: resultTasks.slice(0, max),
  };
}

async function syncTasksIndexFromCommand(parts: string[], stdout: string): Promise<void> {
  if (parts[0] !== 'tasks') return;
  const verb = parts[1];

  // tasks list <tasklistId>
  if (verb === 'list' && parts.length >= 3) {
    const tasklistId = parts[2];
    if (!tasklistId || tasklistId === 'list') return;
    const parsed = tryParseJson(stdout);
    if (!parsed) return;
    const tasks = parseTasks(parsed);
    await upsertTaskIndexBatch(tasklistId, tasks);
    return;
  }

  // tasks add <tasklistId> --title "..."
  if ((verb === 'add' || verb === 'create') && parts.length >= 3) {
    const tasklistId = parts[2];
    if (!tasklistId) return;
    const parsed = tryParseJson(stdout);
    const task = extractTaskFromCommandResult(parsed);
    if (!task?.id || !task.title) return;
    await upsertTaskIndex({
      tasklistId,
      taskId: task.id,
      title: task.title,
      status: task.status || 'needsAction',
      completedAt: task.completed ?? null,
    });
    return;
  }

  // tasks done|undo|delete <tasklistId> <taskId>
  if (parts.length >= 4 && (verb === 'done' || verb === 'undo' || verb === 'delete')) {
    const tasklistId = parts[2];
    const taskId = parts[3];
    if (!tasklistId || !taskId) return;

    if (verb === 'done') {
      await markTaskIndexStatus(tasklistId, taskId, 'completed');
      return;
    }
    if (verb === 'undo') {
      await markTaskIndexStatus(tasklistId, taskId, 'needsAction');
      return;
    }
    if (verb === 'delete') {
      await deleteTaskIndex(tasklistId, taskId);
    }
  }
}

/**
 * Execute a general gog command for the google_cli tool.
 * Write operations are allowed per-service according to ALLOWED_WRITE_SUBCOMMANDS.
 */
export async function execGeneralCommand(command: string): Promise<string> {
  const rawParts = splitCommandArgs(command);
  const parts = await normalizeGeneralCommand(rawParts);
  const topLevel = parts[0];

  if (!topLevel || !ALLOWED_COMMANDS.has(topLevel)) {
    throw new GogError(
      `Command "${topLevel}" is not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
      1, '',
    );
  }

  // Check for always-blocked subcommands
  const hasAlwaysBlocked = parts.some((p) => ALWAYS_BLOCKED.has(p));
  if (hasAlwaysBlocked) {
    throw new GogError(
      `Blocked subcommand in "${command}". Admin settings cannot be changed via this tool.`,
      1, '',
    );
  }

  // Check write subcommands against per-service allowlist
  const serviceWriteAllowed = ALLOWED_WRITE_SUBCOMMANDS[topLevel] || new Set();
  const writeSubcommands = new Set(['send', 'delete', 'create', 'update', 'modify', 'batch', 'remove', 'add', 'done', 'undo', 'clear', 'upload', 'mkdir']);

  for (const part of parts.slice(1)) {
    if (writeSubcommands.has(part) && !serviceWriteAllowed.has(part)) {
      throw new GogError(
        `Write operation "${part}" is not allowed for ${topLevel}. Allowed writes: ${serviceWriteAllowed.size > 0 ? [...serviceWriteAllowed].join(', ') : 'none (read-only)'}`,
        1, '',
      );
    }
  }

  // Determine timeout - use write timeout if any write subcommand is present
  const isWrite = parts.some((p) => serviceWriteAllowed.has(p));
  const timeout = isWrite ? WRITE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  runtimeLog.info('execGeneralCommand', {
    source: 'gogService',
    command,
    normalizedCommand: parts.join(' '),
    isWrite,
  });

  try {
    const result = await execGogRaw(parts, timeout, 'gogService');
    try {
      await syncTasksIndexFromCommand(parts, result.stdout);
    } catch (syncErr) {
      runtimeLog.warning('syncTasksIndexFromCommand failed (non-fatal)', {
        source: 'gogService',
        normalizedCommand: parts.join(' '),
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }
    return result.stdout;
  } catch (err) {
    if (
      err instanceof GogError &&
      topLevel === 'tasks' &&
      /accessNotConfigured/i.test(err.stderr || '')
    ) {
      throw new GogError(
        'Google Tasks API is disabled for your gog project. Enable "Google Tasks API" in Google Cloud Console for that OAuth client/project.',
        err.exitCode,
        err.stderr,
      );
    }
    throw err;
  }
}
