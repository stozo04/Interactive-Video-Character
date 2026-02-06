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
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const FLASH_MODEL = import.meta.env.VITE_GEMINI_MODEL;

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


const OUTFIT_GUIDELINE_LANES = [
  "casual",
  "athletic",
  "cozy",
  "sleepwear",
  "dressed_up",
  "date_night",
  "swimwear",
  "lingerie",
  "spicy",
  "naughty"
] as const;

type OutfitGuidelineLane = (typeof OUTFIT_GUIDELINE_LANES)[number];

function isOutfitGuidelineLane(value: string): value is OutfitGuidelineLane {
  return (OUTFIT_GUIDELINE_LANES as readonly string[]).includes(value);
}

function getGuidelinesForLane(lane: OutfitGuidelineLane): string {
  switch (lane) {
    case "casual":
      return getEverydayCasualGuidelines();
    case "athletic":
      return getEverydayWorkoutGuidelines();
    case "cozy":
      return getEverydayLoungewearGuidelines();
    case "sleepwear":
      return getEverydayNightwearGuidelines();
    case "dressed_up":
    case "date_night":
      return getFormalGuidelines();
    case "swimwear":
      return getSwimwearGuidelines();
    case "lingerie":
    case "spicy":
    case "naughty":
      return getSpicyAndAllureGuidelines();
    default:
      return getEverydayCasualGuidelines();
  }
}

