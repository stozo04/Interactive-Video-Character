import { CharacterAction, CharacterProfile } from '../types';
import { supabase } from './supabaseClient';

const CHARACTERS_TABLE = 'characters';
const IDLE_VIDEO_BUCKET = 'character-videos';
const VIDEO_CACHE_BUCKET = 'video-cache';
const ACTIONS_TABLE = 'character_actions';
const ACTION_VIDEO_BUCKET = 'character-action-videos';

interface CharacterRow {
  id: string;
  created_at_ms?: number | null;
  image_base64: string;
  image_mime_type: string;
  image_file_name?: string | null;
  idle_video_path: string;
}

interface CharacterActionRow {
  id: string;
  character_id: string;
  action_key?: string | null;
  display_name?: string | null;
  video_path: string | null;
  command_phrases?: string[] | string | null;
  sort_order?: number | null;
  created_at?: string | null;
}

export interface CharacterActionMetadata {
  id: string;
  name: string;
  phrases: string[];
  videoPath: string;
  sortOrder?: number | null;
}

const generateActionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizePhraseList = (phrases: string[]): string[] =>
  phrases
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

const findActionRow = async (
  characterId: string,
  actionId: string
): Promise<CharacterActionRow | null> => {
  const selectColumns = '*';

  const byKey = await supabase
    .from(ACTIONS_TABLE)
    .select(selectColumns)
    .eq('character_id', characterId)
    .eq('action_key', actionId)
    .maybeSingle();

  if (byKey.data) {
    return byKey.data as CharacterActionRow;
  }

  if (byKey.error && byKey.error.code !== 'PGRST116') {
    throw byKey.error;
  }

  const byId = await supabase
    .from(ACTIONS_TABLE)
    .select(selectColumns)
    .eq('character_id', characterId)
    .eq('id', actionId)
    .maybeSingle();

  if (byId.data) {
    return byId.data as CharacterActionRow;
  }

  if (byId.error && byId.error.code !== 'PGRST116') {
    throw byId.error;
  }

  return null;
};

const extensionFromMimeType = (
  mimeType: string | null | undefined,
  fallback: string
): string => {
  if (!mimeType) return fallback;
  const [, rawSubtype] = mimeType.split('/');
  if (!rawSubtype) return fallback;
  return rawSubtype.split(';')[0] || fallback;
};

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not supported in this environment.');
  }
  const binaryString = globalThis.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

const downloadIdleVideo = async (path: string): Promise<Blob | null> => {
  try {
    const { data, error } = await supabase.storage
      .from(IDLE_VIDEO_BUCKET)
      .download(path);

    if (error) {
      console.error(
        `Failed to download idle video at path "${path}":`,
        error,
        `\nError details: ${JSON.stringify(error, null, 2)}`
      );
      // Try to provide helpful debugging info
      const errorMessage = error.message || String(error);
      if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
        console.error(
          `\n400 Bad Request suggests the path might be incorrect or the file doesn't exist. ` +
          `Expected format: "{character_id}/idle-video.{extension}" ` +
          `Actual path: "${path}"`
        );
      }
      return null;
    }

    return data;
  } catch (err) {
    console.error(`Unexpected error downloading idle video at path "${path}":`, err);
    return null;
  }
};

const downloadActionVideo = async (path: string): Promise<Blob | null> => {
  const { data, error } = await supabase.storage
    .from(ACTION_VIDEO_BUCKET)
    .download(path);

  if (error) {
    console.error(`Failed to download action video at path "${path}":`, error);
    return null;
  }

  return data;
};

const parseCommandPhrases = (
  phrases: CharacterActionRow['command_phrases']
): string[] => {
  if (!phrases) return [];
  if (Array.isArray(phrases)) {
    return phrases
      .map((phrase) => (phrase ?? '').trim())
      .filter((phrase) => phrase.length > 0);
  }
  if (typeof phrases === 'string') {
    const trimmed = phrases.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((phrase) =>
            typeof phrase === 'string' ? phrase.trim() : String(phrase)
          )
          .filter((phrase) => phrase.length > 0);
      }
    } catch (error) {
      // fall through to delimiter split
    }
    return trimmed
      .split(/[\n,;]+/)
      .map((phrase) => phrase.trim())
      .filter((phrase) => phrase.length > 0);
  }
  return [];
};

