# Helpful Tools Implementation Roadmap

**Goal:** Make Kayley MORE HELPFUL through practical capability tools
**Focus:** Internet search, content sharing (YouTube, articles), Giphy, Spotify, enhanced productivity

---

## Priority 1: Quick Wins (This Week)

### 1. Internet Search via Gemini Grounding ⭐ **HIGHEST PRIORITY**

**What It Enables:**
- Search the web in real-time
- Find articles, YouTube videos, news
- Answer current questions ("What's the weather today?")
- Share links: "I found this article about [topic]"
- "This video made me laugh: [YouTube link]"

**Implementation Complexity:** ⚡ **EASY** (1-2 hours)
**Why Easy:** Gemini API already supports grounding with Google Search - just enable it!

#### Step-by-Step Implementation

**File:** `src/services/ai/GeminiChatService.ts`

**Step 1: Enable Grounding in API Call**

Find the `generateContent` call (around line 100-200):

```typescript
const result = await this.model.generateContent({
  contents: [{ role: "user", parts: [{ text: userMessage }] }],
  systemInstruction: { parts: [{ text: systemPrompt }] },
  generationConfig: {
    temperature: 0.8,
    // ... other config
  },
  // ADD THIS:
  tools: [
    {
      googleSearchRetrieval: {
        dynamicRetrievalConfig: {
          mode: "MODE_DYNAMIC", // Use search when LLM determines it's needed
          dynamicThreshold: 0.7, // Confidence threshold
        },
      },
    },
  ],
});
```

**Step 2: Add to System Prompt**

In `src/services/system_prompts/tools/index.ts`, add to the tools section:

```typescript
export function buildInternetSearchGuidance(): string {
  return `
WEB SEARCH CAPABILITY:
You can search the internet for current information.

WHEN TO USE:
- User asks about current events, news, weather
- You want to find a specific article, video, or resource
- You need up-to-date information you don't have
- You want to share something you found (article, YouTube video)

HOW TO USE:
- Just reference the information naturally - grounding happens automatically
- Share links when you find something: "I found this article: [link]"
- YouTube videos: "This video is perfect: [link]"
- Be specific: "Let me search for that..." then share what you find

WHEN NOT TO USE:
- For things you already know
- For personal questions about the user
- Just to show off - use it when genuinely helpful

EXAMPLES:
User: "What's the weather like today?"
You: "Let me check... [searches] Looks like it's 72° and sunny!"

User: "I'm learning React"
You: "Oh I found this article that explains hooks really well: [link]"

User: "Show me something funny"
You: "Okay I found this video that made me laugh: [YouTube link]"
`;
}
```

**Step 3: Test**

```bash
npm run dev
```

Test queries:
- "What's the weather today?"
- "Find me an article about [topic I've been discussing]"
- "Show me a funny video"

**Expected Result:**
- She searches in real-time
- Returns current information
- Shares links naturally

**Cost:** Free for Gemini 2.0, included in API quota

---

### 2. Giphy GIF Integration ⭐ **HIGH IMPACT**

**What It Enables:**
- React with GIFs to your messages
- Express emotions visually
- Share funny/relevant GIFs
- Celebrate wins with animated reactions

**Implementation Complexity:** ⚡ **EASY** (2-3 hours)
**API:** Free tier: 42 requests/hour (plenty for personal use)

#### Step-by-Step Implementation

**Step 1: Get Giphy API Key**

1. Go to https://developers.giphy.com/
2. Create account (free)
3. Create app, get API key
4. Add to `.env.local`:
```
VITE_GIPHY_API_KEY=your_key_here
```

**Step 2: Create Giphy Service**

**File:** `src/services/giphyService.ts`

