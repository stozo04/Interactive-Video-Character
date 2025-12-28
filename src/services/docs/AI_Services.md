# AI Services (The Providers)

The AI layer is structured with a base class and multiple specific implementations. This allows the app to switch between different AI models (Gemini, GPT-4, Grok) easily.

## The Hierarchy

- **`BaseAIService.ts`**: The core logic. It handles prompt building, tool execution logic, audio generation (ElevenLabs), and background analysis triggers.
- **`geminiChatService.ts`**: Implementation using Google's Gemini Pro/Flash models.
- **`chatGPTService.ts`**: Implementation using OpenAI's GPT-4o models.
- **`grokChatService.ts`**: Implementation using X.AI's Grok models.
- **`mockChatService.ts`**: A local simulator for testing without spending API credits.

## Global Schemas (`aiSchema.ts`)
All services MUST return JSON that matches the `AIActionResponseSchema`. This ensures that no matter which AI is "thinking," the UI receives a consistent structure:
- `text_response`: What she says.
- `action_id`: Which video to play.
- `calendar_action`: Create/Delete events.
- `selfie_action`: Trigger image generation.

## Workflow Interaction

```text
Component -> [Service implementation] (e.g. Gemini)
                    |
            [BaseAIService.generateResponse]
                    |
    +---------------+---------------+---------------+
    |               |               |               |
[buildSystemPrompt] [callProvider] [generateSpeech] [analyzeBackground]
(context fetch)     (LLM Call)     (ElevenLabs)      (messageAnalyzer)
```

## Does it use an LLM?
**Yes.** This is the primary LLM call. It generates the actual conversation.

## Interaction with Supabase
The base service calls `promptUtils.ts` which in turn calls `stateService.ts` and `characterFactsService.ts` to gather all the background info (mood, facts, history) into the system prompt. It doesn't write to the DB itself, but it "fires" the background analytics that do.
