# Live/Interactive Video for Kayley - Exploration Document

**Status:** Research & Ideation (Updated after codebase review)
**Date:** 2026-01-06
**Goal:** Make Kayley feel "live" and interactive in video form

---

## Existing Infrastructure (Already Implemented!)

Your codebase already has a robust video loop state machine:

### `useMediaQueues` Hook
```typescript
// Video queue management
const {
  videoQueue,           // Array of video URLs
  playAction,           // Inject action video (forceImmediate option)
  handleVideoEnd,       // Remove finished, play next
} = useMediaQueues();
```
- Auto-refills queue when < 3 videos remaining
- Shuffles `idleVideoUrls` for variety
- Actions can interrupt current video via `forceImmediate=true`

### `useCharacterActions` Hook
```typescript
// Action playback and categorization
const {
  playAction,               // Play action by ID
  playRandomTalkingAction,  // Random talking animation
  scheduleIdleAction,       // 10-45s random delay
  triggerIdleAction,        // Immediate idle action
  isTalkingActionId,        // Category check
  getGreetingActions,       // Filter actions
} = useCharacterActions({ ... });
```

### `CharacterAction` Structure
```typescript
interface CharacterAction {
  id: string;
  name: string;
  phrases: string[];      // Keywords that trigger this action
  video: Blob;
  videoPath: string;
  hasAudio?: boolean;
}
```

### Current Action Categories
- **Talking actions**: "talk", "talking", "speak", "chat", "answer", "respond"
- **Greeting actions**: "greeting"
- **Idle actions**: Everything else (non-greeting)

### Video Flow in App.tsx
1. Initialize with shuffled `character.idleVideoUrls`
2. Auto-refill when queue < 3 videos
3. AI responses can trigger actions via `response.action_id`
4. Actions interrupt or queue based on `forceImmediate`

---

## What's Actually Needed

Since the video state machine exists, we need:

### 1. Gesture Detection Service (NEW)
MediaPipe integration to detect user gestures via webcam.

### 2. Gesture → Action Mapping (NEW)
Map detected gestures to specific CharacterAction IDs.

### 3. New Action Categories (CONTENT)
Record/generate reaction videos for gestures.

---

## Implementation Plan

### Phase 1: Gesture Detection Service

**New file: `src/services/gestureDetectionService.ts`**

```typescript
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

export type DetectedGesture =
  | 'wave'
  | 'thumbs_up'
  | 'thumbs_down'
  | 'peace'
  | 'open_palm'
  | 'pointing'
  | null;

class GestureDetectionService {
  private recognizer: GestureRecognizer | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isRunning = false;
  private lastGesture: DetectedGesture = null;
  private gestureStartTime: number = 0;
  private onGestureCallback: ((gesture: DetectedGesture) => void) | null = null;

  // Minimum hold time to confirm gesture (prevents flickers)
  private GESTURE_CONFIRM_MS = 500;

  async initialize(): Promise<boolean> {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );

      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });

      return true;
    } catch (error) {
      console.error("[GestureDetection] Failed to initialize:", error);
      return false;
    }
  }

  async startDetection(
    videoElement: HTMLVideoElement,
    onGesture: (gesture: DetectedGesture) => void
  ): Promise<void> {
    if (!this.recognizer) {
      throw new Error("GestureRecognizer not initialized");
    }

    this.videoElement = videoElement;
    this.onGestureCallback = onGesture;
    this.isRunning = true;
    this.detectLoop();
  }

  private detectLoop = () => {
    if (!this.isRunning || !this.videoElement || !this.recognizer) return;

    const result = this.recognizer.recognizeForVideo(
      this.videoElement,
      performance.now()
    );

    const newGesture = this.mapGesture(result);

    // Gesture confirmation logic
    if (newGesture !== this.lastGesture) {
      this.lastGesture = newGesture;
      this.gestureStartTime = Date.now();
    } else if (
      newGesture &&
      Date.now() - this.gestureStartTime >= this.GESTURE_CONFIRM_MS
    ) {
      // Confirmed gesture - fire callback
      this.onGestureCallback?.(newGesture);
      this.gestureStartTime = Date.now() + 2000; // Cooldown
    }

    requestAnimationFrame(this.detectLoop);
  };

  private mapGesture(result: any): DetectedGesture {
    if (!result.gestures?.length) return null;

    const gesture = result.gestures[0][0];
    const categoryName = gesture.categoryName;

    // MediaPipe built-in gestures
    switch (categoryName) {
      case "Thumb_Up":
        return "thumbs_up";
      case "Thumb_Down":
        return "thumbs_down";
      case "Victory":
        return "peace";
      case "Open_Palm":
        // Check for wave motion (requires tracking over time)
        return this.detectWaveMotion(result) ? "wave" : "open_palm";
      case "Pointing_Up":
        return "pointing";
      default:
        return null;
    }
  }

  private waveHistory: number[] = [];

  private detectWaveMotion(result: any): boolean {
    // Track palm X position over time
    const landmarks = result.landmarks?.[0];
    if (!landmarks) return false;

    const palmX = landmarks[0].x; // Wrist X position
    this.waveHistory.push(palmX);

    if (this.waveHistory.length > 10) {
      this.waveHistory.shift();
    }

    // Detect side-to-side oscillation
    if (this.waveHistory.length >= 8) {
      let directionChanges = 0;
      for (let i = 2; i < this.waveHistory.length; i++) {
        const prev = this.waveHistory[i - 1] - this.waveHistory[i - 2];
        const curr = this.waveHistory[i] - this.waveHistory[i - 1];
        if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
          directionChanges++;
        }
      }
      // Wave = at least 2 direction changes
      return directionChanges >= 2;
    }

    return false;
  }

  stopDetection(): void {
    this.isRunning = false;
    this.waveHistory = [];
  }

  dispose(): void {
    this.stopDetection();
    this.recognizer?.close();
    this.recognizer = null;
  }
}

export const gestureDetectionService = new GestureDetectionService();
```

