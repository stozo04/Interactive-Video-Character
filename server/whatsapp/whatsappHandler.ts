import { sentMessageIds, type WASocket } from "./baileyClient";
import { geminiChatService } from "../../src/services/geminiChatService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import type { OrchestratorResult } from "../../src/handlers/messageActions/types";
import type { UserContent } from "../../src/services/aiService";
import { generateSpeechBuffer } from "./serverAudio";
import { createWhatsAppSticker } from "./serverSticker";
import { log } from "../runtimeLogger";
import fs from "fs";
import path from "path";
const LOG_PREFIX = "[WhatsApp]";
const runtimeLog = log.fromContext({ source: "whatsappHandler", route: "whatsapp/handler" });
const TYPING_INDICATOR_INTERVAL_MS = 4500;

async function sendTypingState(sock: WASocket, jid: string, state: "composing" | "paused"): Promise<void> {
  try {
    await sock.sendPresenceUpdate(state, jid);
    runtimeLog.info("Typing state sent", {
      source: "whatsappHandler",
      jid,
      state,
    });
  } catch (error) {
    runtimeLog.warning("Failed to send typing state", {
      source: "whatsappHandler",
      jid,
      state,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function startTypingIndicator(sock: WASocket, jid: string): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const sendComposing = () => {
    void sendTypingState(sock, jid, "composing");
  };

  sendComposing();
  timer = setInterval(sendComposing, TYPING_INDICATOR_INTERVAL_MS);

  return async () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    await sendTypingState(sock, jid, "paused");
  };
}

function isFetchableUrl(url: string): boolean {
  const isFetchable = url.startsWith("http://") || url.startsWith("https://");
  if (!isFetchable) {
    runtimeLog.info("URL is not fetchable", {
      source: "whatsappHandler",
      url: url.substring(0, 100),
      isFetchable,
    });
  }
  return isFetchable;
}

const ALLOWED_MEDIA_HOSTS = new Set([
  "media.giphy.com",
  "giphy.com",
  "media.tenor.com",
  "tenor.com",
]);

function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isAllowed = ALLOWED_MEDIA_HOSTS.has(parsed.hostname);
    if (!isAllowed) {
      runtimeLog.warning("Media URL host not in allowlist", {
        source: "whatsappHandler",
        hostname: parsed.hostname,
        allowedHosts: Array.from(ALLOWED_MEDIA_HOSTS).join(", "),
      });
    }
    return isAllowed;
  } catch (err) {
    runtimeLog.warning("Failed to parse media URL", {
      source: "whatsappHandler",
      url: url.substring(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function fetchAndValidateVideo(
  url: string,
  options: { label: string; requireMp4: boolean }
): Promise<{ ok: boolean; buffer?: Buffer; contentType?: string; reason?: string }> {
  runtimeLog.info("Starting video validation", {
    source: "whatsappHandler",
    label: options.label,
    requireMp4: options.requireMp4,
    urlPreview: url.substring(0, 100),
  });

  if (!isFetchableUrl(url)) {
    runtimeLog.warning("Video URL not fetchable", {
      source: "whatsappHandler",
      label: options.label,
      reason: "non_fetchable_url",
      urlPreview: url.substring(0, 100),
    });
    return { ok: false, reason: "non_fetchable_url" };
  }

  if (!isAllowedMediaUrl(url)) {
    runtimeLog.error("Video host not allowed", {
      source: "whatsappHandler",
      label: options.label,
      reason: "host_not_allowed",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} blocked (host not allowed):`, { url });
    return { ok: false, reason: "host_not_allowed" };
  }

  let response: Response;
  try {
    runtimeLog.info("Fetching video from URL", {
      source: "whatsappHandler",
      label: options.label,
      urlPreview: url.substring(0, 100),
    });

    response = await fetch(url);

    runtimeLog.info("Video fetch completed", {
      source: "whatsappHandler",
      label: options.label,
      status: response.status,
      statusText: response.statusText,
      contentLength: response.headers.get("content-length"),
    });
  } catch (err) {
    runtimeLog.error("Video fetch failed with exception", {
      source: "whatsappHandler",
      label: options.label,
      urlPreview: url.substring(0, 100),
      error: err instanceof Error ? err.message : String(err),
      reason: "fetch_error",
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} fetch failed:`, err);
    return { ok: false, reason: "fetch_error" };
  }

  if (!response.ok) {
    runtimeLog.error("Video fetch returned non-2xx status", {
      source: "whatsappHandler",
      label: options.label,
      status: response.status,
      statusText: response.statusText,
      urlPreview: url.substring(0, 100),
      reason: "bad_status",
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} fetch status:`, {
      status: response.status,
      statusText: response.statusText,
      url,
    });
    return { ok: false, reason: "bad_status" };
  }

  const contentType = response.headers.get("content-type") || "";
  const isMp4 = contentType.toLowerCase().includes("video/mp4");
  const isVideo = contentType.toLowerCase().startsWith("video/");

  runtimeLog.info("Video content type detected", {
    source: "whatsappHandler",
    label: options.label,
    contentType,
    isMp4,
    isVideo,
  });

  if (options.requireMp4 && !isMp4) {
    runtimeLog.error("Video content type is not MP4", {
      source: "whatsappHandler",
      label: options.label,
      contentType,
      requireMp4: true,
      reason: "invalid_content_type",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected mp4):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  if (!options.requireMp4 && !isVideo) {
    runtimeLog.error("Video content type is not video/*", {
      source: "whatsappHandler",
      label: options.label,
      contentType,
      requireMp4: false,
      reason: "invalid_content_type",
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected video/*):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      runtimeLog.error("Video buffer is empty", {
        source: "whatsappHandler",
        label: options.label,
        bufferLength: 0,
        reason: "empty_payload",
        urlPreview: url.substring(0, 100),
      });
      console.error(`${LOG_PREFIX} [MEDIA] ${options.label} empty payload:`, { url });
      return { ok: false, reason: "empty_payload" };
    }

    runtimeLog.info("Video validation successful", {
      source: "whatsappHandler",
      label: options.label,
      bufferSize: buffer.length,
      contentType,
    });

    return { ok: true, buffer, contentType };
  } catch (bufferError) {
    runtimeLog.error("Failed to convert video response to buffer", {
      source: "whatsappHandler",
      label: options.label,
      error: bufferError instanceof Error ? bufferError.message : String(bufferError),
      urlPreview: url.substring(0, 100),
    });
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} buffer conversion failed:`, bufferError);
    return { ok: false, reason: "buffer_conversion_error" };
  }
}

async function sendAndTrack(
  sock: WASocket,
  jid: string,
  content: any
): Promise<void> {
  const contentKeys = Object.keys(content);
  runtimeLog.info("Sending message to WhatsApp", {
    source: "whatsappHandler",
    jid,
    contentTypes: contentKeys.join(", "),
    hasText: !!content.text,
    hasImage: !!content.image,
    hasVideo: !!content.video,
    hasAudio: !!content.audio,
    hasSticker: !!content.sticker,
    gifPlayback: content.gifPlayback ?? false,
  });

  try {
    const sent = await sock.sendMessage(jid, content);

    runtimeLog.info("Message sent successfully to WhatsApp", {
      source: "whatsappHandler",
      jid,
      messageId: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
      fromMe: sent?.key?.fromMe,
      status: sent?.status,
      contentTypes: contentKeys.join(", "),
    });

    console.log(`${LOG_PREFIX} [SEND] Sending to ${jid}:`, Object.keys(content));
    console.log(`${LOG_PREFIX} [SEND] Local Result:`, {
      id: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
      fromMe: sent?.key?.fromMe,
      status: sent?.status,
    });

    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
      runtimeLog.info("Message ID tracked to prevent echo", {
        source: "whatsappHandler",
        messageId: sent.key.id,
      });
    }
  } catch (err) {
    runtimeLog.error("Failed to send message to WhatsApp", {
      source: "whatsappHandler",
      jid,
      contentTypes: contentKeys.join(", "),
      error: err instanceof Error ? err.message : String(err),
      errorType: err instanceof Error ? err.constructor.name : "unknown",
    });
    console.error(`${LOG_PREFIX} [SEND] FAILED:`, err);
    throw err;
  }
}

export async function handleWhatsAppMessage(
  sock: WASocket,
  text: string,
  jid: string,
  replyJid: string,
  userContent?: UserContent
): Promise<void> {
  const messageId = `${jid}_${Date.now()}`;
  const stopTyping = startTypingIndicator(sock, replyJid);

  runtimeLog.info("WhatsApp message handler invoked", {
    source: "whatsappHandler",
    messageId,
    jid,
    replyJid,
    textLength: text.length,
    textPreview: text.substring(0, 60),
    hasUserContent: !!userContent,
    userContentType: userContent?.type,
  });

  console.log(`${LOG_PREFIX} Reply JID: ${replyJid} (original: ${jid})`);
  console.log(`${LOG_PREFIX} Processing: "${text.substring(0, 60)}..."`);

  try {
    runtimeLog.info("Loading interaction context", {
      source: "whatsappHandler",
      messageId,
    });

    const interactionId = await getTodaysInteractionId();
    const session = interactionId
      ? { model: geminiChatService.model, interactionId }
      : null;

    runtimeLog.info("Interaction context loaded", {
      source: "whatsappHandler",
      messageId,
      hasInteractionId: !!interactionId,
      interactionId: interactionId ?? "none",
    });

    runtimeLog.info("Loading conversation history", {
      source: "whatsappHandler",
      messageId,
    });

    const chatHistory = await loadTodaysConversationHistory();

    runtimeLog.info("Conversation history loaded", {
      source: "whatsappHandler",
      messageId,
      historyLength: chatHistory?.length ?? 0,
    });

    runtimeLog.info("Processing user message through orchestrator", {
      source: "whatsappHandler",
      messageId,
      textLength: text.length,
      isMuted: true,
    });

    const result = await processUserMessage({
      userMessage: text,
      userContent,
      aiService: geminiChatService,
      session,
      accessToken: undefined,
      chatHistory,
      upcomingEvents: [],
      tasks: [],
      isMuted: true,
    });

    runtimeLog.info("Message processing completed", {
      source: "whatsappHandler",
      messageId,
      success: result.success,
      hasText: !!result.chatMessages?.[0]?.text,
      hasSelfie: !!result.selfieImage,
      hasSticker: !!result.stickerBuffer || !!result.rawGeneratedStickerBase64,
      hasGif: !!result.gifUrl,
      hasVideo: !!result.videoUrl,
      hasAudio: !!result.chatMessages?.[0]?.text,
    });

    await sendOrchestratorResult(sock, replyJid, result);
  } catch (error) {
    runtimeLog.error("Message processing failed with exception", {
      source: "whatsappHandler",
      messageId,
      jid,
      replyJid,
      textLength: text.length,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : "unknown",
    });
    console.error(`${LOG_PREFIX} Error processing message:`, error);

    try {
      await sendAndTrack(sock, replyJid, {
        text: "Sorry, I'm having trouble right now. Try again in a sec?",
      });
    } catch (fallbackError) {
      runtimeLog.error("Failed to send fallback error message", {
        source: "whatsappHandler",
        messageId,
        replyJid,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  } finally {
    await stopTyping();
  }
}

async function sendOrchestratorResult(
  sock: WASocket,
  jid: string,
  result: OrchestratorResult
): Promise<void> {
  runtimeLog.info("Starting orchestrator result sending", {
    source: "whatsappHandler",
    jid,
    success: result.success,
  });

  if (!result.success) {
    const errorMessage = result.error || "Something went wrong processing that.";
    runtimeLog.warning("Orchestrator result indicates failure", {
      source: "whatsappHandler",
      jid,
      error: errorMessage,
    });
    await sendAndTrack(sock, jid, {
      text: errorMessage,
    });
    return;
  }

  runtimeLog.info("Orchestrator result is success, sending media responses", {
    source: "whatsappHandler",
    jid,
  });

  if (result.rawGeneratedStickerBase64) {
      try {
          runtimeLog.info("Processing generated sticker from orchestrator", {
            source: "whatsappHandler",
            jid,
            base64Length: result.rawGeneratedStickerBase64.length,
          });

          // 1. Convert it using your new utility
          const webpBuffer = await createWhatsAppSticker(result.rawGeneratedStickerBase64);

          runtimeLog.info("Generated sticker converted to WebP", {
            source: "whatsappHandler",
            jid,
            webpSize: webpBuffer.length,
          });

          // 2. Send the compliant buffer
          await sendAndTrack(sock, jid, {
              sticker: webpBuffer
          });
          console.log(`${LOG_PREFIX} Sent generated Sticker`);
          runtimeLog.info("Generated sticker sent successfully", {
            source: "whatsappHandler",
            jid,
          });
      } catch (err) {
          runtimeLog.error("Failed to generate or send sticker", {
            source: "whatsappHandler",
            jid,
            error: err instanceof Error ? err.message : String(err),
            errorType: err instanceof Error ? err.constructor.name : "unknown",
          });
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }
  // --- Sending a GIF ---
  // Note: result.gifUrl MUST be a link to an .mp4 file, not a .gif!
  // Services like Tenor and Giphy provide MP4 versions of all their GIFs for this exact reason.
  if (result.gifUrl && isFetchableUrl(result.gifUrl)) {
    try {
        runtimeLog.info("Processing GIF for sending", {
          source: "whatsappHandler",
          jid,
          gifUrlPreview: result.gifUrl.substring(0, 100),
        });

        const validated = await fetchAndValidateVideo(result.gifUrl, {
          label: "GIF",
          requireMp4: true,
        });

        if (!validated.ok || !validated.buffer) {
          runtimeLog.warning("GIF validation failed", {
            source: "whatsappHandler",
            jid,
            reason: validated.reason,
          });
          await sendAndTrack(sock, jid, {
            text: result.gifMessageText || "I tried to send a GIF, but the link didn't work.",
          });
          return;
        }

        runtimeLog.info("GIF validated and ready to send", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
          contentType: validated.contentType,
        });

        await sendAndTrack(sock, jid, {
            video: validated.buffer,
            gifPlayback: true, // THIS FLAG IS THE MAGIC TRICK
            caption: result.gifMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent GIF`, {
          contentType: validated.contentType,
          sizeBytes: validated.buffer.length,
        });

        runtimeLog.info("GIF sent successfully", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
        });
    } catch (err) {
        runtimeLog.error("Failed to send GIF", {
          source: "whatsappHandler",
          jid,
          gifUrlPreview: result.gifUrl.substring(0, 100),
          error: err instanceof Error ? err.message : String(err),
        });
        console.error(`${LOG_PREFIX} Failed to send GIF:`, err);
    }
  }

  // --- Sending a Sticker ---
  // Note: result.stickerBuffer MUST be a valid .webp file buffer!
  if (result.stickerBuffer) {
      try {
          runtimeLog.info("Sending pre-made sticker", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
          });

          await sendAndTrack(sock, jid, {
              sticker: result.stickerBuffer
          });
          console.log(`${LOG_PREFIX} Sent Sticker`);

          runtimeLog.info("Pre-made sticker sent successfully", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
          });
      } catch (err) {
          runtimeLog.error("Failed to send pre-made sticker", {
            source: "whatsappHandler",
            jid,
            stickerSize: result.stickerBuffer.length,
            error: err instanceof Error ? err.message : String(err),
          });
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }

  const textResponse = result.chatMessages?.[0]?.text;
  if (textResponse) {
    runtimeLog.info("Sending text response", {
      source: "whatsappHandler",
      jid,
      textLength: textResponse.length,
      textPreview: textResponse.substring(0, 60),
    });
    await sendAndTrack(sock, jid, { text: textResponse });
    runtimeLog.info("Text response sent successfully", {
      source: "whatsappHandler",
      jid,
    });
  }

  if (result.selfieImage?.base64) {
    try {
      runtimeLog.info("Processing selfie image", {
        source: "whatsappHandler",
        jid,
        base64Length: result.selfieImage.base64.length,
        mimeType: result.selfieImage.mimeType,
        messageText: result.selfieMessageText?.substring(0, 50),
      });

      const selfiesDir = path.join(process.cwd(), "selfies");
      if (!fs.existsSync(selfiesDir)) {
        fs.mkdirSync(selfiesDir, { recursive: true });
        runtimeLog.info("Created selfies directory", {
          source: "whatsappHandler",
          selfiesDir,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeScene = result.selfieMessageText
        ? result.selfieMessageText
            .substring(0, 30)
            .replace(/[^a-z0-9]/gi, "_")
            .toLowerCase()
        : "selfie";
      const filename = `selfie_${timestamp}_${safeScene}.jpg`;
      const filePath = path.join(selfiesDir, filename);
      const fileBuffer = Buffer.from(result.selfieImage.base64, "base64");
      fs.writeFileSync(filePath, fileBuffer);

      runtimeLog.info("Selfie image saved to disk", {
        source: "whatsappHandler",
        filePath,
        fileSize: fileBuffer.length,
      });
      console.log(`${LOG_PREFIX} [SELFIE] Saved ${filePath}`);

      const imageBuffer = Buffer.from(result.selfieImage.base64, "base64");
      await sendAndTrack(sock, jid, {
        image: imageBuffer,
        mimetype: result.selfieImage.mimeType || "image/png",
        caption: result.selfieMessageText || undefined,
      });

      runtimeLog.info("Selfie image sent successfully", {
        source: "whatsappHandler",
        jid,
        fileSize: imageBuffer.length,
      });
    } catch (err) {
      runtimeLog.error("Failed to process or send selfie", {
        source: "whatsappHandler",
        jid,
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });
      console.error(`${LOG_PREFIX} Failed to send selfie:`, err);
    }
  }

  if (result.videoUrl) {
    try {
      runtimeLog.info("Processing video for sending", {
        source: "whatsappHandler",
        jid,
        videoUrlPreview: result.videoUrl.substring(0, 100),
      });

      if (!isFetchableUrl(result.videoUrl)) {
        runtimeLog.warning("Video URL is not fetchable", {
          source: "whatsappHandler",
          jid,
          videoUrlPreview: result.videoUrl.substring(0, 100),
        });
        await sendAndTrack(sock, jid, {
          text: result.videoMessageText || "I have a video to show you, but I can't send it over WhatsApp right now.",
        });
      } else {
        const validated = await fetchAndValidateVideo(result.videoUrl, {
          label: "Video",
          requireMp4: false,
        });

        if (!validated.ok || !validated.buffer) {
          runtimeLog.warning("Video validation failed", {
            source: "whatsappHandler",
            jid,
            reason: validated.reason,
          });
          await sendAndTrack(sock, jid, {
            text: result.videoMessageText || "I have a video to show you, but the link didn't work.",
          });
          return;
        }

        runtimeLog.info("Video validated and ready to send", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
          contentType: validated.contentType,
        });

        await sendAndTrack(sock, jid, {
          video: validated.buffer,
          caption: result.videoMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent video`, {
          contentType: validated.contentType,
          sizeBytes: validated.buffer.length,
        });

        runtimeLog.info("Video sent successfully", {
          source: "whatsappHandler",
          jid,
          bufferSize: validated.buffer.length,
        });
      }
    } catch (err) {
      runtimeLog.error("Failed to send video", {
        source: "whatsappHandler",
        jid,
        videoUrlPreview: result.videoUrl.substring(0, 100),
        error: err instanceof Error ? err.message : String(err),
      });

      if (isFetchableUrl(result.videoUrl)) {
        runtimeLog.info("Sending video URL as text fallback", {
          source: "whatsappHandler",
          jid,
          videoUrlPreview: result.videoUrl.substring(0, 100),
        });
        await sendAndTrack(sock, jid, {
          text: `${result.videoMessageText || "Here's the video:"} ${result.videoUrl}`,
        });
      }
    }
  }

  if (textResponse) {
    try {
      runtimeLog.info("Generating speech audio for text response", {
        source: "whatsappHandler",
        jid,
        textLength: textResponse.length,
      });

      const audioBuffer = await generateSpeechBuffer(textResponse);

      if (audioBuffer) {
        runtimeLog.info("Audio buffer generated, sending as voice note", {
          source: "whatsappHandler",
          jid,
          audioSize: audioBuffer.length,
          ptt: true,
        });

        await sendAndTrack(sock, jid, {
          audio: audioBuffer,
          mimetype: "audio/mpeg",
          ptt: true,
        });

        runtimeLog.info("Voice note sent successfully", {
          source: "whatsappHandler",
          jid,
          audioSize: audioBuffer.length,
        });
      } else {
        runtimeLog.warning("Failed to generate audio buffer", {
          source: "whatsappHandler",
          jid,
          textLength: textResponse.length,
        });
      }
    } catch (err) {
      runtimeLog.error("Failed to generate or send voice note", {
        source: "whatsappHandler",
        jid,
        textLength: textResponse.length,
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.constructor.name : "unknown",
      });
      console.error(`${LOG_PREFIX} Failed to send voice note:`, err);
    }
  }
}
