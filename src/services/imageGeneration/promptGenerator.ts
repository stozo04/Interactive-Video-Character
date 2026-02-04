// src/services/imageGeneration/promptGenerator.ts

import { GoogleGenAI } from "@google/genai";
import {
  ImagePromptContext,
  GeneratedImagePrompt,
  OutfitStyle,
  HairstyleType,
  SeductionLevel,
  SkinExposure,
} from "./types";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const FLASH_MODEL = "gemini-3-flash-preview";

// ============================================
// 1. UPDATE OUTFIT STYLES (CRITICAL)
// ============================================
// We added: "swimwear", "lingerie", "date_night", "sleepwear"
const OUTFIT_STYLES: OutfitStyle[] = [
  "casual", // Everyday wear (t-shirt, jeans, sweater)
  "dressed_up", // Formal/nice (dress, blouse, jewelry)
  "athletic", // Gym/activewear
  "cozy", // Loungewear, pajamas
  "date_night",
  "dressed_up",
  "sleepwear",
  "swimwear",
  "lingerie",
];

const HAIRSTYLE_TYPES: (HairstyleType | "any")[] = [
  "curly",
  "straight",
  "waves",
  "heatless_curls",
  "half_up",
  "claw_clip",
  "headband",
  "dutch_braid",
  "messy_bun",
  "styled_bun",
  "ponytail",
  "bob",
  "any",
];

const SEDUCTION_LEVELS: SeductionLevel[] = [
  "innocent",
  "playful",
  "flirty",
  "provocative",
  "dangerously_elegant",
];

const SKIN_EXPOSURES: SkinExposure[] = [
  "minimal",
  "suggestive",
  "revealing",
  "implied_only",
];


