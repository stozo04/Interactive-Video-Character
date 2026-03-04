import type { PendingFileAttachment, UploadedImage } from '../types';

export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 1 * 1024 * 1024;
export const DEFAULT_MAX_FILE_CHARS = 100_000;

export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export interface ImageAttachmentOptions {
  maxBytes?: number;
}

export interface FileAttachmentOptions {
  maxBytes?: number;
  maxChars?: number;
}

const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/x-log',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
]);

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'pdf',
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'cs',
  'py',
  'java',
  'rb',
  'go',
  'rs',
  'yaml',
  'yml',
  'toml',
  'csv',
  'log',
  'ini',
  'cfg',
  'xml',
  'sql',
  'html',
  'css',
]);

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

export function isSupportedFileAttachment(file: File): boolean {
  const mimeType = file.type?.toLowerCase() || '';
  if (mimeType.startsWith('image/')) return false;
  if (mimeType === 'application/pdf') return true;
  if (mimeType.startsWith('text/')) return true;
  if (SUPPORTED_TEXT_MIME_TYPES.has(mimeType)) return true;

  const extension = getFileExtension(file.name);
  return extension ? SUPPORTED_TEXT_EXTENSIONS.has(extension) : false;
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

export async function buildFileAttachment(
  file: File,
  options: FileAttachmentOptions = {}
): Promise<PendingFileAttachment> {
  if (!isSupportedFileAttachment(file)) {
    throw new Error('Unsupported file type. Please attach a text or PDF file.');
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (file.size > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    throw new Error(`File too large (max ${maxMb} MB).`);
  }

  const extension = getFileExtension(file.name) || 'txt';
  const isPdf = isPdfFile(file, extension);
  const rawText = isPdf ? await extractPdfText(file) : await file.text();
  const maxChars = options.maxChars ?? DEFAULT_MAX_FILE_CHARS;
  const { text, truncated } = truncateText(rawText, maxChars);

  return {
    kind: 'file',
    fileName: file.name || `attachment.${extension}`,
    mimeType: file.type || (isPdf ? 'application/pdf' : 'text/plain'),
    size: file.size,
    extension,
    text,
    truncated,
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

function getFileExtension(name: string): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return null;
  return trimmed.slice(lastDot + 1).toLowerCase();
}

function isPdfFile(file: File, extension?: string | null): boolean {
  const mimeType = file.type?.toLowerCase() || '';
  return mimeType === 'application/pdf' || extension === 'pdf';
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const clipped = text.slice(0, maxChars);
  return {
    text: `${clipped}\n\n[Attachment truncated after ${maxChars} characters.]`,
    truncated: true,
  };
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist');
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
  const pdf = await loadingTask.promise;
  let output = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = (content.items || [])
      .map((item: any) => item?.str || '')
      .filter(Boolean)
      .join(' ');
    output += `${pageText}\n`;
  }

  return output.trim();
}
