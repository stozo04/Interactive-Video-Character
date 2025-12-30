/**
 * Idle Life Module
 *
 * "Kayley Lives Her Life" - Systems for autonomous character presence during user absence.
 *
 * This module creates the feeling that Kayley has her own life that you're part of,
 * rather than being the center of her existence.
 *
 * Components:
 * - kayleyExperienceService: Things that happen to Kayley (activities, mishaps, discoveries)
 * - calendarAwarenessService: She notices and cares about your calendar events
 * - giftMessageService: Rare, meaningful unprompted messages (max once/day)
 * - pendingMessageService: Storage/delivery of messages waiting for user return
 */

// Services
export {
  generateKayleyExperience,
  getUnsurfacedExperiences,
  markExperienceSurfaced,
  formatExperiencesForPrompt,
  detectAndMarkSurfacedExperiences,
  buildExperienceContext,
  type KayleyExperience,
  type ExperienceType,
  type ExperienceContext,
} from './kayleyExperienceService';

export {
  checkCalendarForMessage,
  getRecentlyCompletedEvents,
  analyzeEventImportance,
  type RecentlyCompletedEvent,
  type EventImportance,
} from './calendarAwarenessService';

export {
  maybeGenerateGiftMessage,
  canSendGiftToday,
  getLastGiftMessage,
  cleanupGiftHistory,
  type GiftType,
  type GiftMessageHistory,
} from './giftMessageService';

export {
  createPendingMessage,
  getUndeliveredMessage,
  hasUndeliveredMessage,
  markMessageDelivered,
  recordMessageReaction,
  getAllUndeliveredMessages,
  cleanupDeliveredMessages,
  type PendingMessage,
  type MessageTrigger,
  type MessageType,
  type MessagePriority,
  type CreatePendingMessageInput,
} from './pendingMessageService';
