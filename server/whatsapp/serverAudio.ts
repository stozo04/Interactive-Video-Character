/**
 * Server-side ElevenLabs TTS
 *
 * Same API call as src/services/elevenLabsService.ts but returns a Buffer
 * instead of a blob URL (which only makes sense in the browser).
 */

const LOG_PREFIX = "[ServerAudio]";

export async function generateSpeechBuffer(
  text: string
): Promise<Buffer | null> {
  const apiKey = process.env.VITE_ELEVEN_LABS_API_KEY;
  const voiceId = process.env.VITE_ELEVEN_LABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.warn(`${LOG_PREFIX} ElevenLabs keys missing, skipping TTS`);
    return null;
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_v3",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API Error: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`${LOG_PREFIX} Speech generation failed:`, error);
    return null;
  }
}
