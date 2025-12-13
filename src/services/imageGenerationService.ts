// src/services/imageGenerationService.ts
/**
 * AI Image Generation Service for Companion "Selfies"
 * 
 * Uses Gemini Imagen to generate contextual images of the AI companion
 * with character consistency via detailed prompts.
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const IMAGEN_MODEL = 'imagen-4.0-fast-generate-001';

// ============================================
// CHARACTER VISUAL IDENTITY
// ============================================
// This is the core visual description used for ALL image generation
// to maintain character consistency across selfies.

const CHARACTER_VISUAL_IDENTITY = {
  // Condensed prompt snippet for image generation
  basePrompt: `A photorealistic 23-year-old woman with light beige skin and warm undertones, long voluminous dark chocolate brown hair styled in loose beach waves with a center part, large striking almond-shaped sage green eyes, natural dark brows, heart-shaped face with a refined nose and full rose-pink lips, slender fit build, friendly and approachable expression`,
  
  // Detailed features for reference
  face: {
    shape: 'soft heart-shape with high cheekbones and gently tapered narrow chin',
    skinTone: 'light-to-medium with warm neutral undertones, soft beige or light bisque',
    eyes: 'large almond-shaped, striking clear bright blue or light green eyes, wide-set and bright',
    eyebrows: 'natural medium-thickness with soft arch, dark cool brown',
    nose: 'slender bridge with refined slightly soft button tip, proportional and straight',
    lips: 'full and plump, naturally pigmented soft rose-pink, soft cupids bow',
  },
  hair: {
    color: 'deep espresso or dark chocolate brown, uniform without heavy highlights',
    length: 'long, cascading well past shoulders to mid-back',
    texture: 'loose voluminous curls and beach waves (Type 2B/2C), slightly tousled',
    style: 'worn loose and down, framing the face',
    part: 'slightly messy indefinite center part',
  },
  body: {
    ageAppearance: 'early 20s (approx 20-24 years old)',
    build: 'slender but fit/toned, petite to average height',
    distinctiveFeatures: 'prominent collarbones',
  },
  aesthetic: {
    vibe: 'girl next door meets social media influencer, warm approachable wholesome photogenic naturally beautiful',
    style: 'casual chic, comfortable yet put-together',
  }
};

// ============================================
// SCENE-BASED OUTFIT SELECTION
// ============================================
// Outfits are chosen based on the scene context to feel natural

interface OutfitOption {
  description: string;
  contexts: string[]; // Scene keywords that match this outfit
}

const OUTFIT_OPTIONS: OutfitOption[] = [
  {
    description: 'wearing a soft cream knit sweater and gold layered necklaces',
    contexts: ['cozy', 'home', 'relaxed', 'chill', 'morning', 'casual', 'default'],
  },
  {
    description: 'wearing a fitted blazer over a simple white crop top with delicate gold jewelry',
    contexts: ['professional', 'meeting', 'work', 'conference', 'business', 'serious'],
  },
  {
    description: 'wearing a flowy sundress with subtle floral print and dainty earrings',
    contexts: ['brunch', 'restaurant', 'date', 'lunch', 'garden', 'spring', 'summer'],
  },
  {
    description: 'wearing an oversized vintage band tee and high-waisted jeans with white sneakers',
    contexts: ['concert', 'casual', 'street', 'shopping', 'walking', 'errands'],
  },
  {
    description: 'wearing a cozy oversized hoodie with messy bun and minimal makeup',
    contexts: ['lazy', 'sleepy', 'tired', 'night', 'bed', 'pajamas', 'morning'],
  },
  {
    description: 'wearing a chic little black dress with statement earrings',
    contexts: ['dinner', 'fancy', 'elegant', 'party', 'evening', 'dressed up', 'night out'],
  },
  {
    description: 'wearing athletic leggings and a cropped workout top with hair in a high ponytail',
    contexts: ['gym', 'workout', 'fitness', 'yoga', 'pilates', 'exercise', 'running'],
  },
  {
    description: 'wearing a cute bikini top with a flowy beach coverup and sunglasses pushed up on head',
    contexts: ['beach', 'pool', 'swimming', 'vacation', 'tropical', 'summer', 'sun'],
  },
  {
    description: 'wearing a turtleneck sweater with gold hoop earrings and a warm scarf',
    contexts: ['fall', 'autumn', 'cold', 'winter', 'cozy', 'sweater weather'],
  },
  {
    description: 'wearing a stylish trench coat over a simple top with boots',
    contexts: ['rain', 'city', 'walk', 'travel', 'airport', 'urban'],
  },
  {
    description: 'wearing a cute apron over casual clothes with flour dusted on cheek',
    contexts: ['cooking', 'baking', 'kitchen', 'food'],
  },
  {
    description: 'wearing a comfy cardigan with reading glasses perched on nose',
    contexts: ['reading', 'studying', 'books', 'library', 'learning'],
  },
];

/**
 * Select an appropriate outfit based on the scene context
 */
