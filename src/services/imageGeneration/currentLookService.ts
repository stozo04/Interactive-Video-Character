// src/services/imageGeneration/currentLookService.ts

import { supabase } from '../supabaseClient';
import { CurrentLookState } from './types';

/**
 * Get the current locked look
 */
export async function getCurrentLookState(): Promise<CurrentLookState | null> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('current_look_state')
    .select('*')
    .eq('is_current_look', true)
    .gt('expires_at', nowIso)
    .order('locked_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('[CurrentLook] Error fetching current look:', error);
    return null;
  }
  if (!data) return null;

  return {
    hairstyle: data.hairstyle as any,
    referenceImageId: data.reference_image_id,
    lockedAt: new Date(data.locked_at),
    expiresAt: new Date(data.expires_at),
    lockReason: data.lock_reason as any,
    isCurrentLook: data.is_current_look,
  };
}

/**
 * Lock a new current look (set hairstyle for the session/day)
 */
export async function lockCurrentLook(
  referenceImageId: string,
  hairstyle: string,
  lockReason: 'session_start' | 'first_selfie_of_day' | 'explicit_now_selfie',
  expirationHours: number = 24
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expirationHours * 60 * 60 * 1000);

  // Clear any existing current rows
  const { error: clearErr } = await supabase
    .from('current_look_state')
    .update({
      is_current_look: false,
      updated_at: now.toISOString(),
    })
    .eq('is_current_look', true);

  if (clearErr) {
    console.error('[CurrentLook] Error clearing previous current look:', clearErr);
    // continue, but this should be rare with proper index
  }

  // Insert a new current row (do not use upsert here)
  const { error } = await supabase
    .from('current_look_state')
    .insert({
      hairstyle,
      reference_image_id: referenceImageId,
      locked_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      lock_reason: lockReason,
      is_current_look: true,
      updated_at: now.toISOString(),
    });

  if (error) {
    console.error('[CurrentLook] Error locking current look:', error);
  } else {
    console.log(`[CurrentLook] Locked ${hairstyle} until ${expiresAt.toLocaleString()}`);
  }
}

/**
 * Unlock current look (force expiration)
 */
export async function unlockCurrentLook(): Promise<void> {
  const { error } = await supabase
    .from('current_look_state')
    .update({
      is_current_look: false,
      updated_at: new Date().toISOString(),
    })
    .eq('is_current_look', true);

  if (error) {
    console.error('[CurrentLook] Error unlocking current look:', error);
  } else {
    console.log('[CurrentLook] Unlocked current look');
  }
}

/**
 * Get recent selfie generation history for anti-repetition
 */
export async function getRecentSelfieHistory(
  limit: number = 10
): Promise<Array<{
  referenceImageId: string;
  usedAt: Date;
  scene: string;
}>> {
  const { data, error } = await supabase
    .from('selfie_generation_history')
    .select('reference_image_id, generated_at, scene')
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[CurrentLook] Error fetching history:', error);
    return [];
  }

  return (data || []).map(row => ({
    referenceImageId: row.reference_image_id,
    usedAt: new Date(row.generated_at),
    scene: row.scene,
  }));
}

/**
 * Record a selfie generation in history
 */
export async function recordSelfieGeneration(
  referenceImageId: string,
  hairstyle: string,
  outfitStyle: string,
  scene: string,
  mood: string | undefined,
  isOldPhoto: boolean,
  referenceDate: Date | undefined,
  selectionFactors: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('selfie_generation_history')
    .insert({
      reference_image_id: referenceImageId,
      hairstyle,
      outfit_style: outfitStyle,
      scene,
      mood: mood || null,
      is_old_photo: isOldPhoto,
      reference_date: referenceDate?.toISOString() || null,
      selection_factors: selectionFactors,
    });

  if (error) {
    console.error('[CurrentLook] Error recording generation:', error);
  }
}
