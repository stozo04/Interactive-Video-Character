// src/services/gmailService.ts
import { clientLogger } from './clientLogger';

// Full email payload — includes body + threadId for reply/archive actions
export interface NewEmailPayload {
  id: string;
  threadId: string;   // needed for sending threaded replies
  from: string;       // e.g. "Cindy Walther <cindy@example.com>"
  subject: string;
  snippet: string;
  body: string;       // full plain-text body (HTML stripped)
  receivedAt: string; // ISO string
}

// Key for storing the last-checked pointer
const HISTORY_ID_KEY = "gmail_history_id";

const IGNORED_LABELS = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
];

/**
 * This service will use an EventTarget to notify the app
 * when new mail arrives. This is a clean, built-in way to
 * handle events.
 */
class GmailService extends EventTarget {
  private apiBase = "https://www.googleapis.com/gmail/v1/users/me";
  private log = clientLogger.scoped('GmailService');

  /**
   * Fetches the user's *current* mailbox state.
   * Call this ONCE after login to get the starting point.
   */
  async getInitialHistoryId(accessToken: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Gmail profile: ${response.statusText}`);
    }

    const data = await response.json();
    const historyId = data.historyId;

    // Save this as our "last seen" pointer
    localStorage.setItem(HISTORY_ID_KEY, historyId);
    console.log(`📍 Gmail history pointer set to: ${historyId}`);
    return historyId;
  }

  /**
   * Check if Gmail service is initialized
   */
  isInitialized(): boolean {
    return localStorage.getItem(HISTORY_ID_KEY) !== null;
  }

  /**
   * Polls for any changes since the last time we checked.
   */
  async pollForNewMail(accessToken: string) {
    const lastHistoryId = localStorage.getItem(HISTORY_ID_KEY);
    if (!lastHistoryId) {
      try {
        await this.getInitialHistoryId(accessToken);
        console.log("Gmail service auto-initialized");
        return;
      } catch (error) {
        console.error("Failed to initialize Gmail service:", error);
        return;
      }
    }

    // 1. Ask Google for all changes since our last check.
    // historyTypes=messageAdded → only new-message events (not label/delete noise)
    // labelId=INBOX            → only messages arriving in inbox; also guarantees
    //                            that labelIds IS populated in the response objects
    const historyResponse = await fetch(
      `${this.apiBase}/history?startHistoryId=${lastHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!historyResponse.ok) {
      if (historyResponse.status === 401) {
        this.dispatchEvent(new CustomEvent("auth-error"));
      }
      throw new Error(
        `Gmail history fetch failed: ${historyResponse.statusText}`
      );
    }

    const historyData = await historyResponse.json();

    this.log.info('poll summary', {
      historyId: lastHistoryId,
      newHistoryId: historyData.historyId ?? 'none',
      historyRecords: historyData.history?.length ?? 0,
    });

    // 2. If there's new history, find the "messages added" events
    if (historyData.history) {
      const allAdded = historyData.history.flatMap((record: any) => record.messagesAdded || []);

      const newMessages = allAdded.filter((item: any) => {
          const labels: string[] = item.message.labelIds || [];

          // The API query already guarantees INBOX membership (labelId=INBOX).
          // If labelIds is still absent for some reason, let the message through
          // rather than silently dropping it — that was the original bug.
          if (!labels.length) {
            this.log.info('message has empty labelIds in history record — passing through filter', {
              messageId: item.message.id,
            });
            return true;
          }

          // IMPORTANT overrides category filtering — if Gmail flagged it as
          // important, surface it regardless of category (e.g. CATEGORY_UPDATES).
          // This catches transactional/business emails (docusign, dotloop, banks)
          // that Gmail auto-categorizes as Updates but are clearly high-signal.
          if (labels.includes('IMPORTANT')) return true;

          // Drop promotional/social/updates/forums categories
          const dropped = labels.some((label: string) => IGNORED_LABELS.includes(label));
          if (dropped) {
            this.log.info('filtered message', {
              messageId: item.message.id,
              labels,
            });
          }
          return !dropped;
        });

      this.log.info('message filter summary', {
        messagesAdded: allAdded.length,
        passedFilter: newMessages.length,
      });

      if (newMessages.length > 0) {
        // 3. Get the headers for just these new messages
        const messageIds = newMessages.map((item: any) => item.message.id);

        // (Optional) Double check: The history object usually has the labels,
        // but if you want 100% accuracy, you could filter again inside
        // fetchMessageHeaders, though this is usually overkill.
        const emailPayloads = await this.fetchMessageHeaders(accessToken, messageIds);

        // 4. Fire an event for App.tsx to listen to!
        this.dispatchEvent(
          new CustomEvent<NewEmailPayload[]>("new-mail", {
            detail: emailPayloads,
          })
        );
      }
    }

    // 5. IMPORTANT: Save the *new* historyId for the *next* poll.
    if (historyData.historyId) {
      localStorage.setItem(HISTORY_ID_KEY, historyData.historyId);
    }
  }

