/**
 * Telegram Message Handler
 *
 * Mirrors whatsappHandler.ts. Receives Grammy Context, calls processUserMessage()
 * orchestrator, and maps OrchestratorResult → Telegram API calls.
 */

import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import { bot, getStevenChatId } from './telegramClient';
import { geminiChatService } from '../../src/services/geminiChatService';
import { processUserMessage } from '../../src/services/messageOrchestrator';
import {
  loadTodaysConversationHistory,
  getTodaysInteractionId,
} from '../../src/services/conversationHistoryService';
import type { OrchestratorResult } from '../../src/handlers/messageActions/types';
import type { UserContent } from '../../src/services/aiService';
import { generateSpeechBuffer } from './serverAudio';
import { createSticker } from './serverSticker';
import { log } from '../runtimeLogger';
import { supabaseAdmin as supabase } from '../services/supabaseAdmin';
import { gmailService } from '../../src/services/gmailService';
import type { NewEmailPayload } from '../../src/services/gmailService';
import { composePolishedReply } from '../../src/services/emailProcessingService';
import { getValidGoogleToken } from '../services/googleTokenService';
import {
  addAutoArchiveRule,
  checkAutoArchiveRule,
  extractEmailAddress,
  extractDisplayName,
} from '../services/autoArchiveService';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';

const LOG_PREFIX = '[Telegram]';
const runtimeLog = log.fromContext({ source: 'telegramHandler', route: 'telegram/handler' });
const TYPING_INDICATOR_INTERVAL_MS = 4500;

// ============================================================================
// AUTO-ARCHIVE CONFIRMATION STATE
// After a manual archive Kayley asks "always archive from X?". Persists until
// the next Telegram message from Steven.
// ============================================================================

let pendingAutoArchiveConfirm: { email: string; name: string } | null = null;

// ============================================================================
// TYPING INDICATOR
// Telegram typing action expires after 5s — fire every 4.5s to keep it alive.
// ============================================================================

