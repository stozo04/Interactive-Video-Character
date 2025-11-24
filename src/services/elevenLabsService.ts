const API_KEY = import.meta.env.VITE_ELEVEN_LABS_API_KEY;
const VOICE_ID = import.meta.env.VITE_ElEVEN_LABS_VOICE_ID;

export const generateSpeech = async (text: string): Promise<string> => {
  if (!API_KEY || !VOICE_ID) {
    console.warn("ElevenLabs keys missing!");
    return "";
  }

  try {
    // We use the 'stream' endpoint for lower latency
    // optimize_streaming_latency=4: This is the max speed setting. 
    // It might slightly degrade quality, but for a real-time chat, speed > quality. You can dial this down to 3 if it sounds too robotic.
    // Models: 
    // eleven_v3: Human-like and expressive speech generation, 
    // eleven_ttv_v3: Human-like and expressive voice design model (Text to Voice)
    // eleven_flash_v2_5: Ultra-fast model optimized for real-time use (~75ms†)
    // eleven_turbo_v2_5: High quality, low-latency model with a good balance of quality and speed (~250ms-300ms)
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_v3"
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API Error: ${response.statusText}`);
    }

    // Convert the response stream into a Blob (file-like object)
    const blob = await response.blob();
    
    // Create a temporary URL pointing to this Blob so our <audio> tag can play it
    return URL.createObjectURL(blob);
    
  } catch (error) {
    console.error("Speech generation failed:", error);
    return "";
  }
};
