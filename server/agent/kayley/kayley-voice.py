#!/home/gatesbot/.openclaw/workspace/.venv-qwen/bin/python3
"""
Kayley Voice Generator
Usage: python kayley-voice.py "Text to speak" [output.wav]
Default output: memory/media/kayley-voice-out.wav
"""
import sys
import os
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

# Args
text = sys.argv[1] if len(sys.argv) > 1 else "Hey VeeVee. It's KayKay."
out_path = sys.argv[2] if len(sys.argv) > 2 else "memory/media/kayley-voice-out.wav"

# Resolve paths relative to workspace root
workspace = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ref_audio = os.path.join(workspace, "memory/media/kayley-voice.mp3")
out_path = os.path.join(workspace, out_path) if not os.path.isabs(out_path) else out_path

print(f"[kayley-voice] generating: {text[:60]}...")

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    device_map="cuda:0",
    dtype=torch.float32,
)

wavs, sr = model.generate_voice_clone(
    text=text,
    language="English",
    ref_audio=ref_audio,
    x_vector_only_mode=True,
    non_streaming_mode=True,
)

sf.write(out_path, wavs[0], sr)
print(f"[kayley-voice] wrote {out_path} sr={sr}")
print(f"OUTFILE:{out_path}")
