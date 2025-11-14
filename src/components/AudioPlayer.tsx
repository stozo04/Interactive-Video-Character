import React, { useEffect, useRef } from 'react';

// Decodes a base64 string into a Uint8Array.
function decode(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Decodes raw PCM audio data into an AudioBuffer for playback.
async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}


interface AudioPlayerProps {
  src: string | null; // base64 encoded audio string
  onEnded: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, onEnded }) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    // Initialize AudioContext on first use, checking for browser compatibility.
    // Fix: Cast window to `any` to access vendor-prefixed `webkitAudioContext` for Safari compatibility.
    if (!audioContextRef.current && (window.AudioContext || (window as any).webkitAudioContext)) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const audioContext = audioContextRef.current;
    if (!audioContext) {
        console.warn("Web Audio API is not supported in this browser.");
        return;
    };

    const playAudio = async (base64Audio: string) => {
        try {
            // Stop any currently playing audio
            if (sourceNodeRef.current) {
                sourceNodeRef.current.stop();
                sourceNodeRef.current.disconnect();
            }
            
            const decodedBytes = decode(base64Audio);
            const audioBuffer = await decodeAudioData(decodedBytes, audioContext, 24000, 1);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            source.onended = () => {
                onEnded();
                sourceNodeRef.current = null;
            };

            source.start();
            sourceNodeRef.current = source;
        } catch (error) {
            console.error("Failed to play audio:", error);
        }
    };
    
    if (src) {
        // The AudioContext may be in a suspended state and needs to be resumed.
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => playAudio(src));
        } else {
            playAudio(src);
        }
    }

    return () => {
        // Cleanup: stop audio if component unmounts while playing
        if (sourceNodeRef.current) {
            try {
              sourceNodeRef.current.stop();
            } catch(e) {
              // This can throw an error if the source has already finished playing.
            }
        }
    };
  }, [src, onEnded]);

  return null; // This is a non-visual component
};

export default AudioPlayer;