function selectOutfitForScene(scene: string, outfitHint?: string): string {
  const sceneKeywords = scene.toLowerCase().split(/\s+/);
  
  // If there's an outfit hint, try to match it first
  if (outfitHint) {
    const hintKeywords = outfitHint.toLowerCase().split(/\s+/);
    for (const outfit of OUTFIT_OPTIONS) {
      if (outfit.contexts.some(ctx => hintKeywords.includes(ctx))) {
        return outfit.description;
      }
    }
  }
  
  // Find the best matching outfit based on scene
  let bestMatch: OutfitOption | null = null;
  let bestScore = 0;
  
  for (const outfit of OUTFIT_OPTIONS) {
    const score = outfit.contexts.filter(ctx => 
      sceneKeywords.some(keyword => keyword.includes(ctx) || ctx.includes(keyword))
    ).length;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = outfit;
    }
  }
  
  // If we found a match, use it; otherwise pick a random casual outfit
  if (bestMatch && bestScore > 0) {
    return bestMatch.description;
  }
  
  // Random selection from casual-appropriate outfits for variety
  const casualOutfits = OUTFIT_OPTIONS.filter(o => 
    o.contexts.includes('casual') || o.contexts.includes('default')
  );
  return casualOutfits[Math.floor(Math.random() * casualOutfits.length)]?.description 
    || OUTFIT_OPTIONS[0].description;
}

/**
 * Build a mood/expression description
 */
function buildMoodDescription(mood?: string): string {
  const moodMap: Record<string, string> = {
    'happy': 'with a warm genuine smile showing a hint of teeth',
    'smiling': 'with a bright friendly smile',
    'playful': 'with a playful smirk and slightly raised eyebrow',
    'relaxed': 'with a peaceful relaxed expression',
    'excited': 'with an excited enthusiastic expression, eyes bright',
    'thoughtful': 'with a thoughtful contemplative expression',
    'laughing': 'mid-laugh with genuine joy',
    'cozy': 'with a content relaxed smile',
    'confident': 'with a confident assured expression',
    'cute': 'with an adorable sweet expression',
    'flirty': 'with a subtle flirty smile',
    'serious': 'with a focused determined expression',
  };
  
  if (mood) {
    const normalizedMood = mood.toLowerCase();
    for (const [key, description] of Object.entries(moodMap)) {
      if (normalizedMood.includes(key)) {
        return description;
      }
    }
  }
  
  // Default to friendly/happy
  return 'with a warm friendly smile';
}

// ============================================
// MAIN IMAGE GENERATION FUNCTION
// ============================================

export interface SelfieRequest {
  scene: string;
  mood?: string;
  outfitHint?: string;
}

export interface SelfieResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Generate a "selfie" image of the AI companion in a given scene
 */
