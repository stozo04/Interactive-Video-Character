# Bug: Missing Outfit Context in Image Generation

## Description
The image generation service (`imageGenerationService.ts`) correctly generates a detailed `outfitContext` using an LLM, but fails to include this context when building the final prompt for Gemini Imagen. This results in the AI companion wearing generic clothing instead of the outfit specified in the conversation or presence state.

## Root Cause
The `buildImagePrompt` function in `imageGenerationService.ts` does not accept or include the `outfitContext` fields in the final string it constructs.

### Relevant Code
In `src/services/imageGenerationService.ts`:
```typescript
function buildImagePrompt(
  scene: string,
  moodDescription: string,
  lightingDescription: string,
  additionalDetails: string = ""
): string {
  return [
    `She is looking into the lens ${moodDescription}.`,
    `She is situated in ${scene}.`,
    `The lighting is ${lightingDescription}.`,
    additionalDetails ? `Note: ${additionalDetails}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
```

The `generateCompanionSelfie` function calls it like this:
```typescript
    let fullPrompt = buildImagePrompt(
      generatedPrompt.sceneDescription,
      generatedPrompt.moodExpression,
      generatedPrompt.lightingDescription,
      generatedPrompt.additionalDetails
    );
```

As seen, the `outfitContext` (which contains `description` and `style`) is completely omitted.

## Steps to Reproduce
1. Trigger a selfie generation with a specific outfit request (e.g., "Mirror selfie wearing cute grey boy shorts and a simple white crop top").
2. Observe the logs for `📸 [ImageGen] LLM Generated Prompt`. It will contain the correct outfit description.
3. Observe the logs for `📸 [ImageGen] Full prompt text`. It will NOT contain the outfit description.
4. The resulting image will have an incorrect or generic outfit.

## Resolution Plan
1. Update `buildImagePrompt` to accept `outfitDescription` and `outfitStyle`.
2. Modify the prompt template to include: `She is wearing ${outfitDescription}.`
3. Update the call site in `generateCompanionSelfie` to pass these values from `generatedPrompt.outfitContext`.
