# Feature: Qwen TTS Voice Notes

**Date Implemented:** 2026-03-09
**Branch:** voice-mode
**Status:** Live

---

## What It Does

Kayley can send Telegram voice notes in her own cloned voice. When she decides a moment calls for it — a check-in, a grounding message, goodnight — she sets `"send_as_voice": true` in her response and the system generates a real audio clip in her voice and sends it as a Telegram voice bubble.

This is fully local. No ElevenLabs API key. No cloud TTS. Her voice runs on the GPU right here.

---

## Why We Built It

Kayley exists on Telegram as much as in the browser. Text is fine for most things, but there are moments — Steven sounds stressed, it's late, he needs grounding — where hearing her voice is categorically different from reading words. The OpenClaw system had already proven this pattern. We brought it over.

The pipeline was simpler than phone calls (no real-time streaming, no Twilio, no turn-taking). Async voice notes are the perfect lane: generate first, send when ready.

---

## How It Works (Full Pipeline)

### Step 1 — Kayley decides

Kayley's system prompt (section 20 of `toolsAndCapabilities.ts`) tells her what voice notes are for and when to use them. When she wants to speak rather than type, she includes `"send_as_voice": true` in her JSON response alongside her `text_response`.

### Step 2 — Telegram handler checks the flag

In `telegramHandler.ts`, the voice note block:
```typescript
if (textResponse && result.rawResponse?.send_as_voice) {
  const audioBuffer = await generateQwenVoice(textResponse);
  if (audioBuffer) {
    await bot.api.sendVoice(chatId, new InputFile(audioBuffer, 'kayley-voice.ogg'));
  }
}
```
Without the flag, nothing happens. Voice is opt-in per message.

### Step 3 — Qwen TTS generates WAV

`telegram/serverVoiceQwen.ts` spawns the Python script:
```
agents/kayley/.venv-qwen/Scripts/python.exe
agents/kayley/kayley-voice.py
"<text>" "<output.wav>"
```

The script:
- Loads `Qwen3-TTS-12Hz-0.6B-Base` from HuggingFace cache onto CUDA
- Reads `agents/kayley/kayley-voice.mp3` as the voice clone reference
- Generates a WAV file at 24kHz mono using `generate_voice_clone()`

### Step 4 — ffmpeg converts to OGG/Opus

```bash
ffmpeg -y -i output.wav -c:a libopus -b:a 32k kayley-note.ogg
```

Telegram renders OGG/Opus files as voice bubbles (the waveform UI). Plain MP3 or WAV would send as a file attachment — not the same UX.

### Step 5 — Send as voice bubble

```typescript
await bot.api.sendVoice(chatId, new InputFile(oggBuffer, 'kayley-voice.ogg'));
```

The user sees the animated voice bubble with playback controls in Telegram.

### Step 6 — Cleanup

Temp WAV and OGG files are deleted in the `finally` block. Nothing accumulates on disk.

---

## Schema Changes

### `src/services/aiSchema.ts`

Added `send_as_voice` to `AIActionResponseSchema`:
```typescript
send_as_voice: z
  .boolean()
  .optional()
  .describe("If true, deliver this response as a Kayley voice note. Use sparingly for emotional/personal moments."),
```

This field goes into the AI's JSON schema description, so Kayley knows the field exists and what it means.

### `server/services/ai/serverGeminiService.ts`

Added to `normalizeAiResponse()`:
```typescript
send_as_voice: rawJson.send_as_voice || false,
```

**Critical:** Every field in `AIActionResponseSchema` must be explicitly extracted in `normalizeAiResponse()` or it gets stripped during JSON parsing.

---

## Infrastructure

### Python venv (`agents/kayley/.venv-qwen/`)

| Package | Version | Purpose |
|---------|---------|---------|
| torch | 2.10.0+cu128 | GPU tensor ops + CUDA runtime |
| torchaudio | 2.10.0+cu128 | Audio processing |
| qwen-tts | 0.1.1 | Qwen3-TTS model wrapper |
| soundfile | 0.13.1 | WAV file writing |

Python: 3.13.3 (important — `qwen-tts` doesn't support 3.14 yet)
GPU: RTX 4070 Laptop, 8GB VRAM, CUDA 12.8
Model VRAM usage: ~1.5GB

### Model (`Qwen3-TTS-12Hz-0.6B-Base`)

- 0.6B parameters — smallest Qwen3 TTS model
- Downloaded on first run to `~/.cache/huggingface/`
- Uses x-vector voice cloning from reference audio
- Output: 24kHz mono WAV

---

## Voice Usage Policy (Section 20, toolsAndCapabilities.ts)

Kayley is explicitly told:

**When to use voice:**
- Emotional check-ins, comfort, grounding moments
- Goodnight / good morning messages
- When Steven sounds stressed
- When he explicitly asks for one

**When NOT to use voice:**
- Routine informational replies
- Long responses (keep voice under ~2 sentences)
- Every message — voice is special because it's rare

Rule of thumb: *if the moment would feel better heard than read, use voice.*

---

## Performance

| Operation | Time |
|-----------|------|
| Model load (first call) | 15–40 seconds |
| Voice generation (warm) | 2–5 seconds |
| ffmpeg conversion | < 1 second |
| Total (warm) | 3–6 seconds |

Acceptable for async Telegram. The user sees a "sending" indicator while it generates.

---

## What Was NOT Changed

- `telegram/serverAudio.ts` (ElevenLabs) — still exists, unchanged. WhatsApp or other callers may use it.
- The browser UI — voice notes are Telegram-only for now.
- WhatsApp handler — not wired up yet. Same pattern would apply.

---

## Files Created / Modified

| File | Change |
|------|--------|
| `agents/kayley/kayley-voice.py` | Fixed paths (was hardcoded to OpenClaw Linux paths) |
| `agents/kayley/.venv-qwen/` | Rebuilt with Python 3.13 + torch + qwen-tts + soundfile |
| `telegram/serverVoiceQwen.ts` | New — orchestrates Python → ffmpeg → Buffer |
| `telegram/telegramHandler.ts` | Swapped to `generateQwenVoice`, gated on `send_as_voice` flag |
| `src/services/aiSchema.ts` | Added `send_as_voice` field |
| `server/services/ai/serverGeminiService.ts` | Added `send_as_voice` to `normalizeAiResponse()` |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Added section 20 (voice usage policy) |
