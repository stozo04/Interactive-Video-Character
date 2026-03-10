"""
Kayley Voice Generator
Usage: python kayley-voice.py "Text to speak" [output.wav]
"""
import sys
import os
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

# Args
text = sys.argv[1] if len(sys.argv) > 1 else "Hey VeeVee. It's KayKay."
out_path = sys.argv[2] if len(sys.argv) > 2 else "kayley-voice-out.wav"

# Resolve paths relative to this script's directory (agents/kayley/)
script_dir = os.path.dirname(os.path.abspath(__file__))
ref_audio = os.path.join(script_dir, "kayley-voice.mp3")
out_path = os.path.join(script_dir, out_path) if not os.path.isabs(out_path) else out_path

# Ensure output directory exists
os.makedirs(os.path.dirname(out_path), exist_ok=True)

print(f"[kayley-voice] ref: {ref_audio}")
print(f"[kayley-voice] generating: {text[:80]}...")

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
