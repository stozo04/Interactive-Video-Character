/**
 * Tests for the task mutation signal in memoryService.
 *
 * WHY THIS FILE EXISTS:
 * task_action runs as a Gemini function tool, meaning it writes to the DB
 * inside geminiChatService's tool loop — completely bypassing React state.
 * The only way the UI knows to refresh is via consumeTaskMutationSignal().
 * These tests verify that the signal is set correctly for each mutating action
 * and resets cleanly after being consumed. If these tests fail, the Daily
 * Checklist will go back to requiring a page refresh after Kayley creates a task.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before any import that triggers memoryService module load) ---

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../clientLogger', () => {
  const noop = () => {};
  const scoped = () => ({ info: noop, error: noop, warn: noop, debug: noop });
  return { clientLogger: { info: noop, error: noop, warn: noop, debug: noop, scoped } };
});

const mockTask = {
  id: 'task-1',
  text: 'Buy groceries',
  completed: false,
  priority: 'low' as const,
  createdAt: Date.now(),
  completedAt: null,
  scheduledDate: '2026-03-04',
  category: undefined,
};

vi.mock('../taskService', () => ({
  fetchTasks: vi.fn().mockResolvedValue([mockTask]),
  createTask: vi.fn().mockResolvedValue(mockTask),
  toggleTask: vi.fn().mockResolvedValue({ ...mockTask, completed: true }),
  deleteTask: vi.fn().mockResolvedValue(true),
}));

// --- Import after mocks ---
import { executeMemoryTool, consumeTaskMutationSignal } from '../memoryService';

// ============================================================================

describe('consumeTaskMutationSignal', () => {
  beforeEach(() => {
    // Drain any signal left over from previous test
    consumeTaskMutationSignal();
  });

  it('returns false when no task action has run', () => {
    expect(consumeTaskMutationSignal()).toBe(false);
  });

  it('returns false again on repeated calls with no mutation', () => {
    consumeTaskMutationSignal();
    expect(consumeTaskMutationSignal()).toBe(false);
  });
});

describe('task_action function tool — signal behaviour', () => {
  beforeEach(() => {
    consumeTaskMutationSignal(); // reset between tests
    vi.clearAllMocks();
  });

  // -- create --

  it('sets the signal after a successful create', async () => {
    await executeMemoryTool('task_action', { action: 'create', task_text: 'Buy groceries' });
    expect(consumeTaskMutationSignal()).toBe(true);
  });

  it('resets the signal to false after it is consumed', async () => {
    await executeMemoryTool('task_action', { action: 'create', task_text: 'Buy groceries' });
    consumeTaskMutationSignal(); // consume
    expect(consumeTaskMutationSignal()).toBe(false); // gone
  });

  it('does NOT set the signal when create is called without task_text', async () => {
    await executeMemoryTool('task_action', { action: 'create' });
    expect(consumeTaskMutationSignal()).toBe(false);
  });

  // -- complete --

  it('sets the signal after completing a matching task', async () => {
    await executeMemoryTool('task_action', { action: 'complete', task_text: 'groceries' });
    expect(consumeTaskMutationSignal()).toBe(true);
  });

  it('does NOT set the signal when no task matches for complete', async () => {
    const { fetchTasks } = await import('../taskService');
    vi.mocked(fetchTasks).mockResolvedValueOnce([]);

    await executeMemoryTool('task_action', { action: 'complete', task_text: 'nonexistent' });
    expect(consumeTaskMutationSignal()).toBe(false);
  });

  // -- delete --

  it('sets the signal after deleting a matching task', async () => {
    await executeMemoryTool('task_action', { action: 'delete', task_text: 'groceries' });
    expect(consumeTaskMutationSignal()).toBe(true);
  });

  it('does NOT set the signal when no task matches for delete', async () => {
    const { fetchTasks } = await import('../taskService');
    vi.mocked(fetchTasks).mockResolvedValueOnce([]);

    await executeMemoryTool('task_action', { action: 'delete', task_text: 'nonexistent' });
    expect(consumeTaskMutationSignal()).toBe(false);
  });

  // -- list (read-only — must NOT set the signal) --

  it('does NOT set the signal for a list action', async () => {
    await executeMemoryTool('task_action', { action: 'list' });
    expect(consumeTaskMutationSignal()).toBe(false);
  });
});
