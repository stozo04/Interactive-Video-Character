# Software Engineer Guide: Qwen TTS Voice Pipeline

## Overview

This guide covers the full architecture, setup, and extension patterns for Kayley's local Qwen3 TTS voice note system. Kayley sends Telegram voice bubbles in her own cloned voice when the moment warrants it.

---

## Architecture

```
Kayley AI response (send_as_voice: true)
        ↓
telegramHandler.ts
  checks result.rawResponse?.send_as_voice
        ↓
telegram/serverVoiceQwen.ts
  generateQwenVoice(text) → Buffer
        ↓
  ┌─────────────────────────────────────────┐
  │  1. execFile(python.exe, kayley-voice.py, text, wavPath)
  │     agents/kayley/.venv-qwen/Scripts/python.exe
  │     agents/kayley/kayley-voice.py
  │     → reads kayley-voice.mp3 as voice clone reference
  │     → Qwen3-TTS-12Hz-0.6B-Base on GPU (CUDA)
  │     → outputs WAV at 24kHz mono
  │
  │  2. execFile(ffmpeg, -i input.wav -c:a libopus -b:a 32k output.ogg)
  │     → OGG/Opus (Telegram-native voice format)
  │
  │  3. fs.readFileSync(oggPath) → Buffer
  │  4. cleanup temp WAV + OGG
  └─────────────────────────────────────────┘
        ↓
bot.api.sendVoice(chatId, new InputFile(buffer, 'kayley-voice.ogg'))
```

---

## Prerequisites

### System Requirements

- **Python 3.13** (not 3.14 — use `py -3.13` on Windows)
- **NVIDIA GPU** with CUDA 12.x drivers
- **ffmpeg** on PATH (`ffmpeg -version` should work)
- **Node.js 22+** with ESM module support

### Python Venv

The venv lives at `agents/kayley/.venv-qwen/`. If you need to rebuild it:

```bash
# From repo root
py -3.13 -m venv agents/kayley/.venv-qwen

# Install PyTorch (CUDA 12.8)
agents/kayley/.venv-qwen/Scripts/python.exe -m pip install \
  torch torchaudio --index-url https://download.pytorch.org/whl/cu128

# Install TTS packages
agents/kayley/.venv-qwen/Scripts/python.exe -m pip install qwen-tts soundfile
```

**Note:** The `torch` download is ~2.9GB. First install takes several minutes.

### Model Weights

On first run, Qwen3-TTS-12Hz-0.6B-Base downloads automatically from HuggingFace to:
```
C:\Users\<user>\.cache\huggingface\hub\models--Qwen--Qwen3-TTS-12Hz-0.6B-Base\
```
This is ~1.2GB and only happens once. Subsequent runs load from cache.

---

## Key Files

| File | Role |
|------|------|
| `agents/kayley/kayley-voice.py` | Python TTS script. Takes `text` + `output_path` as argv. Writes WAV. |
| `agents/kayley/kayley-voice.mp3` | Voice clone reference audio (Kayley's voice sample). |
| `agents/kayley/.venv-qwen/` | Python 3.13 venv with torch, qwen-tts, soundfile. |
| `telegram/serverVoiceQwen.ts` | TypeScript orchestrator. Spawns Python, converts, returns Buffer. |
| `src/services/aiSchema.ts` | Defines `send_as_voice` field in AI response schema. |
| `server/services/ai/serverGeminiService.ts` | `normalizeAiResponse()` — passes `send_as_voice` through. |
| `src/services/system_prompts/tools/toolsAndCapabilities.ts` | Section 20 — Kayley's usage policy for voice notes. |

---

## How Kayley Triggers a Voice Note

Kayley sets `"send_as_voice": true` in her JSON response alongside `text_response`. The telegram handler checks `result.rawResponse?.send_as_voice` before calling `generateQwenVoice()`.

**She sends voice notes for:**
- Emotional check-ins / grounding moments
- Goodnight / good morning messages
- When Steven sounds stressed
- When he explicitly asks for one

**She does NOT send voice for:**
- Routine informational replies
- Long messages (keep voice under ~2 sentences)
- Every message — voice is special because it's rare

---

## Adding a New Schema Field (Reference Pattern)

When you add any field to `AIActionResponseSchema` in `aiSchema.ts`, you MUST also add it to `normalizeAiResponse()` in `serverGeminiService.ts`. Otherwise it gets silently stripped during JSON parsing.

```typescript
// aiSchema.ts
my_new_field: z.boolean().optional().describe("..."),

// serverGeminiService.ts → normalizeAiResponse()
my_new_field: rawJson.my_new_field || false,
```

---

## ESM Module Pattern (Critical)

This project uses ES modules. Never use `__dirname` or `__filename` directly. Use:

```typescript
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

---

## Testing the Pipeline Manually

```bash
# Test Python script directly (generates WAV)
agents/kayley/.venv-qwen/Scripts/python.exe agents/kayley/kayley-voice.py \
  "Hey VeeVee. Just checking in." /tmp/test.wav

# Test ffmpeg conversion
ffmpeg -y -i /tmp/test.wav -c:a libopus -b:a 32k /tmp/test.ogg

# Verify OGG is valid
ffprobe /tmp/test.ogg
```

---

## Performance Notes

| Operation | Time (approx) |
|-----------|---------------|
| First call (model load) | 15–40 seconds |
| Subsequent calls | 2–5 seconds |
| ffmpeg conversion | < 1 second |
| Total pipeline (warm) | ~3–6 seconds |

The Qwen 0.6B model uses ~1.5GB VRAM on the RTX 4070. GPU memory is freed after each call since we spawn a new Python process per message. If you wanted lower latency, you could keep the model loaded as a persistent subprocess — but 3–6 seconds is acceptable for async Telegram messages.

---

## Troubleshooting

**"ReferenceError: __dirname is not defined"**
→ Use the `fileURLToPath(import.meta.url)` pattern above.

**Python script hangs / no output**
→ Check CUDA is available: `agents/kayley/.venv-qwen/Scripts/python.exe -c "import torch; print(torch.cuda.is_available())"`

**"ModuleNotFoundError: No module named 'qwen_tts'"**
→ Venv is missing packages. Re-run the pip installs above.

**Voice sent as file attachment instead of voice bubble**
→ Must use `bot.api.sendVoice()`, not `sendDocument()`. File must be `.ogg` with Opus codec.

**HuggingFace symlink warning**
→ Harmless on Windows. Enable Developer Mode to eliminate it, or just ignore it.
