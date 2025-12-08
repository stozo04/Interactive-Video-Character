// src/services/taskService.ts
import { Task, TaskState } from '../types';

const STORAGE_KEY = 'kayley_daily_tasks';

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
const getTodayString = (): string => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

/**
 * Generate a unique ID for a task
 */
const generateTaskId = (): string => {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Load task state from localStorage with automatic daily rollover
 * If it's a new day, completed tasks are deleted and incomplete tasks carry over
 */
export const loadTasks = (): Task[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // First time - initialize empty state
      const initialState: TaskState = {
        tasks: [],
        lastResetDate: getTodayString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
      return [];
    }

    const state: TaskState = JSON.parse(stored);
    const today = getTodayString();

    // Check if it's a new day
    if (state.lastResetDate !== today) {
      console.log(`📅 New day detected! Rolling over tasks from ${state.lastResetDate} to ${today}`);
      
      // Keep only incomplete tasks
      const incompleteTasks = state.tasks.filter(task => !task.completed);
      
      const newState: TaskState = {
        tasks: incompleteTasks,
        lastResetDate: today
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      console.log(`✅ Rolled over ${incompleteTasks.length} incomplete task(s)`);
      
      return incompleteTasks;
    }

    return state.tasks;
  } catch (error) {
    console.error('Failed to load tasks from localStorage:', error);
    return [];
  }
};

/**
 * Save tasks to localStorage
 */
export const saveTasks = (tasks: Task[]): void => {
  try {
    const state: TaskState = {
      tasks,
      lastResetDate: getTodayString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save tasks to localStorage:', error);
  }
};

/**
 * Create a new task
 */
export const createTask = (
  text: string, 
  priority?: 'low' | 'medium' | 'high',
  category?: string
): Task => {
  const newTask: Task = {
    id: generateTaskId(),
    text: text.trim(),
    completed: false,
    createdAt: Date.now(),
    completedAt: null,
    priority,
    category
  };

  const currentTasks = loadTasks();
  const updatedTasks = [...currentTasks, newTask];
  saveTasks(updatedTasks);

  console.log(`✅ Created task: "${text}"`);
  return newTask;
};

/**
 * Toggle task completion status
 */
export const toggleTask = (taskId: string): Task | null => {
  const currentTasks = loadTasks();
  const taskIndex = currentTasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    console.warn(`Task ${taskId} not found`);
    return null;
  }

  const task = currentTasks[taskIndex];
  const updatedTask: Task = {
    ...task,
    completed: !task.completed,
    completedAt: !task.completed ? Date.now() : null
  };

  currentTasks[taskIndex] = updatedTask;
  saveTasks(currentTasks);

  console.log(`✅ Toggled task "${task.text}" to ${updatedTask.completed ? 'complete' : 'incomplete'}`);
  return updatedTask;
};

/**
 * Delete a task
 */
export const deleteTask = (taskId: string): boolean => {
  const currentTasks = loadTasks();
  const filteredTasks = currentTasks.filter(t => t.id !== taskId);
  
  if (filteredTasks.length === currentTasks.length) {
    console.warn(`Task ${taskId} not found`);
    return false;
  }

  saveTasks(filteredTasks);
  console.log(`🗑️ Deleted task ${taskId}`);
  return true;
};

/**
 * Get task statistics for AI context
 */
export const getTaskStats = () => {
  const tasks = loadTasks();
  const completed = tasks.filter(t => t.completed);
  const incomplete = tasks.filter(t => !t.completed);
  const highPriority = incomplete.filter(t => t.priority === 'high');

  return {
    total: tasks.length,
    completed: completed.length,
    incomplete: incomplete.length,
    highPriority: highPriority.length,
    tasks
  };
};

/**
 * Find task by partial text match (for voice commands)
 */
export const findTaskByText = (searchText: string): Task | null => {
  const tasks = loadTasks();
  const normalized = searchText.toLowerCase().trim();
  
  // Try exact match first
  let found = tasks.find(t => t.text.toLowerCase() === normalized);
  if (found) return found;
  
  // Try partial match
  found = tasks.find(t => t.text.toLowerCase().includes(normalized));
  if (found) return found;
  
  // Try reverse - does the search include the task text?
  found = tasks.find(t => normalized.includes(t.text.toLowerCase()));
  return found || null;
};

/**
 * Update task text or priority
 */
export const updateTask = (
  taskId: string, 
  updates: Partial<Pick<Task, 'text' | 'priority' | 'category'>>
): Task | null => {
  const currentTasks = loadTasks();
  const taskIndex = currentTasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    console.warn(`Task ${taskId} not found`);
    return null;
  }

  const updatedTask: Task = {
    ...currentTasks[taskIndex],
    ...updates,
    text: updates.text?.trim() || currentTasks[taskIndex].text
  };

  currentTasks[taskIndex] = updatedTask;
  saveTasks(currentTasks);

  console.log(`✅ Updated task ${taskId}`);
  return updatedTask;
};

/**
 * Manually trigger daily rollover (for testing or forced reset)
 */
export const checkDailyRollover = (): { rolled: boolean; deletedCount: number } => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return { rolled: false, deletedCount: 0 };

  const state: TaskState = JSON.parse(stored);
  const today = getTodayString();

  if (state.lastResetDate !== today) {
    const completedCount = state.tasks.filter(t => t.completed).length;
    loadTasks(); // This will trigger the rollover
    return { rolled: true, deletedCount: completedCount };
  }

  return { rolled: false, deletedCount: 0 };
};

