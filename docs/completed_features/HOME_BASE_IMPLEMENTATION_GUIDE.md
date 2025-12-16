# 🎥 Feature Implementation: Seamless Video Branching

## 🎯 The Objective
**Problem:** Currently, when our character switches from an "Idle" loop to an "Action" (like clapping), there is a visible black flash or jump cut. This breaks the illusion of a living character.

**Solution:** We are implementing a **"Double Buffer"** video engine. Instead of stopping one video to load another, we will have two video players stacked on top of each other. One plays while the other preloads the next clip silently. When the current clip ends, we instantly swap visibility.

---

## 🧠 Core Concepts (Read this first!)

1.  **Neutral Home Base:** Every video file (idle or action) must start and end at the exact same physical pose. This ensures that cutting between them looks seamless.
2.  **Double Buffering:** Think of a DJ with two decks. Deck A is playing music for the crowd. The DJ loads the next track onto Deck B and gets it ready. When Deck A finishes, they crossfade instantly to Deck B.
3.  **The Queue:** We never interrupt a video in the middle. If the AI decides to "Clap," we add "Clap" to a waiting line (queue). The character finishes their current idle breath, *then* plays the clap.

---

## 🛠️ Implementation Phases

### Phase 1: The Double Buffer Player
**File:** `src/components/VideoPlayer.tsx`

The current component uses a single `<video>` tag. You need to refactor this to manage two.

#### 1. Update State
Instead of relying on just `src` passed via props, you need internal state to track which "deck" is active.
```typescript
// Example State Idea
const [activePlayer, setActivePlayer] = useState<0 | 1>(0);
const [nextVideoReady, setNextVideoReady] = useState(false);
```
#### 2. Render Two Players
Render two <video> elements inside a container.

Positioning: Use CSS absolute positioning so they sit directly on top of each other.

Visibility: Use a CSS class (like opacity-0 vs opacity-100) to hide the inactive player. Do not use display: none or unmount the component, as this stops buffering.

#### 3. The "Preload & Swap" Logic
Use a useEffect hook that listens for changes to the src prop.

IF src changes:

Identify the inactive player (e.g., if Player 0 is visible, load into Player 1).

Set the inactive player's src.

Call .load() on the inactive player ref.

ON videoEnded (Event Listener):

This event fires when the active video finishes.

Check if the inactive player is ready.

The Swap:

Call .play() on the inactive player.

Update state to make the inactive player visible (opacity: 1).

Hide the old player (opacity: 0).

Call onEnded prop to tell the parent app "I'm done, give me the next link."

### Phase 2: Data Model Updates
Files: src/types.ts & src/services/cacheService.ts

We are moving from a single "Idle Video" to a "Playlist of Idle Videos."

#### 1. Update Types
In src/types.ts, update the CharacterProfile interface:

TypeScript
```
export interface CharacterProfile {
  // ... existing fields
  // CHANGE THIS:
  // idleVideo: Blob; 
  // TO THIS:
  idleVideos: Blob[]; 
}
```

#### 2. Update Cache Service
In src/services/cacheService.ts, find buildCharacterProfile.

Current Logic: Fetches a single path from the idle_video_path column.

New Logic: You need to fetch all idle videos associated with this character.

Note: You may need to query a new table (e.g., character_idle_videos) or a storage folder.

Ensure you download all blobs and return them as an array.

Phase 3: The Logic Controller (The Brain)
File: src/App.tsx

The App component currently holds a single currentVideoUrl. It needs to become a "Queue Manager."

#### 1. State Management
Replace currentVideoUrl with a queue system:

TypeScript
```
const [videoQueue, setVideoQueue] = useState<string[]>([]);
```
#### 2. Initialization
When a character loads:

Generate object URLs for all idleVideos blobs.

Shuffle them (randomize order) to create a natural feeling.

Fill the videoQueue with these URLs.

#### 3. Handling AI Actions
When handleSendMessage receives an action (like WAVE):

Old Way: setCurrentVideoUrl(actionUrl) (Immediate cut).

New Way:

Take the actionUrl.

Insert it at index 1 of the videoQueue (the very next slot).

Optional: Insert a "Bridge" video if you implement that feature later.

#### 4. The Loop
Create a handler for onVideoEnded (passed to VideoPlayer):

TypeScript
```
const handleVideoEnd = () => {
  // Remove the first item (the one that just finished)
  // If queue is low (e.g., < 2 items), grab more random idle clips and append them
  // Force update the VideoPlayer with queue[0]
}
```
🧪 Verification Checklist
Before submitting your PR, run these manual tests:

The "No Flicker" Test:

Load the character. Watch them breathe/idle for 3 loops.

Pass: There should be zero black flashes between loops. It should look like one continuous video.

The "Command" Test:

Type "Wave at me."

Pass: The character should finish their current movement (e.g., finish looking left) and then wave. They should not snap instantly to the wave.

The "Spam" Test:

Type "Clap" five times quickly.

Pass: The character should perform 5 claps in a row, smoothly transitioning between each one.

📝 Helpful Resources
MDN: HTMLMediaElement - Reference for .load(), .play(), and ended events. 
https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

React: useRef Hook - You will need this to control the <video> DOM elements directly.
https://react.dev/reference/react/useRef