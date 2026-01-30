/**
 * Video Actions Handler
 *
 * Processes video-related actions from AI responses.
 * Generates AI companion videos using the Grok video generation service.
 *
 * Similar to selfieActions.ts but for video generation.
 */

import { generateCompanionVideo } from '../../services/grokVideoGenerationService';
import { getKayleyPresenceState } from '../../services/kayleyPresenceService';
import type { ChatMessage } from '../../types';
import type { CalendarEvent } from '../../services/calendarService';

/**
 * Video action from AI response
 */
export interface VideoAction {
  scene?: string;
  mood?: string;
  outfit?: string;
  duration?: number; // Optional: 5, 8, or 10 seconds
}

/**
 * Context needed to generate video
 */
export interface VideoActionContext {
  userMessage: string;
  chatHistory: ChatMessage[];
  upcomingEvents: CalendarEvent[];
}

/**
 * Result of processing a video action
 */
export interface VideoActionResult {
  handled: boolean;
  success: boolean;
  videoUrl?: string;
  duration?: number;
  error?: string;
}

/**
 * Process a video action from AI response
 */
export async function processVideoAction(
  videoAction: VideoAction | null | undefined,
  context: VideoActionContext
): Promise<VideoActionResult> {
  if (!videoAction || !videoAction.scene) {
    return { handled: false, success: false };
  }

  console.log("🎬 Video action detected - generating companion video");
  console.log("🎬 Scene:", videoAction.scene, "Mood:", videoAction.mood);

  try {
    // Get Kayley's current presence state
    const kayleyState = await getKayleyPresenceState();

    // DEBUG: Log presence state usage
    console.log("🎬 [Video Generation] Presence State:", {
      hasState: !!kayleyState,
      outfit: kayleyState?.currentOutfit,
      mood: kayleyState?.currentMood,
      activity: kayleyState?.currentActivity,
      location: kayleyState?.currentLocation,
      expiresAt: kayleyState?.expiresAt,
    });

    // Prepare upcoming events for outfit context
    const formattedEvents = context.upcomingEvents.map((event) => ({
      title: event.summary,
      startTime: new Date(event.start.dateTime || event.start.date || ""),
      isFormal: isFormalEvent(event.summary),
    }));

    // Prepare conversation history
    const conversationHistory = context.chatHistory.slice(-10).map((msg) => ({
      role: msg.role === "user" ? "user" : ("assistant" as const),
      content: msg.text,
    }));

    // Generate the video
    const videoResult = await generateCompanionVideo({
      scene: videoAction.scene,
      mood: videoAction.mood,
      outfit: videoAction.outfit,
      userMessage: context.userMessage,
      conversationHistory,
      upcomingEvents: formattedEvents,
      presenceOutfit: kayleyState?.currentOutfit,
      presenceMood: kayleyState?.currentMood,
      duration: videoAction.duration,
    });

    if (videoResult.success && videoResult.url) {
      console.log("✅ Video generated successfully!", videoResult.url);
      return {
        handled: true,
        success: true,
        videoUrl: videoResult.url,
        duration: videoResult.duration,
      };
    } else {
      console.error("❌ Video generation failed:", videoResult.error);
      return {
        handled: true,
        success: false,
        error: videoResult.error || "Couldn't generate the video",
      };
    }
  } catch (error) {
    console.error("Failed to generate video:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if an event is formal based on its summary
 */
function isFormalEvent(summary: string): boolean {
  const lowerSummary = summary.toLowerCase();
  return (
    lowerSummary.includes('dinner') ||
    lowerSummary.includes('meeting') ||
    lowerSummary.includes('presentation') ||
    lowerSummary.includes('interview') ||
    lowerSummary.includes('conference') ||
    lowerSummary.includes('gala') ||
    lowerSummary.includes('wedding')
  );
}
