import sharp from 'sharp';
import { log } from '../runtimeLogger';

const LOG_PREFIX = '[ServerSticker]';
const runtimeLog = log.fromContext({ source: 'serverSticker', route: 'whatsapp/sticker' });

/**
 * Converts any image buffer (PNG, JPEG, etc.) or base64 string
 * into a WhatsApp-compliant WebP sticker.
 */
export async function createWhatsAppSticker(imageInput: Buffer | string): Promise<Buffer> {
    const inputType = typeof imageInput === 'string' ? 'base64' : 'buffer';
    const inputSize = typeof imageInput === 'string' ? imageInput.length : imageInput.length;

    runtimeLog.info('WhatsApp sticker creation requested', {
        source: 'serverSticker',
        inputType,
        inputSize,
        timestamp: new Date().toISOString(),
    });

    try {
        // If a base64 string is passed instead of a Buffer, convert it first
        let imageBuffer: Buffer;

        if (typeof imageInput === 'string') {
            runtimeLog.info('Converting base64 string to buffer', {
                source: 'serverSticker',
                base64Length: imageInput.length,
            });

            try {
                imageBuffer = Buffer.from(imageInput, 'base64');
                runtimeLog.info('Base64 string converted to buffer successfully', {
                    source: 'serverSticker',
                    base64Length: imageInput.length,
                    bufferSize: imageBuffer.length,
                });
            } catch (base64Error) {
                runtimeLog.error('Failed to convert base64 string to buffer', {
                    source: 'serverSticker',
                    error: base64Error instanceof Error ? base64Error.message : String(base64Error),
                    base64Length: imageInput.length,
                });
                throw new Error(`Invalid base64 input: ${base64Error instanceof Error ? base64Error.message : 'unknown error'}`);
            }
        } else {
            imageBuffer = imageInput;
            runtimeLog.info('Using provided image buffer', {
                source: 'serverSticker',
                bufferSize: imageBuffer.length,
            });
        }

        runtimeLog.info('Detecting image metadata with sharp', {
            source: 'serverSticker',
            bufferSize: imageBuffer.length,
        });

        // Detect image metadata for logging
        let imageMetadata: sharp.Metadata | undefined;
        try {
            imageMetadata = await sharp(imageBuffer).metadata();
            runtimeLog.info('Image metadata detected', {
                source: 'serverSticker',
                format: imageMetadata.format,
                width: imageMetadata.width,
                height: imageMetadata.height,
                hasAlpha: imageMetadata.hasAlpha,
                colorspace: imageMetadata.colorspace,
            });
        } catch (metadataError) {
            runtimeLog.warning('Failed to detect image metadata', {
                source: 'serverSticker',
                error: metadataError instanceof Error ? metadataError.message : String(metadataError),
                bufferSize: imageBuffer.length,
            });
        }

        runtimeLog.info('Resizing image to 512x512 with transparent background', {
            source: 'serverSticker',
            targetWidth: 512,
            targetHeight: 512,
            fit: 'contain',
            backgroundColor: 'transparent',
        });

        const resizedImage = await sharp(imageBuffer)
            .resize(512, 512, {
                fit: 'contain', // Keeps aspect ratio, adds transparent padding if needed
                background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
            });

        runtimeLog.info('Image resized successfully, converting to WebP format', {
            source: 'serverSticker',
            quality: 80,
            format: 'webp',
        });

        const webpBuffer = await resizedImage
            .webp({ quality: 80 }) // Convert to WebP format
            .toBuffer();

        const compressionRatio = ((1 - webpBuffer.length / imageBuffer.length) * 100).toFixed(2);

        runtimeLog.info('WhatsApp sticker created successfully', {
            source: 'serverSticker',
            inputSize: imageBuffer.length,
            outputSize: webpBuffer.length,
            compressionRatio: `${compressionRatio}%`,
            quality: 80,
            format: 'webp',
            targetResolution: '512x512',
            estimatedTransferTime: `${(webpBuffer.length / 1024 / 50).toFixed(2)}s @ 50KB/s`,
        });

        return webpBuffer;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = error instanceof Error ? error.constructor.name : 'unknown';

        runtimeLog.error('Failed to create WhatsApp sticker', {
            source: 'serverSticker',
            inputType,
            inputSize,
            error: errorMessage,
            errorType,
        });

        console.error(`${LOG_PREFIX} Sticker creation failed:`, error);
        throw error;
    }
}