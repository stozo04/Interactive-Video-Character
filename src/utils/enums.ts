/**
 * Shared enums for the application.
 * Use these instead of magic strings for type safety.
 *
 * @see docs/features/App_Refactor.md for guidelines
 */

// === Storage Keys ===
// Use these for localStorage keys to avoid typos and enable refactoring
export enum StorageKey {
  SnoozeIndefinite = 'kayley_snooze_indefinite',
  SnoozeUntil = 'kayley_snooze_until',
  ProactiveSettings = 'kayley_proactive_settings',
  LastBriefing = 'last_briefing',
  GmailHistoryId = 'gmail_history_id',
}

// === Task Operations ===
export enum TaskAction {
  Create = 'create',
  Complete = 'complete',
  Delete = 'delete',
}

export enum TaskPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

// === Calendar Operations ===
export enum CalendarAction {
  Create = 'create',
  Delete = 'delete',
}

// === Character Action Types ===
export enum ActionType {
  Talking = 'talking',
  Greeting = 'greeting',
  Idle = 'idle',
}

// === View States ===
export enum AppView {
  Loading = 'loading',
  SelectCharacter = 'selectCharacter',
  CreateCharacter = 'createCharacter',
  Chat = 'chat',
  ManageCharacter = 'manageCharacter',
  Whiteboard = 'whiteboard',
}

// === Message Types ===
export enum MessageRole {
  User = 'user',
  Model = 'model',
}

// === Proactive Feature Types ===
export enum ProactiveFeature {
  Checkins = 'checkins',
  News = 'news',
  Calendar = 'calendar',
}

// === Log Prefixes ===
// Use these for consistent, scannable console logs
export const LogPrefix = {
  Tasks: '📋',
  Calendar: '📅',
  Email: '📧',
  Video: '🎬',
  Idle: '💤',
  Success: '✅',
  Error: '❌',
  Performance: '⚡',
  Loading: '🔄',
  Audio: '🔊',
  Memory: '🧠',
  Relationship: '💕',
  News: '📰',
  Selfie: '📸',
  Whiteboard: '🎨',
} as const;

// Type for LogPrefix values
export type LogPrefixType = typeof LogPrefix[keyof typeof LogPrefix];

// === Supabase Bucket Names ===
export enum StorageBucket {
  CharacterVideos = 'character-videos',
  CharacterActionVideos = 'character-action-videos',
}

// === Timing Constants ===
// Centralized timing values to avoid magic numbers
export const Timing = {
  // Idle action delays (ms)
  IDLE_ACTION_DELAY_MIN: 10_000,
  IDLE_ACTION_DELAY_MAX: 45_000,

  // Polling intervals (ms)
  CALENDAR_POLL_INTERVAL: 5 * 60 * 1000, // 5 minutes
  GMAIL_POLL_INTERVAL: 60 * 1000, // 1 minute
  IDLE_CHECK_INTERVAL: 10 * 1000, // 10 seconds

  // Timeouts (ms)
  IDLE_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  PREFETCH_IDLE_TIMEOUT: 30 * 1000, // 30 seconds
  EMAIL_DEBOUNCE: 5 * 1000, // 5 seconds
} as const;
