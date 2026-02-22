---
name: kayley-selfie-grok
description: Generate Kayley selfie images with xAI Grok directly (no fal.ai), using the Interactive-Video-Character reference image registry and prompt style. Use when the user asks for a selfie, photo, pic, "what are you doing", outfit/location selfie variants, or image-based playful check-ins.
---

# Kayley Selfie (Direct Grok)

Use this skill to produce and send selfies without fal.ai.

## Inputs
- User selfie request text (required)
- Optional output file path

## Steps
1. Build a selfie prompt from user text.
2. Select a reference image URL from the project `referenceImages/config.json`.
3. Call xAI `images/edits` directly with the selected reference URL.
4. Save PNG output locally.
5. Send the image in chat with a short caption.

## Command
Run:

```bash
node scripts/generate-selfie.mjs \
  --request "send a pic at a coffee shop" \
  --out /tmp/kayley-selfie.png
```

Optional flags:
- `--config <path>`: override reference config path
- `--model <model>`: override xAI model
- `--debug`: print selection details

## Required Environment
- `GROK_API_KEY` (or `VITE_GROK_API_KEY`)

## Optional Environment (recommended)
- `GEMINI_API_KEY` (or `VITE_GEMINI_API_KEY`) for detailed prompt generation before Grok render
- `GEMINI_TEXT_MODEL` (default: `gemini-2.0-flash`)
- `GROK_MODEL` (or `VITE_GROK_IMAGEN_MODEL`)
- `KAYLEY_REFERENCE_CONFIG` path to config JSON

## Default Reference Config
`/mnt/c/Users/GatesBot/Desktop/Projects/Interactive-Video-Character/src/utils/referenceImages/config.json`

## Send Result
After generation, send the output image via messaging tool with a natural caption.