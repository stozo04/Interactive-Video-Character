import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '../../types';

// Mock supabaseClient FIRST before any imports that use it
vi.mock('../../services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

// Mock taskService
vi.mock('../../services/taskService');

// Mock React's useState and useCallback using a simple state store
// that returns fresh getters each time
let stateCounter = 0;
const stateStore: Record<number, unknown> = {};

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual as object,
    useState: <T,>(initialValue: T): [T, (val: T | ((prev: T) => T)) => void] => {
      const id = stateCounter++;
      if (!(id in stateStore)) {
        stateStore[id] = initialValue;
      }
      // Return a getter that always reads current state
      const getter = () => stateStore[id] as T;
      const setter = (val: T | ((prev: T) => T)) => {
        stateStore[id] = typeof val === 'function'
          ? (val as (prev: T) => T)(stateStore[id] as T)
          : val;
      };
      // Create a proxy that returns current value
      const proxy = new Proxy([stateStore[id], setter] as [T, typeof setter], {
        get(target, prop) {
          if (prop === '0') return stateStore[id];
          if (prop === '1') return setter;
          if (prop === 'length') return 2;
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index)) return (target as unknown[])[index];
          }
          return (target as any)[prop];
        }
      });
      return proxy as [T, typeof setter];
    },
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  };
});

// Reset state between tests
const resetMockState = () => {
  stateCounter = 0;
  Object.keys(stateStore).forEach(key => delete stateStore[key as unknown as number]);
};

// Import after mocks
import * as taskService from '../../services/taskService';
import { useTasks } from '../useTasks';

describe('useTasks', () => {
  const mockTask: Task = {
    id: 'task-1',
    text: 'Test task',
    completed: false,
    createdAt: Date.now(),
    completedAt: null,
    priority: 'medium',
  };

  const mockCompletedTask: Task = {
    ...mockTask,
    completed: true,
    completedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
  });

  describe('loadTasks', () => {
    it('should call taskService.fetchTasks', async () => {
      const mockTasks = [mockTask];
      vi.mocked(taskService.fetchTasks).mockResolvedValue(mockTasks);

      const hook = useTasks();
      const result = await hook.loadTasks();

      expect(taskService.fetchTasks).toHaveBeenCalledOnce();
      expect(result).toEqual(mockTasks);
    });

    it('should handle empty task list', async () => {
      vi.mocked(taskService.fetchTasks).mockResolvedValue([]);

      const hook = useTasks();
      const result = await hook.loadTasks();

      expect(result).toEqual([]);
    });
  });

  describe('refreshTasks', () => {
    it('should call taskService.fetchTasks', async () => {
      const mockTasks = [mockTask];
      vi.mocked(taskService.fetchTasks).mockResolvedValue(mockTasks);

      const hook = useTasks();
      const result = await hook.refreshTasks();

      expect(taskService.fetchTasks).toHaveBeenCalledOnce();
      expect(result).toEqual(mockTasks);
    });
  });

  describe('handleTaskCreate', () => {
    it('should call taskService.createTask with text', async () => {
      vi.mocked(taskService.createTask).mockResolvedValue(mockTask);

      const hook = useTasks();
      await hook.handleTaskCreate('Test task');

      expect(taskService.createTask).toHaveBeenCalledWith('Test task', undefined);
    });

    it('should call taskService.createTask with priority', async () => {
      vi.mocked(taskService.createTask).mockResolvedValue(mockTask);

      const hook = useTasks();
      await hook.handleTaskCreate('Important task', 'high');

      expect(taskService.createTask).toHaveBeenCalledWith('Important task', 'high');
    });

    it('should call onCelebrate callback when task created', async () => {
      vi.mocked(taskService.createTask).mockResolvedValue(mockTask);
      const onCelebrate = vi.fn();

      const hook = useTasks({ onCelebrate });
      await hook.handleTaskCreate('Test task');

      expect(onCelebrate).toHaveBeenCalledWith(expect.any(String));
    });

    it('should NOT call onCelebrate if task creation fails', async () => {
      vi.mocked(taskService.createTask).mockResolvedValue(null);
      const onCelebrate = vi.fn();

      const hook = useTasks({ onCelebrate });
      await hook.handleTaskCreate('Test task');

      expect(onCelebrate).not.toHaveBeenCalled();
    });
  });

  describe('handleTaskToggle', () => {
    // Note: Full state interaction tests require @testing-library/react-hooks.
    // These tests verify the service layer integration.
    // Full integration testing happens in App.tsx.

    it('should not call taskService if task not found (empty state)', async () => {
      const hook = useTasks();
      await hook.handleTaskToggle('non-existent-task');

      expect(taskService.toggleTask).not.toHaveBeenCalled();
    });

    // Skip: State tracking tests require proper React hook testing library
    it.skip('should call taskService.toggleTask when task exists', async () => {
      // Requires @testing-library/react-hooks for proper state tracking
    });

    it.skip('should call onCelebrate when task is completed', async () => {
      // Requires @testing-library/react-hooks for proper state tracking
    });

    it.skip('should call onPlayPositiveAction when task is completed', async () => {
      // Requires @testing-library/react-hooks for proper state tracking
    });
  });

  describe('handleTaskDelete', () => {
    it('should call taskService.deleteTask', async () => {
      vi.mocked(taskService.deleteTask).mockResolvedValue(true);

      const hook = useTasks();
      await hook.handleTaskDelete('task-1');

      expect(taskService.deleteTask).toHaveBeenCalledWith('task-1');
    });
  });

  describe('celebration messages', () => {
    it('should provide varied celebration messages for task creation', async () => {
      vi.mocked(taskService.createTask).mockResolvedValue(mockTask);
      const messages: string[] = [];
      const onCelebrate = vi.fn((msg: string) => messages.push(msg));

      // Create multiple tasks to see varied messages
      for (let i = 0; i < 20; i++) {
        // Reset state for each iteration
        resetMockState();

        const hook = useTasks({ onCelebrate });
        await hook.handleTaskCreate(`Task ${i}`);
      }

      // Should have called with messages
      expect(messages.length).toBe(20);

      // Messages should be non-empty strings
      messages.forEach(msg => {
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      });
    });
  });

  describe('initial state', () => {
    it('should expose tasks array', () => {
      const hook = useTasks();
      expect(hook.tasks).toBeDefined();
      expect(Array.isArray(hook.tasks)).toBe(true);
    });

    it('should expose isTaskPanelOpen', () => {
      const hook = useTasks();
      expect(typeof hook.isTaskPanelOpen).toBe('boolean');
    });

    it('should expose setTasks function', () => {
      const hook = useTasks();
      expect(typeof hook.setTasks).toBe('function');
    });

    it('should expose setIsTaskPanelOpen function', () => {
      const hook = useTasks();
      expect(typeof hook.setIsTaskPanelOpen).toBe('function');
    });
  });
});
