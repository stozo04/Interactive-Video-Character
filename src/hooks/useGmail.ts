import { useState, useEffect, useCallback } from 'react';
import { gmailService, type NewEmailPayload } from '../services/gmailService';
import type { GmailSession } from '../services/googleAuth';

interface UseGmailOptions {
  session: GmailSession | null;
  status: string;
}

export function useGmail({ session, status }: UseGmailOptions) {
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize Gmail service when session is ready
  useEffect(() => {
    const init = async () => {
      if (session && status === 'connected' && !gmailService.isInitialized()) {
        try {
          console.log('📬 [useGmail] Initializing Gmail history pointer...');
          await gmailService.getInitialHistoryId(session.accessToken);
          setIsInitialized(true);
        } catch (err) {
          console.error('📬 [useGmail] Failed to initialize Gmail service:', err);
        }
      } else if (gmailService.isInitialized()) {
        setIsInitialized(true);
      }
    };

    init();
  }, [session, status]);

  // Polling loop
  useEffect(() => {
    if (!session || status !== 'connected') return;

    const poll = async () => {
      try {
        console.log('📬 [useGmail] Polling for new mail...');
        await gmailService.pollForNewMail(session.accessToken);
      } catch (err) {
        console.error('📬 [useGmail] Polling error:', err);
      }
    };

    // Initial poll after short delay
    console.log('📬 [useGmail] Gmail polling loop started (1m interval)');
    const initialTimer = setTimeout(poll, 2000);
    const intervalId = setInterval(poll, 60000); // 1 minute

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [session, status]);

  // Handle new mail events
  useEffect(() => {
    const handleNewMail = (event: Event) => {
      const customEvent = event as CustomEvent<NewEmailPayload[]>;
      console.log(`📬 [useGmail] Received ${customEvent.detail.length} new email(s)`);
      setEmailQueue(prev => [...prev, ...customEvent.detail]);
    };

    gmailService.addEventListener('new-mail', handleNewMail);
    return () => {
      gmailService.removeEventListener('new-mail', handleNewMail);
    };
  }, []);

  const clearQueue = useCallback(() => {
    setEmailQueue([]);
  }, []);

  return {
    emailQueue,
    clearQueue,
    isInitialized,
    isConnected: session !== null && status === 'connected'
  };
}