export const getCharacterActions = async (
  characterId: string
): Promise<CharacterAction[]> => {
  const { data, error } = await supabase
    .from(ACTIONS_TABLE)
    .select('*')
    .eq('character_id', characterId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error(
      `Failed to fetch actions for character "${characterId}":`,
      error
    );
    return [];
  }

  const rows = (data as CharacterActionRow[]) || [];

  const actions = await Promise.all(
    rows.map(async (row) => {
      if (!row.video_path) {
        console.warn(
          `Skipping action "${row.id}" for character "${characterId}" because it is missing a video path.`
        );
        return null;
      }

      const videoBlob = await downloadActionVideo(row.video_path);
      if (!videoBlob) {
        console.warn(
          `Skipping action "${row.id}" for character "${characterId}" because the video could not be downloaded.`
        );
        return null;
      }

      const actionId = (row.action_key || row.id || '').trim();
      const actionName =
        (row.display_name || row.action_key || row.id || 'Action').trim();

      const phrases = parseCommandPhrases(row.command_phrases);

      return {
        id: actionId || row.id,
        name: actionName,
        phrases,
        video: videoBlob,
        videoPath: row.video_path ?? '',
        sortOrder:
          typeof row.sort_order === 'number' ? row.sort_order : null,
      };
    })
  );

  return actions.filter((action) => action !== null) as CharacterAction[];
};

const buildCharacterProfile = async (row: CharacterRow): Promise<CharacterProfile | null> => {
  if (!row.idle_video_path) {
    console.warn(`Character "${row.id}" is missing idle video path.`);
    return null;
  }

  const idleVideoBlob = await downloadIdleVideo(row.idle_video_path);
  if (!idleVideoBlob) {
    console.warn(
      `Character "${row.id}" idle video could not be retrieved from path "${row.idle_video_path}". ` +
      `This might be due to: 1) File doesn't exist at that path, 2) Incorrect path format, 3) Storage permissions issue. ` +
      `Character will be skipped. Check Supabase storage bucket "${IDLE_VIDEO_BUCKET}" for the correct path.`
    );
    return null;
  }

  const actions = await getCharacterActions(row.id).catch((error) => {
    console.error(
      `Unexpected error while retrieving actions for "${row.id}":`,
      error
    );
    return [];
  });

  const imageBlob = base64ToBlob(row.image_base64, row.image_mime_type);
  const fileName =
    row.image_file_name ||
    `${row.id}.${extensionFromMimeType(row.image_mime_type, 'png')}`;
  const imageFile = new File([imageBlob], fileName, {
    type: row.image_mime_type,
  });

  return {
    id: row.id,
    createdAt:
      typeof row.created_at_ms === 'number'
        ? row.created_at_ms
        : Date.now(),
    image: {
      file: imageFile,
      base64: row.image_base64,
      mimeType: row.image_mime_type,
    },
    idleVideo: idleVideoBlob,
    actions,
    name: 'Kayley Adams',
    displayName: 'Kayley',
  };
};

const removeIdleVideo = async (path: string): Promise<void> => {
  if (!path) return;
  const { error } = await supabase.storage
    .from(IDLE_VIDEO_BUCKET)
    .remove([path]);
  if (error) {
    console.error(`Failed to remove idle video at path "${path}":`, error);
  }
};

