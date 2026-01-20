import { describe, expect, it } from 'vitest';
import {
  buildImageAttachment,
  getFirstImageFileFromClipboard,
  type ClipboardItemLike,
} from '../clipboardImage';

const createBlobAsFile = (content: string, type: string): File => {
  return new Blob([content], { type }) as unknown as File;
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
    const imageFile = createBlobAsFile('img', 'image/png');
    const items: ClipboardItemLike[] = [
      { kind: 'file', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => imageFile },
    ];

    expect(getFirstImageFileFromClipboard(items)).toBe(imageFile);
  });
});

describe('buildImageAttachment', () => {
  it('converts an image file to base64', async () => {
    const file = createBlobAsFile('abc', 'image/png');
    const attachment = await buildImageAttachment(file, { maxBytes: 10 });

    expect(attachment.base64).toBe('YWJj');
    expect(attachment.mimeType).toBe('image/png');
  });

  it('rejects non-image files', async () => {
    const file = createBlobAsFile('abc', 'text/plain');
    await expect(buildImageAttachment(file, { maxBytes: 10 })).rejects.toThrow(
      'Only image files can be attached.'
    );
  });

  it('rejects files larger than the max size', async () => {
    const file = createBlobAsFile('abcd', 'image/png');
    await expect(buildImageAttachment(file, { maxBytes: 3 })).rejects.toThrow(
      'Image too large'
    );
  });
});