```typescript
/**
 * Giphy Service
 *
 * Enables Kayley to search and send GIFs.
 */

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY;
const GIPHY_API_BASE = "https://api.giphy.com/v1/gifs";

export interface GifResult {
  id: string;
  url: string;
  title: string;
  images: {
    original: { url: string };
    downsized: { url: string };
    preview_gif: { url: string };
  };
}

/**
 * Search for GIFs by query.
 *
 * @param query - Search term (e.g., "excited", "high five", "celebration")
 * @param limit - Number of results (default 5)
 * @returns Array of GIF results
 */
export async function searchGifs(
  query: string,
  limit: number = 5
): Promise<GifResult[]> {
  try {
    const url = `${GIPHY_API_BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(
      query
    )}&limit=${limit}&rating=pg-13`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      console.log(`[Giphy] No results for query: ${query}`);
      return [];
    }

    return data.data.map((gif: any) => ({
      id: gif.id,
      url: gif.url,
      title: gif.title,
      images: {
        original: { url: gif.images.original.url },
        downsized: { url: gif.images.downsized.url },
        preview_gif: { url: gif.images.preview_gif.url },
      },
    }));
  } catch (error) {
    console.error("[Giphy] Error searching:", error);
    return [];
  }
}

/**
 * Get a random GIF by tag.
 *
 * @param tag - Tag to search (e.g., "celebration", "thumbs up")
 * @returns Single random GIF
 */
export async function getRandomGif(tag: string): Promise<GifResult | null> {
  try {
    const url = `${GIPHY_API_BASE}/random?api_key=${GIPHY_API_KEY}&tag=${encodeURIComponent(
      tag
    )}&rating=pg-13`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.data) {
      return null;
    }

    const gif = data.data;
    return {
      id: gif.id,
      url: gif.url,
      title: gif.title,
      images: {
        original: { url: gif.images.original.url },
        downsized: { url: gif.images.downsized.url },
        preview_gif: { url: gif.images.preview_gif.url },
      },
    };
  } catch (error) {
    console.error("[Giphy] Error getting random gif:", error);
    return null;
  }
}
```

**Step 3: Add LLM Tool**

**File:** `src/services/memoryService.ts` (or create new tool file)

Add to `MemoryToolName`:
```typescript
export type MemoryToolName =
  | "recall_memory"
  | "store_user_info"
  // ... existing tools
  | "send_gif";  // NEW
```

Add to `ToolCallArgs`:
```typescript
export type ToolCallArgs =
  | { tool: "recall_memory"; query: string; category?: string }
  | { tool: "store_user_info"; category: string; key: string; value: string }
  // ... existing tools
  | { tool: "send_gif"; query: string; reason: string };  // NEW
```

Add to `executeMemoryTool`:
```typescript
case "send_gif": {
  const { query, reason } = args as { query: string; reason: string };

  console.log(`[Tool] send_gif: query="${query}", reason="${reason}"`);

  const gif = await getRandomGif(query);

  if (!gif) {
    return {
      success: false,
      message: `Could not find GIF for "${query}"`,
    };
  }

  return {
    success: true,
    message: `Found GIF: ${gif.title}`,
    data: {
      gifUrl: gif.images.downsized.url,
      gifTitle: gif.title,
      reason: reason,
    },
  };
}
```

**Step 4: Add Tool Declaration**

**File:** `src/services/aiSchema.ts`

Add to `GeminiMemoryToolDeclarations`:
```typescript
{
  name: "send_gif",
  description: "Send a GIF reaction or expression. Use this to react visually to what the user said, celebrate, express emotions, or share something funny.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: 'Search term for the GIF (e.g., "excited", "high five", "facepalm", "celebration", "shocked")',
      },
      reason: {
        type: "string",
        description: "Why you're sending this GIF - what emotion or reaction it expresses",
      },
    },
    required: ["query", "reason"],
  },
},
```

Add to `MemoryToolArgs` union and `PendingToolCall.name` union.

**Step 5: Add System Prompt Guidance**