export async function generateCompanionSelfie(request: SelfieRequest): Promise<SelfieResult> {
  if (!GEMINI_API_KEY) {
    console.error('❌ [ImageGen] Missing VITE_GEMINI_API_KEY');
    return { success: false, error: 'Image generation not configured' };
  }
  
  try {
    console.log('📸 [ImageGen] Generating selfie for scene:', request.scene);
    
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    // Build the complete prompt
    const outfit = selectOutfitForScene(request.scene, request.outfitHint);
    const moodDescription = buildMoodDescription(request.mood);
    
    // Construct the full image generation prompt
    const fullPrompt = buildImagePrompt(request.scene, outfit, moodDescription);
    
    console.log('📸 [ImageGen] Full prompt:', fullPrompt);
    
    // Call Gemini Imagen
    const result = await ai.models.generateImages({
      model: IMAGEN_MODEL,
      prompt: fullPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '9:16', // Portrait for selfie feel
      }
    });
    
    // Extract the generated image
    const generatedImage = result.generatedImages?.[0];
    
    if (!generatedImage?.image?.imageBytes) {
      console.error('❌ [ImageGen] No image returned from Imagen');
      return { success: false, error: 'No image generated' };
    }
    
    console.log('✅ [ImageGen] Selfie generated successfully!');
    
    return {
      success: true,
      imageBase64: generatedImage.image.imageBytes,
      mimeType: 'image/png',
    };
    
  } catch (error: any) {
    console.error('❌ [ImageGen] Error generating selfie:', error);
    
    // Check for specific error types
    if (error?.message?.includes('SAFETY')) {
      return { success: false, error: 'The image could not be generated due to content guidelines' };
    }
    
    return { 
      success: false, 
      error: error?.message || 'Failed to generate image' 
    };
  }
}

/**
 * Build the complete image generation prompt
 */
function buildImagePrompt(scene: string, outfit: string, moodDescription: string): string {
  // Clean up the scene description
  const cleanScene = scene
    .replace(/^(at |in |on |the )/i, '')
    .trim();
  
  // Build scene context
  const sceneContext = buildSceneContext(cleanScene);
  
  return `${CHARACTER_VISUAL_IDENTITY.basePrompt}, ${moodDescription}, ${outfit}, ${sceneContext}, taking a casual selfie, looking directly at camera, soft natural lighting, high detail, photorealistic, Instagram-style photo, shallow depth of field background blur`;
}

/**
 * Build contextual scene description
 */
function buildSceneContext(scene: string): string {
  // Common scene expansions for better image generation
  const sceneExpansions: Record<string, string> = {
    'restaurant': 'seated at a cozy upscale restaurant table with warm ambient lighting and elegant decor in background',
    'beach': 'on a beautiful sunny beach with ocean waves and golden sand in background',
    'coffee shop': 'in a trendy aesthetic coffee shop with exposed brick and plants in background',
    'cafe': 'in a cozy cafe with warm lighting and pastry display in background',
    'home': 'in a bright modern apartment with plants and cozy decor in background',
    'bedroom': 'in a cozy aesthetic bedroom with fairy lights and neutral decor in background',
    'gym': 'in a modern clean gym with exercise equipment in background',
    'park': 'in a beautiful green park with trees and natural lighting',
    'office': 'in a modern minimalist home office with plants and clean desk setup',
    'kitchen': 'in a bright modern kitchen with marble countertops and copper accents',
    'pool': 'by a sparkling blue pool on a sunny day with lounge chairs in background',
    'concert': 'at a live concert venue with colorful stage lights in background',
    'car': 'inside a car with soft interior lighting and window light',
    'mirror': 'in front of a full length mirror in a stylish room',
    'sunset': 'during golden hour sunset with warm orange and pink sky in background',
    'city': 'on a city rooftop with urban skyline in background',
    'mountains': 'in the mountains with scenic peaks and nature in background',
    'library': 'in a cozy library or bookstore with bookshelves in background',
  };
  
  // Find matching scene expansion
  const lowerScene = scene.toLowerCase();
  for (const [key, expansion] of Object.entries(sceneExpansions)) {
    if (lowerScene.includes(key)) {
      return expansion;
    }
  }
  
  // Default: use the scene as-is with some enhancement
  return `in a ${scene} setting with appropriate ambient lighting and background`;
}

// ============================================
// UTILITY: Convert base64 to data URL for display
// ============================================

export function base64ToDataUrl(base64: string, mimeType: string = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`;
}

