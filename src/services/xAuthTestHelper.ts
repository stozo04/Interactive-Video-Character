/**
 * X OAuth Test Helper
 *
 * Exposes functions on `window` for testing the X OAuth flow
 * from the browser devtools console.
 *
 * Usage (open browser console):
 *
 *   Step 1: Start OAuth flow
 *   > await xAuth.start()
 *   → Opens a new tab to authorize on X
 *
 *   Step 2: After authorizing, X redirects to your callback URL.
 *           The page won't load (that's fine). Copy the FULL URL from the address bar.
 *
 *   Step 3: Paste the callback URL
 *   > await xAuth.callback("https://example.com?state=abc&code=xyz")
 *   → Exchanges the code for tokens and stores them
 *
 *   Step 4: Verify connection
 *   > await xAuth.status()
 *
 *   Step 5: Test posting (optional)
 *   > await xAuth.testPost("hello from Kayley!")
 *
 *   Disconnect:
 *   > await xAuth.disconnect()
 */

import {
  initXAuth,
  handleXAuthCallback,
  isXConnected,
  postTweet,
  revokeXAuth,
  getRecentPostedTweets,
} from "./xTwitterService";
import { generateTweet } from "./xTweetGenerationService";

interface XAuthTestHelper {
  start: () => Promise<void>;
  callback: (url: string) => Promise<void>;
  status: () => Promise<void>;
  testPost: (text: string) => Promise<void>;
  testGenerate: () => Promise<void>;
  disconnect: () => Promise<void>;
  recent: () => Promise<void>;
}

const xAuthHelper: XAuthTestHelper = {
  /**
   * Step 1: Start the OAuth flow. Opens the X authorization page in a new tab.
   */
  async start() {
    try {
      const authUrl = await initXAuth();
      console.log("🐦 Opening X authorization page...");
      console.log("🐦 Auth URL:", authUrl);
      console.log("");
      console.log("📋 After authorizing, copy the FULL URL from the address bar");
      console.log('   Then run: await xAuth.callback("paste_url_here")');
      window.open(authUrl, "_blank");
    } catch (error) {
      console.error("❌ Failed to start OAuth:", error);
    }
  },

  /**
   * Step 2: Paste the callback URL after authorizing on X.
   * Extracts code and state from the URL and exchanges for tokens.
   */
  async callback(callbackUrl: string) {
    try {
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        console.error("❌ URL missing code or state params. Got:", {
          code: !!code,
          state: !!state,
          url: callbackUrl,
        });
        return;
      }

      console.log("🐦 Exchanging authorization code for tokens...");
      await handleXAuthCallback(code, state);
      console.log("✅ X account connected successfully!");
      console.log('   Run: await xAuth.status() to verify');
    } catch (error) {
      console.error("❌ Callback failed:", error);
    }
  },

  /**
   * Check if X account is connected.
   */
  async status() {
    const connected = await isXConnected();
    if (connected) {
      console.log("✅ X account is connected and tokens are valid");
    } else {
      console.log("❌ X account is NOT connected");
      console.log('   Run: await xAuth.start() to begin OAuth flow');
    }
  },

  /**
   * Post a test tweet directly.
   */
  async testPost(text: string) {
    try {
      console.log(`🐦 Posting tweet: "${text}"`);
      const result = await postTweet(text);
      console.log("✅ Tweet posted!", result);
    } catch (error) {
      console.error("❌ Failed to post:", error);
    }
  },

  /**
   * Test the full LLM tweet generation pipeline (without posting).
   */
  async testGenerate() {
    try {
      console.log("🐦 Generating tweet via LLM...");
      const draft = await generateTweet("pending_approval");
      if (draft) {
        console.log("✅ Tweet generated:");
        console.log(`   Text: "${draft.tweetText}"`);
        console.log(`   Intent: ${draft.intent}`);
        console.log(`   Reasoning: ${draft.reasoning}`);
        console.log(`   Draft ID: ${draft.id}`);
        console.log(`   Status: ${draft.status}`);
      } else {
        console.log("⚠️ No tweet generated (check console logs above for details)");
      }
    } catch (error) {
      console.error("❌ Generation failed:", error);
    }
  },

  /**
   * Disconnect X account (revoke tokens).
   */
  async disconnect() {
    try {
      await revokeXAuth();
      console.log("✅ X account disconnected");
    } catch (error) {
      console.error("❌ Disconnect failed:", error);
    }
  },

  /**
   * Show recently posted tweets from the database.
   */
  async recent() {
    const tweets = await getRecentPostedTweets(10);
    if (tweets.length === 0) {
      console.log("📭 No posted tweets yet");
      return;
    }
    console.log(`📬 ${tweets.length} recent tweets:`);
    tweets.forEach((t, i) => {
      console.log(`   ${i + 1}. "${t.tweetText}" [${t.status}] ${t.postedAt || t.createdAt}`);
    });
  },
};

// Expose on window for console access
declare global {
  interface Window {
    xAuth: XAuthTestHelper;
  }
}

export function registerXAuthTestHelper(): void {
  window.xAuth = xAuthHelper;
  console.log("🐦 X Auth test helper registered. Use: await xAuth.start()");
}
