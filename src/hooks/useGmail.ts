// src/hooks/useGmail.ts
//
// Manages Gmail polling, full-body fetching, and a FIFO email queue.
//
// Key behaviors:
// - Polls every 60s for new inbox messages
// - Fetches the full body for each new email (so Kayley can summarize properly)
// - Deduplicates via in-memory Set (pre-seeded from DB on init) — prevents
//   re-announcing after page refresh without blocking server-caught emails
// - Exposes currentPendingEmail (head of FIFO queue) and advanceQueue()

import { useState, useEffect, useCallback, useRef } from 'react';
import { gmailService, type NewEmailPayload } from '../services/gmailService';
import { supabase } from '../services/supabaseClient';
import { clientLogger } from '../services/clientLogger';
import type { GmailSession } from '../services/googleAuth';

const log = clientLogger.scoped('useGmail');

interface UseGmailOptions {
  session: GmailSession | null;
  status: string;
}

export function useGmail({ session, status }: UseGmailOptions) {
  // Full FIFO queue of emails waiting for Kayley to announce + act on
  const [emailQueue, setEmailQueue]       = useState<NewEmailPayload[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const statusRef                          = useRef(status);

  // In-memory dedup: tracks email IDs already queued in this browser session.
  // Pre-populated from DB on init so refreshing the page doesn't re-announce old emails.
  // Using a ref (not state) avoids re-renders and closure staleness issues.
  const seenEmailIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // =========================================================
  // Initialize Gmail history pointer on first connect
  // =========================================================
  useEffect(() => {
    const init = async () => {
      if (session && status === 'connected' && !gmailService.isInitialized()) {
        try {
          await gmailService.getInitialHistoryId(session.accessToken);
          setIsInitialized(true);
          log.info('Gmail history pointer initialized');
        } catch (err) {
          log.error('Failed to initialize Gmail service', { err: String(err) });
        }
      } else if (gmailService.isInitialized()) {
        setIsInitialized(true);
      }
    };

    init();
  }, [session, status]);

  // =========================================================
  // Pre-populate seenEmailIdsRef from DB once Gmail is initialized
  // Prevents re-announcing emails that were already shown before a page refresh,
  // AND correctly shows emails that the server already caught (whatsapp_sent_at set)
  // since the server's row existence no longer blocks browser display.
  // =========================================================
  useEffect(() => {
    if (!isInitialized) return;

    const loadSeenIds = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // last 24h
      const { data } = await supabase
        .from('kayley_email_actions')
        .select('gmail_message_id')
        .not('announced_at', 'is', null)
        .gte('announced_at', since);

      if (data) {
        for (const row of data) {
          if (row.gmail_message_id) seenEmailIdsRef.current.add(row.gmail_message_id);
        }
        log.info('Pre-populated seen email IDs from DB', { count: data.length });
      }
    };

    loadSeenIds();
  }, [isInitialized]);

  // =========================================================
  // Polling loop — 60s interval
  // =========================================================
  useEffect(() => {
    if (!session || status !== 'connected') return;

    const poll = async () => {
      if (statusRef.current === 'refreshing') return;
      try {
        await gmailService.pollForNewMail(session.accessToken);
      } catch (err) {
        log.error('Polling error', { err: String(err) });
      }
    };

    const initialTimer = setTimeout(poll, 2000);
    const intervalId   = setInterval(poll, 60000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [session, status]);

  // =========================================================
  // Handle new-mail events from gmailService
  // Fetches full body + deduplicates against DB before queuing
  // =========================================================
  useEffect(() => {
    const handleNewMail = async (event: Event) => {
      const customEvent  = event as CustomEvent<NewEmailPayload[]>;
      const rawEmails    = customEvent.detail;

      log.info(`New mail event received`, { count: rawEmails.length });

      for (const email of rawEmails) {
        // ---- Dedup check: skip if already announced in this session ----
        // We use an in-memory set rather than a DB query so that emails the
        // SERVER already wrote to kayley_email_actions (whatsapp_sent_at set)
        // still get shown in the browser chat — they just won't double-queue.
        // The set is pre-populated from the last 24h of DB rows on init, so
        // browser refreshes also don't re-announce.
        if (seenEmailIdsRef.current.has(email.id)) {
          log.info('Skipping already-announced email (seen this session)', { messageId: email.id });
          continue;
        }
        seenEmailIdsRef.current.add(email.id);

        // ---- Fetch full body ----
        let body = '';
        if (session?.accessToken) {
          try {
            body = await gmailService.fetchMessageBody(session.accessToken, email.id);
            log.info('Fetched email body', { messageId: email.id, bodyLength: body.length });
          } catch (err) {
            log.warning('Could not fetch email body, falling back to snippet', { messageId: email.id, err: String(err) });
            body = email.snippet;
          }
        }

        const fullEmail: NewEmailPayload = { ...email, body };
        setEmailQueue(prev => [...prev, fullEmail]);
        log.info('Email added to queue', { messageId: email.id, from: email.from, subject: email.subject });
      }
    };

    gmailService.addEventListener('new-mail', handleNewMail);
    return () => gmailService.removeEventListener('new-mail', handleNewMail);
  }, [session]);

  // =========================================================
  // Queue controls
  // =========================================================

  /** The first email in the queue — Kayley should announce this one */
  const currentPendingEmail = emailQueue[0] ?? null;

  /** Pop the front of the queue after action is taken */
  const advanceQueue = useCallback(() => {
    setEmailQueue(prev => {
      const [removed, ...rest] = prev;
      if (removed) {
        log.info('Advanced email queue', { removedId: removed.id, remaining: rest.length });
      }
      return rest;
    });
  }, []);

  /** Legacy: clear the whole queue (kept for backward compatibility) */
  const clearQueue = useCallback(() => {
    log.info('Email queue cleared');
    setEmailQueue([]);
  }, []);

  return {
    emailQueue,
    currentPendingEmail,
    advanceQueue,
    clearQueue,           // legacy — App.tsx still uses this for auth errors etc.
    isInitialized,
    isConnected: session !== null && status === 'connected',
  };
}
