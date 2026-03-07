// server/services/googleTasksIndexService.ts
//
// Lightweight local cache for Google Tasks metadata.
// Google remains source-of-truth; this index accelerates title -> (tasklistId, taskId) lookups.

import { supabaseAdmin as supabase } from './supabaseAdmin';
import { log } from '../runtimeLogger';

const runtimeLog = log.fromContext({ source: 'googleTasksIndexService' });
const TABLE = 'google_tasks_index';

export interface IndexedTaskRef {
  tasklistId: string;
  taskId: string;
  title: string;
  ambiguousCount: number;
}

export interface UpsertTaskIndexInput {
  tasklistId: string;
  taskId: string;
  title: string;
  status?: string;
  completedAt?: string | null;
}

interface GoogleTaskIndexRow {
  tasklist_id: string;
  task_id: string;
  title: string;
  title_normalized: string;
  status: string;
  completed_at: string | null;
  last_seen_at: string;
  updated_at: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isMissingTableError(error: unknown): boolean {
  const msg = String((error as any)?.message || '');
  return (
    /Could not find the table/i.test(msg) ||
    /relation .*google_tasks_index.* does not exist/i.test(msg)
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRow(input: UpsertTaskIndexInput): GoogleTaskIndexRow {
  const now = nowIso();
  return {
    tasklist_id: input.tasklistId,
    task_id: input.taskId,
    title: input.title.trim(),
    title_normalized: normalizeTitle(input.title),
    status: input.status || 'needsAction',
    completed_at: input.completedAt ?? null,
    last_seen_at: now,
    updated_at: now,
  };
}

export async function upsertTaskIndex(input: UpsertTaskIndexInput): Promise<void> {
  const row = buildRow(input);
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'tasklist_id,task_id' });

  if (!error) return;
  if (isMissingTableError(error)) return;

  runtimeLog.warning('upsertTaskIndex failed', {
    table: TABLE,
    tasklistId: input.tasklistId,
    taskId: input.taskId,
    error: error.message,
  });
}

export async function upsertTaskIndexBatch(
  tasklistId: string,
  tasks: Array<{ id?: string; title?: string; status?: string; completed?: string | null }>,
): Promise<void> {
  const rows = tasks
    .map((task) => ({
      tasklistId,
      taskId: String(task.id || '').trim(),
      title: String(task.title || '').trim(),
      status: String(task.status || 'needsAction'),
      completedAt: task.completed ?? null,
    }))
    .filter((task) => task.taskId && task.title);

  if (rows.length === 0) return;

  for (const row of rows) {
    await upsertTaskIndex(row);
  }
}

export async function markTaskIndexStatus(
  tasklistId: string,
  taskId: string,
  status: 'needsAction' | 'completed',
): Promise<void> {
  const payload = {
    status,
    completed_at: status === 'completed' ? nowIso() : null,
    updated_at: nowIso(),
    last_seen_at: nowIso(),
  };

  const { error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq('tasklist_id', tasklistId)
    .eq('task_id', taskId);

  if (!error) return;
  if (isMissingTableError(error)) return;

  runtimeLog.warning('markTaskIndexStatus failed', {
    table: TABLE,
    tasklistId,
    taskId,
    status,
    error: error.message,
  });
}

export async function deleteTaskIndex(tasklistId: string, taskId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('tasklist_id', tasklistId)
    .eq('task_id', taskId);

  if (!error) return;
  if (isMissingTableError(error)) return;

  runtimeLog.warning('deleteTaskIndex failed', {
    table: TABLE,
    tasklistId,
    taskId,
    error: error.message,
  });
}

export async function findOpenIndexedTaskByTitle(title: string): Promise<IndexedTaskRef | null> {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select('tasklist_id, task_id, title')
    .eq('title_normalized', normalized)
    .neq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    if (isMissingTableError(error)) return null;
    runtimeLog.warning('findOpenIndexedTaskByTitle failed', {
      table: TABLE,
      title,
      error: error.message,
    });
    return null;
  }

  if (!data || data.length === 0) return null;

  const [first] = data;
  return {
    tasklistId: String((first as any).tasklist_id || ''),
    taskId: String((first as any).task_id || ''),
    title: String((first as any).title || title),
    ambiguousCount: data.length,
  };
}
