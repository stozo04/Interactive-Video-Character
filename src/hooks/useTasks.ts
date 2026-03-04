/**
 * useTasks Hook
 *
 * Manages task state and CRUD operations with celebration callbacks.
 * Extracted from App.tsx as part of Phase 2 refactoring.
 *
 * @see src/hooks/useTasks.README.md for usage documentation
 */

import { useState, useCallback, Dispatch, SetStateAction } from 'react';
import { Task } from '../types';
import * as taskService from '../services/taskService';

/**
 * Celebration messages for task creation
 */
const CREATE_CELEBRATIONS = [
  "Got it! Added to your list",
  "Done! I'll help you remember that.",
  "Added! One step at a time",
  "On the list! You've got this."
];

/**
 * Celebration messages for task completion
 */
const COMPLETE_CELEBRATIONS = [
  "Nice! That's one thing off your plate",
  "You crushed it! One down!",
  "Look at you go!",
  "Done and done! Great work",
  "Boom! Another one bites the dust!"
];

/**
 * Options for the useTasks hook
 */
export interface UseTasksOptions {
  /**
   * Called when a celebration message should be displayed/spoken.
   * Use this to add to chat history and generate speech.
   */
  onCelebrate?: (message: string) => void;

  /**
   * Called when a positive action should be played (e.g., on task completion).
   * Use this to trigger a happy/excited character action.
   */
  onPlayPositiveAction?: () => void;
}

/**
 * Return type for the useTasks hook
 */
export interface UseTasksResult {
  /** Current list of tasks */
  tasks: Task[];

  /** Direct setter for tasks (for external updates like AI tool calls) */
  setTasks: Dispatch<SetStateAction<Task[]>>;

  /** Whether the task panel is open */
  isTaskPanelOpen: boolean;

  /** Setter for task panel open state */
  setIsTaskPanelOpen: Dispatch<SetStateAction<boolean>>;

  /** Load tasks from the database */
  loadTasks: () => Promise<Task[]>;

  /** Refresh tasks from the database (alias for loadTasks) */
  refreshTasks: () => Promise<Task[]>;

  /** Create a new task */
  handleTaskCreate: (text: string, priority?: 'low' | 'medium' | 'high') => Promise<void>;

  /** Toggle task completion status */
  handleTaskToggle: (taskId: string) => Promise<void>;

  /** Delete a task */
  handleTaskDelete: (taskId: string) => Promise<void>;
}

/**
 * Hook for managing task state and operations.
 *
 * @example
 * ```typescript
 * const {
 *   tasks,
 *   isTaskPanelOpen,
 *   setIsTaskPanelOpen,
 *   handleTaskCreate,
 *   handleTaskToggle,
 *   handleTaskDelete,
 *   loadTasks,
 * } = useTasks({
 *   onCelebrate: (message) => {
 *     setChatHistory(prev => [...prev, { role: 'model', text: message }]);
 *     generateSpeech(message).then(audio => enqueueAudio(audio));
 *   },
 *   onPlayPositiveAction: () => {
 *     const happy = character.actions.find(a => a.name.includes('happy'));
 *     if (happy) playAction(happy.id);
 *   },
 * });
 * ```
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { onCelebrate, onPlayPositiveAction } = options;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);

  /**
   * Load tasks from the database
   */
  const loadTasks = useCallback(async (): Promise<Task[]> => {
    console.log('📋 [useTasks] Loading tasks...');
    const loadedTasks = await taskService.fetchTasks();
    console.log(`📋 [useTasks] Loaded ${loadedTasks.length} task(s)`);
    setTasks(loadedTasks);
    return loadedTasks;
  }, []);

  /**
   * Refresh tasks from the database (alias for loadTasks)
   */
  const refreshTasks = useCallback(async (): Promise<Task[]> => {
    console.log('📋 [useTasks] Refreshing tasks...');
    const refreshedTasks = await taskService.fetchTasks();
    console.log(`📋 [useTasks] Refreshed to ${refreshedTasks.length} task(s)`);
    setTasks(refreshedTasks);
    return refreshedTasks;
  }, []);

  /**
   * Create a new task
   */
  const handleTaskCreate = useCallback(async (
    text: string,
    priority?: 'low' | 'medium' | 'high'
  ): Promise<void> => {
    console.log('📋 [useTasks] Creating task:', text, priority ? `(${priority})` : '');

    const newTask = await taskService.createTask(text, priority);

    if (newTask) {
      console.log('✅ [useTasks] Task created:', newTask.id);
      setTasks(prev => [...prev, newTask]);

      // Celebrate task creation
      if (onCelebrate) {
        const message = CREATE_CELEBRATIONS[
          Math.floor(Math.random() * CREATE_CELEBRATIONS.length)
        ];
        onCelebrate(message);
      }
      return;
    }

    console.log('⚠️ [useTasks] Task create returned no data; refreshing task list.');
    await refreshTasks();
  }, [onCelebrate, refreshTasks]);

  /**
   * Toggle task completion status
   */
  const handleTaskToggle = useCallback(async (taskId: string): Promise<void> => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      console.log('❌ [useTasks] Task not found:', taskId);
      return;
    }

    console.log('📋 [useTasks] Toggling task:', taskId, '-> completed:', !task.completed);

    const updatedTask = await taskService.toggleTask(taskId, task.completed);

    if (updatedTask) {
      console.log('✅ [useTasks] Task toggled:', taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

      // Celebrate task completion (not un-completion)
      if (updatedTask.completed) {
        if (onCelebrate) {
          const message = COMPLETE_CELEBRATIONS[
            Math.floor(Math.random() * COMPLETE_CELEBRATIONS.length)
          ];
          onCelebrate(message);
        }

        if (onPlayPositiveAction) {
          onPlayPositiveAction();
        }
      }
    } else {
      console.log('❌ [useTasks] Failed to toggle task:', taskId);
    }
  }, [tasks, onCelebrate, onPlayPositiveAction]);

  /**
   * Delete a task
   */
  const handleTaskDelete = useCallback(async (taskId: string): Promise<void> => {
    console.log('📋 [useTasks] Deleting task:', taskId);

    const success = await taskService.deleteTask(taskId);

    if (success) {
      console.log('✅ [useTasks] Task deleted:', taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } else {
      console.log('❌ [useTasks] Failed to delete task:', taskId);
    }
  }, []);

  return {
    tasks,
    setTasks,
    isTaskPanelOpen,
    setIsTaskPanelOpen,
    loadTasks,
    refreshTasks,
    handleTaskCreate,
    handleTaskToggle,
    handleTaskDelete,
  };
}