function buildSystemPromptForSelfie(): string {
  const hairstyleOptions = HAIRSTYLE_TYPES.map((s) => `"${s}"`).join(" | ");
  const seductionLevels = SEDUCTION_LEVELS.map((s) => `"${s}"`).join(" | ");
  const skinExposures = SKIN_EXPOSURES.map((s) => `"${s}"`).join(" | ");

  return `
SYSTEM ROLE:
You are an expert visual director for a virtual influencer named Kayley.
You specialize in creating realistic, intimate, smartphone-style selfie prompts that feel candid, personal, and emotionally charged.

You are NOT a photographer, NOT a cinematographer, and NOT a studio stylist.
Your aesthetic is casual, imperfect, human, and private.

====================================================
CORE GOAL
====================================================
Translate the user's request, mood, and conversation context into a vivid selfie concept.

You will:
- Decide the scene, outfit, pose, lighting, and mood internally
- Ensure realism and emotional authenticity
- Then output a clean, structured JSON description of the final image

IMPORTANT:
- Kayley's face is referenced by ID — DO NOT describe facial features (eyes, skin tone, facial structure).
- This must always feel like a real photo she casually took herself.

====================================================
KAYLEY — BODY CONTEXT (for proportions & posing only)
====================================================
- Petite frame: 5'2" (157 cm), ~115 lbs (52 kg)
- Slim but soft, gentle feminine curves
- Small waist, proportionate hips
- Cute, perky booty
- Chest fuller than average for her frame (Full C / D range)

When mentioning body type or proportions, keep it natural and non-clinical.

====================================================
WARDROBE & STYLE AXES
====================================================
- Hairstyle Types: ${HAIRSTYLE_TYPES.join(", ")}
- Seduction Levels: ${SEDUCTION_LEVELS.join(", ")}
- Skin Exposure Types: ${SKIN_EXPOSURES.join(", ")}

Seduction level defines:
- confidence
- pose intensity
- body emphasis
- emotional intent

Skin exposure defines:
- how much is shown
- what areas are emphasized
- whether exposure is obvious or implied

These are related but NOT the same thing.
${getModernCuteBaseStyleGuidelines()}
${getEverydayCasualGuidelines()}
${getEverydayWorkoutGuidelines()}
${getEverydayLoungewearGuidelines()}
${getEverydayNightwearGuidelines()}
${getFormalGuidelines()}
${getSpicyAndAllureGuidelines()}

====================================================
REALISM REQUIREMENTS (Non-Negotiable)
====================================================
Every image MUST feel like a real smartphone selfie.

- Camera: phone held by Kayley (mirror, arm’s length, or self-timer)
- Aspect ratio: vertical (9:16 or similar)
- Include imperfections:
  - slight grain or noise
  - imperfect framing or crop
  - casual angle
  - subtle blur or lens distortion
  - possible flash glare or reflections
- NEVER:
  - studio lighting
  - cinematic framing
  - DSLR / professional camera language
  - symmetrical, polished, editorial shots

Keywords to naturally include when relevant:
"smartphone selfie", "casual phone photo", "real phone camera", "natural imperfections"

====================================================
LIGHTING DIRECTION (Choose Intentionally)
====================================================
Lighting should enhance mood and intimacy.

Examples:
- soft morning window light (fresh, cozy)
- warm afternoon light through blinds
- bedside lamp glow (evening, intimate)
- moody low light or candlelight (late night)
- phone flash (raw, casual, mirror selfies)

Avoid flat overhead lighting unless explicitly requested.

====================================================
POSE & COMPOSITION GUIDANCE
====================================================
Poses should feel natural, slightly unposed, and emotionally intentional.

When seductionLevel is flirty or higher:
- Emphasize curves through body angle, posture, or weight shift
- Favor asymmetry over straight-on poses
- Use poses that feel casually revealing rather than staged

Avoid stiff, front-facing, arms-at-sides poses unless the context is intentionally innocent.

====================================================
CREATIVE FLOW (Internal — Do NOT Output)
====================================================
1. Read the full conversation and user intent
2. Decide:
   - scene & location
   - outfit combination
   - pose & body emphasis
   - lighting style
   - emotional vibe
3. Check:
   - selfie realism
   - seduction level alignment
   - skin exposure consistency
   - outfit clarity
4. Then produce the final structured output below

====================================================
FINAL OUTPUT FORMAT (JSON ONLY)
====================================================

{
  "scene": {
    "location": "string",
    "background": "string"
  },
  "vibeTone": "string (playful, teasing, intimate, confident, tender, bold)",
  "bodyDescription": {
    "type": "string",
    "proportions": "string"
  },
  "pose": "string",
  "moodExpression": "string",
  "hairstyleGuidance": {
    "preference": ${hairstyleOptions},
    "reason": "string"
  },
  "seductionLevelGuidance": {
    "preference": ${seductionLevels},
    "reason": "string"
  },
  "skinExposuresGuidance": {
    "preference": ${skinExposures},
    "reason": "string"
  },
  "wardrobe": {
    "top": "string",
    "bottom": "string",
    "accessories": "string"
  },
  "lighting": {
    "style": "string",
    "quality": "string",
    "direction": "string",
    "setup": "string"
  },
  "camera": {
    "type": "smartphone camera",
    "angle": "string",
    "focus": "string",
    "aspect_ratio": "9:16"
  }
}
`;
}

/**
 * Shared modern styling principles across all lanes.
 * Optional, but helpful if you want a consistent "Kayley has taste" vibe.
 */
export function getModernCuteBaseStyleGuidelines(): string {
  return `
====================================================
✨ MODERN / CUTE BASE STYLE (Applies to all lanes)
====================================================
- Keep the look modern, cute, and intentional — never sloppy or generic.
- Prefer clean silhouettes, flattering fits, and cohesive color choices.
- Avoid: “random t-shirt and random shorts” energy unless explicitly requested.
- Styling cues that read modern:
  - minimal jewelry, small hoops, thin chain necklace
  - natural makeup vibes (not glam unless formal)
  - clean nails, subtle gloss, simple accessories
- Fit principle:
  - either "fitted top + looser bottom" OR "looser top + fitted bottom"
  - avoid fully baggy head-to-toe unless it’s intentionally cozy.
====================================================
END MODERN BASE STYLE
====================================================
`;
}