export const hashImage = async (base64: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(base64);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const getCharacters = async (): Promise<CharacterProfile[]> => {
  const { data, error } = await supabase
    .from(CHARACTERS_TABLE)
    .select('*')
    .order('created_at_ms', { ascending: false });

  if (error) {
    console.error('Failed to fetch characters from Supabase:', error);
    return [];
  }

  const profiles = await Promise.all(
    ((data as CharacterRow[]) || []).map((row) => buildCharacterProfile(row))
  );

  return profiles.filter(
    (profile): profile is CharacterProfile => profile !== null
  );
};

export const saveCharacter = async (
  character: CharacterProfile
): Promise<void> => {
  const videoExtension = extensionFromMimeType(character.idleVideo.type, 'webm');
  const idleVideoPath = `${character.id}/idle-video.${videoExtension}`;

  const { error: uploadError } = await supabase.storage
    .from(IDLE_VIDEO_BUCKET)
    .upload(idleVideoPath, character.idleVideo, {
      upsert: true,
      contentType: character.idleVideo.type || 'video/webm',
    });

  if (uploadError) {
    console.error('Failed to upload idle video to Supabase:', uploadError);
    throw uploadError;
  }

  const { error } = await supabase
    .from(CHARACTERS_TABLE)
    .upsert(
      {
        id: character.id,
        created_at_ms: character.createdAt,
        image_base64: character.image.base64,
        image_mime_type: character.image.mimeType,
        image_file_name: character.image.file?.name ?? null,
        idle_video_path: idleVideoPath,
      }
    );

  if (error) {
    console.error('Failed to save character metadata to Supabase:', error);
    throw error;
  }
};

export const deleteCharacter = async (id: string): Promise<void> => {
  const { data, error: selectError } = await supabase
    .from(CHARACTERS_TABLE)
    .select('idle_video_path')
    .eq('id', id)
    .single();

  if (selectError && selectError.code !== 'PGRST116') {
    console.error('Failed to look up character before deletion:', selectError);
  }

  const row = data as { idle_video_path: string | null } | null;

  if (row?.idle_video_path) {
    await removeIdleVideo(row.idle_video_path);
  }

  const { data: actionRows, error: actionSelectError } = await supabase
    .from(ACTIONS_TABLE)
    .select('id, video_path')
    .eq('character_id', id);

  if (actionSelectError) {
    console.error(
      `Failed to fetch actions for character "${id}" before deletion:`,
      actionSelectError
    );
  }

  const actionVideoPaths =
    (actionRows as Pick<CharacterActionRow, 'id' | 'video_path'>[] | null)
      ?.map((action) => action.video_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0) ?? [];

  if (actionVideoPaths.length > 0) {
    const { error: removeActionsError } = await supabase.storage
      .from(ACTION_VIDEO_BUCKET)
      .remove(actionVideoPaths);
    if (removeActionsError) {
      console.error(
        `Failed to remove action videos for character "${id}":`,
        removeActionsError
      );
    }
  }

  const actionIds =
    (actionRows as Pick<CharacterActionRow, 'id'>[] | null)?.map(
      (action) => action.id
    ) ?? [];

  if (actionIds.length > 0) {
    const { error: deleteActionsError } = await supabase
      .from(ACTIONS_TABLE)
      .delete()
      .in('id', actionIds);
    if (deleteActionsError) {
      console.error(
        `Failed to delete action metadata for character "${id}":`,
        deleteActionsError
      );
    }
  }

  const { error } = await supabase.from(CHARACTERS_TABLE).delete().eq('id', id);

  if (error) {
    console.error('Failed to delete character from Supabase:', error);
  }
};

interface CreateCharacterActionInput {
  name: string;
  phrases: string[];
  video: Blob;
  sortOrder?: number | null;
  actionId?: string;
}

interface UpdateCharacterActionInput {
  name?: string;
  phrases?: string[];
  video?: Blob;
  sortOrder?: number | null;
}

export const createCharacterAction = async (
  characterId: string,
  input: CreateCharacterActionInput
): Promise<CharacterActionMetadata> => {
  const normalizedName = input.name?.trim() || 'Action';
  const phrases = normalizePhraseList(input.phrases ?? []);
  const actionId = input.actionId?.trim() || generateActionId();
  const extension = extensionFromMimeType(input.video.type, 'webm');
  const videoPath = `${characterId}/actions/${actionId}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ACTION_VIDEO_BUCKET)
    .upload(videoPath, input.video, {
      upsert: true,
      contentType: input.video.type || 'video/webm',
    });

  if (uploadError) {
    console.error(
      `Failed to upload action video for character "${characterId}":`,
      uploadError
    );
    throw uploadError;
  }

  const { error: upsertError } = await supabase
    .from(ACTIONS_TABLE)
    .upsert({
      id: actionId,
      character_id: characterId,
      action_key: actionId,
      display_name: normalizedName,
      video_path: videoPath,
      command_phrases: phrases.length > 0 ? phrases : null,
      sort_order: input.sortOrder ?? null,
    });

  if (upsertError) {
    console.error(
      `Failed to save action metadata for character "${characterId}":`,
      upsertError
    );
    throw upsertError;
  }

  return {
    id: actionId,
    name: normalizedName,
    phrases,
    videoPath,
    sortOrder: input.sortOrder ?? null,
  };
};

export const updateCharacterAction = async (
  characterId: string,
  actionId: string,
  input: UpdateCharacterActionInput
): Promise<CharacterActionMetadata> => {
  const row = await findActionRow(characterId, actionId);

  if (!row) {
    throw new Error(
      `Action "${actionId}" for character "${characterId}" does not exist.`
    );
  }

  const fallbackName = row.display_name || row.action_key || row.id || 'Action';
  const normalizedName =
    input.name !== undefined ? input.name.trim() || fallbackName : fallbackName;

  const phrases =
    input.phrases !== undefined
      ? normalizePhraseList(input.phrases)
      : parseCommandPhrases(row.command_phrases);

  let videoPath = row.video_path || '';

  if (input.video) {
    const extension = extensionFromMimeType(input.video.type, 'webm');
    const newVideoPath = `${characterId}/actions/${actionId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(ACTION_VIDEO_BUCKET)
      .upload(newVideoPath, input.video, {
        upsert: true,
        contentType: input.video.type || 'video/webm',
      });

    if (uploadError) {
      console.error(
        `Failed to upload updated action video for "${actionId}":`,
        uploadError
      );
      throw uploadError;
    }

    if (videoPath && videoPath !== newVideoPath) {
      const { error: removeError } = await supabase.storage
        .from(ACTION_VIDEO_BUCKET)
        .remove([videoPath]);
      if (removeError) {
        console.warn(
          `Failed to remove old action video "${videoPath}" for "${actionId}":`,
          removeError
        );
      }
    }

    videoPath = newVideoPath;
  }

  const updatePayload: Record<string, unknown> = {
    display_name: normalizedName,
    command_phrases: phrases.length > 0 ? phrases : null,
    video_path: videoPath || null,
  };

  if (input.sortOrder !== undefined) {
    updatePayload.sort_order = input.sortOrder;
  }

  if (!row.action_key || row.action_key.trim().length === 0) {
    updatePayload.action_key = actionId;
  }

  const { error: updateError } = await supabase
    .from(ACTIONS_TABLE)
    .update(updatePayload)
    .eq('id', row.id);

  if (updateError) {
    console.error(
      `Failed to update action metadata for "${actionId}":`,
      updateError
    );
    throw updateError;
  }

  return {
    id: actionId,
    name: normalizedName,
    phrases,
    videoPath,
    sortOrder:
      input.sortOrder !== undefined ? input.sortOrder : row.sort_order ?? null,
  };
};

export const deleteCharacterAction = async (
  characterId: string,
  actionId: string
): Promise<void> => {
  const row = await findActionRow(characterId, actionId);

  if (!row) {
    console.warn(
      `Attempted to delete missing action "${actionId}" for character "${characterId}".`
    );
    return;
  }

  if (row.video_path) {
    const { error: removeError } = await supabase.storage
      .from(ACTION_VIDEO_BUCKET)
      .remove([row.video_path]);
    if (removeError) {
      console.error(
        `Failed to remove action video "${row.video_path}" for "${actionId}":`,
        removeError
      );
      throw removeError;
    }
  }

  const { error: deleteError } = await supabase
    .from(ACTIONS_TABLE)
    .delete()
    .eq('id', row.id);

  if (deleteError) {
    console.error(
      `Failed to delete action "${actionId}" for character "${characterId}":`,
      deleteError
    );
    throw deleteError;
  }
};

export const getVideoCache = async (cacheKey: string): Promise<Blob[] | null> => {
  const { data, error } = await supabase.storage
    .from(VIDEO_CACHE_BUCKET)
    .list(cacheKey);

  if (error) {
    console.error(`Failed to list cached videos for key "${cacheKey}":`, error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const sorted = [...data].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  const downloads = await Promise.all(
    sorted.map(async (file) => {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(VIDEO_CACHE_BUCKET)
        .download(`${cacheKey}/${file.name}`);
      if (downloadError) {
        console.error(
          `Failed to download cached video "${file.name}" for key "${cacheKey}":`,
          downloadError
        );
        return null;
      }
      return blob;
    })
  );

  const blobs = downloads.filter((blob): blob is Blob => blob !== null);
  return blobs.length > 0 ? blobs : null;
};

export const setVideoCache = async (
  cacheKey: string,
  blobs: Blob[]
): Promise<void> => {
  const { data: existing, error: listError } = await supabase.storage
    .from(VIDEO_CACHE_BUCKET)
    .list(cacheKey);

  if (!listError && existing && existing.length > 0) {
    const paths = existing.map((file) => `${cacheKey}/${file.name}`);
    const { error: removeError } = await supabase.storage
      .from(VIDEO_CACHE_BUCKET)
      .remove(paths);
    if (removeError) {
      console.error(
        `Failed to clear existing cache entries for key "${cacheKey}":`,
        removeError
      );
    }
  }

  await Promise.all(
    blobs.map(async (blob, index) => {
      const extension = extensionFromMimeType(blob.type, 'webm');
      const path = `${cacheKey}/${index}.${extension}`;
      const { error } = await supabase.storage
        .from(VIDEO_CACHE_BUCKET)
        .upload(path, blob, {
          upsert: true,
          contentType: blob.type || 'application/octet-stream',
        });
      if (error) {
        console.error(
          `Failed to upload cached video "${path}" for key "${cacheKey}":`,
          error
        );
      }
    })
  );
};
