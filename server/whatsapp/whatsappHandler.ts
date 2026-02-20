import { sentMessageIds, type WASocket } from "./baileyClient";
import { geminiChatService } from "../../src/services/geminiChatService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import type { OrchestratorResult } from "../../src/handlers/messageActions/types";
import { generateSpeechBuffer } from "./serverAudio";

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