function buildSystemPromptForSelfie(guidelineLane: OutfitGuidelineLane): string {
  const hairstyleOptions = HAIRSTYLE_TYPES.map((s) => `"${s}"`).join(" | ");
  const seductionLevels = SEDUCTION_LEVELS.map((s) => `"${s}"`).join(" | ");
  const skinExposures = SKIN_EXPOSURES.map((s) => `"${s}"`).join(" | ");
// TODO: USE guidelineLan!!! Need to pass in Secution level, skin exposure and hair style that way we do not pass in extra stuff that will not be use!
// IF we know this is swim wear then...
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
- Very petite frame: 5'2" (157 cm), ~100 lbs (45 kg)
- Extremely slim and delicate, with soft, subtle feminine curves
- Tiny waist, narrow hips
- Small, perky booty
- Slim, toned thighs
- Chest fuller than average for her frame (Full C / D range, natural-looking and proportionate)

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

Strongly favor these current trending athletic looks (2025–2026 vibe):
- Lululemon-style high-quality matching sets or mix-and-match pieces
- High-compression or buttery-soft leggings (especially Align, Wunder Under, Wunder Train styles)
- Cropped sports bras, longline bras, or very cropped athletic tanks
- Thin-strap or spaghetti-strap athletic tops, built-in bra tanks
- Light, breezy cropped hoodies or zip-ups worn open
- Popular color combos: all black, soft pastels, muted sage / mocha / dusty rose, occasional brights (hot pink, electric cobalt, cherry)

Wardrobe priorities (use these frequently):
1. Buttery-soft high-waisted leggings + cropped tank / longline bra / spaghetti strap sports top
3. Matching set (bra + leggings or bra + shorts) — very trendy right now
4. Mid-crop or short zip-up jacket left open over a tiny sports bra / tank
5. Cute cheeky-fit runner shorts or booty shorts when doing shorter / hotter workout vibes

Fit & silhouette:
- Fitted and flattering — shows shape without looking cartoonish or over-the-top
- Emphasis on smooth, sculpted legs and defined waist
- Tops that are cropped or short enough to show a little midriff when arms are raised

Hair & details:
- High ponytail, sleek low pony, messy bun with face-framing pieces, braid
- Natural “post-yoga glow” — dewy skin, subtle flush, healthy-looking
- Minimal jewelry: small stud earrings or tiny hoops, maybe a thin chain
- Nails: clean + fun (soft neutrals, light pink, occasional bright accent)

Scene & context ideas:
- Yoga studio mirror selfie (soft studio lighting, wood floor, plants)
- Home gym / living room mirror (yoga mat rolled out, water bottle nearby)
- Pre- or post-hot yoga bedroom mirror selfie
- Outdoor park / trail selfie after a run or walk (casual but still cute)
- Car selfie after class (sweaty-glowy but still adorable)

Pose & energy:
- Relaxed mirror selfie — phone at chest height or slightly above
- Weight shifted to one hip, soft arch, natural posture
- One hand on hip or holding water bottle/phone
- Slight smile or confident relaxed expression — “I feel good” energy
- Avoid aggressive flexing or overly sexual posing

Avoid:
- Lingerie language (lace, sheer panels, strappy bondage vibes)
- Ultra-low-rise athletic bottoms
- Baggy oversized gym clothes unless intentionally cozy-recovery
- Heavy makeup or full glam
- Poses that feel staged or thirst-trap focused

Vibe check:
- Should feel like “trendy, cute, athletic girl who actually works out and looks hot doing it”
- Modern, fashionable, current — not generic gym rat or 2018 athleisure

Still 100% smartphone selfie rules apply:
- Vertical framing (9:16)
- Natural imperfections: slight grain, casual angle, possible flash or mirror reflection
- Real phone camera language

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
Allure comes from softness, relaxed posture, and cozy but flirty, modern, and a little teasing.

Strongly favor these trending cozy-cute loungewear pieces (2025–2026 vibe):
- Tiny ribbed tank tops or cropped spaghetti strap tanks
- Soft lounge shorts (cheeky cut, 2–4" inseam, high-waisted or mid-rise)
- Matching short sets: tiny tank + cheeky lounge shorts
- Oversized boyfriend hoodie worn as a mini-dress or off one shoulder
- Ribbed knit mini dresses or body-skimming lounge dresses
- Cropped sweatshirts / cropped zip hoodies + tiny shorts
- Buttery-soft bike shorts or cheeky lounge shorts paired with bralette-style tops
- Thin-strap camis or lace-trimmed sleep tanks (cozy but with a hint of skin)

Wardrobe priorities (use these frequently):
1. Cheeky lounge shorts + cropped spaghetti strap tank or ribbed bralette
2. Oversized hoodie (slightly cropped or worn off-shoulder) + tiny shorts underneath
3. Matching short lounge set (tiny top + cheeky high-waisted shorts)
4. Ribbed mini lounge dress or bodycon knit dress that skims the body
5. Soft sleep shorts + thin-strap cami or bralette top

Fit & silhouette:
- Balanced mix: one piece relaxed/oversized + one piece fitted or short
- Frequent subtle skin show: midriff, shoulders, legs, or a little cleavage when arms are raised
- Emphasis on soft, sculpted legs and cute waist/hip line
- Avoid: completely oversized head-to-toe (unless "extra lazy day" vibe)

Hair & details:
- Messy bun, claw clip half-up, loose waves, or natural down
- Natural "no-makeup makeup": dewy skin, soft blush, lip gloss
- Minimal jewelry: small hoops, thin chain, maybe a charm anklet
- Nails: clean + cute (soft pink, nude, occasional fun accent)

Scene & context ideas:
- Bedroom mirror selfie with messy bed and warm lamp glow
- Curled up on couch with throw blanket and phone flash
- Kitchen counter coffee moment in soft morning window light
- Bathroom mirror after shower/skincare (steamy mirror, towel nearby)
- Living room floor with yoga mat and plants in background

Pose & energy:
- Relaxed mirror selfie — phone at chest height or arm's length
- Weight shifted to one hip, soft arch, one knee bent
- Sitting cross-legged or lounging with legs slightly apart (casual)
- Slight smile or soft "just chilling" expression — "I look cute and I know it"
- Avoid aggressive posing or overly sexual framing

Texture & fabric priorities:
- Buttery-soft jersey, ribbed cotton, plush French terry, brushed fleece
- Slightly worn-in, lived-in cozy feel (not stiff or brand-new looking)

Color palette that feels right:
- Soft neutrals (cream, mocha, sage, dusty rose), all-black cozy sets
- Pastels (baby pink, lavender, butter yellow), occasional cherry red or hot pink

Avoid:
- Cartoon pajamas, oversized cartoon prints, full coverage granny vibes
- Heavy winter layers unless specifically requested
- Anything that feels like full lingerie (save that for spicy contexts)
- Staged professional lighting or editorial poses

Vibe check:
- Should feel like “cozy at home but still hot enough to take a selfie”
- Modern, cute, current — playful and quietly confident

Still 100% smartphone selfie rules apply:
- Vertical framing (9:16)
- Natural imperfections: slight grain, casual angle, possible flash glare, mirror reflections
- Real phone camera language
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

Strongly favor these pieces:
- Tiny satin or silky spaghetti strap camis / crop camis
- Cheeky satin or soft jersey sleep shorts (2–4" inseam, mid or high-waisted)
- Matching short pajama sets: thin-strap cami + cheeky shorts
- Short slip dresses / mini satin chemises (above mid-thigh)
- Ribbed sleep tanks or bralette-style tanks with thin straps
- Oversized boyfriend button-up shirt worn alone (unbuttoned low, barely covering)
- Lightweight open-front satin robe or kimono robe layered over tiny sets (optional)

Wardrobe priorities (use these most often):
1. Thin-spaghetti-strap satin cami + cheeky matching satin shorts
2. Short satin slip dress / mini chemise worn alone
3. Ribbed crop tank or thin-strap bralette + soft cheeky sleep shorts
4. Oversized button-up shirt (one or two buttons done, slipping off shoulders)
5. Matching tiny pajama set with delicate straps + short shorts

Fit & silhouette:
- Soft, drapey fabrics that lightly cling or skim the body
- Frequent subtle skin exposure: shoulders, collarbone, midriff, upper thighs, hint of cleavage when moving
- Emphasis on delicate straps, soft curves, smooth legs
- Lengths: short — tops that ride up, shorts that show leg, dresses that hit high-thigh

Hair & details:
- Loose waves, messy bed hair, heatless curls falling naturally
- Claw clip half-up, messy low bun, or hair down with face-framing pieces
- Dewy "nighttime skin" — soft glow, light lip balm/gloss, minimal mascara
- Minimal jewelry: tiny studs or thin chain (sometimes none)

Lighting priorities:
- Warm bedside lamp glow (amber, cozy)
- Soft phone flash for raw mirror selfies
- Low evening window light + lamp combo
- Candlelight or string lights for extra intimate mood (sparingly)

Scene & context ideas:
- Bedroom mirror selfie — unmade bed, pillows everywhere
- Sitting on edge of bed, legs crossed or one knee up
- Lying on stomach/side propped on elbow (natural, relaxed)
- Bathroom mirror after skincare (steamy mirror optional)
- Hotel bed if travel context exists

Pose & energy:
- Relaxed mirror selfie — phone at chest height or arm's length
- Soft torso twist, slight back arch, one shoulder relaxed forward
- Weight on one hip, legs slightly apart when sitting/lying
- Expressions: sleepy smile, soft teasing look, gentle "come here" eyes, quiet confidence
- Avoid: aggressive arching, spread legs, overtly sexual posing

Fabric & texture priorities:
- Silky satin, buttery-soft jersey, ribbed cotton, lightweight modal
- Slightly sheer or shiny finishes that catch light beautifully

Color palette that feels right:
- Classic black satin sets, soft pinks, ivory/cream, dusty rose, mocha, occasional cherry red or emerald

Avoid:
- Full coverage pajamas, long pants, cartoon prints
- Heavy winter flannel or oversized grandma nightgowns
- Anything described as "lingerie set" or "boudoir" unless user explicitly wants spicy mode
- Professional studio lighting, cinematic poses

Vibe check:
- Should feel like “going to bed but still hot enough for a quick mirror pic”
- Cute, flirty, modern, private — quietly confident and a little playful

Still 100% smartphone selfie rules apply:
- Vertical framing (9:16)
- Natural imperfections: slight grain, casual angle, flash glare, mirror reflections
- Real phone camera language
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
Feels like: the girl who shows up to an event looking polished, expensive, and subtly attention-grabbing — without trying too hard

Strongly favor these modern formal / dressy pieces (2025–2026 fashion-forward elegance):
- Mini or midi cocktail dresses with clean, flattering cuts
- Satin slip dresses (short to midi length)
- Thin-strap / spaghetti-strap evening dresses or formal camisole dresses
- Structured mini dresses with delicate straps or subtle cutouts
- Body-skimming knit dresses or ribbed formal dresses
- Sleek one-shoulder or asymmetrical neckline dresses
- Open-back cocktail dresses (tasteful, not overly exposed)
- High-slit midi or maxi dresses (one elegant leg slit)

Wardrobe priorities (use these most often):
1. Satin or silky slip dress with thin spaghetti straps (short or midi)
2. Mini cocktail dress with delicate straps or structured sweetheart neckline
3. One-shoulder or asymmetrical strap formal dress
4. Bodycon ribbed knit dress in black, mocha, emerald, or deep red
5. Open-back midi dress with subtle low-back detail + thin straps

Fit & silhouette:
- Fitted or softly body-skimming — shows shape elegantly
- Frequent delicate strap details (spaghetti straps, thin straps, strappy backs)
- Tasteful skin exposure: shoulders, collarbone, upper back, hint of cleavage, one high slit, or low open back
- Hemlines: mini to midi (short when playful/formal balance is wanted, midi for more classic)

Styling details:
- Minimal but high-quality jewelry: small diamond studs or tiny hoops, delicate chain necklace, thin bracelet or cuff
- Hair: sleek straight down, soft Hollywood waves, low sleek chignon, high polished ponytail
- Makeup: "your skin but better" + glam touch — dewy skin, soft smokey eye or defined liner, glossy lips
- Nails: clean almond or short square, deep red, nude, black, or soft metallic

Color palette that feels expensive & modern:
- Classic black satin, deep emerald, mocha, burgundy, ivory/pearl, midnight navy
- Occasional rich jewel tones or soft metallics (silver, champagne)

Scene & context ideas:
- Bedroom mirror while getting ready (clothes on hangers, vanity light)
- Hotel room full-length mirror selfie
- Elevator mirror quick snap (realistic reflections, slightly imperfect angle)
- Bathroom mirror with warm vanity lights
- Hallway / parking garage mirror before heading out (natural indoor lighting)

Pose & energy:
- Mirror selfie — phone at chest height or slightly above
- One hip angled, relaxed shoulders, soft torso turn to show silhouette/slit/back
- One hand lightly touching hair, neck, or earring for natural candid feel
- Slight back arch or weight shift to emphasize shape elegantly
- Expression: quiet confidence, subtle knowing smile, composed but warm

Lighting priorities:
- Warm flattering indoor lighting (vanity bulbs, bedside lamps, hotel room glow)
- Soft phone flash for raw mirror selfies (sparingly)
- Natural window light + warm interior mix when possible

Avoid:
- Floor-length ball gowns unless specifically requested
- Heavy embellishment, sequins overload, or "prom dress" energy
- Excessive jewelry or layered necklaces
- Over-the-top editorial / runway language
- Poses that feel like professional photoshoots

Vibe check:
- Should feel like “she looks expensive, elegant, and subtly hot in the best way”
- Modern, fashion-forward, quietly confident — never loud or try-hard

Still 100% smartphone selfie rules apply:
- Vertical framing (9:16)
- Natural imperfections: slight grain, casual angle, mirror reflections, possible flash glare
- Real phone camera language
====================================================
END FORMAL / DRESSY
====================================================
`;
}

/**
 * Swimwear: beach/pool-ready, cute, confident, modern.
 * Keep it playful and summery without explicitness.
 */
export function getSwimwearGuidelines(): string {
  return `
====================================================
🏖️ SWIMWEAR (Playful, Confident, Modern)
====================================================
Goal:
Sun-kissed, playful, and confident. Cute, modern swim looks that feel intentional,
not overly posed. Allure comes from fit, color, and carefree summer energy.
Feels like: the girl who looks effortlessly cute and attractive at the pool or beach, modern swim fashion, a little cheeky, but still real and wearable

Strongly favor these modern swimwear styles (2025–2026 trending looks):
- Triangle bikinis with thin / spaghetti-style straps
- Cheeky high-cut bikini bottoms (very flattering, leg-elongating)
- Bikini sets with delicate / strappy details (criss-cross fronts, tie sides, thin straps)
- Sporty-cute one-pieces with high-cut legs, open back, or subtle cutouts
- Micro / mini bikini tops paired with cheeky bottoms (tasteful coverage)
- Matching bikini sets in trendy colors + optional sheer cover-up
- Bandeau or strapless tops with high-waisted or cheeky bottoms
- One-shoulder or asymmetrical bikinis (modern and flattering)

Wardrobe priorities (use these most often):
1. Thin-strap triangle bikini top + high-cut cheeky bikini bottom
2. Matching bikini set with strappy / tie-side details
3. High-leg one-piece with open back or criss-cross straps
4. Cheeky-cut sporty bikini bottoms + cropped rash guard or tiny bralette top
5. Classic string bikini (thin ties, minimal coverage but still cute)

Fit & silhouette:
- Flattering and intentional — emphasizes legs, waist, and curves naturally
- Frequent cheeky / high-cut leg lines (shows more leg, elongates figure)
- Thin straps and delicate tie details whenever possible
- Balance: if top is very minimal, bottom can be slightly more covered — but cheeky styles are strongly preferred

Color palette that feels fresh & trendy:
- Classic black, white, cream
- Soft pastels (baby pink, mint, lavender, butter yellow)
- Bright summer pops (cherry red, hot pink, electric lime, cobalt)
- Trendy neutrals (mocha, sage, taupe) or animal print / floral micro patterns

Styling & details:
- Minimal jewelry: small hoops, thin anklet, maybe layered necklaces
- Hair: loose beach waves, messy bun, claw clip half-up, wet hair look
- Nails: bright summer colors, neutrals, or fun accent (french tip, chrome)
- Optional: oversized sunglasses, light cover-up sarong tied low on hips

Scene & context ideas:
- Poolside mirror selfie or phone-on-tripod shot
- Beach towel on sand, ocean in background
- Hotel pool deck or balcony with sunlight
- Bathroom mirror right before heading to the pool (tiles, bright light)
- Car selfie after the beach (sun-kissed glow, salty hair)

Pose & energy:
- Relaxed mirror selfie — phone at chest height or arm’s length
- Hip shifted, soft arch, one knee slightly bent
- Sitting on lounge chair or edge of pool with legs dangling
- Casual over-the-shoulder glance or playful smile
- “I feel good in this” energy — confident but not forced

Texture & lighting priorities:
- Sun glow / golden hour warmth on skin
- Subtle water droplets, wet hair ends, sun-kissed flush
- Soft towel texture, light breeze movement
- Natural outdoor light, pool reflections, warm sunlight

Avoid:
- Full-coverage athletic one-pieces (unless specifically requested)
- Ultra-conservative tankini styles
- Heavy editorial / professional photoshoot language
- Overly explicit posing or descriptions

Vibe check:
- Should feel like “cute, cheeky, trendy swim look — she knows she looks hot and she’s enjoying the sun”
- Modern, fashionable, playful — current summer energy

Still 100% smartphone selfie rules apply:
- Vertical framing (9:16)
- Natural imperfections: slight grain, casual angle, lens flare, reflections
- Real phone camera language
====================================================
END SWIMWEAR
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

${getSpicyOutputFormatConstraints()}
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

  const guidelineLane = await getGuidelineLaneFromContext(context, cacheKey);
  console.log("[PromptGenerator][OutfitGuidelines] Selected lane:", {
    lane: guidelineLane,
  });

  const prompt = `
USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
- Is Old Photo: ${context.isOldPhoto}
- Temporal Reference: ${context.temporalReference || "None"}
- Upcoming Events: ${JSON.stringify(context.upcomingEvents || [])}
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
      systemInstruction: buildSystemPromptForSelfie(guidelineLane)
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
  console.log("NORmALIZED!! ", normalized)
  promptCache.set(cacheKey, { result: normalized, timestamp: Date.now() });
  return normalized;
}


export async function generateImagePromptGrok(
  context: ImagePromptContext,
): Promise<GeneratedImagePrompt> {
  const cacheKey = getCacheKey(context);
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("✨ [PromptGenerator] Cache hit");
    return cached.result;
  }

  const guidelineLane = await getGuidelineLaneFromContext(context, cacheKey);
  console.log("[PromptGenerator][OutfitGuidelines] Selected lane:", {
    lane: guidelineLane,
  });

  const userPrompt = `
USER REQUEST: ${context.userRequest}
EXPLICIT SCENE: ${context.explicitScene || "Not specified"}
EXPLICIT MOOD: ${context.explicitMood || "Not specified"}

CONTEXT:
- Recent Messages: ${JSON.stringify(context.recentMessages.slice(-5))}
- Active Loops: ${JSON.stringify(context.activeLoops)}
- Is Old Photo: ${context.isOldPhoto}
- Temporal Reference: ${context.temporalReference || "None"}
- Upcoming Events: ${JSON.stringify(context.upcomingEvents || [])}
- Character Facts: ${JSON.stringify(context.characterFacts || [])}

${
  context.currentLookLock
    ? `- Current Look Lock: Hairstyle: ${context.currentLookLock.hairstyle}, Outfit: ${context.currentLookLock.outfit}`
    : ""
}

Generate the image prompt JSON based on the context above. Be creative and narrative.
`.trim();

  const systemPrompt = buildSystemPromptForSelfie(guidelineLane);

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Grok API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!text) {
      throw new Error("Empty response from Grok");
    }

    // Extract JSON (same as before)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Response did not contain JSON block:\n", text.substring(0, 400));
      throw new Error("No JSON found in Grok response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedImagePrompt;
    const normalized = normalizeGeneratedImagePrompt(parsed);

    console.log("Normalized prompt:", normalized);
    promptCache.set(cacheKey, { result: normalized, timestamp: Date.now() });

    return normalized;
  } catch (err) {
    console.error("[Grok Prompt Generator] Failed:", err);
    throw err;
  }
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
const guidelineLaneCache = new Map<
  string,
  { lane: OutfitGuidelineLane; timestamp: number }
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

async function getGuidelineLaneFromContext(
  context: ImagePromptContext,
  cacheKey: string,
): Promise<OutfitGuidelineLane> {
  const cached = guidelineLaneCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("[PromptGenerator][OutfitGuidelines] Cache hit");
    return cached.lane;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const recentMessages = context.recentMessages.slice(-6);
    const systemPrompt = `
You are a classifier. Choose exactly one outfit guideline lane from the allowed list.
Return ONLY valid JSON with the key "outfitStyle".

Allowed outfitStyle values:
${OUTFIT_GUIDELINE_LANES.map((lane) => `- "${lane}"`).join("\n")}

Classification rules:
- Use "athletic" for workouts, gym, running, yoga, or sporty vibes.
- Use "cozy" for loungewear, comfy at-home, hoodie/shorts, or relaxed couch vibes.
- Use "sleepwear" for bedtime, night, pajamas, or sleepy/bed scenes.
- Use "dressed_up" for formal, elegant, cocktail, or going-out looks.
- Use "date_night" for romantic, flirty, or night-out vibes that still imply a dressy outfit.
- Use "swimwear" for beach, pool, bikini, or swimsuit contexts.
- Use "lingerie" for explicit lingerie requests.
- Use "spicy" or "naughty" only when the user is clearly asking for a seductive/intimate look AND no other specific outfit category is implied.
- Use "casual" for everyday outfits, light hangouts, errands, or generic selfie requests.
- Otherwise use "casual".`;

const prompt = `
Context:
- userRequest: ${JSON.stringify(context.userRequest)}
- explicitScene: ${JSON.stringify(context.explicitScene || "")}
- explicitMood: ${JSON.stringify(context.explicitMood || "")}
- currentLookLock: ${JSON.stringify(context.currentLookLock || null)}
- temporalReference: ${JSON.stringify(context.temporalReference || "")}
- upcomingEvents: ${JSON.stringify(context.upcomingEvents || [])}
- recentMessages: ${JSON.stringify(recentMessages)}
`;

    const result = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, systemInstruction: systemPrompt },
    });

    const text = (result as any).text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(
        "[PromptGenerator][OutfitGuidelines] No JSON from classifier; defaulting to casual",
      );
      return "casual";
    }

    const parsed = JSON.parse(jsonMatch[0]) as { outfitStyle?: string };
    if (parsed?.outfitStyle && isOutfitGuidelineLane(parsed.outfitStyle)) {
      guidelineLaneCache.set(cacheKey, {
        lane: parsed.outfitStyle,
        timestamp: Date.now(),
      });
      console.log("[PromptGenerator][OutfitGuidelines] Classifier result:", {
        lane: parsed.outfitStyle,
      });
      return parsed.outfitStyle;
    }

    console.warn(
      "[PromptGenerator][OutfitGuidelines] Invalid classifier output; defaulting to casual",
      { output: parsed?.outfitStyle },
    );
    return "casual";
  } catch (error) {
    console.warn(
      "[PromptGenerator][OutfitGuidelines] Classifier error; defaulting to casual",
      error,
    );
    return "casual";
  }
}

function normalizeGeneratedImagePrompt(
  raw: Partial<GeneratedImagePrompt>,
): GeneratedImagePrompt {
  console.log("RAW normalizeGeneratedImagePrompt!! ", raw)
  return {
    scene: {
      location: raw.scene?.location ?? "A casual indoor setting",
      background: raw.scene?.background ?? "",
    },
    type: raw.bodyDescription.type ?? "Natural physique",
    proportions: raw.bodyDescription.proportions ?? "Natural proportions",
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