### Phase 2: New Hook - `useGestureResponses`

**New file: `src/hooks/useGestureResponses.ts`**

```typescript
import { useCallback, useRef, useEffect } from 'react';
import { gestureDetectionService, DetectedGesture } from '../services/gestureDetectionService';
import { CharacterAction } from '../types';

// Map gestures to action keywords
const GESTURE_ACTION_MAP: Record<DetectedGesture & string, string[]> = {
  wave: ['wave', 'waving', 'wave_back', 'wave-back'],
  thumbs_up: ['thumbs_up', 'thumbs-up', 'approve', 'like'],
  thumbs_down: ['thumbs_down', 'thumbs-down', 'disapprove', 'dislike'],
  peace: ['peace', 'peace_sign', 'victory'],
  open_palm: ['high_five', 'stop', 'palm'],
  pointing: ['point', 'pointing', 'look'],
};

interface UseGestureResponsesOptions {
  actions: CharacterAction[];
  playAction: (actionId: string, forceImmediate?: boolean) => boolean;
  enabled: boolean;
  webcamRef: React.RefObject<HTMLVideoElement>;
}

export function useGestureResponses({
  actions,
  playAction,
  enabled,
  webcamRef,
}: UseGestureResponsesOptions) {
  const lastGestureTime = useRef<number>(0);
  const COOLDOWN_MS = 3000; // 3 second cooldown between gesture responses

  const findActionForGesture = useCallback(
    (gesture: DetectedGesture): CharacterAction | null => {
      if (!gesture) return null;

      const keywords = GESTURE_ACTION_MAP[gesture] || [];

      for (const action of actions) {
        const normalizedName = action.name.toLowerCase();
        const normalizedPhrases = action.phrases.map(p => p.toLowerCase());

        for (const keyword of keywords) {
          if (
            normalizedName.includes(keyword) ||
            normalizedPhrases.some(phrase => phrase.includes(keyword))
          ) {
            return action;
          }
        }
      }

      return null;
    },
    [actions]
  );

  const handleGesture = useCallback(
    (gesture: DetectedGesture) => {
      if (!gesture) return;

      // Cooldown check
      const now = Date.now();
      if (now - lastGestureTime.current < COOLDOWN_MS) return;

      const action = findActionForGesture(gesture);
      if (action) {
        console.log(`[Gesture] Detected ${gesture}, playing action: ${action.name}`);
        playAction(action.id, true); // Force immediate
        lastGestureTime.current = now;
      }
    },
    [findActionForGesture, playAction]
  );

  useEffect(() => {
    if (!enabled || !webcamRef.current) return;

    gestureDetectionService.initialize().then((success) => {
      if (success && webcamRef.current) {
        gestureDetectionService.startDetection(webcamRef.current, handleGesture);
      }
    });

    return () => {
      gestureDetectionService.stopDetection();
    };
  }, [enabled, webcamRef, handleGesture]);

  return {
    findActionForGesture,
  };
}
```

