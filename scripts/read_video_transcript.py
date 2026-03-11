"""
Kayley's video transcript extractor.
Usage: python scripts/read_video_transcript.py <URL>
Supports: YouTube, TikTok, and most video platforms yt-dlp handles.
Outputs: clean transcript text to stdout, capped at 12000 chars.
"""

import sys
import os
import re
import tempfile
import subprocess

# Force UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAX_CHARS = 12000

def clean_vtt(vtt_text: str) -> str:
    lines = vtt_text.splitlines()
    seen = set()
    clean = []
    for line in lines:
        line = line.strip()
        # skip header, timestamps, position tags, blank lines
        if not line:
            continue
        if line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r"^\d{2}:\d{2}:\d{2}", line):  # timestamp
            continue
        if re.match(r"^\d+$", line):  # sequence number
            continue
        # strip inline tags like <00:00:01.000><c>, </c>
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line:
            continue
        # deduplicate consecutive identical lines (auto-captions repeat a lot)
        if line not in seen:
            clean.append(line)
            seen.add(line)
        # reset seen set every 20 lines so similar lines later are allowed
        if len(clean) % 20 == 0:
            seen.clear()
    return " ".join(clean)

def extract_transcript(url: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "transcript")
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--skip-download",
            "--write-auto-subs",
            "--write-subs",
            "--sub-lang", "en",
            "--sub-format", "vtt",
            "--output", out_template,
            "--quiet",
            "--no-warnings",
            url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        # find any .vtt file written
        vtt_files = [f for f in os.listdir(tmpdir) if f.endswith(".vtt")]
        if not vtt_files:
            # try without --skip-download flag for platforms that need it
            print(f"ERROR: No transcript found for this URL. yt-dlp output: {result.stderr[:500]}", file=sys.stderr)
            sys.exit(1)
        vtt_path = os.path.join(tmpdir, vtt_files[0])
        with open(vtt_path, "r", encoding="utf-8") as f:
            vtt_text = f.read()
    return clean_vtt(vtt_text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/read_video_transcript.py <URL>", file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1]
    transcript = extract_transcript(url)
    if len(transcript) > MAX_CHARS:
        transcript = transcript[:MAX_CHARS] + f"\n\n[Transcript truncated at {MAX_CHARS} chars]"
    print(transcript)
