import type { UploadedImage } from '../types';

export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export interface ImageAttachmentOptions {
  maxBytes?: number;
}

export function getFirstImageFileFromClipboard(
  items: ClipboardItemLike[]
): File | null {
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (!item.type || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export async function buildImageAttachment(
  file: File,
  options: ImageAttachmentOptions = {}
): Promise<UploadedImage> {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached.');
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    throw new Error(`Image too large (max ${maxMb} MB).`);
  }

  const base64 = await arrayBufferToBase64(await file.arrayBuffer());
  return {
    file,
    base64,
    mimeType: file.type || 'image/png',
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