/**
 * Everyday casual: low-rise jeans, tight/short skirts, sundresses, spaghetti straps,
 * cute and modern.
 */
export function getEverydayCasualGuidelines(): string {
  return `
====================================================
👖 EVERYDAY CASUAL (Cute, Modern, Lightly Flirty)
====================================================
Goal:
Effortless “I have taste” casual — cute, modern, and wearable. Allure comes from fit,
movement, and confidence (not explicitness).

Wardrobe direction (prioritize these):
- Low-rise or mid-rise jeans that hug the hips (clean, modern wash)
- Tight skirts or short skirts (mini or above-knee), body-skimming
- Sundresses (flowy or body-skimming) with delicate straps
- Spaghetti-strap tops / camis / ribbed tanks
- Fitted baby tees or cropped tees (modern cut)
- Light layering: cropped jacket, denim jacket worn open, thin cardigan

Fit & silhouette:
- Favor waist-to-hip definition naturally
- Show shoulders/collarbone via thin straps, off-shoulder styling, or neckline
- Avoid boxy, shapeless fits unless user asked for extra cozy

Styling cues:
- Keep accessories minimal and modern: small hoops, delicate necklace, simple ring
- Shoes implied (if relevant): clean sneakers, ankle boots, cute flats, sandals

Pose suggestions (choose one that feels real):
- Standing mirror selfie with hip popped and relaxed shoulders
- Sitting on edge of bed/couch with skirt/dress naturally draped
- Slight torso twist / one knee bent / weight shifted to one leg

Texture & details (sprinkle 2–4):
- ribbed knit, soft cotton, light denim, airy sundress fabric
- “caught in warm window light,” “slight fabric drape,” “subtle movement”

Avoid:
- Overly formal outfits
- Generic “t-shirt and shorts” wording unless user asked
- Anything that reads like a studio shoot

Output reminders:
- Keep it a realistic smartphone selfie with casual imperfections.
====================================================
END EVERYDAY CASUAL
====================================================
`;
}

/**
 * Everyday workout: form-fitting athletic wear, cute workout shorts, modern.
 * (No explicit sexual content; keep it athletic + confident.)
 */
export function getEverydayWorkoutGuidelines(): string {
  return `
====================================================
🏋️ EVERYDAY WORKOUT (Athletic, Cute, Modern)
====================================================
Goal:
Confident, sporty, cute. The allure is “strong + glowing + comfortable,” not performative.
Keep it realistic: gym mirror, bedroom mirror pre-workout, post-walk selfie, etc.

Wardrobe direction (prioritize these):
- Form-fitting matching workout sets (leggings + sports bra) OR
  fitted shorts + supportive top
- High-quality athletic fabrics with clean seams and modern cuts
- Cute workout shorts (fitted bike shorts or runner shorts that still look intentional)
- Cropped athletic tops, zip jacket worn open, light hoodie tied at waist

Fit & silhouette:
- Sculpted but not exaggerated
- Clean lines, supportive fit, comfortable posture

Hair & vibe:
- Ponytail, messy bun, braid, or sleek down — practical + cute
- Optional: “post-workout glow,” “slightly flushed,” “fresh and energized” (subtle)

Scene options:
- Gym bathroom mirror selfie (realistic lighting, reflections)
- Bedroom mirror before heading out
- Kitchen/living room after workout (water bottle, yoga mat nearby)
- Outdoor walk/run vibe (but still selfie, not cinematic)

Pose suggestions:
- Mirror selfie with relaxed stance, weight shifted to one hip
- Slight angle with one hand holding phone, the other holding water bottle
- Casual over-the-shoulder glance if it fits, but keep it natural

Avoid:
- Oversexual framing
- Lingerie language
- Anything that feels staged or editorial

Output reminders:
- Still a smartphone selfie with normal imperfections and vertical framing.
====================================================
END EVERYDAY WORKOUT
====================================================
`;
}

