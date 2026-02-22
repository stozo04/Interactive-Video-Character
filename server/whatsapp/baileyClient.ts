import baileysPkg, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
// 1. Import the QR code library!
import qrcode from 'qrcode-terminal';
import sharp from "sharp";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import type { UserContent } from "../../src/services/aiService";

const makeWASocket = baileysPkg.default || baileysPkg;
const LOG_PREFIX = "[Baileys]";

export const sentMessageIds = new Set<string>();
export type WASocket = ReturnType<typeof makeWASocket>;

export async function startWhatsAppClient(
    onMessage: (sock: WASocket, text: string, jid: string, replyJid: string, userContent?: UserContent) => Promise<void>
) {
    const { state, saveCreds } = await useMultiFileAuthState('.whatsapp-auth');
    
    const sock = makeWASocket({
        auth: state,
        // 2. We removed the deprecated printQRInTerminal flag here!
    });

    sock.ev.on('connection.update', (update) => {
        // 3. Extract 'qr' from the update payload
        const { connection, lastDisconnect, qr } = update;
        
        // 4. If a QR code string is received, draw it in the terminal!
        if (qr) {
            console.log(`${LOG_PREFIX} Scan this QR code with your WhatsApp:`);
            qrcode.generate(qr, { small: true });
        }

        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`${LOG_PREFIX} Connection closed due to `, lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if(shouldReconnect) {
                startWhatsAppClient(onMessage);
            }
        } else if(connection === 'open') {
            console.log(`${LOG_PREFIX} Opened connection successfully!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (event) => {
        if (event.type !== "notify") return;

        for (const m of event.messages) {
            const remoteJid = m.key.remoteJid;
            if (!remoteJid) continue;

            if (m.key.id && sentMessageIds.has(m.key.id)) {
                sentMessageIds.delete(m.key.id);
                continue;
            }

            if (m.key.fromMe && m.key.id?.startsWith("BAE5")) {
                continue;
            }
            // --- MEDIA DETECTION ---
            const isSticker = !!m.message?.stickerMessage;
            // GIFs are just videoMessages with the gifPlayback flag set to true
            const isGif = !!m.message?.videoMessage?.gifPlayback; 
            const isImage = !!m.message?.imageMessage;
            const isVideo = !!m.message?.videoMessage && !isGif;

            // Extract normal text if it exists
            let text =
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                m.message?.videoMessage?.caption ||
                "";

            // If it's a sticker or GIF without text, give the AI some context
            if (isSticker && !text) {
                text = "[User sent a sticker]";
                // Optional: Download the WebP to pass to Gemini Vision
                // const mediaBuffer = await downloadMediaMessage(m, 'buffer', { }, { logger: console as any });
            } else if (isGif && !text) {
                text = "[User sent a GIF]";
            } else if (isImage && !text) {
                text = "[User sent an image]";
            } else if (isVideo && !text) {
                text = "[User sent a video]";
            }

            if (text) {
                // NATIVE V7 ROUTING
                const userContent = await buildUserContentFromMedia(m, {
                  isSticker,
                  isGif,
                  isImage,
                  isVideo,
                  fallbackText: text,
                });
                await onMessage(sock, text, remoteJid, remoteJid, userContent || undefined);
            }
        }
    });
}

async function buildUserContentFromMedia(
  message: any,
  mediaFlags: {
    isSticker: boolean;
    isGif: boolean;
    isImage: boolean;
    isVideo: boolean;
    fallbackText: string;
  }
): Promise<UserContent | null> {
  const { isSticker, isGif, isImage, isVideo, fallbackText } = mediaFlags;

  if (!isSticker && !isImage && !isGif && !isVideo) {
    return null;
  }

  try {
    const mediaBuffer = await downloadMediaMessage(
      message,
      "buffer",
      {},
      { logger: console as any }
    );

    if (!mediaBuffer || !(mediaBuffer instanceof Buffer)) {
      console.warn(`${LOG_PREFIX} [MEDIA] Download returned no buffer`);
      return null;
    }

    if (isSticker || isImage) {
      const jpegBuffer = await sharp(mediaBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      console.log(`${LOG_PREFIX} [MEDIA] Image prepared for Gemini`, {
        bytes: jpegBuffer.length,
      });
      return {
        type: "image_text",
        text: fallbackText,
        imageData: jpegBuffer.toString("base64"),
        mimeType: "image/jpeg",
      };
    }

    if (isGif || isVideo) {
      const frame = await extractVideoFrameToJpeg(mediaBuffer);
      if (!frame) {
        return null;
      }
      console.log(`${LOG_PREFIX} [MEDIA] Video frame prepared for Gemini`, {
        bytes: frame.length,
      });
      return {
        type: "image_text",
        text: fallbackText,
        imageData: frame.toString("base64"),
        mimeType: "image/jpeg",
      };
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} [MEDIA] Failed to prepare media:`, error);
  }

  return null;
}

async function extractVideoFrameToJpeg(inputBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-media-"));
  const inputPath = path.join(tmpDir, "input.mp4");
  const outputPath = path.join(tmpDir, "frame.jpg");

  try {
    fs.writeFileSync(inputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vf",
        "select=eq(n\\,0)",
        "-vframes",
        "1",
        "-q:v",
        "2",
        outputPath,
      ];
      execFile("ffmpeg", args, { timeout: 15000 }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const frameBuffer = fs.readFileSync(outputPath);
    return frameBuffer.length > 0 ? frameBuffer : null;
  } catch (error) {
    console.error(`${LOG_PREFIX} [MEDIA] ffmpeg frame extraction failed:`, error);
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`${LOG_PREFIX} [MEDIA] Temp cleanup failed:`, cleanupError);
    }
  }
}
