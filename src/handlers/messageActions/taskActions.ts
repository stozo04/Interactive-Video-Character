/**
 * Task Actions Handler
 *
 * Processes task-related actions from AI responses.
 * Handles create, complete, delete, and list operations.
 *
 * Extracted from App.tsx as part of Phase 5 refactoring.
 */

import * as taskService from '../../services/taskService';
import type { Task } from '../../services/taskService';

/**
 * Task action from AI response
 */
export interface TaskAction {
  action: 'create' | 'complete' | 'delete' | 'list';
  task_text?: string;
  task_id?: string;
  priority?: 'low' | 'medium' | 'high';
}

/**
 * Handlers needed to execute task actions
 */
export interface TaskActionHandlers {
  handleTaskCreate: (text: string, priority?: 'low' | 'medium' | 'high') => Promise<void>;
  handleTaskToggle: (taskId: string) => Promise<void>;
  handleTaskDelete: (taskId: string) => Promise<void>;
  setIsTaskPanelOpen: (open: boolean) => void;
}

/**
 * Result of processing a task action
 */
export interface TaskActionResult {
  handled: boolean;
  action?: 'create' | 'complete' | 'delete' | 'list';
  taskText?: string;
  error?: string;
}

/**
 * Process a task action from AI response
 */
export async function processTaskAction(
  taskAction: TaskAction | null | undefined,
  tasks: Task[],
  handlers: TaskActionHandlers
): Promise<TaskActionResult> {
  if (!taskAction || !taskAction.action) {
    return { handled: false };
  }

  console.log('📋 Task action detected:', taskAction);

  try {
    switch (taskAction.action) {
      case 'create':
        return await handleCreateTask(taskAction, handlers);

      case 'complete':
        return await handleCompleteTask(taskAction, handlers);

      case 'delete':
        return await handleDeleteTask(taskAction, handlers);

      case 'list':
        return handleListTasks(handlers);

      default:
        return { handled: false };
    }
  } catch (error) {
    console.error('Failed to execute task action:', error);
    return {
      handled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle task create action
 */
async function handleCreateTask(
  action: TaskAction,
  handlers: TaskActionHandlers
): Promise<TaskActionResult> {
  if (!action.task_text) {
    return { handled: false };
  }

  await handlers.handleTaskCreate(action.task_text, action.priority);
  console.log('✅ Task created (AI):', action.task_text);

  return {
    handled: true,
    action: 'create',
    taskText: action.task_text,
  };
}

/**
 * Handle task complete action
 */
async function handleCompleteTask(
  action: TaskAction,
  handlers: TaskActionHandlers
): Promise<TaskActionResult> {
  let taskId: string | undefined;
  let taskText: string | undefined;

  if (action.task_text) {
    const foundTask = await taskService.findTaskByText(action.task_text);
    if (foundTask) {
      taskId = foundTask.id;
      taskText = foundTask.text;
    }
  } else if (action.task_id) {
    taskId = action.task_id;
    taskText = action.task_text;
  }

  if (!taskId) {
    console.warn('Task not found for completion:', action.task_text || action.task_id);
    return { handled: false };
  }

  await handlers.handleTaskToggle(taskId);
  console.log('✅ Task completed (AI):', taskText);

  return {
    handled: true,
    action: 'complete',
    taskText,
  };
}

/**
 * Handle task delete action
 */
async function handleDeleteTask(
  action: TaskAction,
  handlers: TaskActionHandlers
): Promise<TaskActionResult> {
  let taskId: string | undefined;
  let taskText: string | undefined;

  if (action.task_text) {
    const foundTask = await taskService.findTaskByText(action.task_text);
    if (foundTask) {
      taskId = foundTask.id;
      taskText = foundTask.text;
    }
  } else if (action.task_id) {
    taskId = action.task_id;
    taskText = action.task_text;
  }

  if (!taskId) {
    console.warn('Task not found for deletion:', action.task_text || action.task_id);
    return { handled: false };
  }

  await handlers.handleTaskDelete(taskId);
  console.log('🗑️ Task deleted (AI):', taskText);

  return {
    handled: true,
    action: 'delete',
    taskText,
  };
}

/**
 * Handle task list action
 */
function handleListTasks(handlers: TaskActionHandlers): TaskActionResult {
  handlers.setIsTaskPanelOpen(true);
  console.log('📋 Opened task panel (AI)');

  return {
    handled: true,
    action: 'list',
  };
}

/**
 * Parse embedded task_action JSON from response text
 *
 * Sometimes the AI embeds the task_action in the text response as JSON.
 */
export function parseTaskActionFromResponse(textResponse: string): TaskAction | null {
  try {
    const trimmed = textResponse.trim();
    if (!trimmed.startsWith('{') || !trimmed.includes('task_action')) {
      return null;
    }

    const parsed = JSON.parse(trimmed);
    if (parsed.task_action) {
      console.log('📋 Extracted task_action from text_response');
      return parsed.task_action as TaskAction;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback detection for task completion from user message
 *
 * When the AI doesn't provide a task_action, try to detect completion intent.
 */
export function detectTaskCompletionFallback(
  message: string,
  tasks: Task[]
): TaskAction | null {
  const messageLower = message.toLowerCase();

  const completionKeywords = [
    'done',
    'finished',
    'complete',
    'completed',
    'is done',
    'got it done',
  ];
  const taskKeywords = ['task', 'todo', 'checklist'];

  // Check if message indicates task completion
  const hasCompletionIntent = completionKeywords.some((kw) => messageLower.includes(kw));
  const mentionsTask =
    taskKeywords.some((kw) => messageLower.includes(kw)) ||
    tasks.some((t) => messageLower.includes(t.text.toLowerCase()));

  if (!hasCompletionIntent || (!mentionsTask && tasks.length === 0)) {
    return null;
  }

  console.log('📋 Detected task completion intent from user message (AI missed it)');

  // Try to find which task they're referring to
  for (const task of tasks) {
    if (!task.completed && messageLower.includes(task.text.toLowerCase())) {
      console.log(`📋 Fallback: Marking "${task.text}" as complete`);
      return {
        action: 'complete',
        task_text: task.text,
      };
    }
  }

  return null;
}