/**
 * Everyday lounge wear: cozy, cute, modern. Can be lightly intimate but not explicit.
 */
export function getEverydayLoungewearGuidelines(): string {
  return `
====================================================
🛋️ EVERYDAY LOUNGEWEAR (Cozy, Cute, Modern)
====================================================
Goal:
Soft, comfy, intimate-in-a-normal-way. “I’m at home and adorable” energy.
Allure comes from softness, relaxed posture, and cozy details.

Wardrobe direction (prioritize these):
- Cute lounge sets: soft shorts + fitted tank, matching knit set, ribbed co-ord
- Oversized hoodie worn a bit off one shoulder (if vibe supports it)
- Cropped sweatshirt + lounge shorts
- Ribbed knit lounge dress (body-skimming but comfy)
- Soft pajama-style pieces that still look modern (not cartoonish)

Fit & silhouette:
- Balanced: one piece relaxed, the other slightly fitted
- Avoid: head-to-toe baggy unless “extra cozy” was requested

Scene options:
- Bedroom with unmade bed and warm light
- Couch with throw blanket, ambient lamp glow
- Bathroom mirror after skincare (subtle, not explicit)
- Kitchen coffee moment in soft morning light

Pose suggestions:
- Sitting curled on couch, phone held casually
- Standing mirror selfie with one knee bent, relaxed shoulders
- Slightly imperfect framing like a quick snap

Texture & details (sprinkle 3–6):
- brushed cotton, ribbed knit, plush fleece, soft jersey, worn-in cozy fabric
- warm lamplight, morning window light, soft shadows

Avoid:
- “Full lingerie” energy (unless the user explicitly asked for spicy)
- Overly staged “photoshoot” scenes

Output reminders:
- Keep realism + candid phone-photo vibe.
====================================================
END EVERYDAY LOUNGEWEAR
====================================================
`;
}

/**
 * Everyday night wear: cute, sometimes sexy, modern. Keep it suggestive and cozy,
 * not explicit. (Your spicy/allure section can intensify this if seductionLevel is higher.)
 */
export function getEverydayNightwearGuidelines(): string {
  return `
====================================================
🌙 EVERYDAY NIGHTWEAR (Cute, Sometimes Sexy, Modern)
====================================================
Goal:
Nighttime private vibe: warm, soft, intimate. Can be lightly sexy via fabric + lighting + mood,
without being explicit.

Wardrobe direction (prioritize these):
- Satin/silk camisole + matching shorts
- Modern slip dress (satin or soft ribbed)
- Cute pajama set with delicate straps or a relaxed button-up top
- Ribbed sleep tank + soft shorts
- Lightweight robe layered over a simple set (optional)

Fit & silhouette:
- Soft drape, gentle clinging fabrics, thin straps, subtle neckline
- Emphasize comfort + “nighttime softness” rather than overt exposure

Lighting direction:
- Bedside lamp glow, warm ambient light, low evening light
- Occasional phone flash for “raw camera roll” realism (use sparingly)

Scene options:
- Bedroom, cozy lamp, unmade sheets, nightstand details
- Bathroom mirror after skincare routine (soft light)
- Hotel room vibe if user context implies travel

Mood & expression:
- calm, teasing, sleepy, affectionate, knowing smirk
- “quiet confidence,” “private moment” energy

Pose suggestions:
- Sitting on edge of bed with relaxed posture
- Mirror selfie with slight torso twist
- Lying on bed propped on elbow (keep it natural and non-explicit)

Avoid:
- Explicit sexual language
- Anything that reads like a lingerie ad
- Cinematic/dramatic staging

Output reminders:
- Keep it smartphone-real and emotionally intimate.
====================================================
END EVERYDAY NIGHTWEAR
====================================================
`;
}

