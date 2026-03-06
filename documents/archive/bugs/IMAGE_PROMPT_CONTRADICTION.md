# Image Prompt Contradiction: "No Phone" Rule vs. Showing Screen

**Date:** January 5, 2026
**Reporter:** User
**Severity:** High (Directly contradicts common requested scenes)
**Status:** ✅ Resolved

## Problem

The image generation system had a hardcoded safety/aesthetic constraint: **"CRITICAL: Only two arms total, no phone visible in frame."**

While this was intended to prevent messy AI generation of hands holding phones (often a weak point for Diffusion models), it created a direct contradiction when the AI was asked to show something *on* its phone.

### Example Mismatch:
**Prompt included:** 
- "She is situated in a showing a grainy old photo on my phone of 16-year-old me in a pageant sash."
- **BUT ALSO:** "CRITICAL: Only two arms total, no phone visible in frame."

**Result:** The AI model (Gemini Imagen) was giving conflicting instructions. Usually, the "CRITICAL" keyword at the end of the prompt (the most recent instruction) would win, resulting in an image with NO phone, even though the scene explicitly required one.

## Root Cause Analysis

The `buildImagePrompt` function in `imageGenerationService.ts` was appending a static string to every prompt to ensure a "selfie look" without showing the device. It did not take into account that some scenes (like "looking at a photo on my phone") *require* the device to be visible to make sense.

## Solution

Modified `src/services/imageGenerationService.ts` to detect "phone-centric" scenes and dynamically adjust the constraints.

### 1. Detection Logic
Added a check for keywords that imply the phone or screen should be visible:
```typescript
const involvesShowingPhone = scene.toLowerCase().includes('on my phone') || 
                             scene.toLowerCase().includes('showing a photo') ||
                             scene.toLowerCase().includes('screen');
```

### 2. Dynamic Constraint Selection
Based on the detection, the prompt now uses one of two constraint strings:

**Standard (Default):**
> "She is taking a selfie with one arm extended toward the camera, cropped at the edge of the frame. Her other arm rests naturally at her side or on her hip. CRITICAL: Only two arms total, no phone visible in frame."

**Phone-Centric (Fixed):**
> "She is holding her phone toward the camera to show the screen, with her other hand visible or holding the device. High focus on the screen content. Note: It is okay to see the phone/screen in this specific scene."

## Files Changed

- **`src/services/imageGenerationService.ts`**: Updated `buildImagePrompt` to use dynamic overrides.

## How to Verify

1. Trigger a selfie with a scene like "showing you a photo on my phone".
2. Check the logs for "[ImageGen] Full prompt text:".
3. Verify that the "CRITICAL: no phone visible" text is replaced by the permission to show the phone.

## Lessons Learned

Static "Critical" rules are dangerous in prompt engineering. All constraints should be context-aware. If a scene description (the user intent) contradicts a technical constraint (the developer's aesthetic preference), the user intent should usually win or the constraint should be relaxed.
