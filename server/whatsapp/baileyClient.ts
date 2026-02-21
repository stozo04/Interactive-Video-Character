import baileysPkg, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
// 1. Import the QR code library!
import qrcode from 'qrcode-terminal';

const makeWASocket = baileysPkg.default || baileysPkg;
const LOG_PREFIX = "[Baileys]";

export const sentMessageIds = new Set<string>();
export type WASocket = ReturnType<typeof makeWASocket>;

export async function startWhatsAppClient(
    onMessage: (sock: WASocket, text: string, jid: string, replyJid: string) => Promise<void>
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

            // Extract normal text if it exists
            let text = m.message?.conversation || m.message?.extendedTextMessage?.text || "";

            // If it's a sticker or GIF without text, give the AI some context
            if (isSticker && !text) {
                text = "[User sent a sticker]";
                // Optional: Download the WebP to pass to Gemini Vision
                // const mediaBuffer = await downloadMediaMessage(m, 'buffer', { }, { logger: console as any });
            } else if (isGif && !text) {
                text = "[User sent a GIF]";
            } else if (isImage && !text) {
                text = "[User sent an image]";
            }

            if (text) {
                // NATIVE V7 ROUTING
                await onMessage(sock, text, remoteJid, remoteJid);
            }
        }
    });
}