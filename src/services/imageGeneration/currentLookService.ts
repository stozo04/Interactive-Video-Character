// src/services/imageGeneration/currentLookService.ts

import { supabase } from '../supabaseClient';
import { CurrentLookState } from './types';

/**
 * Get the current locked look
 */
export async function getCurrentLookState(): Promise<CurrentLookState | null> {
  const { data, error } = await supabase
    .from('current_look_state')
    .select('*')
    .eq('is_current_look', true)
    .maybeSingle();

  if (error) {
    console.error('[CurrentLook] Error fetching current look:', error);
    return null;
  }

  if (!data) return null;

  // Check if expired
  const expiresAt = new Date(data.expires_at);
  if (new Date() > expiresAt) {
    console.log('[CurrentLook] Current look expired, returning null');
    return null;
  }

  return {
    hairstyle: data.hairstyle as any,
    referenceImageId: data.reference_image_id,
    lockedAt: new Date(data.locked_at),
    expiresAt,
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

  // Upsert (insert or update)
  const { error } = await supabase
    .from('current_look_state')
    .upsert({
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
  await supabase
    .from('current_look_state')
    .update({
      is_current_look: false,
      updated_at: new Date().toISOString(),
    })

  console.log('[CurrentLook] Unlocked current look');
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
