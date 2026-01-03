// src/services/kayleyPresenceService.ts

/**
 * Kayley Presence State Service
 *
 * Tracks what Kayley is currently wearing/doing/feeling based on her responses.
 * Used for generating context-appropriate selfies.
 */

import { supabase } from './supabaseClient';

export interface KayleyPresenceState {
  currentOutfit?: string;      // "just got back from the gym", "in my pajamas"
  currentMood?: string;         // "feeling cute", "tired", "excited"
  currentActivity?: string;     // "making coffee", "working", "relaxing"
  currentLocation?: string;     // "at home", "at the gym"
  lastMentionedAt: Date;
  expiresAt?: Date;
  confidence: number;
}

/**
 * Get Kayley's current presence state for a user
 */
export async function getKayleyPresenceState(): Promise<KayleyPresenceState | null> {
  const { data, error } = await supabase
    .from("kayley_presence_state")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[KayleyPresence] Error fetching state:", error);
    return null;
  }

  if (!data) return null;

  // Check if expired
  if (data.expires_at && new Date() > new Date(data.expires_at)) {
    console.log("[KayleyPresence] State expired, returning null");
    return null;
  }

  return {
    currentOutfit: data.current_outfit,
    currentMood: data.current_mood,
    currentActivity: data.current_activity,
    currentLocation: data.current_location,
    lastMentionedAt: new Date(data.last_mentioned_at),
    expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    confidence: data.confidence,
  };
}
const USER_ID = import.meta.env.VITE_USER_ID;
/**
 * Update Kayley's presence state
 */
export async function updateKayleyPresenceState(updates: {
  outfit?: string;
  mood?: string;
  activity?: string;
  location?: string;
  expirationMinutes?: number; // How long until this state expires
  confidence?: number;
  sourceMessageId?: string;
}): Promise<void> {
  const now = new Date();
  const expiresAt = updates.expirationMinutes
    ? new Date(now.getTime() + updates.expirationMinutes * 60 * 1000)
    : null;

  // Fetch existing state to merge
  const existing = await getKayleyPresenceState();

  const { error } = await supabase.from("kayley_presence_state").upsert({
    current_outfit: updates.outfit ?? existing?.currentOutfit ?? null,
    current_mood: updates.mood ?? existing?.currentMood ?? null,
    current_activity: updates.activity ?? existing?.currentActivity ?? null,
    current_location: updates.location ?? existing?.currentLocation ?? null,
    last_mentioned_at: now.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
    confidence: updates.confidence ?? 1.0,
    source_message_id: updates.sourceMessageId,
    updated_at: now.toISOString(),
  });

  if (error) {
    console.error("[KayleyPresence] Error updating state:", error);
  } else {
    console.log("[KayleyPresence] State updated:", {
      outfit: updates.outfit,
      mood: updates.mood,
      activity: updates.activity,
      location: updates.location,
    });
  }
}

/**
 * Clear Kayley's presence state (mark as expired)
 */
export async function clearKayleyPresenceState(g): Promise<void> {
  const { error } = await supabase.from("kayley_presence_state").update({
    expires_at: new Date().toISOString(), // Expire immediately
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[KayleyPresence] Error clearing state:", error);
  } else {
    console.log("[KayleyPresence] State cleared");
  }
}

/**
 * Get default expiration time based on activity type
 */
export function getDefaultExpirationMinutes(activity?: string, outfit?: string): number {
  const activityLower = activity?.toLowerCase() || '';
  const outfitLower = outfit?.toLowerCase() || '';

  // Quick activities (expire in 15 min)
  if (activityLower.includes('making coffee') ||
      activityLower.includes('getting ready') ||
      activityLower.includes('shower')) {
    return 15;
  }

  // Medium activities (expire in 1-2 hours)
  if (activityLower.includes('working') ||
      activityLower.includes('studying') ||
      outfitLower.includes('gym') ||
      outfitLower.includes('workout')) {
    return 120; // 2 hours
  }

  // Outfit mentions (persist longer, 4 hours)
  if (outfitLower.includes('wearing') ||
      outfitLower.includes('dressed') ||
      outfitLower.includes('outfit')) {
    return 240; // 4 hours
  }

  // Default: 2 hours
  return 120;
}