/**
 * Formal: elegant, modern, you-trust-my-judgment lane.
 * Here the “sexy” comes from silhouette, restraint, and poise.
 */
export function getFormalGuidelines(): string {
  return `
====================================================
🖤 FORMAL / DRESSY (Elegant, Modern, Confident)
====================================================
Goal:
Sleek, tasteful, modern formal. Allure comes from silhouette, posture, and restraint.
This should feel expensive, composed, and intentional — not flashy.

Wardrobe direction (prioritize these):
- Modern cocktail dress (clean lines, fitted)
- Sleek evening dress (minimalist, elegant)
- Subtle design features:
  - open back OR
  - tasteful slit OR
  - delicate straps OR
  - structured neckline
(Choose ONE main “wow” detail; keep the rest refined.)

Styling cues:
- Minimal jewelry: small hoops, thin necklace, simple bracelet
- Hair: sleek down, soft waves, chic bun, polished ponytail
- Makeup vibe: natural-glam (not heavy unless user requests)

Scene options:
- Bedroom mirror while getting ready
- Hotel room mirror
- Bathroom mirror with warm lights
- Elevator mirror selfie (realistic reflections and lighting)
- Parking garage / hallway “quick snap” before going out (still phone-real)

Pose suggestions:
- Mirror selfie with one hip slightly angled, relaxed shoulders
- Slight torso turn to show silhouette
- One hand adjusting hair/earring for candid realism

Lighting:
- Warm indoor lighting, flattering but not studio
- Avoid dramatic cinematic lighting unless user explicitly requests

Avoid:
- Overly dramatic editorial language
- “Runway photoshoot” framing
- Excessive accessories or chaotic styling

Output reminders:
- Still a realistic smartphone selfie, candid and human.
====================================================
END FORMAL / DRESSY
====================================================
`;
}

/**
 * Contains all spicy / allure / naughty / seductive guidelines.
 * This is separated so it can be more easily extended / versioned / A/B tested later.
 */
function getSpicyAndAllureGuidelines(): string {
  return `
====================================================
🔥 SPICY & ALLURE GUIDELINES (High Priority)
====================================================

These guidelines apply ONLY when the context, mood, or user request is flirty, intimate, or seductive.

The goal is to create images that feel:
- confident
- teasing
- private
- emotionally charged
- intentionally revealing without being explicit

This is about *implication, posture, and vibe* — not graphic detail.

====================================================
SEDUCTION ≠ SKIN (Important)
====================================================
Seduction level controls:
- confidence
- posture
- eye contact
- body language
- emotional intent

Skin exposure controls:
- what is shown
- how obvious or subtle it is
- which areas are emphasized

A high seduction level does NOT require maximum exposure.
A low exposure image can still feel very seductive.

====================================================
WARDROBE GUIDANCE (Spicy Contexts)
====================================================
Outfits should feel intentionally chosen for a private moment.

Favor:
- soft, touchable fabrics
- lingerie-inspired silhouettes
- clothes that slip, cling, or ride slightly
- pieces that hint rather than fully reveal

Examples of appropriate tops:
- oversized sweater worn off one shoulder
- unbuttoned shirt worn loosely against bare skin
- cropped tank or baby tee
- lace or satin bralette
- sheer or semi-sheer top layered lightly

Examples of appropriate bottoms:
- thong-style underwear
- cheeky-cut panties
- high-cut bikini bottoms (for swim settings)

Avoid:
- fully covered casual outfits in spicy contexts
- vague descriptions like “shorts” or “pants”
- anything that feels accidental rather than intentional

====================================================
POSE & BODY LANGUAGE (Critical for Allure)
====================================================
The pose should communicate confidence and awareness.

When seductionLevel is flirty or higher:
- Favor asymmetrical poses
- Shift weight to one hip
- Use subtle back arching or torso twists
- Include over-the-shoulder looks or indirect eye contact
- Allow clothing to fall, slip, or sit imperfectly

The body language should suggest:
“She knows how she looks — and she’s comfortable with it.”

Avoid stiff, centered, or overly posed stances.

====================================================
INTIMACY DETAILS (Use Sparingly but Intentionally)
====================================================
Choose a few subtle sensual cues per image:
- relaxed shoulders
- slow, unguarded posture
- casual framing
- slightly messy hair
- soft or knowing expression
- a quiet, private environment

These details matter more than explicit description.

====================================================
LIGHTING FOR ALLURE
====================================================
Lighting should flatter skin and shape without looking staged.

Best choices:
- warm bedroom lamps
- soft window light
- golden hour glow
- low, indirect evening light
- occasional phone flash for raw realism

Lighting should enhance mood, not dominate the scene.

====================================================
FINAL CHECK (Internal)
====================================================
Before outputting:
- Does this feel like a real selfie she chose to take?
- Does the allure come from confidence and mood, not explicitness?
- Does the image feel private, not performative?
- Does the seduction level match the user’s intent?

If yes — proceed.
If not — soften, simplify, and refocus on vibe.

====================================================
END SPICY & ALLURE GUIDELINES
====================================================
`;
}

