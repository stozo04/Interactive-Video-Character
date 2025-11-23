import React, { useEffect, useRef } from 'react';

interface AudioPlayerProps {
  src: string | null;
  onStart?: () => void;
  onEnded: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, onStart, onEnded }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Detect type
  const isUrl = src ? (src.startsWith('blob:') || src.startsWith('http')) : false;

  useEffect(() => {
    // Handle Base64/Legacy manually (WebAudio API style logic)
    if (src && !isUrl && audioRef.current) {
      // Check if it's raw base64 (no data URI prefix) and fix it if necessary
      // Note: This is a fallback for legacy base64 strings.
      let finalSrc = src;
      // Simple check: if it doesn't start with 'http', 'blob:', or 'data:', assume base64
      if (!src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:')) {
          finalSrc = `data:audio/mp3;base64,${src}`;
      }

      audioRef.current.src = finalSrc;
      audioRef.current.play()
        .then(() => {
            if (onStart) onStart();
        })
        .catch(e => console.error("Playback failed", e));
    }
  }, [src, isUrl, onStart]);

  // If URL: Render a standard HTML5 <audio autoPlay /> tag. 
  // This is faster because the browser handles buffering/streaming automatically.
  if (isUrl) {
    return (
      <audio 
        src={src || undefined} 
        autoPlay 
        onPlay={onStart}
        onEnded={onEnded} 
        onError={(e) => console.error("Audio error", e)}
        className="hidden"
      />
    );
  }

  // If Base64: Keep the existing logic
  return (
    <audio
      ref={audioRef}
      onEnded={onEnded}
      className="hidden"
    />
  );
};

export default AudioPlayer;
