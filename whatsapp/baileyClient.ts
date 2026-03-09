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
import type { UserContent } from "../src/services/aiService";
import { log } from "../lib/logger";

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

// Module-level socket reference so emailBridge can send proactive messages
let _activeSock: WASocket | null = null;
let _isConnected = false;
export function getActiveSock(): WASocket | null { return _activeSock; }
export function isWhatsAppConnected(): boolean { return _isConnected; }

export async function startWhatsAppClient(
    onMessage: (
        sock: WASocket,
        text: string,
        jid: string,
        replyJid: string,
        userContent?: UserContent,
        inboundMessageId?: string
    ) => Promise<void>
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
        const latestVersionResult = await fetchLatestWaWebVersion({});
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
        if (stopped) {
            runtimeLog.warning("Connect called but client is stopped", {
                source: "baileysClient",
            });
            return;
        }

        runtimeLog.info("Creating WhatsApp socket connection", {
            source: "baileysClient",
            versionSource,
            hasVersion: !!resolvedVersion,
        });

        const sock = makeWASocket({
            auth: state,
            browser: browserDescription,
            ...(resolvedVersion ? { version: resolvedVersion } : {}),
            syncFullHistory: false,
            // 2. We removed the deprecated printQRInTerminal flag here!
        });

        // Make socket available for proactive sends (emailBridge, etc.)
        _activeSock = sock;

        sock.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`${LOG_PREFIX} Scan this QR code with your WhatsApp:`);
                qrcode.generate(qr, { small: true });
                runtimeLog.info("QR code generated for WhatsApp pairing", {
                    source: "baileysClient",
                    qrLength: qr.length,
                });
                return;
            }

            if (connection === 'open') {
                reconnectAttempts = 0;
                consecutive405Failures = 0;
                _isConnected = true;
                runtimeLog.info("WhatsApp connection state set to connected", {
                    source: "baileysClient",
                    isConnected: true,
                });
                console.log(`${LOG_PREFIX} Opened connection successfully!`);
                runtimeLog.info("WhatsApp connection opened successfully", {
                    source: "baileysClient",
                    connected: true,
                });
                return;
            }

            if (connection !== 'close') {
                runtimeLog.info("WhatsApp connection state changed", {
                    source: "baileysClient",
                    connection,
                });
                return;
            }

            // Socket is dead — clear reference so proactive senders back off
            _activeSock = null;
            _isConnected = false;
            runtimeLog.info("WhatsApp connection state set to disconnected", {
                source: "baileysClient",
                isConnected: false,
            });

            const disconnectError = lastDisconnect?.error as Boom | undefined;
            const statusCode = disconnectError?.output?.statusCode;
            const errorData = (disconnectError as any)?.data;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const is405Failure = statusCode === 405 || errorData?.reason === "405";
            const isConflict =
                statusCode === 440 ||
                errorData?.reason === "conflict" ||
                errorData?.reason === "replaced" ||
                errorData?.type === "replaced";

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
            runtimeLog.error("WhatsApp connection closed unexpectedly", {
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
                runtimeLog.critical("WhatsApp session logged out - manual recovery required", {
                    source: "baileysClient",
                    statusCode,
                    error: serializeErrorForLog(disconnectError),
                });
                stopForManualRecovery("WhatsApp session is logged out.", disconnectError);
                return;
            }

            if (isConflict) {
                runtimeLog.critical("WhatsApp session replaced by another connection (conflict/440)", {
                    source: "baileysClient",
                    statusCode,
                    reason: typeof errorData?.reason === "string" ? errorData.reason : null,
                    error: serializeErrorForLog(disconnectError),
                });
                stopForManualRecovery(
                    "WhatsApp session was replaced by another connection (conflict/440). Close other linked devices or delete auth and re-pair.",
                    disconnectError
                );
                return;
            }

            if (consecutive405Failures >= MAX_CONSECUTIVE_405_FAILURES) {
                runtimeLog.critical("Repeated 405 failures detected - manual recovery required", {
                    source: "baileysClient",
                    consecutive405Failures,
                    maxConsecutive405Failures: MAX_CONSECUTIVE_405_FAILURES,
                    statusCode,
                    error: serializeErrorForLog(disconnectError),
                });
                stopForManualRecovery(
                    `Repeated WhatsApp login failures (HTTP 405) detected (${consecutive405Failures} in a row). This usually means the saved web session is stale or rejected.`,
                    disconnectError
                );
                return;
            }

            runtimeLog.warning("Scheduling WhatsApp reconnect after disconnect", {
                source: "baileysClient",
                statusCode,
                is405Failure,
                reconnectAttempt: reconnectAttempts + 1,
                reason: is405Failure ? `http_405_failure_${consecutive405Failures}` : `disconnect_${statusCode ?? "unknown"}`,
            });

            scheduleReconnect(
                is405Failure
                    ? `http_405_failure_${consecutive405Failures}`
                    : `disconnect_${statusCode ?? "unknown"}`
            );
        });

        sock.ev.on('creds.update', (_creds: any) => {
            runtimeLog.info("WhatsApp credentials updated", {
                source: "baileysClient",
            });
            saveCreds();
        });

        sock.ev.on('messages.upsert', async (event: any) => {
            if (event.type !== "notify") {
                runtimeLog.info("WhatsApp messages.upsert non-notify event received", {
                    source: "baileysClient",
                    type: event.type,
                });
                return;
            }

            runtimeLog.info("WhatsApp messages received", {
                source: "baileysClient",
                messageCount: event.messages.length,
            });

            for (const m of event.messages) {
                const remoteJid = m.key.remoteJid;
                if (!remoteJid) {
                    runtimeLog.warning("WhatsApp message missing remoteJid", {
                        source: "baileysClient",
                    });
                    continue;
                }

                if (m.key.id && sentMessageIds.has(m.key.id)) {
                    runtimeLog.info("Skipping locally sent message", {
                        source: "baileysClient",
                        messageId: m.key.id,
                        remoteJid,
                    });
                    sentMessageIds.delete(m.key.id);
                    continue;
                }

                if (m.key.fromMe && m.key.id?.startsWith("BAE5")) {
                    runtimeLog.info("Skipping BAE5 internal message", {
                        source: "baileysClient",
                        messageId: m.key.id,
                    });
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
                    runtimeLog.info("Detected sticker message", {
                        source: "baileysClient",
                        remoteJid,
                    });
                    // Optional: Download the WebP to pass to Gemini Vision
                    // const mediaBuffer = await downloadMediaMessage(m, 'buffer', { }, { logger: console as any });
                } else if (isGif && !text) {
                    text = "[User sent a GIF]";
                    runtimeLog.info("Detected GIF message", {
                        source: "baileysClient",
                        remoteJid,
                    });
                } else if (isImage && !text) {
                    text = "[User sent an image]";
                    runtimeLog.info("Detected image message", {
                        source: "baileysClient",
                        remoteJid,
                    });
                } else if (isVideo && !text) {
                    text = "[User sent a video]";
                    runtimeLog.info("Detected video message", {
                        source: "baileysClient",
                        remoteJid,
                    });
                } else if (text) {
                    runtimeLog.info("Received text message", {
                        source: "baileysClient",
                        remoteJid,
                        textLength: text.length,
                    });
                }

                if (text) {
                    try {
                        // NATIVE V7 ROUTING
                        runtimeLog.info("Processing message with media detection", {
                            source: "baileysClient",
                            remoteJid,
                            hasMedia: isSticker || isGif || isImage || isVideo,
                            mediaTypes: { isSticker, isGif, isImage, isVideo },
                        });

                        const userContent = await buildUserContentFromMedia(m, {
                          isSticker,
                          isGif,
                          isImage,
                          isVideo,
                          fallbackText: text,
                        });

                        runtimeLog.info("Invoking message handler", {
                            source: "baileysClient",
                            remoteJid,
                            hasUserContent: !!userContent,
                        });

                        await onMessage(
                            sock,
                            text,
                            remoteJid,
                            remoteJid,
                            userContent || undefined,
                            m.key.id || undefined
                        );
                    } catch (messageError) {
                        runtimeLog.error("Failed to process WhatsApp message", {
                            source: "baileysClient",
                            remoteJid,
                            error: serializeErrorForLog(messageError),
                        });
                    }
                }
            }
        });

        sock.ev.on('call', (calls) => {
            runtimeLog.info("WhatsApp call event received", {
                source: "baileysClient",
                callCount: calls.length,
            });
        });

        sock.ev.on('group-participants.update', (event) => {
            runtimeLog.info("WhatsApp group participants updated", {
                source: "baileysClient",
                groupJid: event.id,
                participantsCount: event.participants.length,
            });
        });
    };

    runtimeLog.info("Starting WhatsApp client connection", {
        source: "baileysClient",
        timestamp: new Date().toISOString(),
    });
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
    runtimeLog.info("No media detected, skipping media processing", {
      source: "baileysClient",
    });
    return null;
  }

  runtimeLog.info("Downloading media message", {
    source: "baileysClient",
    mediaTypes: { isSticker, isGif, isImage, isVideo },
  });

  try {
    const mediaBuffer = await downloadMediaMessage(
      message,
      "buffer",
      {},
      { logger: console as any }
    );

    if (!mediaBuffer || !(mediaBuffer instanceof Buffer)) {
      runtimeLog.warning("Media download returned no buffer", {
        source: "baileysClient",
        hasBuffer: !!mediaBuffer,
        isBufferInstance: mediaBuffer instanceof Buffer,
      });
      return null;
    }

    runtimeLog.info("Media buffer downloaded successfully", {
      source: "baileysClient",
      bufferSize: mediaBuffer.length,
      mediaTypes: { isSticker, isGif, isImage, isVideo },
    });

    if (isSticker || isImage) {
      runtimeLog.info("Converting image/sticker to JPEG", {
        source: "baileysClient",
        inputSize: mediaBuffer.length,
        isSticker,
        isImage,
      });

      const jpegBuffer = await sharp(mediaBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();

      runtimeLog.info("Image successfully prepared for Gemini", {
        source: "baileysClient",
        inputSize: mediaBuffer.length,
        outputSize: jpegBuffer.length,
        compressionRatio: ((1 - jpegBuffer.length / mediaBuffer.length) * 100).toFixed(2),
      });

      return {
        type: "image_text",
        text: fallbackText,
        imageData: jpegBuffer.toString("base64"),
        mimeType: "image/jpeg",
      };
    }

    if (isGif || isVideo) {
      runtimeLog.info("Extracting video frame for Gemini", {
        source: "baileysClient",
        inputSize: mediaBuffer.length,
        isGif,
        isVideo,
      });

      const frame = await extractVideoFrameToJpeg(mediaBuffer);
      if (!frame) {
        runtimeLog.warning("Failed to extract video frame", {
          source: "baileysClient",
          mediaType: isGif ? "gif" : "video",
        });
        return null;
      }

      runtimeLog.info("Video frame successfully prepared for Gemini", {
        source: "baileysClient",
        inputSize: mediaBuffer.length,
        frameSize: frame.length,
      });

      return {
        type: "image_text",
        text: fallbackText,
        imageData: frame.toString("base64"),
        mimeType: "image/jpeg",
      };
    }
  } catch (error) {
    runtimeLog.error("Failed to prepare media content for AI processing", {
      source: "baileysClient",
      mediaTypes: { isSticker, isGif, isImage, isVideo },
      error: serializeErrorForLog(error),
    });
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

  runtimeLog.info("Starting video frame extraction with ffmpeg", {
    source: "baileysClient",
    tmpDir,
    inputBufferSize: inputBuffer.length,
  });

  try {
    runtimeLog.info("Writing video buffer to temporary file", {
      source: "baileysClient",
      tmpDir,
      inputPath,
      bufferSize: inputBuffer.length,
    });

    fs.writeFileSync(inputPath, inputBuffer);

    runtimeLog.info("Executing ffmpeg for frame extraction", {
      source: "baileysClient",
      inputPath,
      outputPath,
      timeout: 15000,
    });

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
          runtimeLog.error("ffmpeg process failed", {
            source: "baileysClient",
            error: serializeErrorForLog(err),
          });
          reject(err);
        } else {
          runtimeLog.info("ffmpeg process completed successfully", {
            source: "baileysClient",
          });
          resolve();
        }
      });
    });

    const frameBuffer = fs.readFileSync(outputPath);
    const result = frameBuffer.length > 0 ? frameBuffer : null;

    if (result) {
      runtimeLog.info("Video frame extracted and read successfully", {
        source: "baileysClient",
        frameSize: result.length,
      });
    } else {
      runtimeLog.warning("Video frame extraction produced empty buffer", {
        source: "baileysClient",
        outputPath,
      });
    }

    return result;
  } catch (error) {
    runtimeLog.error("Video frame extraction failed", {
      source: "baileysClient",
      tmpDir,
      error: serializeErrorForLog(error),
    });
    return null;
  } finally {
    try {
      runtimeLog.info("Cleaning up temporary video extraction directory", {
        source: "baileysClient",
        tmpDir,
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      runtimeLog.info("Temporary directory cleaned up successfully", {
        source: "baileysClient",
        tmpDir,
      });
    } catch (cleanupError) {
      runtimeLog.error("Failed to clean up temporary video extraction directory", {
        source: "baileysClient",
        tmpDir,
        error: serializeErrorForLog(cleanupError),
      });
    }
  }
}
