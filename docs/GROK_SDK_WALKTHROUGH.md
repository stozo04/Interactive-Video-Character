# README: Migrating to Grok Structured Outputs for AI Actions

This guide provides a detailed walkthrough for refactoring our application to use Grok as the "brain" for triggering character actions.

**Goal:** Instead of manually checking for keywords (like "wave"), we will let Grok analyze the user's intent and tell our app which video action to play. We will use `ai-sdk/xai` and `zod` to force Grok to return a reliable, structured JSON response.

**The New Flow:**
1.  **User:** "I just got a raise!"
2.  **`App.tsx`:** Sends this raw text to `grokChatService`. (We will *remove* the old `findMatchingAction` call).
3.  **`grokChatService.ts`:**
    * Tells Grok: "Here is a list of actions: `WAVE`, `KISS`, `GREETING`. Does this message match one? Also, what is your text reply?"
    * Forces Grok to reply with a Zod-compliant JSON object.
4.  **Grok:** Responds with: `{ "text_response": "That's wonderful news! Congratulations!", "action_id": "CLAP" }` (or "WAVE", "KISS", etc.)
5.  **`App.tsx`:**
    * Receives this object.
    * Displays `"That's wonderful news!..."` in the chat.
    * Sees `action_id: "CLAP"` and plays the "clapping" video.

---

## Step 1: Install the XAI SDK

First, we must add the official `xai-sdk` to your project. You mentioned you already have `zod`.

```bash

# xAI Grok Provider

The [xAI Grok](https://x.ai) provider contains language model support for the [xAI API](https://x.ai/api).

## Setup

The xAI Grok provider is available via the `@ai-sdk/xai` module. You can
install it with

<Tabs items={['pnpm', 'npm', 'yarn', 'bun']}>
  <Tab>
    <Snippet text="pnpm add @ai-sdk/xai" dark />
  </Tab>
  <Tab>
    <Snippet text="npm install @ai-sdk/xai" dark />
  </Tab>
  <Tab>
    <Snippet text="yarn add @ai-sdk/xai" dark />
  </Tab>

  <Tab>
    <Snippet text="bun add @ai-sdk/xai" dark />
  </Tab>
</Tabs>

## Provider Instance

You can import the default provider instance `xai` from `@ai-sdk/xai`:

```ts
import { xai } from '@ai-sdk/xai';
```

If you need a customized setup, you can import `createXai` from `@ai-sdk/xai`
and create a provider instance with your settings:

```ts
import { createXai } from '@ai-sdk/xai';

const xai = createXai({
  apiKey: 'your-api-key',
});
```

You can use the following optional settings to customize the xAI provider instance:

- **baseURL** _string_

  Use a different URL prefix for API calls, e.g. to use proxy servers.
  The default prefix is `https://api.x.ai/v1`.

- **apiKey** _string_

  API key that is being sent using the `Authorization` header. It defaults to
  the `XAI_API_KEY` environment variable.

- **headers** _Record&lt;string,string&gt;_

  Custom headers to include in the requests.

