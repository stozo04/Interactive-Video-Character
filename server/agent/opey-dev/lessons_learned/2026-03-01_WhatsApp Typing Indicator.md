# Lessons Learned — WhatsApp Typing Indicator — 2026-03-01

## Ticket
Implement a WhatsApp typing indicator that stays on while Kayley is generating a response.

## Codebase Discoveries
- The WhatsApp bridge is powered by Baileys and the primary response flow lives in `server/whatsapp/whatsappHandler.ts`.

## Gotchas & Bugs
- A single presence update does not keep the typing indicator alive for long responses; it needs periodic refreshes.

## Approach That Worked
- Start a repeating `sock.sendPresenceUpdate('composing', jid)` loop before orchestration and stop it with a `paused` update in a `finally` block.

## What Future Opey Should Know
- Presence updates should never block message delivery; log failures and keep the main response flow running.
