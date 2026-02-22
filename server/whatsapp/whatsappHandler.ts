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
import fs from "fs";
import path from "path";
const LOG_PREFIX = "[WhatsApp]";

function isFetchableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
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
    return ALLOWED_MEDIA_HOSTS.has(parsed.hostname);
  } catch (err) {
    return false;
  }
}

async function fetchAndValidateVideo(
  url: string,
  options: { label: string; requireMp4: boolean }
): Promise<{ ok: boolean; buffer?: Buffer; contentType?: string; reason?: string }> {
  if (!isFetchableUrl(url)) {
    return { ok: false, reason: "non_fetchable_url" };
  }

  if (!isAllowedMediaUrl(url)) {
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} blocked (host not allowed):`, { url });
    return { ok: false, reason: "host_not_allowed" };
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} fetch failed:`, err);
    return { ok: false, reason: "fetch_error" };
  }

  if (!response.ok) {
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

  if (options.requireMp4 && !isMp4) {
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected mp4):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  if (!options.requireMp4 && !isVideo) {
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} invalid content-type (expected video/*):`, {
      contentType,
      url,
    });
    return { ok: false, reason: "invalid_content_type" };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    console.error(`${LOG_PREFIX} [MEDIA] ${options.label} empty payload:`, { url });
    return { ok: false, reason: "empty_payload" };
  }

  return { ok: true, buffer, contentType };
}

async function sendAndTrack(
  sock: WASocket,
  jid: string,
  content: any
): Promise<void> {
  console.log(`${LOG_PREFIX} [SEND] Sending to ${jid}:`, Object.keys(content));
  try {
    const sent = await sock.sendMessage(jid, content);
    console.log(`${LOG_PREFIX} [SEND] Local Result:`, {
      id: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
      fromMe: sent?.key?.fromMe,
      status: sent?.status,
    });
    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
    }
  } catch (err) {
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
  console.log(`${LOG_PREFIX} Reply JID: ${replyJid} (original: ${jid})`);
  console.log(`${LOG_PREFIX} Processing: "${text.substring(0, 60)}..."`);

  try {
    const interactionId = await getTodaysInteractionId();
    const session = interactionId
      ? { model: geminiChatService.model, interactionId }
      : null;

    const chatHistory = await loadTodaysConversationHistory();

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

    await sendOrchestratorResult(sock, replyJid, result);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error processing message:`, error);
    await sendAndTrack(sock, replyJid, {
      text: "Sorry, I'm having trouble right now. Try again in a sec?",
    });
  }
}

async function sendOrchestratorResult(
  sock: WASocket,
  jid: string,
  result: OrchestratorResult
): Promise<void> {
  if (!result.success) {
    await sendAndTrack(sock, jid, {
      text: result.error || "Something went wrong processing that.",
    });
    return;
  }

  if (result.rawGeneratedStickerBase64) {
      try {
          // 1. Convert it using your new utility
          const webpBuffer = await createWhatsAppSticker(result.rawGeneratedStickerBase64);
          
          // 2. Send the compliant buffer
          await sendAndTrack(sock, jid, {
              sticker: webpBuffer 
          });
          console.log(`${LOG_PREFIX} Sent generated Sticker`);
      } catch (err) {
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }
  // --- Sending a GIF ---
  // Note: result.gifUrl MUST be a link to an .mp4 file, not a .gif!
  // Services like Tenor and Giphy provide MP4 versions of all their GIFs for this exact reason.
  if (result.gifUrl && isFetchableUrl(result.gifUrl)) {
    try {
        const validated = await fetchAndValidateVideo(result.gifUrl, {
          label: "GIF",
          requireMp4: true,
        });
        if (!validated.ok || !validated.buffer) {
          await sendAndTrack(sock, jid, {
            text: result.gifMessageText || "I tried to send a GIF, but the link didn't work.",
          });
          return;
        }

        await sendAndTrack(sock, jid, {
            video: validated.buffer,
            gifPlayback: true, // THIS FLAG IS THE MAGIC TRICK
            caption: result.gifMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent GIF`, {
          contentType: validated.contentType,
          sizeBytes: validated.buffer.length,
        });
    } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send GIF:`, err);
    }
  }

  // --- Sending a Sticker ---
  // Note: result.stickerBuffer MUST be a valid .webp file buffer!
  if (result.stickerBuffer) {
      try {
          await sendAndTrack(sock, jid, {
              sticker: result.stickerBuffer 
          });
          console.log(`${LOG_PREFIX} Sent Sticker`);
      } catch (err) {
          console.error(`${LOG_PREFIX} Failed to send Sticker:`, err);
      }
  }

  const textResponse = result.chatMessages?.[0]?.text;
  if (textResponse) {
    await sendAndTrack(sock, jid, { text: textResponse });
  }

  if (result.selfieImage?.base64) {
    try {
      const selfiesDir = path.join(process.cwd(), "selfies");
      if (!fs.existsSync(selfiesDir)) {
        fs.mkdirSync(selfiesDir, { recursive: true });
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
      console.log(`${LOG_PREFIX} [SELFIE] Saved ${filePath}`);

      const imageBuffer = Buffer.from(result.selfieImage.base64, "base64");
      await sendAndTrack(sock, jid, {
        image: imageBuffer,
        mimetype: result.selfieImage.mimeType || "image/png",
        caption: result.selfieMessageText || undefined,
      });
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send selfie:`, err);
    }
  }

  if (result.videoUrl) {
    try {
      if (!isFetchableUrl(result.videoUrl)) {
        await sendAndTrack(sock, jid, {
          text: result.videoMessageText || "I have a video to show you, but I can't send it over WhatsApp right now.",
        });
      } else {
        const validated = await fetchAndValidateVideo(result.videoUrl, {
          label: "Video",
          requireMp4: false,
        });
        if (!validated.ok || !validated.buffer) {
          await sendAndTrack(sock, jid, {
            text: result.videoMessageText || "I have a video to show you, but the link didn't work.",
          });
          return;
        }

        await sendAndTrack(sock, jid, {
          video: validated.buffer,
          caption: result.videoMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent video`, {
          contentType: validated.contentType,
          sizeBytes: validated.buffer.length,
        });
      }
    } catch (err) {
      if (isFetchableUrl(result.videoUrl)) {
        await sendAndTrack(sock, jid, {
          text: `${result.videoMessageText || "Here's the video:"} ${result.videoUrl}`,
        });
      }
    }
  }

  if (textResponse) {
    try {
      const audioBuffer = await generateSpeechBuffer(textResponse);
      if (audioBuffer) {
        await sendAndTrack(sock, jid, {
          audio: audioBuffer,
          mimetype: "audio/mpeg",
          ptt: true,
        });
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send voice note:`, err);
    }
  }
}
