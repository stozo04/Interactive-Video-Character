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
          model_id: "eleven_turbo_v2_5", // Turbo is faster/cheaper
          voice_settings: {
            stability: 0.5, // Lower stability = faster generation
            similarity_boost: 0.7,
          }
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
