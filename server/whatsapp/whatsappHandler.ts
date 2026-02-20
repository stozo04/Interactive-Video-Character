/**
 * WhatsApp Message Handler
 *
 * Bridges WhatsApp messages to the existing chat pipeline:
 * WhatsApp text → processUserMessage() → OrchestratorResult → WhatsApp response
 *
 * Shares the same conversation thread (interaction ID) as the web client
 * via Supabase conversation_history table.
 */

import { sentMessageIds } from "./baileyClient";
import type { WASocket } from "./baileyClient";
import { geminiChatService } from "../../src/services/geminiChatService";
import { processUserMessage } from "../../src/services/messageOrchestrator";
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from "../../src/services/conversationHistoryService";
import type { OrchestratorResult } from "../../src/handlers/messageActions/types";
import { generateSpeechBuffer } from "./serverAudio";

const LOG_PREFIX = "[WhatsApp]";

/**
 * Helper to determine if a URL can be fetched by the Node.js backend.
 * Node.js cannot fetch browser-memory `blob:` URLs.
 */
function isFetchableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Send a WhatsApp message and track its ID to prevent self-reply loops.
 * In self-chat mode, Baileys' own replies appear in messages.upsert as fromMe=true.
 * By recording the ID, baileyClient.ts can skip them.
 * * GOTCHA: The `status` returned here will almost always be 1 (Pending) because 
 * this resolves the moment the payload hits the local socket, before the WhatsApp 
 * server actually acknowledges it. Track delivery via the `messages.update` event instead.
 */
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
      status: sent?.status, // Usually 1 (Pending)
    });
    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} [SEND] FAILED:`, err);
    throw err;
  }
}

/**
 * Handle an incoming WhatsApp text message.
 *
 * 1. Load shared session (interaction ID) from Supabase
 * 2. Load today's chat history for context
 * 3. Run through the same orchestrator as the web client
 * 4. Convert OrchestratorResult → WhatsApp messages (text + media)
 */
export async function handleWhatsAppMessage(
  sock: WASocket,
  text: string,
  jid: string,
  replyJid: string
): Promise<void> {
  // Reply JID is pre-normalized by baileyClient (LID -> PN when available).
  console.log(`${LOG_PREFIX} Reply JID: ${replyJid} (original: ${jid})`);
  console.log(`${LOG_PREFIX} Processing: "${text.substring(0, 60)}..."`);

  try {
    // 1. Restore shared session from Supabase
    const interactionId = await getTodaysInteractionId();
    const session = interactionId
      ? { model: geminiChatService.model, interactionId }
      : null;

    console.log(`${LOG_PREFIX} Session: interactionId=${interactionId || "NEW"}`);

    // 2. Load today's conversation history for context
    const chatHistory = await loadTodaysConversationHistory();
    console.log(`${LOG_PREFIX} Chat history: ${chatHistory.length} messages`);

    // 3. Run through the orchestrator (same pipeline as web)
    const result = await processUserMessage({
      userMessage: text,
      aiService: geminiChatService,
      session,
      accessToken: undefined,    // No Google OAuth from WhatsApp
      chatHistory,
      upcomingEvents: [],        // No calendar from WhatsApp (requires OAuth)
      tasks: [],                 // Could add Supabase task fetch later
      isMuted: true,             // Skip browser blob URL audio generation
    });

    // 4. Send response back via WhatsApp
    await sendOrchestratorResult(sock, replyJid, result);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error processing message:`, error);

    // Send error message so the user knows something went wrong
    await sendAndTrack(sock, replyJid, {
      text: "Sorry, I'm having trouble right now. Try again in a sec?",
    });
  }
}

/**
 * Convert an OrchestratorResult into WhatsApp messages.
 *
 * Handles: text, selfie images, video, and voice notes (TTS).
 */
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

  // --- Text response ---
  const textResponse = result.chatMessages?.[0]?.text;
  if (textResponse) {
    await sendAndTrack(sock, jid, { text: textResponse });
  }

  // --- Selfie image ---
  if (result.selfieImage?.base64) {
    try {
      const imageBuffer = Buffer.from(result.selfieImage.base64, "base64");
      await sendAndTrack(sock, jid, {
        image: imageBuffer,
        mimetype: result.selfieImage.mimeType || "image/png",
        caption: result.selfieMessageText || undefined,
      });
      console.log(`${LOG_PREFIX} Sent selfie image`);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send selfie:`, err);
    }
  }

  // --- Video ---
  if (result.videoUrl) {
    try {
      if (!isFetchableUrl(result.videoUrl)) {
        // Handle Blob URLs or malformed URLs that Node can't fetch
        console.warn(`${LOG_PREFIX} Unfetchable video URL detected:`, result.videoUrl);
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
          console.log(`${LOG_PREFIX} Sent video`);
        } else {
          throw new Error(`Fetch failed: ${videoResponse.statusText}`);
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Couldn't fetch video, sending fallback text:`, err);
      // Fallback only if we have a valid link they could click
      if (isFetchableUrl(result.videoUrl)) {
        await sendAndTrack(sock, jid, {
          text: `${result.videoMessageText || "Here's the video:"} ${result.videoUrl}`,
        });
      }
    }
  }

  // --- Voice note (TTS) ---
  if (textResponse) {
    try {
      const audioBuffer = await generateSpeechBuffer(textResponse);
      if (audioBuffer) {
        await sendAndTrack(sock, jid, {
          audio: audioBuffer,
          mimetype: "audio/mpeg",
          ptt: true, // Push-to-talk = voice note bubble
        });
        console.log(`${LOG_PREFIX} Sent voice note`);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send voice note:`, err);
      // Non-fatal — text was already sent
    }
  }
}