**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`

```typescript
export function buildGifGuidance(): string {
  return `
GIF REACTIONS:
You can send GIFs to express emotions visually!

WHEN TO USE:
- React to something funny/surprising the user said
- Celebrate wins ("you got the job!" → celebration GIF)
- Express emotions (excited, shocked, amused, supportive)
- Break tension with humor
- Visual reactions are sometimes better than words

WHEN NOT TO USE:
- Every single message (use sparingly - 1-2 per conversation max)
- Serious/vulnerable moments (unless user is playful)
- When text is more appropriate

MOOD GATING:
- High energy + playful = more GIFs
- Low energy or serious topic = no GIFs
- Match the vibe

EXAMPLES:
User: "I got the job!!"
You: [sends celebration GIF] "YES!! That's amazing!!"

User: [tells bad joke]
You: [sends facepalm GIF] "That was terrible 😂"

User: "I'm so stressed about this presentation"
You: [sends supportive/calming GIF] "You got this"

TECHNICAL:
Call send_gif(query="celebration", reason="They got the job!")
The GIF will appear inline in your response.
`;
}
```

**Step 6: Update UI to Display GIFs**

**File:** `src/components/MessageDisplay.tsx` (or wherever messages render)

Check if tool response contains `gifUrl`:
```typescript
{message.toolResults?.map((result, idx) => (
  result.data?.gifUrl ? (
    <img
      key={idx}
      src={result.data.gifUrl}
      alt={result.data.gifTitle}
      style={{ maxWidth: '300px', borderRadius: '8px' }}
    />
  ) : null
))}
```

**Step 7: Test**

```bash
npm run dev
```

Test scenarios:
- Tell her good news: "I got the job!" → Should send celebration GIF
- Tell a bad joke → Should send facepalm/groaning GIF
- Ask her to send a funny GIF → Should send one

---

### 3. Enhanced Content Sharing (Built on Internet Search)

**What It Enables:**
- Share YouTube videos she finds funny/relevant
- Share articles related to your interests
- News about topics you care about
- Reddit posts, tweets, etc.

**Implementation:** ⚡ **FREE** (comes with Gemini grounding from #1)

**Just add system prompt guidance:**

```typescript
export function buildContentSharingGuidance(): string {
  return `
CONTENT SHARING:
With web search, you can find and share content naturally.

TYPES OF CONTENT:
- YouTube videos (funny, educational, relevant to their interests)
- Articles (deep dives, explanations, news)
- Reddit posts (if relevant to conversation)
- Tweets/social posts (timely, relevant)

WHEN TO SHARE:
- User mentions learning something → find educational content
- Conversation is playful → find funny videos
- They mention an interest → find related content
- You genuinely think they'd enjoy it

WHEN NOT TO SHARE:
- Just to share something (needs to be relevant)
- User is in serious/vulnerable moment
- You're forcing it

MOOD GATING:
- High energy + high warmth = more likely to share fun content
- Playful mood = funny videos
- Low energy = no content spam

RELATIONSHIP TIERS:
- Tier 1-2: Only when explicitly asked
- Tier 3-4: Occasional shares if very relevant
- Tier 5-6: Regular sharing like close friends

EXAMPLES:
User: "I'm trying to learn React hooks"
You: "Oh I found this video that explains it really well: [link]"

User: "I'm bored"
You: "Okay I found this video that made me laugh: [link]"

User: "Tell me about the news today"
You: "There's this article about [topic]: [link]"

PHRASING:
Good: "I found this for you: [link]"
Good: "This made me think of you: [link]"
Good: "This video is perfect: [link]"
Bad: "I have retrieved a URL for your consumption"
Bad: "Here is content: [link]"
`;
}
```

---

## Priority 2: Medium Effort, High Value (Next Week)

### 4. Spotify Music Sharing

**What It Enables:**
- Share songs she thinks you'd like
- Create collaborative playlists
- "This song reminds me of you"
- Music recommendations based on mood

**Implementation Complexity:** ⚡⚡ **MEDIUM** (4-6 hours)
**API:** Spotify Web API (free)

**High-Level Steps:**

1. **Get Spotify API credentials**
   - Create app at https://developer.spotify.com/
   - Get Client ID and Secret
   - OAuth not needed for search (public data)

2. **Create `spotifyService.ts`**
   ```typescript
   export async function searchTracks(query: string, limit: number = 5)
   export async function getTrack(trackId: string)
   export async function createPlaylist(name: string, tracks: string[])
   ```

3. **Add LLM tool `share_music`**
   ```typescript
   parameters: {
     action: "search" | "share_track" | "create_playlist",
     query?: string,
     trackId?: string,
     playlistName?: string,
   }
   ```

4. **System prompt guidance**
   - When to share music (mood-based, relationship tier)
   - "This song reminds me of..." phrasing

**Example Usage:**
- User: "I'm feeling anxious"
- Kayley: "Try this song, it helps me calm down: [Spotify link]"

---

### 5. Enhanced Email Intelligence

**What Exists:**
- ✅ Gmail API integration
- ✅ Email polling for new messages

**What to Add:**
- Email summarization ("You got 5 emails, 2 need responses")
- VIP detection ("Your mom emailed!")
- Draft suggestions

**Implementation Complexity:** ⚡⚡ **MEDIUM** (3-4 hours)

**High-Level Steps:**

1. **Extend `checkGmail` function**
   - Parse email subjects/senders
   - Detect importance (keywords, sender history)
   - Summarize content

2. **Add tool `manage_emails`**
   ```typescript
   parameters: {
     action: "summarize" | "mark_read" | "draft_reply",
     emailIds?: string[],
   }
   ```

3. **Proactive morning briefing**
   - "Overnight you got 3 emails - want the summary?"

**Example Usage:**
- Morning greeting: "Hey! You got 5 emails overnight. Your boss sent one about the project deadline, looks important. Want me to summarize the rest?"

---

### 6. Package Tracking (Email Parsing)

**What It Enables:**
- "Your package arrives today!"
- Track deliveries from confirmation emails
- Proactive notifications

**Implementation Complexity:** ⚡ **EASY** (2-3 hours)
**Built on:** Existing Gmail integration

**High-Level Steps:**

1. **Parse shipping emails**
   - Detect Amazon, UPS, FedEx, USPS
   - Extract tracking numbers and delivery dates

2. **Create open loop**
   - "Package arriving today" → ask about it later

3. **Proactive reminder**
   - "Your package should be here by now, did it arrive?"

---

## Priority 3: Nice-to-Have (Future)

### 7. Weather Awareness
- Tied to location
- Proactive: "It's beautiful out, want to go for a walk?"
- Context: "Presentation in 2 hours + rainy weather" → "Stay cozy and crush it"

### 8. News Filtering
- Topics you care about
- Morning briefing: "3 things in AI today..."
- Shared reading: "Did you see the article about [ongoing thread]?"

### 9. Learning Companion
- Track study goals
- Spaced repetition reminders
- Progress celebration
- Quiz you on material

---

## Implementation Priority Ranking

### Week 1 (Do These First):
1. ⭐ **Internet Search (Gemini Grounding)** - 1-2 hours
2. ⭐ **Giphy Integration** - 2-3 hours
3. ⭐ **Content Sharing Guidance** - 30 min (built on #1)

**Total:** ~4-6 hours for massive capability boost

### Week 2 (If You Want More):
4. **Spotify Music Sharing** - 4-6 hours
5. **Enhanced Email Intelligence** - 3-4 hours
6. **Package Tracking** - 2-3 hours

---

## AlphaGo Philosophy Applied

**These tools are GOOD because:**
- ✅ Enable capabilities (LLM can't search web, can't fetch GIFs without tools)
- ✅ LLM decides WHEN to use them (system prompt gives guidance, not rules)
- ✅ Natural language (LLM decides HOW to phrase, what to share)
- ✅ Mood/relationship gated (use less when low energy, more when tier 5-6)

**They DON'T:**
- ❌ Force interaction patterns
- ❌ Prescribe exact behaviors
- ❌ Kill spontaneity
- ❌ Make her robotic

**Example of Good Design:**
- Tool: `send_gif(query, reason)` → Capability
- System Prompt: "Use GIFs when playful/celebrating, not every message" → Guidance
- LLM decides: When to use, which query, how to integrate naturally → Freedom

---

## Next Steps

1. **Pick your starting point:**
   - All 3 Week 1 tools? (6 hours total)
   - Just internet search? (1-2 hours)
   - Just Giphy? (2-3 hours)

2. **I'll create detailed implementation guides:**
   - Exact code for each file
   - Step-by-step testing
   - Integration with existing systems

3. **Test for natural usage:**
   - Does she use tools at appropriate times?
   - Does it feel helpful or intrusive?
   - Is phrasing natural?

Which tools do you want to start with? Internet search + Giphy would give you the biggest immediate impact for ~4-6 hours of work.
