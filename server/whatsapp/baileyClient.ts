/**
 * Baileys WhatsApp Connection Manager
 *
 * Handles WebSocket connection to WhatsApp, QR code auth,
 * session persistence, and message filtering.
 *
 * Flow:
 *   1. First run: displays QR code in terminal
 *   2. Scan with phone: WhatsApp → Linked Devices → Link a Device
 *   3. WhatsApp disconnects with restartRequired, we reconnect with saved creds
 *   4. Subsequent runs: auto-reconnects from .whatsapp-auth/
 */

import baileys from "@whiskeysockets/baileys";
const { makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = baileys;
type WASocket = ReturnType<typeof makeWASocket>;
const proto = baileys.proto;

export { jidNormalizedUser };

const LOG_PREFIX = "[Baileys]";
const AUTH_DIR = ".whatsapp-auth";

// Track message IDs sent by Baileys to prevent infinite self-reply loops.
// When Baileys sends a reply, the message also appears in messages.upsert
// with fromMe=true. Without this guard, we'd process our own replies forever.
export const sentMessageIds = new Set<string>();

export type { WASocket };

export type OnMessageCallback = (
  sock: WASocket,
  text: string,
  jid: string,
  replyJid: string
) => Promise<void>;

/**
 * Start the WhatsApp client.
 *
 * - Displays QR code in terminal for first-time auth
 * - Persists auth state to .whatsapp-auth/ for reconnection
 * - Filters incoming messages to WHATSAPP_PHONE_JID only
 * - Calls onMessage for each valid text message
 */
export async function startWhatsAppClient(
  onMessage: OnMessageCallback
): Promise<WASocket> {
  const targetJid = process.env.WHATSAPP_PHONE_JID;
  if (!targetJid) {
    throw new Error(
      "WHATSAPP_PHONE_JID env var is required (e.g. 1XXXXXXXXXX@s.whatsapp.net)"
    );
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  // Persist credentials on update
  sock.ev.on("creds.update", saveCreds);

  // Handle connection events
  sock.ev.on("connection.update", (update: any) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log(
          `${LOG_PREFIX} Logged out. Delete ${AUTH_DIR}/ and restart to re-auth.`
        );
        return;
      }

      // restartRequired is expected after QR scan — WhatsApp disconnects
      // to establish authenticated creds. Create a NEW socket to reconnect.
      if (statusCode === DisconnectReason.restartRequired) {
        console.log(`${LOG_PREFIX} Pairing complete, reconnecting with credentials...`);
      } else {
        console.log(`${LOG_PREFIX} Connection closed (status ${statusCode}). Reconnecting...`);
      }

      startWhatsAppClient(onMessage).catch((err) => {
        console.error(`${LOG_PREFIX} Reconnection failed:`, err);
      });
    }

    if (connection === "open") {
      console.log(`${LOG_PREFIX} Connected to WhatsApp!`);
    }
  });

  // Handle incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
    // DEBUG: Log ALL message events to diagnose delivery
    console.log(`${LOG_PREFIX} [DEBUG] messages.upsert event:`, {
      type,
      count: messages.length,
      messages: messages.map((m: any) => ({
        id: m.key?.id,
        remoteJid: m.key?.remoteJid,
        fromMe: m.key?.fromMe,
        participant: m.key?.participant,
        senderPn: m.key?.senderPn || m.senderPn || m.participantPn || null,
        remoteJidAlt: m.key?.remoteJidAlt || m.remoteJidAlt || null,
        hasMessage: !!m.message,
        messageKeys: m.message ? Object.keys(m.message) : [],
      })),
    });

    if (type !== "notify") return;

    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      const isSelfChat = remoteJid?.endsWith("@lid");

      // Skip messages Baileys itself sent (prevents infinite reply loops)
      if (msg.key.id && sentMessageIds.has(msg.key.id)) {
        sentMessageIds.delete(msg.key.id);
        continue;
      }

      if (isSelfChat) {
        // Self-chat uses @lid JID format. Process user's own messages
        // (fromMe=true from phone). Baileys replies are caught by sentMessageIds.
      } else if (remoteJid === targetJid && !msg.key.fromMe) {
        // Direct message from target phone number — process it
      } else {
        // Everything else — skip
        console.log(
          `${LOG_PREFIX} Ignoring message from ${remoteJid} (fromMe=${msg.key.fromMe})`
        );
        continue;
      }

      // Extract text content
      const text = extractTextFromMessage(msg.message);
      if (!text) {
        console.log(
          `${LOG_PREFIX} Ignoring non-text message from ${remoteJid}`
        );
        continue;
      }

      console.log(
        `${LOG_PREFIX} Received from ${remoteJid}: "${text.substring(0, 60)}..."`
      );

      try {
        const replyJid = getReplyJid(msg, sock);
        await onMessage(sock, text, remoteJid, replyJid);
      } catch (err) {
        console.error(`${LOG_PREFIX} Error handling message:`, err);
      }
    }
  });

  return sock;
}

/**
 * Extract text content from a WhatsApp message.
 * Handles regular text and extended text (messages with link previews, etc.)
 */
function extractTextFromMessage(
  message: any | null | undefined
): string | null {
  if (!message) return null;

  // Plain text message
  if (message.conversation) {
    return message.conversation;
  }

  // Extended text (link previews, quoted replies, etc.)
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }

  return null;
}

/**
 * Resolve the correct JID to send replies to.
 *
 * Self-chat mode: The "Message yourself" thread lives under the @lid JID.
 * Replies MUST go to the @lid address to appear in that thread.
 * Sending to @s.whatsapp.net creates a separate invisible conversation.
 *
 * DM mode: Use senderPn > remoteJidAlt > jidNormalizedUser(remoteJid).
 */
function getReplyJid(msg: any, sock: WASocket): string {
  const remoteJid = msg.key?.remoteJid as string | undefined;
  const senderPn = msg.key?.senderPn || msg.senderPn || msg.participantPn;
  const remoteJidAlt = msg.key?.remoteJidAlt || msg.remoteJidAlt;

  // Groups: reply to the group JID
  if (remoteJid?.includes("@g.us")) {
    return remoteJid;
  }

  // Self-chat: reply to the SAME @lid JID to stay in the "Message yourself" thread
  if (remoteJid && remoteJid.endsWith("@lid")) {
    console.log(`${LOG_PREFIX} [JID] Self-chat mode: replying to ${remoteJid}`);
    return remoteJid;
  }

  // DM Priority 1: senderPn has the correct phone number
  if (senderPn && typeof senderPn === "string" && senderPn.includes("@s.whatsapp.net")) {
    const normalized = jidNormalizedUser(senderPn);
    console.log(`${LOG_PREFIX} [JID] Using senderPn: ${normalized}`);
    return normalized;
  }

  // DM Priority 2: remoteJidAlt (alternative JID, sometimes present)
  if (remoteJidAlt && typeof remoteJidAlt === "string" && remoteJidAlt.includes("@s.whatsapp.net")) {
    const normalized = jidNormalizedUser(remoteJidAlt);
    console.log(`${LOG_PREFIX} [JID] Using remoteJidAlt: ${normalized}`);
    return normalized;
  }

  // Default: normalize whatever remoteJid we have
  if (remoteJid) {
    const normalized = jidNormalizedUser(remoteJid);
    console.log(`${LOG_PREFIX} [JID] Using normalized remoteJid: ${normalized}`);
    return normalized;
  }

  console.warn(`${LOG_PREFIX} [JID] No JID found on message`);
  return "";
}