function startTypingIndicator(chatId: number): () => void {
  let stopped = false;

  const sendTyping = () => {
    if (stopped) return;
    bot.api.sendChatAction(chatId, 'typing').catch(() => {
      // Non-fatal — just log
      runtimeLog.warning('Failed to send typing action', { source: 'telegramHandler', chatId });
    });
  };

  sendTyping();
  const timer = setInterval(sendTyping, TYPING_INDICATOR_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ============================================================================
// FILE DOWNLOAD
// ============================================================================

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractVideoFrameBuffer(fileId: string): Promise<Buffer | null> {
  try {
    const videoBuf = await downloadTelegramFile(fileId);
    const tmpDir = path.join(process.cwd(), '.tmp-telegram');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const inputPath = path.join(tmpDir, `in_${Date.now()}.mp4`);
    const outputPath = path.join(tmpDir, `frame_${Date.now()}.jpg`);
    fs.writeFileSync(inputPath, videoBuf);

    const result = spawnSync('ffmpeg', [
      '-i', inputPath,
      '-vframes', '1',
      '-q:v', '2',
      outputPath,
      '-y',
    ], { timeout: 15_000 });

    // Clean up input regardless
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }

    if (result.status !== 0 || !fs.existsSync(outputPath)) {
      runtimeLog.warning('ffmpeg frame extraction failed', {
        source: 'telegramHandler',
        stderr: result.stderr?.toString().substring(0, 200),
      });
      return null;
    }

    const frameBuf = fs.readFileSync(outputPath);
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    return frameBuf;
  } catch (err) {
    runtimeLog.warning('Video frame extraction error', {
      source: 'telegramHandler',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ============================================================================
// INCOMING MESSAGE → UserContent
// Extracts text and optional rich content from the Telegram message.
// ============================================================================

async function buildInputFromMessage(ctx: Context): Promise<{ text: string; userContent?: UserContent }> {
  const msg = ctx.message!;

  if (msg.text) {
    return { text: msg.text };
  }

  if (msg.photo) {
    // Largest photo is the last in the array
    const photo = msg.photo[msg.photo.length - 1];
    try {
      const buf = await downloadTelegramFile(photo.file_id);
      return {
        text: msg.caption || '[User sent a photo]',
        userContent: {
          type: 'image_text',
          text: msg.caption || '[User sent a photo]',
          imageData: buf.toString('base64'),
          mimeType: 'image/jpeg',
        },
      };
    } catch (err) {
      runtimeLog.warning('Failed to download photo', {
        source: 'telegramHandler',
        error: err instanceof Error ? err.message : String(err),
      });
      return { text: msg.caption || '[User sent a photo but it could not be loaded]' };
    }
  }

  if (msg.voice) {
    return { text: '[User sent a voice note]' };
  }

  if (msg.sticker) {
    try {
      const webpBuf = await downloadTelegramFile(msg.sticker.file_id);
      // Convert WebP → JPEG for the vision model
      const jpegBuf = await sharp(webpBuf).jpeg({ quality: 90 }).toBuffer();
      return {
        text: '[User sent a sticker]',
        userContent: {
          type: 'image_text',
          text: '[User sent a sticker]',
          imageData: jpegBuf.toString('base64'),
          mimeType: 'image/jpeg',
        },
      };
    } catch (err) {
      runtimeLog.warning('Failed to process sticker', {
        source: 'telegramHandler',
        error: err instanceof Error ? err.message : String(err),
      });
      return { text: '[User sent a sticker]' };
    }
  }

  if (msg.animation || msg.video) {
    const fileId = msg.animation?.file_id ?? msg.video!.file_id;
    const frameBuf = await extractVideoFrameBuffer(fileId);
    if (frameBuf) {
      return {
        text: '[User sent a video]',
        userContent: {
          type: 'image_text',
          text: '[User sent a video]',
          imageData: frameBuf.toString('base64'),
          mimeType: 'image/jpeg',
        },
      };
    }
    return { text: '[User sent a video]' };
  }

  return { text: msg.caption || '[User sent a message]' };
}

// ============================================================================
// OUTGOING: GIPHY GIF FETCH
// ============================================================================

const MAX_GIF_BYTES = 12 * 1024 * 1024;

function getGiphyApiKey(): string | null {
  return process.env.GIPHY_API_KEY ?? (globalThis as any).__importMetaEnv?.VITE_GIPHY_API_KEY ?? null;
}

function parseOptionalNumber(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type GiphyRendition = { mp4?: string; mp4_size?: string };
type GiphyGif = { id?: string; images?: Record<string, GiphyRendition | undefined> };

async function fetchGiphyMp4(query: string): Promise<{ ok: boolean; mp4Url?: string; reason?: string }> {
  const apiKey = getGiphyApiKey();
  if (!apiKey) return { ok: false, reason: 'missing_giphy_api_key' };

  const endpoint = new URL('https://api.giphy.com/v1/gifs/search');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('limit', '5');
  endpoint.searchParams.set('rating', 'g');
  endpoint.searchParams.set('lang', 'en');

  try {
    const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return { ok: false, reason: 'giphy_search_failed' };

    const payload = (await response.json()) as { data?: GiphyGif[] };
    const results = Array.isArray(payload?.data) ? payload.data : [];
    if (results.length === 0) return { ok: false, reason: 'no_results' };

    const preferredRenditions = ['downsized_small', 'fixed_height', 'fixed_width', 'original'];
    for (const gif of results) {
      const images = gif.images || {};
      for (const rendition of preferredRenditions) {
        const candidate = images[rendition];
        if (!candidate?.mp4) continue;
        const mp4Size = parseOptionalNumber(candidate.mp4_size);
        if (mp4Size && mp4Size > MAX_GIF_BYTES) continue;
        return { ok: true, mp4Url: candidate.mp4 };
      }
    }
    return { ok: false, reason: 'no_suitable_rendition' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'fetch_error' };
  }
}

// ============================================================================
// OUTGOING: SEND ORCHESTRATOR RESULT → TELEGRAM
// ============================================================================

async function sendOrchestratorResult(chatId: number, result: OrchestratorResult): Promise<void> {
  if (!result.success) {
    const errorMessage = result.error || 'Something went wrong processing that.';
    await bot.api.sendMessage(chatId, errorMessage);
    return;
  }

  // --- Generated sticker (base64 → WebP → sendSticker) ---
  if (result.rawGeneratedStickerBase64) {
    try {
      const webpBuffer = await createSticker(result.rawGeneratedStickerBase64);
      await bot.api.sendSticker(chatId, new InputFile(webpBuffer, 'sticker.webp'));
      console.log(`${LOG_PREFIX} Sent generated sticker`);
    } catch (err) {
      runtimeLog.error('Failed to send generated sticker', {
        source: 'telegramHandler',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- GIF ---
  if (result.gifQuery && result.gifQuery.trim().length > 0) {
    try {
      const giphyResult = await fetchGiphyMp4(result.gifQuery);
      if (giphyResult.ok && giphyResult.mp4Url) {
        const response = await fetch(giphyResult.mp4Url);
        if (response.ok) {
          const buf = Buffer.from(await response.arrayBuffer());
          await bot.api.sendAnimation(chatId, new InputFile(buf, 'animation.mp4'), {
            caption: result.gifMessageText || undefined,
          });
          console.log(`${LOG_PREFIX} Sent GIF animation`);
        } else {
          await bot.api.sendMessage(chatId, result.gifMessageText || "I tried to find a GIF but it didn't load.");
        }
      } else {
        runtimeLog.warning('GIPHY search failed', { source: 'telegramHandler', reason: giphyResult.reason });
        await bot.api.sendMessage(chatId, result.gifMessageText || "I tried to find a GIF but couldn't.");
      }
    } catch (err) {
      runtimeLog.error('Failed to send GIF', {
        source: 'telegramHandler',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Pre-made sticker buffer ---
  if (result.stickerBuffer) {
    try {
      await bot.api.sendSticker(chatId, new InputFile(result.stickerBuffer, 'sticker.webp'));
      console.log(`${LOG_PREFIX} Sent sticker`);
    } catch (err) {
      runtimeLog.error('Failed to send pre-made sticker', {
        source: 'telegramHandler',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Text ---
  const textResponse = result.chatMessages?.[0]?.text;
  if (textResponse) {
    await bot.api.sendMessage(chatId, textResponse);
  }

  // --- Selfie image ---
  if (result.selfieImage?.base64) {
    try {
      // Save to disk (mirrors whatsappHandler.ts behaviour)
      const selfiesDir = path.join(process.cwd(), 'selfies');
      if (!fs.existsSync(selfiesDir)) fs.mkdirSync(selfiesDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeScene = result.selfieMessageText
        ? result.selfieMessageText.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()
        : 'selfie';
      const filePath = path.join(selfiesDir, `selfie_${timestamp}_${safeScene}.jpg`);
      const fileBuffer = Buffer.from(result.selfieImage.base64, 'base64');
      fs.writeFileSync(filePath, fileBuffer);
      console.log(`${LOG_PREFIX} [SELFIE] Saved ${filePath}`);

      await bot.api.sendPhoto(chatId, new InputFile(fileBuffer, 'selfie.jpg'), {
        caption: result.selfieMessageText || undefined,
      });
    } catch (err) {
      runtimeLog.error('Failed to send selfie', {
        source: 'telegramHandler',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Video ---
  if (result.videoUrl) {
    try {
      const isFetchable = result.videoUrl.startsWith('http://') || result.videoUrl.startsWith('https://');
      if (!isFetchable) {
        await bot.api.sendMessage(chatId, result.videoMessageText || "I have a video but can't send it here.");
      } else {
        const response = await fetch(result.videoUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buf = Buffer.from(await response.arrayBuffer());
        await bot.api.sendVideo(chatId, new InputFile(buf, 'video.mp4'), {
          caption: result.videoMessageText || undefined,
        });
        console.log(`${LOG_PREFIX} Sent video`);
      }
    } catch (err) {
      runtimeLog.error('Failed to send video', {
        source: 'telegramHandler',
        chatId,
        videoUrl: result.videoUrl?.substring(0, 100),
        error: err instanceof Error ? err.message : String(err),
      });
      // Fallback: send as link
      if (result.videoUrl?.startsWith('http')) {
        await bot.api.sendMessage(chatId, `${result.videoMessageText || 'Here\'s the video:'} ${result.videoUrl}`);
      }
    }
  }

  // --- Voice note (TTS) ---
  if (textResponse) {
    try {
      const audioBuffer = await generateSpeechBuffer(textResponse);
      if (audioBuffer) {
        await bot.api.sendVoice(chatId, new InputFile(audioBuffer, 'voice.mp3'));
      }
    } catch (err) {
      runtimeLog.error('Failed to send voice note', {
        source: 'telegramHandler',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- App to open (send as message + URL) ---
  if ((result as any).appToOpen) {
    const { text: appText, url } = (result as any).appToOpen;
    if (appText || url) {
      await bot.api.sendMessage(chatId, [appText, url].filter(Boolean).join('\n'));
    }
  }
}

// ============================================================================
// PENDING EMAIL
// ============================================================================

interface PendingEmailRow {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_address: string | null;
  subject: string | null;
}

async function loadPendingEmailFromDB(): Promise<{ row: PendingEmailRow; email: NewEmailPayload } | null> {
  const { data, error } = await supabase
    .from('kayley_email_actions')
    .select('id, gmail_message_id, gmail_thread_id, from_address, subject')
    .eq('action_taken', 'pending')
    .not('whatsapp_sent_at', 'is', null) // column name unchanged — just a "messenger_sent_at"
    .order('announced_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;

  const email: NewEmailPayload = {
    id:         data.gmail_message_id,
    threadId:   data.gmail_thread_id   ?? '',
    from:       data.from_address      ?? '',
    subject:    data.subject           ?? '',
    snippet:    '',
    body:       '',
    receivedAt: '',
  };

  return { row: data as PendingEmailRow, email };
}

async function executeTelegramEmailAction(
  action: 'archive' | 'reply' | 'dismiss',
  replyBody: string | undefined,
  row: PendingEmailRow,
  email: NewEmailPayload
): Promise<void> {
  const chatId = getStevenChatId();
  let accessToken: string;

  try {
    accessToken = await getValidGoogleToken();
  } catch (err) {
    const isExpired = err instanceof Error && err.message === 'GOOGLE_REFRESH_TOKEN_EXPIRED';
    const msg = isExpired
      ? `I tried to ${action} that email but my Google connection has expired. Open the app and sign back in — takes 10 seconds!`
      : `I tried to ${action} that email but hit a Google auth error. You may need to reconnect in the app.`;
    if (chatId) await bot.api.sendMessage(chatId, msg).catch(() => {});
    return;
  }

  let success = false;

  try {
    if (action === 'archive') {
      success = await gmailService.archiveEmail(accessToken, row.gmail_message_id);
    } else if (action === 'reply' && replyBody) {
      const polished = await composePolishedReply(replyBody, email, []);
      const toMatch = email.from.match(/<(.+?)>/);
      const toAddress = toMatch ? toMatch[1] : email.from;
      success = await gmailService.sendReply(
        accessToken,
        row.gmail_thread_id ?? email.threadId,
        toAddress,
        email.subject,
        polished
      );
    } else if (action === 'dismiss') {
      success = true;
    }
  } catch (err) {
    runtimeLog.error('Gmail API call failed during email action', {
      source: 'telegramHandler',
      action,
      gmailMessageId: row.gmail_message_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!success) {
    // Don't burn the DB row — leave it as 'pending' so the user can retry.
    runtimeLog.warning('Email action failed, row left as pending for retry', {
      source: 'telegramHandler',
      action,
      gmailMessageId: row.gmail_message_id,
    });
    if (chatId) {
      await bot.api.sendMessage(
        chatId,
        `Hmm, something went wrong trying to ${action} that email — it didn't go through. Want me to try again?`
      ).catch(() => {});
    }
    return;
  }

  const dbAction = action === 'dismiss' ? 'dismissed' : action;
  const { error: updateError } = await supabase
    .from('kayley_email_actions')
    .update({ action_taken: dbAction, actioned_at: new Date().toISOString() })
    .eq('id', row.id);

  if (updateError) {
    runtimeLog.error('Failed to update kayley_email_actions after successful action', {
      source: 'telegramHandler',
      action,
      dbAction,
      gmailMessageId: row.gmail_message_id,
      rowId: row.id,
      error: updateError.message,
    });
  } else {
    runtimeLog.info('Email action DB row updated', {
      source: 'telegramHandler',
      action,
      dbAction,
      rowId: row.id,
    });
  }

  // After successful archive: offer auto-archive rule
  if (action === 'archive' && success) {
    const fromEmail = extractEmailAddress(email.from);
    const fromName  = extractDisplayName(email.from) || fromEmail;

    try {
      const alreadyRuled = await checkAutoArchiveRule(fromEmail);
      if (!alreadyRuled) {
        pendingAutoArchiveConfirm = { email: fromEmail, name: fromName };
        if (chatId) {
          await bot.api.sendMessage(chatId, `Want me to always auto-archive emails from ${fromName}? Just say "yes" if so!`);
        }
      }
    } catch {
      pendingAutoArchiveConfirm = null;
    }
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleTelegramMessage(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const messageId = `${chatId}_${Date.now()}`;
  const stopTyping = startTypingIndicator(chatId);

  runtimeLog.info('Telegram message handler invoked', {
    source: 'telegramHandler',
    messageId,
    chatId,
  });

  try {
    // -----------------------------------------------------------------------
    // AUTO-ARCHIVE CONFIRMATION short-circuit
    // -----------------------------------------------------------------------
    const confirming = pendingAutoArchiveConfirm;
    pendingAutoArchiveConfirm = null;

    if (confirming) {
      const rawText = ctx.message?.text ?? '';
      const isYes = rawText.length < 60 &&
        /^(yes|yeah|yep|yup|sure|ok|okay|do it|add( it)?|absolutely|definitely|sounds good|go ahead)/i
          .test(rawText.trim());

      if (isYes) {
        try {
          await addAutoArchiveRule(confirming.email, confirming.name);
          await bot.api.sendMessage(chatId, `Done! I'll auto-archive emails from ${confirming.name} from now on. 🗑️`);
        } catch {
          await bot.api.sendMessage(chatId, `Hmm, had trouble saving that — want to try again?`);
        }
        return;
      }
      // Non-affirmative: fall through to normal orchestrator
    }

    // -----------------------------------------------------------------------
    // Build input from message
    // -----------------------------------------------------------------------
    const { text, userContent } = await buildInputFromMessage(ctx);

    console.log(`${LOG_PREFIX} Processing: "${text.substring(0, 60)}..."`);

    // -----------------------------------------------------------------------
    // Load conversation context
    // -----------------------------------------------------------------------
    const interactionId = await getTodaysInteractionId();
    const session = interactionId
      ? { model: geminiChatService.model, interactionId }
      : null;

    const [chatHistory, pendingEmailData] = await Promise.all([
      loadTodaysConversationHistory(),
      loadPendingEmailFromDB(),
    ]);

    // -----------------------------------------------------------------------
    // Process through orchestrator
    // -----------------------------------------------------------------------
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
      pendingEmail: pendingEmailData?.email ?? null,
    });

    runtimeLog.info('Message processing completed', {
      source: 'telegramHandler',
      messageId,
      conversationLogId: result.conversationLogId ?? null,
      success: result.success,
      hasText: !!result.chatMessages?.[0]?.text,
      hasSelfie: !!result.selfieImage,
      hasGif: !!result.gifQuery,
      total_tokens: result.tokenUsage?.total_tokens ?? null,
      total_input_tokens: result.tokenUsage?.total_input_tokens ?? null,
      total_output_tokens: result.tokenUsage?.total_output_tokens ?? null,
      total_thought_tokens: result.tokenUsage?.total_thought_tokens ?? null,
    });

    // Execute email action if detected
    if (result.detectedEmailAction && pendingEmailData) {
      const { action, reply_body } = result.detectedEmailAction;
      runtimeLog.info('Executing email action', {
        source: 'telegramHandler',
        conversationLogId: result.conversationLogId ?? null,
        action,
        gmailMessageId: pendingEmailData.row.gmail_message_id,
      });
      void executeTelegramEmailAction(action, reply_body, pendingEmailData.row, pendingEmailData.email);
    }

    await sendOrchestratorResult(chatId, result);

  } catch (error) {
    runtimeLog.error('Message processing failed', {
      source: 'telegramHandler',
      messageId,
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`${LOG_PREFIX} Error processing message:`, error);

    try {
      await bot.api.sendMessage(chatId, "Sorry, I'm having trouble right now. Try again in a sec?");
    } catch { /* ignore fallback error */ }
  } finally {
    stopTyping();
  }
}