  /**
   * Given a list of message IDs, fetches their metadata.
   */
  private async fetchMessageHeaders(
    accessToken: string,
    messageIds: string[]
  ): Promise<NewEmailPayload[]> {
    // We will use a "batch" request to get all messages in one API call
    const boundary = "batch_boundary";
    let batchBody = "";

    for (const id of messageIds) {
      batchBody += `--${boundary}\n`;
      batchBody += `Content-Type: application/http\n\n`;
      batchBody += `GET ${this.apiBase}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date\n\n`;
    }
    batchBody += `--${boundary}--`;

    const batchResponse = await fetch(
      `https://www.googleapis.com/batch/gmail/v1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
        },
        body: batchBody,
      }
    );

    // This is a bit complex, but it's the most efficient way.
    // We must parse the "multipart" response.
    const text = await batchResponse.text();
    const parts = text.split(/--batch_.*/);
    const payloads: NewEmailPayload[] = [];
    let skippedParts = 0;
    let parsedParts = 0;

    for (const part of parts) {
      if (part.includes("Content-Type: application/json")) {
        // Find the JSON body within the part
        const jsonStart = part.indexOf("{");
        const jsonEnd = part.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonBody = part.substring(jsonStart, jsonEnd + 1);
          let data: any = null;
          try {
            data = JSON.parse(jsonBody);
          } catch (error) {
            skippedParts += 1;
            this.log.warning('batch part JSON parse failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          // Helper to find a specific header value
          const headers = Array.isArray(data?.payload?.headers)
            ? data.payload.headers
            : null;

          if (!headers) {
            skippedParts += 1;
            // data.error means Gmail returned an API error for this message in the batch
            // (e.g. 404 Not Found — message not yet indexed, timing race with History API)
            this.log.warning('batch part missing headers', {
              messageId: data?.id ?? null,
              hasPayload: !!data?.payload,
              errorCode: data?.error?.code ?? null,
              errorMessage: data?.error?.message ?? null,
            });
            // Queue for individual retry if we have an ID (transient 404 race)
            if (data?.id) failedIds.push(data.id);
            continue;
          }

          const getHeader = (name: string) =>
            headers.find((h: any) => h.name === name)?.value || "";

          payloads.push({
            id: data.id,
            threadId: data.threadId || '',
            from: getHeader("From"),
            subject: getHeader("Subject"),
            receivedAt: getHeader("Date"),
            snippet: data.snippet || '',  // default to '' — never undefined
            body: '',                     // populated separately by fetchMessageBody()
          });
          parsedParts += 1;
        }
      }
    }

    this.log.info('batch headers parsed', {
      requestedIds: messageIds.length,
      parsedParts,
      skippedParts,
    });
    return payloads;
  }

  // ==========================================================================
  // FETCH FULL MESSAGE BODY
  // ==========================================================================

  /**
   * Fetches the full plain-text body of a single email.
   * Prefers text/plain parts; falls back to stripping HTML from text/html.
   * Returns an empty string if the body can't be decoded.
   */
  async fetchMessageBody(accessToken: string, messageId: string): Promise<string> {
    const response = await fetch(
      `${this.apiBase}/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      console.warn(`[GmailService] fetchMessageBody failed for ${messageId}: ${response.statusText}`);
      return '';
    }

    const data = await response.json();
    return this.extractBodyText(data.payload);
  }

  /**
   * Recursively walks the MIME payload tree to find the best text part.
   * Prefers text/plain over text/html.
   */
  private extractBodyText(payload: any): string {
    if (!payload) return '';

    // Direct body data on this part
    // Use startsWith — Gmail includes charset params e.g. "text/plain; charset=UTF-8"
    if (payload.body?.data) {
      const text = this.decodeBase64Url(payload.body.data);
      if (payload.mimeType?.startsWith('text/plain')) return text;
      if (payload.mimeType?.startsWith('text/html'))  return this.stripHtml(text);
    }

    // Walk child parts — prefer text/plain
    if (payload.parts?.length) {
      const plainPart = payload.parts.find((p: any) => p.mimeType?.startsWith('text/plain'));
      if (plainPart?.body?.data) return this.decodeBase64Url(plainPart.body.data);

      const htmlPart = payload.parts.find((p: any) => p.mimeType?.startsWith('text/html'));
      if (htmlPart?.body?.data) return this.stripHtml(this.decodeBase64Url(htmlPart.body.data));

      // Recurse into nested multipart
      for (const part of payload.parts) {
        const text = this.extractBodyText(part);
        if (text) return text;
      }
    }

    return '';
  }

