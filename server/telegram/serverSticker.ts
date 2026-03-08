import sharp from 'sharp';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[ServerSticker]';
const runtimeLog = log.fromContext({ source: 'serverSticker', route: 'telegram/sticker' });

/**
 * Converts any image buffer (PNG, JPEG, etc.) or base64 string
 *  into a 512×512 WebP sticker (compatible with both WhatsApp and Telegram).
 */
export async function createSticker(imageInput: Buffer | string): Promise<Buffer> {
  const inputType = typeof imageInput === 'string' ? 'base64' : 'buffer';
  const inputSize = typeof imageInput === 'string' ? imageInput.length : imageInput.length;

  runtimeLog.info('Sticker creation requested', {
    source: 'serverSticker',
    inputType,
    inputSize,
  });

  let imageBuffer: Buffer;

  if (typeof imageInput === 'string') {
    try {
      imageBuffer = Buffer.from(imageInput, 'base64');
    } catch (base64Error) {
      throw new Error(`Invalid base64 input: ${base64Error instanceof Error ? base64Error.message : 'unknown error'}`);
    }
  } else {
    imageBuffer = imageInput;
  }

  try {
    const webpBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 80 })
      .toBuffer();

    runtimeLog.info('Sticker created successfully', {
      source: 'serverSticker',
      inputSize: imageBuffer.length,
      outputSize: webpBuffer.length,
    });

    return webpBuffer;
  } catch (error) {
    runtimeLog.error('Failed to create sticker', {
      source: 'serverSticker',
      inputType,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`${LOG_PREFIX} Sticker creation failed:`, error);
    throw error;
  }
}