- **fetch** _(input: RequestInfo, init?: RequestInit) => Promise&lt;Response&gt;_

  Custom [fetch](https://developer.mozilla.org/en-US/docs/Web/API/fetch) implementation.
  Defaults to the global `fetch` function.
  You can use it as a middleware to intercept requests,
  or to provide a custom fetch implementation for e.g. testing.

## Language Models

You can create [xAI models](https://console.x.ai) using a provider instance. The
first argument is the model id, e.g. `grok-3`.

```ts
const model = xai('grok-3');
```

### Example

You can use xAI language models to generate text with the `generateText` function:

```ts
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text } = await generateText({
  model: xai('grok-3'),
  prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});
```

xAI language models can also be used in the `streamText`, `generateObject`, and `streamObject` functions
(see [AI SDK Core](/docs/ai-sdk-core)).

### Provider Options

xAI chat models support additional provider options that are not part of
the [standard call settings](/docs/ai-sdk-core/settings). You can pass them in the `providerOptions` argument:

```ts
const model = xai('grok-3-mini');

await generateText({
  model,
  providerOptions: {
    xai: {
      reasoningEffort: 'high',
    },
  },
});
```

The following optional provider options are available for xAI chat models:

- **parallel_function_calling** _boolean_

  Whether to enable parallel function calling during tool use. When `true`, the model can call multiple functions in parallel. When `false`, the model will call functions sequentially. Defaults to `true`.

- **reasoningEffort** _'low' | 'high'_

  Reasoning effort for reasoning models. Only supported by `grok-3-mini` and `grok-3-mini-fast` models.

## Live Search

xAI models support Live Search functionality, allowing them to query real-time data from various sources and include it in responses with citations.

### Basic Search

To enable search, specify `searchParameters` with a search mode:

```ts
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text, sources } = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'What are the latest developments in AI?',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'auto', // 'auto', 'on', or 'off'
        returnCitations: true,
        maxSearchResults: 5,
      },
    },
  },
});

console.log(text);
console.log('Sources:', sources);
```

### Search Parameters

The following search parameters are available:

- **mode** _'auto' | 'on' | 'off'_

  Search mode preference:

  - `'auto'` (default): Model decides whether to search
  - `'on'`: Always enables search
  - `'off'`: Disables search completely

- **returnCitations** _boolean_

  Whether to return citations in the response. Defaults to `true`.

- **fromDate** _string_

  Start date for search data in ISO8601 format (`YYYY-MM-DD`).

- **toDate** _string_

  End date for search data in ISO8601 format (`YYYY-MM-DD`).

- **maxSearchResults** _number_

  Maximum number of search results to consider. Defaults to 20, max 50.

- **sources** _Array&lt;SearchSource&gt;_

  Data sources to search from. Defaults to `["web", "x"]` if not specified.

### Search Sources

You can specify different types of data sources for search:

#### Web Search

```ts
const result = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'Best ski resorts in Switzerland',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'on',
        sources: [
          {
            type: 'web',
            country: 'CH', // ISO alpha-2 country code
            allowedWebsites: ['ski.com', 'snow-forecast.com'],
            safeSearch: true,
          },
        ],
      },
    },
  },
});
```

#### Web source parameters

- **country** _string_: ISO alpha-2 country code
- **allowedWebsites** _string[]_: Max 5 allowed websites
- **excludedWebsites** _string[]_: Max 5 excluded websites
- **safeSearch** _boolean_: Enable safe search (default: true)

#### X (Twitter) Search

```ts
const result = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'Latest updates on Grok AI',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'on',
        sources: [
          {
            type: 'x',
            includedXHandles: ['grok', 'xai'],
            excludedXHandles: ['openai'],
            postFavoriteCount: 10,
            postViewCount: 100,
          },
        ],
      },
    },
  },
});
```

#### X source parameters

- **includedXHandles** _string[]_: Array of X handles to search (without @ symbol)
- **excludedXHandles** _string[]_: Array of X handles to exclude from search (without @ symbol)
- **postFavoriteCount** _number_: Minimum favorite count of the X posts to consider.
- **postViewCount** _number_: Minimum view count of the X posts to consider.

#### News Search

```ts
const result = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'Recent tech industry news',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'on',
        sources: [
          {
            type: 'news',
            country: 'US',
            excludedWebsites: ['tabloid.com'],
            safeSearch: true,
          },
        ],
      },
    },
  },
});
```

#### News source parameters

- **country** _string_: ISO alpha-2 country code
- **excludedWebsites** _string[]_: Max 5 excluded websites
- **safeSearch** _boolean_: Enable safe search (default: true)

#### RSS Feed Search

```ts
const result = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'Latest status updates',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'on',
        sources: [
          {
            type: 'rss',
            links: ['https://status.x.ai/feed.xml'],
          },
        ],
      },
    },
  },
});
```

#### RSS source parameters

- **links** _string[]_: Array of RSS feed URLs (max 1 currently supported)

### Multiple Sources

You can combine multiple data sources in a single search:

```ts
const result = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'Comprehensive overview of recent AI breakthroughs',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'on',
        returnCitations: true,
        maxSearchResults: 15,
        sources: [
          {
            type: 'web',
            allowedWebsites: ['arxiv.org', 'openai.com'],
          },
          {
            type: 'news',
            country: 'US',
          },
          {
            type: 'x',
            includedXHandles: ['openai', 'deepmind'],
          },
        ],
      },
    },
  },
});
```

### Sources and Citations

When search is enabled with `returnCitations: true`, the response includes sources that were used to generate the answer:

```ts
const { text, sources } = await generateText({
  model: xai('grok-3-latest'),
  prompt: 'What are the latest developments in AI?',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'auto',
        returnCitations: true,
      },
    },
  },
});

// Access the sources used
for (const source of sources) {
  if (source.sourceType === 'url') {
    console.log('Source:', source.url);
  }
}
```

### Streaming with Search

Live Search works with streaming responses. Citations are included when the stream completes:

```ts
import { streamText } from 'ai';

const result = streamText({
  model: xai('grok-3-latest'),
  prompt: 'What has happened in tech recently?',
  providerOptions: {
    xai: {
      searchParameters: {
        mode: 'auto',
        returnCitations: true,
      },
    },
  },
});

for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}

console.log('Sources:', await result.sources);
```

## Model Capabilities

| Model                       | Image Input         | Object Generation   | Tool Usage          | Tool Streaming      | Reasoning           |
| --------------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `grok-4-fast-non-reasoning` | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-4-fast-reasoning`     | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-code-fast-1`          | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-4`                    | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-3`                    | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-3-latest`             | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-3-fast`               | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-3-fast-latest`        | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-3-mini`               | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-3-mini-latest`        | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-3-mini-fast`          | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-3-mini-fast-latest`   | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> |
| `grok-2`                    | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-2-latest`             | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-2-1212`               | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-2-vision`             | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-2-vision-latest`      | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-2-vision-1212`        | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-beta`                 | <Cross size={18} /> | <Check size={18} /> | <Check size={18} /> | <Check size={18} /> | <Cross size={18} /> |
| `grok-vision-beta`          | <Check size={18} /> | <Cross size={18} /> | <Cross size={18} /> | <Cross size={18} /> | <Cross size={18} /> |

<Note>
  The table above lists popular models. Please see the [xAI
  docs](https://docs.x.ai/docs#models) for a full list of available models. The
  table above lists popular models. You can also pass any available provider
  model ID as a string if needed.
</Note>

## Image Models

You can create xAI image models using the `.image()` factory method. For more on image generation with the AI SDK see [generateImage()](/docs/reference/ai-sdk-core/generate-image).

```ts
import { xai } from '@ai-sdk/xai';
import { experimental_generateImage as generateImage } from 'ai';

const { image } = await generateImage({
  model: xai.image('grok-2-image'),
  prompt: 'A futuristic cityscape at sunset',
});
```

<Note>
  The xAI image model does not currently support the `aspectRatio` or `size`
  parameters. Image size defaults to 1024x768.
</Note>

### Model-specific options

You can customize the image generation behavior with model-specific settings:

```ts
import { xai } from '@ai-sdk/xai';
import { experimental_generateImage as generateImage } from 'ai';

const { images } = await generateImage({
  model: xai.image('grok-2-image'),
  prompt: 'A futuristic cityscape at sunset',
  maxImagesPerCall: 5, // Default is 10
  n: 2, // Generate 2 images
});
```

### Model Capabilities

| Model          | Sizes              | Notes                                                                                                                                                                                                    |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grok-2-image` | 1024x768 (default) | xAI's text-to-image generation model, designed to create high-quality images from text prompts. It's trained on a diverse dataset and can generate images across various styles, subjects, and settings. |

```
## Step 2: Define the Zod Schema
Create a new file, src/services/grokSchema.ts, to define the strict output format we will demand from Grok.
// src/services/grokSchema.ts
import { z } from 'zod';

// This is the list of *exact* action IDs your character has.
// This list MUST match the IDs you use in App.tsx (actionVideoUrls[action.id]).
const ActionIdEnum = z.enum([
  'KISS', 
  'GREETING', 
  'WAVE'
  // Add new actions here as you create them, e.g., 'CLAP', 'LAUGH'
]);

/**
 * Defines the strict JSON structure we want Grok to return.
 */
export const GrokActionResponseSchema = z.object({
  /**
   * The conversational text response to display in the chat.
   * This should be a natural, in-character reply.
   */
  text_response: z.string().describe(
    "The conversational text to display in the chat."
  ),

  /**
   * The video action to play.
   * This MUST be null unless the user's intent *strongly*
   * matches one of the available actions.
   */
  action_id: ActionIdEnum.nullable().describe(
    "The ID of the video action to play, or null if no action is appropriate."
  )
});

// We can also infer the TypeScript type from the schema
export type GrokActionResponse = z.infer<typeof GrokActionResponseSchema>;

## Step 3: Refactor grokChatService.ts
This is the biggest change. We will replace the fetch call with the xai-sdk client and tell it to use our new Zod schema.

// src/services/grokChatService.ts

import { Client } from 'xai-sdk'; // <-- NEW IMPORT
import { ChatMessage, CharacterProfile, CharacterAction } from '../types';
import type { RelationshipMetrics } from './relationshipService';
// NEW: Import our Zod schema and type
import { GrokActionResponseSchema, type GrokActionResponse } from './grokSchema';

// ... (keep GrokChatSession interface)

// --- NEW: Instantiate the SDK Client ---
const API_KEY = process.env.VITE_GROK_API_KEY;
if (!API_KEY) {
  console.warn("VITE_GROK_API_KEY environment variable not set.");
}
const client = new Client({ apiKey: API_KEY });


interface GrokChatOptions {
  character?: CharacterProfile;
  // matchingAction?: CharacterAction | null; // <-- REMOVE THIS
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
}

/**
 * Generate a response using Grok API with structured output
 */
export const generateGrokResponse = async (
  userMessage: string,
  options: GrokChatOptions = {},
  session?: GrokChatSession
): Promise<{ response: GrokActionResponse; session: GrokChatSession }> => { // <-- UPDATED RETURN TYPE
  if (!API_KEY) {
    throw new Error("VITE_GROK_API_KEY not configured.");
  }

  const { character, chatHistory = [], relationship, upcomingEvents } = options;

  // Build system prompt (we will update this function below)
  const systemPrompt = buildSystemPrompt(character, relationship, upcomingEvents);

  // Prepare messages for API (this stays the same)
  const messages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.text,
    } as GrokMessage)),
    { role: 'user', content: userMessage },
  ];

  try {
    // --- THIS IS THE BIG CHANGE ---
    // Replace the 'fetch' call with the SDK's 'completions.create'
    const response = await client.chat.completions.create({
      model: session?.model || 'grok-4-fast-reasoning-latest',
      messages: messages,
      // This is the magic! We tell Grok to use our Zod schema.
      response_format: {
        type: "json_object",
        schema: GrokActionResponseSchema,
      },
      // We pass previous_response_id if we have it, just like before
      ...(session?.previousResponseId && {
        previous_response_id: session.previousResponseId,
      }),
    });

    const responseId = response.id;
    const responseContent = response.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error("Grok returned an empty response.");
    }

    // The content is a JSON *string*. We parse it.
    // Zod.parse would also work, but Grok guarantees it matches.
    const structuredResponse: GrokActionResponse = JSON.parse(responseContent);

    // Update session
    const updatedSession: GrokChatSession = {
      characterId: session?.characterId || character?.id || 'unknown',
      userId: session?.userId || 'default',
      previousResponseId: responseId,
      model: session?.model || 'grok-4-fast-reasoning-latest',
    };

    return {
      response: structuredResponse, // <-- Return the full object
      session: updatedSession,
    };
  } catch (error) {
    console.error('Error calling Grok API:', error);
    throw error;
  }
};

/**
 * Build system prompt with character context and new ACTION instructions
 */
const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = []
): string => {
  // --- NEW: Define the Action Menu ---
  const actionsMenu = `
  [
    {
      "action_id": "GREETING",
      "description": "A friendly acknowledgment or 'hello'. Use when the user first appears, says 'hi', or a similar greeting."
    },
    {
      "action_id": "WAVE",
      "description": "A physical wave. Use when the user says 'wave', 'hello', or 'goodbye', or when you are greeting them."
    },
    {
      "action_id": "KISS",
      "description": "Blowing a kiss. This is an affectionate action. Use *only* if the user says something very loving or explicitly asks for a kiss, and *only* if the relationship is 'Close Friend' or 'Deeply Loving'."
    }
  ]
  `;
  
  let prompt = `You are an interactive AI character. Your response **must** be a JSON object matching the provided Zod schema.`;
  
  // ... (keep character prompt, relationship prompt, calendar prompt) ...

  // --- NEW: Add Action Instructions ---
  prompt += `
\n[Character Actions]:
You can perform the video actions listed below. Your job is to analyze the user's *intent*.
${actionsMenu}

[Action Rules]:
1. Your response **must** be a JSON object with 'text_response' and 'action_id'.
2. 'text_response' is your natural, in-character verbal reply.
3. 'action_id' is the action you will perform.
4. **THIS IS THE MOST IMPORTANT RULE:** The 'action_id' field **MUST be \`null\`** for 90% of normal conversation.
5. Only set the 'action_id' to a string (e.g., "WAVE") if the user's message is a *direct command* ("Please wave") or a *very strong emotional match* ("I just got a raise!" -> "CLAP", "Hello!" -> "GREETING").
6. If you are in doubt, **ALWAYS use \`null\`**. Do not over-trigger actions.
`;

  // ... (keep Response Guidelines) ...

  return prompt;
};

// --- Refactor generateGrokGreeting (Recommended) ---
// This function should also be updated to use the new SDK for consistency.
// It doesn't need the action schema, just a simple text response.
export const generateGrokGreeting = async (
  character: CharacterProfile,
  session?: GrokChatSession,
  previousHistory?: ChatMessage[],
  relationship?: RelationshipMetrics | null
): Promise<{ greeting: string; session: GrokChatSession }> => {
  
  const systemPrompt = buildSystemPrompt(character, relationship);
  const greetingPrompt = "Generate a friendly, brief greeting. Keep it under 15 words.";

  const messages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(previousHistory || []).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.text,
    } as GrokMessage)),
    { role: 'user', content: greetingPrompt },
  ];
  
  try {
    const response = await client.chat.completions.create({
      model: session?.model || 'grok-4-fast-reasoning-latest',
      messages: messages,
      // No schema needed, just text
    });

    const greeting = response.choices[0]?.message?.content || "Hi there!";
    const responseId = response.id;
    
    const updatedSession: GrokChatSession = {
      // ... (same session logic as before) ...
      characterId: character.id,
      userId: session?.userId || 'default',
      previousResponseId: responseId,
      model: session?.model || 'grok-4-fast-reasoning-latest',
    };

    return { greeting, session: updatedSession };
  } catch (error) {
    console.error('Error generating Grok greeting:', error);
    throw error;
  }
};

