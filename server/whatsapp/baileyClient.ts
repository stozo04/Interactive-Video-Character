import baileysPkg, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers,
  fetchLatestWaWebVersion,
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
// 1. Import the QR code library!
import qrcode from 'qrcode-terminal';
import sharp from "sharp";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import type { UserContent } from "../../src/services/aiService";
import { log } from "../runtimeLogger";

const makeWASocket = baileysPkg.default || baileysPkg;
const LOG_PREFIX = "[Baileys]";
const AUTH_DIR = ".whatsapp-auth";
const MAX_RECONNECT_ATTEMPTS = 8;
const MAX_CONSECUTIVE_405_FAILURES = 3;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 15000;
const runtimeLog = log.fromContext({ source: "baileysClient", route: "whatsapp" });

export const sentMessageIds = new Set<string>();
export type WASocket = ReturnType<typeof makeWASocket>;

export async function startWhatsAppClient(
    onMessage: (sock: WASocket, text: string, jid: string, replyJid: string, userContent?: UserContent) => Promise<void>
) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const browserDescription = Browsers.windows("Chrome");
    let resolvedVersion: [number, number, number] | undefined;
    let versionSource = "baileys_default";
    let reconnectAttempts = 0;
    let consecutive405Failures = 0;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let stopped = false;

    try {
        const latestVersionResult = await fetchLatestWaWebVersion();
        if ("error" in latestVersionResult && latestVersionResult.error) {
            console.warn(`${LOG_PREFIX} Failed to fetch latest WA Web version, using Baileys default`, {
                error: latestVersionResult.error,
            });
            runtimeLog.warning("Failed to fetch latest WA Web version", {
                source: "baileysClient",
                error: serializeErrorForLog(latestVersionResult.error),
                fallback: "baileys_default",
            });
        } else {
            resolvedVersion = latestVersionResult.version;
            versionSource = latestVersionResult.isLatest ? "wa_web_latest" : "wa_web_fallback";
            console.log(`${LOG_PREFIX} Using WhatsApp Web version`, {
                version: resolvedVersion,
                versionSource,
                browser: browserDescription,
            });
            runtimeLog.info("Resolved WhatsApp Web client version", {
                source: "baileysClient",
                version: resolvedVersion.join("."),
                versionTuple: resolvedVersion,
                versionSource,
                browser: browserDescription,
            });
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} WA Web version fetch threw, using Baileys default`, error);
        runtimeLog.warning("WA Web version fetch threw; using Baileys default", {
            source: "baileysClient",
            error: serializeErrorForLog(error),
            fallback: "baileys_default",
        });
    }

    console.log(`${LOG_PREFIX} Auth state directory: ${AUTH_DIR}`);
    runtimeLog.info("WhatsApp client starting", {
        source: "baileysClient",
        authDir: AUTH_DIR,
        maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        maxConsecutive405Failures: MAX_CONSECUTIVE_405_FAILURES,
        browser: browserDescription,
        version: resolvedVersion?.join(".") ?? "baileys_default",
        versionSource,
    });

    const scheduleReconnect = (reason: string) => {
        if (stopped) return;
        if (reconnectTimer) {
            return;
        }

        reconnectAttempts += 1;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            stopped = true;
            console.error(`${LOG_PREFIX} Reconnect attempts exceeded (${MAX_RECONNECT_ATTEMPTS}). Stopping WhatsApp auto-reconnect.`);
            console.error(`${LOG_PREFIX} If this persists, delete ${AUTH_DIR} and re-pair by scanning a new QR code.`);
            runtimeLog.error("WhatsApp reconnect attempts exceeded", {
                source: "baileysClient",
                reconnectAttempts,
                maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
                authDir: AUTH_DIR,
            });
            return;
        }

        const delayMs = Math.min(BASE_RECONNECT_DELAY_MS * reconnectAttempts, MAX_RECONNECT_DELAY_MS);
        console.warn(`${LOG_PREFIX} Scheduling reconnect`, {
            attempt: reconnectAttempts,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            delayMs,
            reason,
        });
        runtimeLog.warning("Scheduling WhatsApp reconnect", {
            source: "baileysClient",
            attempt: reconnectAttempts,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            delayMs,
            reason,
        });

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect();
        }, delayMs);
    };

    const stopForManualRecovery = (message: string, details?: unknown) => {
        stopped = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        console.error(`${LOG_PREFIX} ${message}`, details ?? "");
        console.error(`${LOG_PREFIX} Manual recovery required: remove ${AUTH_DIR} and restart \`npm run whatsapp:dev\` to re-pair.`);
        console.error(`${LOG_PREFIX} PowerShell example (do not run while bridge is active): Remove-Item -Recurse -Force ${AUTH_DIR}`);
        runtimeLog.error("WhatsApp manual recovery required", {
            source: "baileysClient",
            authDir: AUTH_DIR,
            message,
            details: serializeErrorForLog(details),
        });
    };

    const connect = async (): Promise<void> => {
        if (stopped) return;

        const sock = makeWASocket({
            auth: state,
            browser: browserDescription,
            ...(resolvedVersion ? { version: resolvedVersion } : {}),
            syncFullHistory: false,
            // 2. We removed the deprecated printQRInTerminal flag here!
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`${LOG_PREFIX} Scan this QR code with your WhatsApp:`);
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'open') {
                reconnectAttempts = 0;
                consecutive405Failures = 0;
                console.log(`${LOG_PREFIX} Opened connection successfully!`);
                runtimeLog.info("WhatsApp connection opened", {
                    source: "baileysClient",
                });
                return;
            }

            if (connection !== 'close') {
                return;
            }

            const disconnectError = lastDisconnect?.error as Boom | undefined;
            const statusCode = disconnectError?.output?.statusCode;
            const errorData = (disconnectError as any)?.data;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const is405Failure = statusCode === 405 || errorData?.reason === "405";

            if (is405Failure) {
                consecutive405Failures += 1;
            } else {
                consecutive405Failures = 0;
            }

            console.warn(`${LOG_PREFIX} Connection closed`, {
                statusCode,
                reason: errorData?.reason,
                location: errorData?.location,
                reconnectAttempts,
                consecutive405Failures,
                isLoggedOut,
            });
            runtimeLog.warning("WhatsApp connection closed", {
                source: "baileysClient",
                statusCode: statusCode ?? null,
                reason: typeof errorData?.reason === "string" ? errorData.reason : null,
                location: typeof errorData?.location === "string" ? errorData.location : null,
                reconnectAttempts,
                consecutive405Failures,
                isLoggedOut,
                error: serializeErrorForLog(disconnectError),
            });

            if (isLoggedOut) {
                stopForManualRecovery("WhatsApp session is logged out.", disconnectError);
                return;
            }

            if (consecutive405Failures >= MAX_CONSECUTIVE_405_FAILURES) {
                stopForManualRecovery(
                    `Repeated WhatsApp login failures (HTTP 405) detected (${consecutive405Failures} in a row). This usually means the saved web session is stale or rejected.`,
                    disconnectError
                );
                return;
            }

            scheduleReconnect(
                is405Failure
                    ? `http_405_failure_${consecutive405Failures}`
                    : `disconnect_${statusCode ?? "unknown"}`
            );
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
    };

    await connect();
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

function serializeErrorForLog(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const boomError = error as Boom & { data?: Record<string, unknown> };

  return {
    name: "name" in boomError ? String((boomError as any).name ?? "") : undefined,
    message: "message" in boomError ? String((boomError as any).message ?? "") : undefined,
    statusCode: boomError.output?.statusCode,
    reason:
      boomError.data && typeof boomError.data.reason === "string"
        ? boomError.data.reason
        : undefined,
    location:
      boomError.data && typeof boomError.data.location === "string"
        ? boomError.data.location
        : undefined,
    isBoom: "isBoom" in boomError ? Boolean((boomError as any).isBoom) : undefined,
    isServer: "isServer" in boomError ? Boolean((boomError as any).isServer) : undefined,
  };
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
