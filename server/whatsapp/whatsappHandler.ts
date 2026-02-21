import { sentMessageIds, type WASocket } from "./baileyClient";
import { geminiChatService } from "../../src/services/geminiChatService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import type { OrchestratorResult } from "../../src/handlers/messageActions/types";
import { generateSpeechBuffer } from "./serverAudio";
import { createWhatsAppSticker } from "./serverSticker";
const LOG_PREFIX = "[WhatsApp]";

function isFetchableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
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
  replyJid: string
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
        const gifResponse = await fetch(result.gifUrl);
        if (gifResponse.ok) {
            const gifArrayBuffer = await gifResponse.arrayBuffer();
            const gifBuffer = Buffer.from(gifArrayBuffer);
            
            await sendAndTrack(sock, jid, {
                video: gifBuffer,
                gifPlayback: true, // THIS FLAG IS THE MAGIC TRICK
                caption: result.gifMessageText || undefined,
            });
            console.log(`${LOG_PREFIX} Sent GIF`);
        }
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
        const videoResponse = await fetch(result.videoUrl);
        if (videoResponse.ok) {
          const videoArrayBuffer = await videoResponse.arrayBuffer();
          const videoBuffer = Buffer.from(videoArrayBuffer);
          await sendAndTrack(sock, jid, {
            video: videoBuffer,
            caption: result.videoMessageText || undefined,
          });
        } else {
          throw new Error(`Fetch failed: ${videoResponse.statusText}`);
        }
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