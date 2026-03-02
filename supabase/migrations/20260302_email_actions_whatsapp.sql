-- Extends kayley_email_actions with two columns needed for the WhatsApp bridge:
--
--   gmail_access_token  — stored by the browser when it creates the 'pending' row
--                         so the WA server process can call the Gmail API without
--                         the user being present in a browser.
--
--   whatsapp_sent_at    — set by emailBridge.ts after it successfully sends the
--                         kayley_summary to Steven's WhatsApp. The WA handler uses
--                         this to know which emails have been surfaced to him.

ALTER TABLE public.kayley_email_actions
  ADD COLUMN IF NOT EXISTS gmail_access_token TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at   TIMESTAMPTZ;