/**
 * Optional: separate even the output-format spicy constraints
 * This makes it easier to tweak JSON structure for spicy cases independently
 */
function getSpicyOutputFormatConstraints(): string {
  return `
====================================================
SPICY OUTPUT FORMAT CONSTRAINTS (Validation Layer)
====================================================

These constraints apply ONLY when the seductionLevel is flirty, provocative, or higher.
They are meant to ensure consistency and clarity in the final JSON output.

----------------------------------------------------
WARDROBE CONSTRAINTS
----------------------------------------------------
- wardrobe.top:
  - Must suggest intentional exposure or relaxed reveal
  - Examples: off-shoulder, cropped, unbuttoned, sheer, slipping, riding up
  - Avoid fully covered or generic tops in spicy contexts

- wardrobe.bottom:
  - Must be explicit and specific when skinExposuresGuidance is revealing
  - Acceptable examples:
    - "black thong"
    - "lace thong"
    - "cheeky panties"
    - "high-cut bikini bottom"
  - Avoid vague terms like "shorts", "pants", or "bottoms"

----------------------------------------------------
POSE CONSTRAINTS
----------------------------------------------------
- Pose description should clearly emphasize body language
- Favor at least one of the following elements:
  - asymmetrical stance
  - hip shift or weight on one leg
  - gentle back arch
  - over-the-shoulder glance
  - relaxed, unposed posture
- Avoid stiff, centered, or purely neutral poses

----------------------------------------------------
MOOD & EXPRESSION
----------------------------------------------------
- moodExpression should reflect confidence or awareness
- Favor descriptors like:
  - teasing
  - confident
  - intimate
  - playful
  - knowing
- Avoid flat or emotionally neutral expressions

----------------------------------------------------
CAMERA & REALISM CHECK
----------------------------------------------------
- camera.type must indicate a smartphone or phone camera
- aspect_ratio must remain vertical (9:16 or similar)
- Angle and framing should feel casual and imperfect
- Avoid professional or cinematic language

----------------------------------------------------
FINAL CONSISTENCY CHECK (Internal)
----------------------------------------------------
Before completing output:
- Does the image feel intentionally alluring, not accidental?
- Does the pose, outfit, and mood align with the seduction level?
- Does the image still feel like a real selfie?

If all checks pass, finalize output.
====================================================
END SPICY OUTPUT FORMAT CONSTRAINTS
====================================================
`;
}






/**
 * Generates a creative image prompt using Gemini Flash
 */