## Step 4: Update App.tsx (The "Brain Shift")
Now we update handleSendMessage to use the new "Grok-first" logic. We will remove the old findMatchingAction call.
// src/App.tsx

import React, { /* ... */ } from 'react';
// ...
import * as grokChatService from './services/grokChatService';
// NEW: Import the response *type* (not the schema)
import type { GrokActionResponse } from './services/grokSchema';
// ...
import { /* ... */ } from './components/GmailConnectButton';
// ...

// ... (keep sanitizeText, getUserId, etc.)

// --- THIS FUNCTION IS NO LONGER NEEDED ---
/*
const findMatchingAction = (
  message: string,
  actions: CharacterProfile['actions']
) => {
  // ... (all of this logic is now handled by Grok)
};
*/

// ...

const App: React.FC = () => {
  // ... (all state remains the same)

  // ... (all other hooks remain the same)

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return;

    registerInteraction();
    setErrorMessage(null);
    
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: message }];
    setChatHistory(updatedHistory);
    setIsProcessingAction(true);

    try {
      // --- REMOVE OLD ACTION LOGIC ---
      // const matchingAction = findMatchingAction(
      //   message,
      //   selectedCharacter.actions
      // );
      // (This is all GONE)

      // ... (keep relationship update logic)
      const userId = getUserId();
      const relationshipEvent = /* ... */;
      const updatedRelationship = /* ... */;
      setRelationship(updatedRelationship);

      // --- UPDATE GROK CALL ---
      const grokSession = grokSession || grokChatService.getOrCreateSession(selectedCharacter.id, userId);
      
      const { response, session: updatedSession } = await grokChatService.generateGrokResponse(
        message,
        {
          character: selectedCharacter,
          // matchingAction, // <-- REMOVE THIS
          chatHistory: updatedHistory,
          relationship: updatedRelationship,
          upcomingEvents: upcomingEvents,
        },
        grokSession
      );
      
      setGrokSession(updatedSession);
      
      // --- NEW LOGIC: Parse the Structured Response ---
      
      // 'response' is now our GrokActionResponse object
      const grokResponse: GrokActionResponse = response;
      const textResponse = grokResponse.text_response;
      const actionIdToPlay = grokResponse.action_id; // This will be "WAVE", "KISS", or null
      
      // ... (handle calendar actions if they are still needed) ...
      // if (textResponse.startsWith('[CALENDAR_CREATE]')) { ... }

      // Add Grok's *text response* to local state
      const finalHistory = [...updatedHistory, { role: 'model' as const, text: textResponse }];
      setChatHistory(finalHistory);
      
      // ... (keep conversation saving logic, but use textResponse)
      conversationHistoryService.appendConversationHistory(
        selectedCharacter.id,
        userId,
        [
          { role: 'user', text: message },
          { role: 'model', text: textResponse }, // <-- Use textResponse
        ]
      ).then(() => {
        // ...
      });

      // --- NEW: Play the action Grok decided on ---
      if (actionIdToPlay) {
        // 'actionIdToPlay' is an ID like "WAVE". We find its URL in state.
        const actionUrl = actionVideoUrls[actionIdToPlay];
        
        if (!actionUrl) {
          // Fallback to Supabase URL if local URL not available
          const matchedAction = selectedCharacter.actions.find(a => a.id === actionIdToPlay);
          if (matchedAction?.videoPath) {
            const { data } = supabase.storage
              .from(ACTION_VIDEO_BUCKET)
              .getPublicUrl(matchedAction.videoPath);
            const fallbackUrl = data?.publicUrl ?? null;
            if (fallbackUrl) {
              setCurrentVideoUrl(fallbackUrl);
              setCurrentActionId(matchedAction.id);
            }
          } else {
            console.warn(`Grok chose action "${actionIdToPlay}" but it could not be found.`);
          }
        } else {
          // ... (this logic is the same as your old 'if (matchingAction)' block)
          if (
            currentVideoUrl &&
            currentVideoUrl !== idleVideoUrl &&
            currentVideoUrl !== actionUrl
          ) {
            // ... (revoke logic)
          }
          setCurrentVideoUrl(actionUrl);
          setCurrentActionId(actionIdToPlay);
        }
      }

    } catch (error) {
      console.error('Error generating response:', error);
      // ... (error handling)
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  // ... (rest of App.tsx)
};

export default App;

## Step 5: How to Test
Test for "Nothing": Have a normal conversation.

You: "What's the weather like?"

AI: Should reply with text (e.g., "I'm not sure...") and action_id must be null. The character should not play an action. This is the most important test.

Test Explicit Command:

You: "Please wave."

AI: Grok should see the keyword "wave" and return { "text_response": "Hi there!", "action_id": "WAVE" }. The app should play the "WAVE" video.

Test Implicit Intent:

You: "Hello!"

AI: Grok should match this to the "GREETING" description and return { "text_response": "Hey!", "action_id": "GREETING" }. The app should play the "GREETING" video.

Test Edge Case (KISS):

You: "You're the best!"

AI: If your relationship is high, it might trigger "KISS". This will help you tune the prompt descriptions for grokChatService.ts and the action_id list in grokSchema.ts.