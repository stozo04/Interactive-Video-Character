import { describe, expect, it } from 'vitest';
import {
  buildFileAttachment,
  buildImageAttachment,
  getFirstImageFileFromClipboard,
  type ClipboardItemLike,
} from '../clipboardImage';

const createFile = (content: string, type: string, name: string = 'file.txt'): File => {
  return new File([content], name, { type });
};

describe('getFirstImageFileFromClipboard', () => {
  it('returns null when no image items exist', () => {
    const items: ClipboardItemLike[] = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'text/plain', getAsFile: () => null },
    ];

    expect(getFirstImageFileFromClipboard(items)).toBeNull();
  });

  it('returns the first image file when present', () => {
    const imageFile = createFile('img', 'image/png', 'image.png');
    const items: ClipboardItemLike[] = [
      { kind: 'file', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => imageFile },
    ];

    expect(getFirstImageFileFromClipboard(items)).toBe(imageFile);
  });
});

describe('buildImageAttachment', () => {
  it('converts an image file to base64', async () => {
    const file = createFile('abc', 'image/png', 'image.png');
    const attachment = await buildImageAttachment(file, { maxBytes: 10 });

    expect(attachment.base64).toBe('YWJj');
    expect(attachment.mimeType).toBe('image/png');
  });

  it('rejects non-image files', async () => {
    const file = createFile('abc', 'text/plain', 'note.txt');
    await expect(buildImageAttachment(file, { maxBytes: 10 })).rejects.toThrow(
      'Only image files can be attached.'
    );
  });

  it('rejects files larger than the max size', async () => {
    const file = createFile('abcd', 'image/png', 'image.png');
    await expect(buildImageAttachment(file, { maxBytes: 3 })).rejects.toThrow(
      'Image too large'
    );
  });
});

describe('buildFileAttachment', () => {
  it('reads text files into attachments', async () => {
    const file = createFile('hello world', 'text/plain', 'note.txt');
    const attachment = await buildFileAttachment(file, { maxBytes: 100, maxChars: 100 });

    expect(attachment.kind).toBe('file');
    expect(attachment.fileName).toBe('note.txt');
    expect(attachment.text).toBe('hello world');
    expect(attachment.truncated).toBe(false);
  });

  it('rejects unsupported file types', async () => {
    const file = createFile('abc', 'application/octet-stream', 'blob.bin');
    await expect(buildFileAttachment(file, { maxBytes: 10, maxChars: 10 })).rejects.toThrow(
      'Unsupported file type'
    );
  });

  it('rejects files larger than the max size', async () => {
    const file = createFile('abcd', 'text/plain', 'note.txt');
    await expect(buildFileAttachment(file, { maxBytes: 3, maxChars: 100 })).rejects.toThrow(
      'File too large'
    );
  });

  it('truncates large text content', async () => {
    const file = createFile('abcdef', 'text/plain', 'note.txt');
    const attachment = await buildFileAttachment(file, { maxBytes: 100, maxChars: 3 });

    expect(attachment.truncated).toBe(true);
    expect(attachment.text).toContain('Attachment truncated');
  });
});
