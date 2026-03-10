# Lessons Learned: Qwen TTS Voice Notes (2026-03-09)

## What We Built

End-to-end Telegram voice note pipeline using local Qwen3 TTS voice cloning. Kayley can now send voice notes in her own cloned voice when a message warrants it. She decides — not every message, just the ones that feel better heard than read.

Pipeline: `text → Python (Qwen3 TTS) → WAV → ffmpeg → OGG/Opus → Telegram voice bubble`

---

## Key Decisions & Surprises

### Python version matters for ML packages

`qwen-tts` supports Python 3.9–3.13. This machine has Python 3.14 as the default (`python --version`), but also 3.13 via the `py` launcher (`py -3.13`). We had to:
1. Stop the in-progress PyTorch 3.14 download
2. Recreate the venv with `py -3.13 -m venv agents/kayley/.venv-qwen`

**Lesson:** Always check `py -3.13 --version` before assuming the system Python is the right one for ML venvs.

### `__dirname` doesn't exist in ESM

The project runs as ES modules (`"type": "module"` in package.json). Any new TypeScript file that uses `__dirname` or `__filename` will crash at startup with `ReferenceError: __dirname is not defined in ES module scope`.

**Fix:**
```typescript
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

This pattern must be used in ALL new server-side TS files that need path resolution.

### PyTorch downloads are silent when piped

`pip install` normally prints a progress bar. When stdout is piped (as it is from `execFile`/background tasks), the progress bar is suppressed. The download just appears stuck on the `Downloading torch-X.whl (2867.4 MB)` line. It IS downloading — just silently.

**Lesson:** Don't panic if a large pip install looks stuck. Check disk activity or wait it out.

### First Qwen inference is slow, subsequent are fast

The first call loads the model from HuggingFace cache (~1.2GB) onto the GPU. This takes 10–30 seconds. After that, subsequent calls are 2–5 seconds. We don't preload at startup — trade-off accepted for now.

### HuggingFace symlink warning on Windows

When downloading models on Windows without Developer Mode enabled, HuggingFace hub shows:
```
UserWarning: `huggingface_hub` cache-system uses symlinks by default...
```
This is harmless — it degrades gracefully to copying files instead of symlinking. Model still downloads and works. Ignore it.

### SoX warning is harmless

`qwen-tts` installs `sox` as a dependency and may warn if SoX binary isn't on PATH. We use `soundfile` for writing audio, not SoX. The warning is benign.

### `send_as_voice` placement in schema

We gated voice on a field Kayley sets in her JSON response (`"send_as_voice": true`). This fits the existing pattern perfectly — same as `selfie_action`, `gif_action`, etc. Key insight: the field had to be added to BOTH:
1. `src/services/aiSchema.ts` (Zod schema + description that goes into the prompt)
2. `server/services/ai/serverGeminiService.ts` `normalizeAiResponse()` (or it gets silently stripped)

Always check `normalizeAiResponse()` when adding new schema fields.

---

## Failure Points to Watch

| Failure | Symptom | Fix |
|---------|---------|-----|
| Qwen model not loaded | Python exits with import error | Check `.venv-qwen` has `qwen-tts` installed |
| Wrong Python version | `qwen-tts` install fails | Use `py -3.13` not `python` |
| CUDA not available | `torch.cuda.is_available()` = False | Check NVIDIA drivers + CUDA toolkit |
| WAV file not produced | `OUTFILE:` not in Python stdout | Check ref audio path in `kayley-voice.py` |
| ffmpeg not found | `execFileAsync` throws ENOENT | Ensure ffmpeg is on PATH |
| Voice sent as file not bubble | Wrong format / missing sendVoice | Must use `bot.api.sendVoice()`, not `sendDocument()` |
| `__dirname` crash | ReferenceError on startup | Use `fileURLToPath(import.meta.url)` pattern |

---

## File Map

```
agents/kayley/
  kayley-voice.py          ← Python TTS script (paths relative to agents/kayley/)
  kayley-voice.mp3         ← Reference audio for voice cloning
  .venv-qwen/              ← Python 3.13 venv (torch, qwen-tts, soundfile)
  voice-tmp/               ← Temp WAV/OGG files (auto-cleaned after each call)

telegram/
  serverVoiceQwen.ts       ← Orchestrator: spawns Python → ffmpeg → returns Buffer

src/services/
  aiSchema.ts              ← send_as_voice field (Zod schema + LLM description)

server/services/ai/
  serverGeminiService.ts   ← normalizeAiResponse() includes send_as_voice

src/services/system_prompts/tools/
  toolsAndCapabilities.ts  ← Section 20: voice usage policy for Kayley
```
