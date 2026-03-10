import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabaseAdmin";

type DatabaseClient = Pick<SupabaseClient<any>, "from">;

const SELFIE_HISTORY_TABLE = "selfie_generation_history";
const VIDEO_HISTORY_TABLE = "video_generation_history";
const VOICE_NOTE_HISTORY_TABLE = "voice_note_generation_history";

export enum MediaDeliveryStatus {
  GENERATED = "generated",
  DELIVERED = "delivered",
  FAILED = "failed",
}

export enum RichMediaType {
  SELFIE = "selfie",
  VIDEO = "video",
  VOICE_NOTE = "voice_note",
}

export interface MediaDeliveryUpdate {
  deliveryStatus: MediaDeliveryStatus;
  deliveryChannel?: string | null;
  deliveredAt?: string | null;
  deliveryError?: string | null;
  messageText?: string | null;
}

export interface VideoHistoryInsert {
  scene: string;
  mood?: string;
  messageText?: string;
  videoUrl: string;
  durationSeconds?: number;
  requestId?: string;
  aspectRatio?: string;
  resolution?: string;
}

export interface VoiceNoteHistoryInsert {
  messageText: string;
  provider?: string;
  audioMimeType?: string;
}

function getClient(client?: DatabaseClient): DatabaseClient {
  return client ?? supabaseAdmin;
}

export async function recordSelfieGenerationHistory(
  params: {
    referenceImageId: string;
    hairstyle: string;
    outfitStyle: string;
    scene: string;
    mood?: string;
    isOldPhoto: boolean;
    referenceDate?: Date;
    selectionFactors: Record<string, unknown>;
  },
  client?: DatabaseClient,
): Promise<string | null> {
  const { data, error } = await getClient(client)
    .from(SELFIE_HISTORY_TABLE)
    .insert({
      reference_image_id: params.referenceImageId,
      hairstyle: params.hairstyle,
      outfit_style: params.outfitStyle,
      scene: params.scene,
      mood: params.mood || null,
      is_old_photo: params.isOldPhoto,
      reference_date: params.referenceDate?.toISOString() || null,
      selection_factors: params.selectionFactors,
      delivery_status: MediaDeliveryStatus.GENERATED,
      delivered_at: null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[MediaHistory] Failed to record selfie generation:", error);
    return null;
  }

  return data?.id ?? null;
}

export async function updateSelfieGenerationHistory(
  historyId: string,
  update: MediaDeliveryUpdate,
  client?: DatabaseClient,
): Promise<void> {
  const payload = {
    delivery_status: update.deliveryStatus,
    delivery_channel: update.deliveryChannel ?? null,
    delivered_at:
      update.deliveryStatus === MediaDeliveryStatus.DELIVERED
        ? update.deliveredAt ?? new Date().toISOString()
        : null,
    delivery_error: update.deliveryError ?? null,
    message_text: update.messageText ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await getClient(client)
    .from(SELFIE_HISTORY_TABLE)
    .update(payload)
    .eq("id", historyId);

  if (error) {
    console.error("[MediaHistory] Failed to update selfie delivery status:", error);
  }
}

export async function recordVideoGenerationHistory(
  params: VideoHistoryInsert,
  client?: DatabaseClient,
): Promise<string | null> {
  const { data, error } = await getClient(client)
    .from(VIDEO_HISTORY_TABLE)
    .insert({
      scene: params.scene,
      mood: params.mood ?? null,
      message_text: params.messageText ?? null,
      video_url: params.videoUrl,
      duration_seconds: params.durationSeconds ?? null,
      request_id: params.requestId ?? null,
      aspect_ratio: params.aspectRatio ?? null,
      resolution: params.resolution ?? null,
      delivery_status: MediaDeliveryStatus.GENERATED,
      delivered_at: null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[MediaHistory] Failed to record video generation:", error);
    return null;
  }

  return data?.id ?? null;
}

export async function updateVideoGenerationHistory(
  historyId: string,
  update: MediaDeliveryUpdate,
  client?: DatabaseClient,
): Promise<void> {
  const payload = {
    delivery_status: update.deliveryStatus,
    delivery_channel: update.deliveryChannel ?? null,
    delivered_at:
      update.deliveryStatus === MediaDeliveryStatus.DELIVERED
        ? update.deliveredAt ?? new Date().toISOString()
        : null,
    delivery_error: update.deliveryError ?? null,
    message_text: update.messageText ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await getClient(client)
    .from(VIDEO_HISTORY_TABLE)
    .update(payload)
    .eq("id", historyId);

  if (error) {
    console.error("[MediaHistory] Failed to update video delivery status:", error);
  }
}

export async function recordVoiceNoteHistory(
  params: VoiceNoteHistoryInsert,
  client?: DatabaseClient,
): Promise<string | null> {
  const { data, error } = await getClient(client)
    .from(VOICE_NOTE_HISTORY_TABLE)
    .insert({
      message_text: params.messageText,
      provider: params.provider ?? null,
      audio_mime_type: params.audioMimeType ?? null,
      delivery_channel: null,
      delivery_status: MediaDeliveryStatus.GENERATED,
      delivered_at: null,
      delivery_error: null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[MediaHistory] Failed to record voice note history:", error);
    return null;
  }

  return data?.id ?? null;
}

export async function updateVoiceNoteHistory(
  historyId: string,
  update: MediaDeliveryUpdate,
  client?: DatabaseClient,
): Promise<void> {
  const payload = {
    delivery_status: update.deliveryStatus,
    delivery_channel: update.deliveryChannel ?? null,
    delivered_at:
      update.deliveryStatus === MediaDeliveryStatus.DELIVERED
        ? update.deliveredAt ?? new Date().toISOString()
        : null,
    delivery_error: update.deliveryError ?? null,
    message_text: update.messageText ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await getClient(client)
    .from(VOICE_NOTE_HISTORY_TABLE)
    .update(payload)
    .eq("id", historyId);

  if (error) {
    console.error("[MediaHistory] Failed to update voice note delivery status:", error);
  }
}