  /** Gmail uses base64url encoding (- and _ instead of + and /) */
  private decodeBase64Url(encoded: string): string {
    try {
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(base64)));
    } catch {
      return '';
    }
  }

  /** Strip HTML tags and collapse whitespace for a readable plain-text preview */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')   // remove tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')       // collapse whitespace
      .trim();
  }

  // ==========================================================================
  // ARCHIVE EMAIL
  // ==========================================================================

  /**
   * Archives a message by removing the INBOX label.
   * The message stays in Gmail (not deleted), just moves out of inbox.
   */
  async archiveEmail(accessToken: string, messageId: string): Promise<boolean> {
    console.log(`[GmailService] Archiving message: ${messageId}`);

    const response = await fetch(
      `${this.apiBase}/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    );

    if (!response.ok) {
      console.error(`[GmailService] Archive failed for ${messageId}: ${response.statusText}`);
      return false;
    }

    console.log(`[GmailService] ✅ Archived message: ${messageId}`);
    return true;
  }

  // ==========================================================================
  // SEND EMAIL REPLY
  // ==========================================================================

  /**
   * Sends a reply email in the same thread.
   * The body should already be written in Kayley's voice by the AI.
   *
   * @param accessToken  - OAuth token
   * @param threadId     - Gmail thread ID (keeps it in the same conversation)
   * @param to           - Recipient address (the original sender)
   * @param subject      - Original subject (Re: prefix added automatically if missing)
   * @param body         - Plain-text body (composed by Kayley via AI)
   */
  async sendReply(
    accessToken: string,
    threadId: string | undefined | null,
    to: string,
    subject: string,
    body: string
  ): Promise<boolean> {
    console.log(`[GmailService] Sending email to: ${to}${threadId ? ` | thread: ${threadId}` : ' | new thread'}`);

    // Ensure "Re:" prefix on subject
    const reSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    // Always append Kayley's signature so the recipient knows who they're talking to.
    // This is enforced here rather than relying on the AI to remember every time.
    const signature = `\r\n\r\n— Kayley\r\n(Steven's AI companion, responding on his behalf)`;
    const bodyWithSignature = body + signature;

    // Build a minimal RFC 2822 email string
    const emailLines = [
      `To: ${to}`,
      `Subject: ${reSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      '',   // blank line separates headers from body
      bodyWithSignature,
    ];
    const rawEmail = emailLines.join('\r\n');

    // Gmail API requires base64url encoding
    const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch(
      `${this.apiBase}/messages/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(threadId ? { raw: encoded, threadId } : { raw: encoded }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      this.log.error('sendReply failed', {
        status: response.status,
        statusText: response.statusText,
        to,
        threadId: threadId ?? null,
        responseBody: errBody.substring(0, 500),
      });
      return false;
    }

    this.log.info('sendReply succeeded', { to, threadId: threadId ?? null });
    return true;
  }

  // ==========================================================================
  // SEARCH EMAILS
  // ==========================================================================

  /**
   * Searches Gmail inbox using Gmail search syntax (same as the Gmail search bar).
   * Returns structured results with dates for the LLM to reason about recency.
   */
  async searchEmails(
    accessToken: string,
    query: string,
    maxResults: number = 5
  ): Promise<GmailSearchResult[]> {
    const clampedMax = Math.min(Math.max(maxResults, 1), 10);
    this.log.info('searchEmails', { query, maxResults: clampedMax });

    // 1. List matching message IDs
    const listResponse = await fetch(
      `${this.apiBase}/messages?q=${encodeURIComponent(query)}&maxResults=${clampedMax}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      this.log.warning('searchEmails list failed', { status: listResponse.status });
      throw new Error(`Gmail search failed: ${listResponse.statusText}`);
    }

    const listData = await listResponse.json();
    const messages: Array<{ id: string; threadId: string }> = listData.messages || [];

    if (messages.length === 0) return [];

    // 2. Fetch metadata + snippet for each result
    const results: GmailSearchResult[] = [];

    for (const msg of messages) {
      try {
        const msgResponse = await fetch(
          `${this.apiBase}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!msgResponse.ok) continue;

        const msgData = await msgResponse.json();
        const headers = msgData.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name === name)?.value || '';

        const result: GmailSearchResult = {
          messageId: msgData.id,
          threadId: msgData.threadId || '',
          from: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: msgData.snippet || '',
        };

        // Fetch body for the first result only (to keep token usage reasonable)
        if (results.length === 0) {
          const body = await this.fetchMessageBody(accessToken, msg.id);
          if (body) {
            result.body = body.length > 800 ? body.slice(0, 800) + '...' : body;
          }
        }

        results.push(result);
      } catch (err) {
        this.log.warning('searchEmails fetch message failed', {
          messageId: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log.info('searchEmails complete', { query, resultsCount: results.length });
    return results;
  }
}

export interface GmailSearchResult {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
}

// Create a single instance that the whole app can use
export const gmailService = new GmailService();