### Phase 3: Integration in App.tsx

```typescript
// Add webcam ref and gesture hook
const webcamRef = useRef<HTMLVideoElement>(null);
const [gesturesEnabled, setGesturesEnabled] = useState(false);

useGestureResponses({
  actions: selectedCharacter?.actions || [],
  playAction,
  enabled: gesturesEnabled,
  webcamRef,
});

// Add webcam element (can be hidden)
<video
  ref={webcamRef}
  autoPlay
  playsInline
  muted
  style={{ display: 'none' }} // Hidden - just for detection
/>
```

### Phase 4: Required Video Content

You need to record/generate these action videos and add them to your character's actions:

| Gesture | Action Name | Phrases | Video Description |
|---------|-------------|---------|-------------------|
| wave | wave_back | ["wave", "waving", "hi"] | Kayley waves back, smiling |
| thumbs_up | thumbs_up_response | ["thumbs up", "approve"] | Kayley gives thumbs up |
| peace | peace_sign | ["peace", "victory"] | Kayley does peace sign |

---

## Effort Estimates (Revised)

| Task | Effort | Notes |
|------|--------|-------|
| Gesture detection service | 4-6 hours | MediaPipe integration |
| useGestureResponses hook | 2-3 hours | Action mapping |
| App.tsx integration | 1-2 hours | Webcam + hook wiring |
| Record/generate action videos | 1-3 days | Content creation |
| **Total code work** | **1-2 days** | |
| **Total with content** | **3-5 days** | |

---

## Quick Win: Micro-Animations (No New Content Needed)

While you create gesture response videos, add subtle animations to make static moments feel alive:

**CSS breathing effect on video container:**
```css
.kayley-video-container {
  animation: subtle-breathing 4s ease-in-out infinite;
}

@keyframes subtle-breathing {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.005); }
}
```

**Effort:** 30 minutes

---

## Alternative: AI-Detected Response Selection

Instead of gesture detection, use the AI to select appropriate reaction actions based on conversation:

```typescript
// In your chat response schema, add:
{
  "reaction_action": "wave_back" | "thumbs_up" | "nod" | "laugh" | null
}

// When AI detects user said "hi!" or "hey!", it can set:
reaction_action: "wave_back"
```

This requires:
1. Updating the AI response schema
2. Adding reaction action handling in App.tsx
3. Creating the reaction videos

**Effort:** 2-3 hours (code) + video content

---

## Confidence Scores (Revised)

| Approach | Code Effort | Content Effort | Quality | Confidence |
|----------|-------------|----------------|---------|------------|
| Gesture Detection + Response | Low (1-2 days) | Medium (3-5 days) | High | **90%** |
| AI-Selected Reactions | Very Low (3 hours) | Medium (3-5 days) | Good | **95%** |
| Micro-animations only | Very Low (1 hour) | None | Minimal | **100%** |

---

## Recommended Approach

1. **Today:** Add micro-animations (30 min)
2. **This week:** Implement AI-selected reactions (easier than gesture detection)
3. **Next week:** Add gesture detection for truly interactive feel
4. **Ongoing:** Create reaction video content as needed

The bottleneck is **video content**, not code. Your infrastructure is already capable of playing context-appropriate videos - you just need to:
1. Create the reaction videos
2. Add them as CharacterActions with appropriate names/phrases
3. Wire up the trigger mechanism (gesture detection OR AI selection)

---

## Implementation Confidence: 95%

Your existing `useCharacterActions` + `useMediaQueues` infrastructure already implements the hard parts. The gesture detection is well-documented MediaPipe API usage. The main work is creating compelling reaction videos.
