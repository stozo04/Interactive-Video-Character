import sharp from 'sharp';

/**
 * Converts any image buffer (PNG, JPEG, etc.) or base64 string 
 * into a WhatsApp-compliant WebP sticker.
 */
export async function createWhatsAppSticker(imageInput: Buffer | string): Promise<Buffer> {
    // If a base64 string is passed instead of a Buffer, convert it first
    const imageBuffer = typeof imageInput === 'string' 
        ? Buffer.from(imageInput, 'base64') 
        : imageInput;

    return await sharp(imageBuffer)
        .resize(512, 512, {
            fit: 'contain', // Keeps aspect ratio, adds transparent padding if needed
            background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .webp({ quality: 80 }) // Convert to WebP format
        .toBuffer();
}