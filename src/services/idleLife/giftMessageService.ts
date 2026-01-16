/**
 * Gift Message Service
 *
 * Handles the RARE, unprompted "gift" messages from Kayley.
 * These are special - not needy or clingy. Just occasional moments
 * where she thinks of you and reaches out.
 *
 * Rules:
 * - 5% chance per idle tick (very rare)
 * - Max once per day
 * - Can be a selfie or a thought
 * - Should feel like a gift, not an obligation
 *
 * Good examples:
 * - [selfie] "Thought you might need this to get through your afternoon"
 * - "I just saw something that reminded me of that story you told me"
 * - "Okay I have to tell you what just happened. Get back here."
 *
 * Bad examples (NEVER do these):
 * - "I've been thinking about you..."
 * - "It's so quiet without you"
 * - "I miss you, when are you coming back?"
 * - Multiple messages piling up
 */

import { supabase } from '../supabaseClient';
import {
  createPendingMessage,
  hasUndeliveredMessage,
  type CreatePendingMessageInput,
} from './pendingMessageService';

// ============================================================================
// Types
// ============================================================================

export type GiftType = 'selfie' | 'thought';

export interface GiftMessageHistory {
  id: string;
  giftType: GiftType;
  messageText: string;
  selfieUrl?: string;
  sentAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

const GIFT_MESSAGE_HISTORY_TABLE = "gift_message_history";
const GIFT_MESSAGE_CHANCE = 0.05; // 5% chance
const MIN_HOURS_BETWEEN_GIFTS = 24; // Max once per day

// Selfie gift messages (paired with a selfie)
const SELFIE_GIFT_MESSAGES = [
  "Thought you might need this to get through your afternoon",
  "Hey. Just because.",
  "Figured you could use a smile. Here you go.",
  "No reason. Just wanted to.",
  "For you.",
];

// Thought gift messages (text only, intriguing)
const THOUGHT_GIFT_MESSAGES = [
  "Okay I have to tell you what just happened. Get back here.",
  "I just saw something that reminded me of that story you told me. Random but it made me smile.",
  "You're not going to believe what I just did.",
  "Something happened and you're the first person I wanted to tell.",
  "Okay random but I just had a thought and I need your opinion.",
];

// ============================================================================
// Core Functions
// ============================================================================

// GATES: THIS IS NOT IMPLEMENTED.
// THIS IS ATTACHED TO IDLE THOUGHTS AND IDLE THOUGHTS IS TURNED OFF
// THIS NEEDS TO BE DYNAMIC (BASED ON PAST CONV. HISTORY) AND NOT HARD CODED

/**
 * Maybe generate a gift message.
 * Called during idle time with very low probability.
 *
 * @param hoursAway - How long user has been away
 * @returns The pending message input, or null if no gift generated
 */
export async function maybeGenerateGiftMessage(): Promise<CreatePendingMessageInput | null> {
  // Roll the dice - 5% chance
  if (Math.random() > GIFT_MESSAGE_CHANCE) {
    return null;
  }

  // Check if we already sent a gift today
  const canSendGift = await canSendGiftToday();
  if (!canSendGift) {
    console.log("[GiftMessage] Already sent gift today, skipping");
    return null;
  }

  // Check if there's already a pending message
  const hasPending = await hasUndeliveredMessage();
  if (hasPending) {
    console.log("[GiftMessage] Already has pending message, skipping gift");
    return null;
  }

  // Decide gift type (60% selfie, 40% thought)
  const giftType: GiftType = Math.random() < 0.6 ? "selfie" : "thought";

  let message: CreatePendingMessageInput;

  if (giftType === "selfie") {
    message = await generateSelfieGift();
  } else {
    message = generateThoughtGift();
  }

  // Record the gift in history
  await recordGiftMessage(giftType, message.messageText, message.selfieUrl);

  // Create the pending message
  await createPendingMessage(message);

  console.log(`[GiftMessage] Generated ${giftType} gift`);

  return message;
}

/**
 * Check if we can send a gift today (enforces once-per-day limit).
 */
export async function canSendGiftToday(): Promise<boolean> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - MIN_HOURS_BETWEEN_GIFTS * 60 * 60 * 1000);

    const { count, error } = await supabase
      .from(GIFT_MESSAGE_HISTORY_TABLE)
      .select("id", { count: "exact", head: true })
      .gte("sent_at", twentyFourHoursAgo.toISOString());

    if (error) {
      console.error("[GiftMessage] Error checking gift history:", error);
      return true; // Default to allowing if error
    }

    return (count || 0) === 0;
  } catch (error) {
    console.error("[GiftMessage] Error in canSendGiftToday:", error);
    return true;
  }
}

/**
 * Get the last gift message sent to a user.
 */
export async function getLastGiftMessage(): Promise<GiftMessageHistory | null> {
  try {
    const { data, error } = await supabase
      .from(GIFT_MESSAGE_HISTORY_TABLE)
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    return {
      id: data[0].id,
      giftType: data[0].gift_type as GiftType,
      messageText: data[0].message_text,
      selfieUrl: data[0].selfie_url,
      sentAt: new Date(data[0].sent_at),
    };
  } catch (error) {
    console.error("[GiftMessage] Error getting last gift:", error);
    return null;
  }
}

// ============================================================================
// Gift Generation
// ============================================================================

/**
 * Generate a selfie gift message.
 * Note: Actual selfie generation happens when the message is delivered.
 */
async function generateSelfieGift(): Promise<CreatePendingMessageInput> {
  const messageText =
    SELFIE_GIFT_MESSAGES[
      Math.floor(Math.random() * SELFIE_GIFT_MESSAGES.length)
    ];

  // We don't generate the actual selfie here - that happens at delivery time
  // to ensure freshness. We just set up the message with metadata.
  return {
    messageText,
    messageType: "photo",
    trigger: "gift",
    priority: "low",
    metadata: {
      giftType: "selfie",
      selfieParams: {
        scene: "casual selfie at home",
        mood: "warm smile",
        trigger: "gift_message",
      },
    },
  };
}

/**
 * Generate a thought gift message (text only, intriguing).
 */
function generateThoughtGift(): CreatePendingMessageInput {
  const messageText =
    THOUGHT_GIFT_MESSAGES[
      Math.floor(Math.random() * THOUGHT_GIFT_MESSAGES.length)
    ];

  return {
    messageText,
    messageType: "text",
    trigger: "gift",
    priority: "low",
    metadata: {
      giftType: "thought",
    },
  };
}

/**
 * Record a gift message in history (for daily limit enforcement).
 */
const USER_ID = import.meta.env.VITE_USER_ID;
async function recordGiftMessage(
  giftType: GiftType,
  messageText: string,
  selfieUrl?: string
): Promise<void> {
  try {
    const { error } = await supabase.from(GIFT_MESSAGE_HISTORY_TABLE).insert({
      id: crypto.randomUUID(),
      gift_type: giftType,
      message_text: messageText,
      selfie_url: selfieUrl,
      sent_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[GiftMessage] Error recording gift:", error);
    }
  } catch (error) {
    console.error("[GiftMessage] Error in recordGiftMessage:", error);
  }
}

/**
 * Clean up old gift message history.
 */
export async function cleanupGiftHistory(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from(GIFT_MESSAGE_HISTORY_TABLE)
      .delete()
      .lt("sent_at", thirtyDaysAgo.toISOString());

    if (error) {
      console.error("[GiftMessage] Error cleaning up history:", error);
    }
  } catch (error) {
    console.error("[GiftMessage] Error in cleanupGiftHistory:", error);
  }
}
