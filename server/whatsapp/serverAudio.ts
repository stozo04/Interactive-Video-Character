/**
 * Server-side ElevenLabs TTS
 *
 * Same API call as src/services/elevenLabsService.ts but returns a Buffer
 * instead of a blob URL (which only makes sense in the browser).
 */

import { log } from "../runtimeLogger";

const LOG_PREFIX = "[ServerAudio]";
const runtimeLog = log.fromContext({ source: "serverAudio", route: "whatsapp/tts" });

export async function generateSpeechBuffer(
  text: string
): Promise<Buffer | null> {
  runtimeLog.info("Speech buffer generation requested", {
    source: "serverAudio",
    textLength: text.length,
    textPreview: text.substring(0, 100),
  });

  const apiKey = process.env.VITE_ELEVEN_LABS_API_KEY;
  const voiceId = process.env.VITE_ELEVEN_LABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    runtimeLog.warning("ElevenLabs API credentials missing", {
      source: "serverAudio",
      hasApiKey: !!apiKey,
      hasVoiceId: !!voiceId,
      skipping: true,
    });
    console.warn(`${LOG_PREFIX} ElevenLabs keys missing, skipping TTS`);
    return null;
  }

  runtimeLog.info("ElevenLabs credentials available", {
    source: "serverAudio",
    voiceIdLength: voiceId.length,
    voiceIdPrefix: voiceId.substring(0, 4),
  });

  try {
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
    const requestPayload = {
      text,
      model_id: "eleven_v3",
    };

    runtimeLog.info("Making ElevenLabs TTS API request", {
      source: "serverAudio",
      endpoint,
      model: "eleven_v3",
      textLength: text.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(requestPayload),
    });

    runtimeLog.info("Received response from ElevenLabs API", {
      source: "serverAudio",
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      contentLength: response.headers.get("content-length"),
      contentType: response.headers.get("content-type"),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unable to read error body");
      const errorMessage = `ElevenLabs API Error: ${response.statusText} (${response.status})`;

      runtimeLog.error("ElevenLabs API returned non-2xx response", {
        source: "serverAudio",
        status: response.status,
        statusText: response.statusText,
        endpoint,
        textLength: text.length,
        errorBodyPreview: errorBody.substring(0, 200),
      });

      throw new Error(errorMessage);
    }

    runtimeLog.info("Converting ElevenLabs response to buffer", {
      source: "serverAudio",
      contentLength: response.headers.get("content-length"),
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    runtimeLog.info("Speech buffer generated successfully", {
      source: "serverAudio",
      bufferSize: buffer.length,
      textLength: text.length,
      model: "eleven_v3",
      durationEstimate: `${(buffer.length / 16000).toFixed(2)}s @ 16kHz`,
    });

    return buffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : "unknown";

    runtimeLog.error("Speech buffer generation failed", {
      source: "serverAudio",
      error: errorMessage,
      errorType,
      textLength: text.length,
      textPreview: text.substring(0, 100),
    });

    console.error(`${LOG_PREFIX} Speech generation failed:`, error);
    return null;
  }
}
