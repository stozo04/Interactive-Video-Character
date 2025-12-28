# Performance & Assets

These services ensure the app feels fast, responsive, and doesn't crash your browser with heavy video files.

## Cache Service (`cacheService.ts`)

Manages the delivery of videos and character assets.

*   **The "Zero-Memory" Optimization**: Instead of downloading 100MB videos into your computer's RAM (Blobs), it uses **Public URLs** from Supabase Storage. This allows the browser to stream the video and use its own disk cache, saving 99% of memory.
*   **Tables**: `characters`, `character_idle_videos`, `character_actions`
*   **LLM?**: No. It's an asset manager.

## Prefetch Service (`prefetchService.ts`)

Eliminates the "Wait" when you send a message.

*   **The Problem**: Reading the database (Mood, Facts, History) takes ~300ms. If we wait to do this *after* the user types, the response feels slow.
*   **The Solution**: While the user is "idle," this service pre-fetches all that data into a 60-second memory cache.
*   **Workflow**:
```text
User is Reading... -> [prefetchService] fetches Mood/Facts -> (Data is in RAM)
User Types "Hi"    -> [BaseAIService] gets data from RAM -> (Instant Prompt Start)
```

## State Service (`stateService.ts`)

(Documented in detail in its own file). Centralizes all Supabase calls for user state.
