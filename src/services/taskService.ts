// src/services/taskService.ts
import { supabase } from './supabaseClient';
import { Task } from '../types';

export const TABLE_NAME = 'daily_tasks';

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
const getTodayString = (): string => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

/**
 * Load tasks from Supabase
 * Returns tasks that are either:
 * 1. Scheduled for today
 * 2. Incomplete and from the past (carry-over)
 */
export const fetchTasks = async (): Promise<Task[]> => {
  try {
    const today = getTodayString();

    // We want: (scheduled_date = today) OR (scheduled_date < today AND completed = false)
    // Supabase OR syntax: or=(scheduled_date.eq.today,and(scheduled_date.lt.today,completed.eq.false))
    // However, simplified logic: Get all tasks that are NOT (completed AND scheduled_date < today) matches most active views,
    // but better to be explicit about "Today or Incomplete Past".

    // Let's just fetch:
    // 1. All incomplete tasks (regardless of date - they carry over)
    // 2. Completed tasks ONLY from today

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("*")
      .or(
        `completed.eq.false,and(completed.eq.true,scheduled_date.eq.${today})`
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching tasks fetching:", error);
      throw error;
    }

    return (data || []).map((row) => ({
      id: row.id,
      text: row.text,
      completed: row.completed,
      priority: row.priority as "low" | "medium" | "high",
      category: row.category,
      createdAt: new Date(row.created_at).getTime(),
      completedAt: row.completed_at
        ? new Date(row.completed_at).getTime()
        : null,
      scheduledDate: row.scheduled_date,
    }));
  } catch (error) {
    console.error("Failed to load tasks from Supabase:", error);
    return [];
  }
};

/**
 * Create a new task
 */
export const createTask = async (
  text: string,
  priority: "low" | "medium" | "high" = "low",
  category?: string
): Promise<Task | null> => {
  const newTaskPayload = {
    text: text.trim(),
    priority,
    category,
    scheduled_date: getTodayString(), // Default to today
    completed: false,
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(newTaskPayload)
    .select()
    .single();

  if (error) {
    console.error("Error creating task:", error);
    return null;
  }

  return {
    id: data.id,
    text: data.text,
    completed: data.completed,
    priority: data.priority,
    category: data.category,
    createdAt: new Date(data.created_at).getTime(),
    completedAt: null,
    scheduledDate: data.scheduled_date,
  };
};

/**
 * Toggle task completion status
 */
export const toggleTask = async (
  taskId: string,
  currentCompleted: boolean
): Promise<Task | null> => {
  console.log('toggleTask: taskId: ', taskId)
  console.log('toggleTask: currentCompleted: ', currentCompleted)
  const updates = {
    completed: !currentCompleted,
    completed_at: !currentCompleted ? new Date().toISOString() : null,
  };
console.log('toggleTask: updates: ', updates)
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();

  if (error) {
    console.error("Error toggling task:", error);
    return null;
  }

  return {
    id: data.id,
    text: data.text,
    completed: data.completed,
    priority: data.priority,
    category: data.category,
    createdAt: new Date(data.created_at).getTime(),
    completedAt: data.completed_at
      ? new Date(data.completed_at).getTime()
      : null,
  };
};

/**
 * Delete a task
 */
export const deleteTask = async (taskId: string): Promise<boolean> => {
  const { error } = await supabase.from(TABLE_NAME).delete().eq("id", taskId);

  if (error) {
    console.error("Error deleting task:", error);
    return false;
  }

  return true;
};

/**
 * Get task statistics for AI context (Sync version not possible anymore, must be async or cached)
 * We will return a promise or expect the caller to have the data.
 * For AI context, we usually pass the already loaded tasks from the state.
 */
export const getTaskStats = (tasks: Task[]) => {
  const completed = tasks.filter((t) => t.completed);
  const incomplete = tasks.filter((t) => !t.completed);
  const highPriority = incomplete.filter((t) => t.priority === "high");

  return {
    total: tasks.length,
    completed: completed.length,
    incomplete: incomplete.length,
    highPriority: highPriority.length,
    tasks,
  };
};

/**
 * Update task text or priority
 */
export const updateTask = async (
  taskId: string,
  updates: Partial<Pick<Task, "text" | "priority" | "category">>
): Promise<Task | null> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();

  if (error) {
    console.error(`Error updating task ${taskId}:`, error);
    return null;
  }

  return {
    id: data.id,
    text: data.text,
    completed: data.completed,
    priority: data.priority,
    category: data.category,
    createdAt: new Date(data.created_at).getTime(),
    completedAt: data.completed_at
      ? new Date(data.completed_at).getTime()
      : null,
  };
};

/**
 * Find task by partial text match (for voice commands)
 */
export const findTaskByText = async (
  searchText: string
): Promise<Task | null> => {
  const normalized = searchText.toLowerCase().trim();

  // Fetch all tasks for the user (we could filter in DB but "includes" is harder with simple LIKE if we want exact/partial logic)
  // For simplicity and to match old logic, let's fetch active tasks and search in memory.
  // Optimization: Only fetch incomplete tasks or tasks from today.
  const tasks = await fetchTasks();

  // Try exact match first
  let found = tasks.find((t) => t.text.toLowerCase() === normalized);
  if (found) return found;

  // Try partial match
  found = tasks.find((t) => t.text.toLowerCase().includes(normalized));
  if (found) return found;

  // Try reverse - does the search include the task text?
  found = tasks.find((t) => normalized.includes(t.text.toLowerCase()));
  return found || null;
};


