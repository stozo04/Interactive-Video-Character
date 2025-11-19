// src/services/gmailService.ts

// This is the data we'll send to the chat "bridge"
export interface NewEmailPayload {
    id: string;
    from: string;
    subject: string;
    snippet: string;
    receivedAt: string; // ISO string
  }
  
  // Key for storing the last-checked pointer
  const HISTORY_ID_KEY = "gmail_history_id";
  
  /**
   * This service will use an EventTarget to notify the app
   * when new mail arrives. This is a clean, built-in way to
   * handle events.
   */
  class GmailService extends EventTarget {
    private apiBase = "https://www.googleapis.com/gmail/v1/users/me";
  
    /**
     * Fetches the user's *current* mailbox state.
     * Call this ONCE after login to get the starting point.
     */
    async getInitialHistoryId(accessToken: string): Promise<string> {
      const response = await fetch(`${this.apiBase}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json();
      const historyId = data.historyId;
      
      // Save this as our "last seen" pointer
      localStorage.setItem(HISTORY_ID_KEY, historyId);
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
      // Silently initialize if not already done
      try {
        await this.getInitialHistoryId(accessToken);
        console.log('Gmail service auto-initialized');
        return; // Skip this poll cycle, will poll on next interval
      } catch (error) {
        console.error("Failed to initialize Gmail service:", error);
        return;
      }
    }
  
      // 1. Ask Google for all changes since our last check
      const historyResponse = await fetch(
        `${this.apiBase}/history?startHistoryId=${lastHistoryId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
  
      if (!historyResponse.ok) {
        // 401 means token is bad. App.tsx will need to handle this.
        if (historyResponse.status === 401) {
          this.dispatchEvent(new CustomEvent("auth-error"));
        }
        throw new Error(`Gmail history fetch failed: ${historyResponse.statusText}`);
      }
  
      const historyData = await historyResponse.json();
  
      // 2. If there's new history, find the "messages added" events
      if (historyData.history) {
        const newMessages = historyData.history
          .flatMap((record: any) => record.messagesAdded || [])
          .filter((item: any) => item.message.labelIds.includes("INBOX"));
          
        if (newMessages.length > 0) {
          // 3. Get the headers for just these new messages
          const messageIds = newMessages.map((item: any) => item.message.id);
          const emailPayloads = await this.fetchMessageHeaders(accessToken, messageIds);
  
          // 4. Fire an event for App.tsx to listen to!
          this.dispatchEvent(
            new CustomEvent<NewEmailPayload[]>("new-mail", { detail: emailPayloads })
          );
        }
      }
      
      // 5. IMPORTANT: Save the *new* historyId for the *next* poll.
      localStorage.setItem(HISTORY_ID_KEY, historyData.historyId);
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
  
      for (const part of parts) {
        if (part.includes("Content-Type: application/json")) {
          // Find the JSON body within the part
          const jsonStart = part.indexOf("{");
          const jsonEnd = part.lastIndexOf("}");
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonBody = part.substring(jsonStart, jsonEnd + 1);
            const data = JSON.parse(jsonBody);
  
            // Helper to find a specific header value
            const getHeader = (name: string) => 
              data.payload.headers.find((h: any) => h.name === name)?.value || "";
              
            payloads.push({
              id: data.id,
              from: getHeader("From"),
              subject: getHeader("Subject"),
              receivedAt: getHeader("Date"),
              snippet: data.snippet,
            });
          }
        }
      }
      return payloads;
    }
  }
  
  // Create a single instance that the whole app can use
  export const gmailService = new GmailService();