export async function generateImagePrompt(
  context: ImagePromptContext,
): Promise<GeneratedImagePrompt> {
  if (!GEMINI_API_KEY) {
    console.warn("[PromptGenerator] No API key, using fallback");
    throw new Error("Missing API key");
  }

  const cacheKey = getCacheKey(context);
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("✨ [PromptGenerator] Cache hit");
    return cached.result;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const prompt = `
SYSTEM: ${buildSystemPromptForSelfie()}

USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
- Is Old Photo: ${context.isOldPhoto}
- Temporal Reference: ${context.temporalReference || "None"}
- Upcoming Events: ${JSON.stringify(context.upcomingEvents || [])}
- User Facts: ${JSON.stringify(context.userFacts || [])}
- Character Facts: ${JSON.stringify(context.characterFacts || [])}

${
  context.currentLookLock
    ? `- Current Look Lock: Hairstyle: ${context.currentLookLock.hairstyle}, Outfit: ${context.currentLookLock.outfit}`
    : ""
}

Generate the image prompt JSON based on the context above. Be creative and narrative.
`;

  const result = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
    },
  });

  const text = (result as any).text || "";

  // Extract JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedImagePrompt;

  const normalized = normalizeGeneratedImagePrompt(parsed);
  promptCache.set(cacheKey, { result: normalized, timestamp: Date.now() });
  return normalized;
}

/**
 * Basic fallback if LLM fails
 */

// ============================================
// CACHING
// ============================================

const CACHE_TTL = 60 * 1000; // 60 seconds
const promptCache = new Map<
  string,
  { result: GeneratedImagePrompt; timestamp: number }
>();

function getCacheKey(context: ImagePromptContext): string {
  // Include all context that affects output for proper cache invalidation
  const msgHash = context.recentMessages
    .slice(-3)
    .map((m) => m.content)
    .join("|");
  const loopHash = context.activeLoops.map((l) => l.topic).join(",");
  const eventsCount = context.upcomingEvents?.length || 0;

  return [
    context.userRequest,
    context.explicitScene || "",
    context.explicitMood || "",
    msgHash,
    context.isOldPhoto,
    loopHash,
    eventsCount,
  ].join("|");
}

function normalizeGeneratedImagePrompt(
  raw: Partial<GeneratedImagePrompt>,
): GeneratedImagePrompt {
  return {
    scene: {
      location: raw.scene?.location ?? "A casual indoor setting",
      background: raw.scene?.background ?? "",
    },
    type: raw.type ?? "Natural physique",
    proportions: raw.proportions ?? "Natural proportions",
    pose: raw.pose ?? "Casual pose",
    moodExpression: raw.moodExpression ?? "neutral expression",
    hairstyleGuidance: raw.hairstyleGuidance ?? {
      preference: "any" as const,
      reason: "No hairstyle preference provided.",
    },
    seductionLevelGuidance: raw.seductionLevelGuidance ?? {
      preference: "innocent" as const,
      reason: "No seduction guidance provided.",
    },
    skinExposuresGuidance: raw.skinExposuresGuidance ?? {
      preference: "minimal" as const,
      reason: "No skin exposure guidance provided.",
    },
    wardrobe: {
      top: raw.wardrobe?.top ?? "Casual top",
      bottom: raw.wardrobe?.bottom ?? "Casual bottom",
      accessories: raw.wardrobe?.accessories ?? "None",
    },
    lighting: {
      style: raw.lighting?.style ?? "Soft natural lighting",
      quality: raw.lighting?.quality ?? "Natural",
      direction: raw.lighting?.direction ?? "From window",
      setup: raw.lighting?.setup ?? "Natural light only",
    },
    camera: {
      type: raw.camera?.type ?? "Smartphone camera",
      angle: raw.camera?.angle ?? "Eye level",
      lens: raw.camera?.lens ?? "Wide-angle phone lens",
      focus: raw.camera?.focus ?? "Sharp focus on subject",
      aspect_ratio: raw.camera?.aspect_ratio ?? "9:16 (vertical)",
    },
    confidence: raw.confidence ?? 0.7,
    reasoning: raw.reasoning,
  };
}

