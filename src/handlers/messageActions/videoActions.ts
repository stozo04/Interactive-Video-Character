/**
 * Video Actions Handler
 *
 * Processes video-related actions from AI responses.
 * Generates AI companion videos using the Grok video generation service.
 *
 * Similar to selfieActions.ts but for video generation.
 */

import { generateCompanionVideo } from '../../services/grokVideoGenerationService';
import type { ChatMessage } from '../../types';

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
      upcomingEvents: [],
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

