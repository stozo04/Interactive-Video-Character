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
  const nowIso = new Date().toISOString();

  // Try unexpired first
  const unexpired = await supabase
    .from('kayley_presence_state')
    .select('*')
    .gt('expires_at', nowIso)
    .order('last_mentioned_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (unexpired.error) {
    console.error('[KayleyPresence] Error fetching state (unexpired):', unexpired.error);
    return null;
  }
  if (unexpired.data) {
    const data = unexpired.data as any;
    return {
      currentOutfit: data.current_outfit ?? undefined,
      currentMood: data.current_mood ?? undefined,
      currentActivity: data.current_activity ?? undefined,
      currentLocation: data.current_location ?? undefined,
      lastMentionedAt: new Date(data.last_mentioned_at),
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      confidence: data.confidence,
    };
  }

  // Fallback to latest overall
  const latest = await supabase
    .from('kayley_presence_state')
    .select('*')
    .order('last_mentioned_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest.error) {
    console.error('[KayleyPresence] Error fetching state (latest):', latest.error);
    return null;
  }
  if (!latest.data) return null;

  const d = latest.data as any;
  // If expired, you can still return null if you want strictly-current-only
  if (d.expires_at && new Date() > new Date(d.expires_at)) return null;

  return {
    currentOutfit: d.current_outfit ?? undefined,
    currentMood: d.current_mood ?? undefined,
    currentActivity: d.current_activity ?? undefined,
    currentLocation: d.current_location ?? undefined,
    lastMentionedAt: new Date(d.last_mentioned_at),
    expiresAt: d.expires_at ? new Date(d.expires_at) : undefined,
    confidence: d.confidence,
  };
}


/**
 * Update Kayley's presence state
 */
export async function updateKayleyPresenceState(updates: {
  outfit?: string;
  mood?: string;
  activity?: string;
  location?: string;
  expirationMinutes?: number;
  confidence?: number;
  sourceMessageId?: string;
}): Promise<void> {
  const now = new Date();
  const expiresAt = updates.expirationMinutes
    ? new Date(now.getTime() + updates.expirationMinutes * 60 * 1000)
    : null;

  const { error } = await supabase.from('kayley_presence_state').insert({
    current_outfit: updates.outfit ?? null,
    current_mood: updates.mood ?? null,
    current_activity: updates.activity ?? null,
    current_location: updates.location ?? null,
    last_mentioned_at: now.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
    confidence: updates.confidence ?? 1.0,
    source_message_id: updates.sourceMessageId ?? null,
    updated_at: now.toISOString(),
  });

  if (error) console.error('[KayleyPresence] Error updating state:', error);
}

/**
 * Clear Kayley's presence state (mark as expired)
 */
export async function clearKayleyPresenceState(): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('kayley_presence_state')
    .update({ expires_at: nowIso, updated_at: nowIso })
    .is('expires_at', null); // only clear those without expiry, or remove this filter to expire all
  if (error) console.error('[KayleyPresence] Error clearing state:', error);
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
