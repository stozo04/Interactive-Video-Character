import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processTaskAction,
  parseTaskActionFromResponse,
  detectTaskCompletionFallback,
  TaskActionResult,
} from '../taskActions';
import type { Task } from '../../../types';

// Mock taskService
vi.mock('../../../services/taskService', () => ({
  findTaskByText: vi.fn().mockImplementation(async (text: string) => {
    if (text === 'Buy groceries') {
      return { id: 'task-1', text: 'Buy groceries', completed: false };
    }
    return null;
  }),
}));

// const createMockTask = (overrides: Partial<Task> = {}): Task => ({
//   id: 'task-1',
//   text: 'Test Task',
//   completed: false,
//   priority: 'medium',
//   createdAt: Date.now(),
//   ...overrides,
// });

describe('taskActions', () => {
  const mockHandlers = {
    handleTaskCreate: vi.fn().mockResolvedValue(undefined),
    handleTaskToggle: vi.fn().mockResolvedValue(undefined),
    handleTaskDelete: vi.fn().mockResolvedValue(undefined),
    setIsTaskPanelOpen: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processTaskAction', () => {
    describe('create action', () => {
      it('should create task with text', async () => {
        const taskAction = {
          action: 'create' as const,
          task_text: 'Buy groceries',
          priority: 'high' as const,
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('create');
        expect(mockHandlers.handleTaskCreate).toHaveBeenCalledWith('Buy groceries', 'high');
      });

      it('should not create task without text', async () => {
        const taskAction = {
          action: 'create' as const,
          // missing task_text
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(false);
        expect(mockHandlers.handleTaskCreate).not.toHaveBeenCalled();
      });
    });

    describe('complete action', () => {
      it('should complete task by text match', async () => {
        const taskAction = {
          action: 'complete' as const,
          task_text: 'Buy groceries',
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('complete');
        expect(mockHandlers.handleTaskToggle).toHaveBeenCalledWith('task-1');
      });

      it('should complete task by ID', async () => {
        const taskAction = {
          action: 'complete' as const,
          task_id: 'task-123',
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(mockHandlers.handleTaskToggle).toHaveBeenCalledWith('task-123');
      });

      it('should not complete if task not found', async () => {
        const taskAction = {
          action: 'complete' as const,
          task_text: 'Non-existent task',
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(false);
        expect(mockHandlers.handleTaskToggle).not.toHaveBeenCalled();
      });
    });

    describe('delete action', () => {
      it('should delete task by text match', async () => {
        const taskAction = {
          action: 'delete' as const,
          task_text: 'Buy groceries',
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('delete');
        expect(mockHandlers.handleTaskDelete).toHaveBeenCalledWith('task-1');
      });

      it('should delete task by ID', async () => {
        const taskAction = {
          action: 'delete' as const,
          task_id: 'task-456',
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(mockHandlers.handleTaskDelete).toHaveBeenCalledWith('task-456');
      });
    });

    describe('list action', () => {
      it('should open task panel', async () => {
        const taskAction = {
          action: 'list' as const,
        };

        const result = await processTaskAction(taskAction, [], mockHandlers);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('list');
        expect(mockHandlers.setIsTaskPanelOpen).toHaveBeenCalledWith(true);
      });
    });

    it('should return not handled for null action', async () => {
      const result = await processTaskAction(null, [], mockHandlers);

      expect(result.handled).toBe(false);
    });
  });

  describe('parseTaskActionFromResponse', () => {
    it('should parse embedded JSON task_action from response', () => {
      const response = `{"task_action":{"action":"create","task_text":"Buy milk"}}`;

      const result = parseTaskActionFromResponse(response);

      expect(result).not.toBeNull();
      expect(result?.action).toBe('create');
      expect(result?.task_text).toBe('Buy milk');
    });

    it('should return null for regular text response', () => {
      const response = 'Sure, I can help you with that task!';

      const result = parseTaskActionFromResponse(response);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const response = '{invalid json with task_action}';

      const result = parseTaskActionFromResponse(response);

      expect(result).toBeNull();
    });
  });

  // describe('detectTaskCompletionFallback', () => {
  //   const tasks = [
  //     createMockTask({ id: 'task-1', text: 'Buy groceries', completed: false }),
  //     createMockTask({ id: 'task-2', text: 'Call mom', completed: false }),
  //     createMockTask({ id: 'task-3', text: 'Exercise', completed: true }),
  //   ];

  //   it('should detect task completion from message', () => {
  //     const message = 'I finished the buy groceries task';

  //     const result = detectTaskCompletionFallback(message, tasks);

  //     expect(result).not.toBeNull();
  //     expect(result?.action).toBe('complete');
  //     expect(result?.task_text).toBe('Buy groceries');
  //   });

  //   it('should detect with "done" keyword', () => {
  //     const message = "the call mom task is done";

  //     const result = detectTaskCompletionFallback(message, tasks);

  //     expect(result).not.toBeNull();
  //     expect(result?.task_text).toBe('Call mom');
  //   });

  //   it('should not match already completed tasks', () => {
  //     const message = 'I completed the exercise task';

  //     const result = detectTaskCompletionFallback(message, tasks);

  //     // Exercise is already completed, should not match
  //     expect(result).toBeNull();
  //   });

  //   it('should return null if no completion keywords', () => {
  //     const message = 'What tasks do I have?';

  //     const result = detectTaskCompletionFallback(message, tasks);

  //     expect(result).toBeNull();
  //   });

  //   it('should return null if no task mentioned', () => {
  //     const message = 'I finished everything today!';

  //     const result = detectTaskCompletionFallback(message, tasks);

  //     // Has completion keyword but no specific task match
  //     expect(result).toBeNull();
  //   });
  // });
});
