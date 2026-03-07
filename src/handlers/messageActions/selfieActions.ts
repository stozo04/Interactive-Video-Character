/**
 * Selfie Actions Handler
 *
 * Processes selfie-related actions from AI responses.
 * Generates AI companion images using the image generation service.
 *
 * Extracted from App.tsx as part of Phase 5 refactoring.
 */

import { generateCompanionSelfie } from '../../services/imageGenerationService';
import { getKayleyPresenceState } from '../../services/kayleyPresenceService';
import type { ChatMessage } from '../../types';

/**
 * Selfie action from AI response
 */
export interface SelfieAction {
  scene?: string;
  mood?: string;
  outfit?: string;
}

/**
 * Context needed to generate selfie
 */
export interface SelfieActionContext {
  userMessage: string;
  chatHistory: ChatMessage[];
}

/**
 * Result of processing a selfie action
 */
export interface SelfieActionResult {
  handled: boolean;
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Process a selfie action from AI response
 */
export async function processSelfieAction(
  selfieAction: SelfieAction | null | undefined,
  context: SelfieActionContext
): Promise<SelfieActionResult> {
  if (!selfieAction || !selfieAction.scene) {
    return { handled: false, success: false };
  }

  console.log("📸 Selfie action detected - generating companion image");
  console.log("📸 Scene:", selfieAction.scene, "Mood:", selfieAction.mood);

  try {
    // Get Kayley's current presence state
    const kayleyState = await getKayleyPresenceState();

    // DEBUG: Log presence state usage
    console.log("📸 [Selfie Generation] Presence State:", {
      hasState: !!kayleyState,
      outfit: kayleyState?.currentOutfit,
      mood: kayleyState?.currentMood,
      activity: kayleyState?.currentActivity,
      location: kayleyState?.currentLocation,
      expiresAt: kayleyState?.expiresAt,
    });

    // Prepare conversation history
    const conversationHistory = context.chatHistory.slice(-10).map((msg) => ({
      role: msg.role === "user" ? "user" : ("assistant" as const),
      content: msg.text,
    }));

    // Generate the selfie image
    const selfieResult = await generateCompanionSelfie({
      scene: selfieAction.scene,
      mood: selfieAction.mood,
      outfit: selfieAction.outfit,
      userMessage: context.userMessage,
      conversationHistory,
      upcomingEvents: [],
      presenceOutfit: kayleyState?.currentOutfit,
      presenceMood: kayleyState?.currentMood,
    });

    if (selfieResult.success && selfieResult.imageBase64) {
      console.log("✅ Selfie generated successfully!");
      return {
        handled: true,
        success: true,
        imageBase64: selfieResult.imageBase64,
        mimeType: selfieResult.mimeType,
      };
    } else {
      console.error("❌ Selfie generation failed:", selfieResult.error);
      return {
        handled: true,
        success: false,
        error: selfieResult.error || "Couldn't generate the image",
      };
    }
  } catch (error) {
    console.error("Failed to generate selfie:", error);
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

