/**
 * Qwen TTS Voice Generator
 *
 * Spawns the local Qwen TTS Python script to generate cloned Kayley voice,
 * then converts WAV → OGG/Opus via ffmpeg for Telegram voice notes.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { log } from "../lib/logger";

const execFileAsync = promisify(execFile);
const runtimeLog = log.fromContext({ source: "serverVoiceQwen", route: "telegram/tts" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENTS_DIR = path.resolve(__dirname, "..", "agents", "kayley");
const PYTHON_EXE = path.join(AGENTS_DIR, ".venv-qwen", "Scripts", "python.exe");
const VOICE_SCRIPT = path.join(AGENTS_DIR, "kayley-voice.py");
const TEMP_DIR = path.join(AGENTS_DIR, "voice-tmp");

/**
 * Generate a Kayley voice note from text.
 * Returns an OGG/Opus Buffer ready for bot.api.sendVoice(), or null on failure.
 */
export async function generateQwenVoice(text: string): Promise<Buffer | null> {
  const id = Date.now().toString(36);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  const oggPath = path.join(TEMP_DIR, `${id}.ogg`);

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  try {
    // 1. Generate WAV via Qwen TTS
    runtimeLog.info("Qwen TTS starting", {
      source: "serverVoiceQwen",
      textLength: text.length,
      textPreview: text.substring(0, 80),
    });

    const { stdout, stderr } = await execFileAsync(
      PYTHON_EXE,
      [VOICE_SCRIPT, text, wavPath],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );

    if (stderr) {
      runtimeLog.warning("Qwen TTS stderr output", {
        source: "serverVoiceQwen",
        stderr: stderr.substring(0, 500),
      });
    }

    if (!fs.existsSync(wavPath)) {
      runtimeLog.error("Qwen TTS produced no output file", {
        source: "serverVoiceQwen",
        stdout: stdout.substring(0, 500),
        stderr: stderr?.substring(0, 500),
      });
      return null;
    }

    const wavSize = fs.statSync(wavPath).size;
    runtimeLog.info("Qwen TTS WAV generated", {
      source: "serverVoiceQwen",
      wavSize,
      wavPath,
    });

    // 2. Convert WAV → OGG/Opus via ffmpeg
    await execFileAsync("ffmpeg", [
      "-y", "-i", wavPath,
      "-c:a", "libopus", "-b:a", "32k",
      oggPath,
    ], { timeout: 30_000 });

    if (!fs.existsSync(oggPath)) {
      runtimeLog.error("ffmpeg conversion produced no output", { source: "serverVoiceQwen" });
      return null;
    }

    const oggBuffer = fs.readFileSync(oggPath);
    runtimeLog.info("Voice note ready", {
      source: "serverVoiceQwen",
      oggSize: oggBuffer.length,
    });

    return oggBuffer;
  } catch (err) {
    runtimeLog.error("Qwen voice generation failed", {
      source: "serverVoiceQwen",
      error: err instanceof Error ? err.message : String(err),
      textPreview: text.substring(0, 80),
    });
    return null;
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}
  }
}
