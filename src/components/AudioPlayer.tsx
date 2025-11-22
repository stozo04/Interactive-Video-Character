import React, { useEffect, useRef } from 'react';

interface AudioPlayerProps {
  src: string | null;
  onStart?: () => void;
  onEnded: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, onStart, onEnded }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (src && audioRef.current) {
      // Check if it's raw base64 (no data URI prefix) and fix it if necessary
      // Note: This is a fallback for legacy base64 strings.
      // Ideally, services should return full Data URIs or Blob URLs.
      let finalSrc = src;
      // Simple check: if it doesn't start with 'http', 'blob:', or 'data:', assume base64
      if (!src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:')) {
          finalSrc = `data:audio/mp3;base64,${src}`;
      }

      audioRef.current.src = finalSrc;
      audioRef.current.play().catch(e => console.error("Playback failed", e));
    }
  }, [src]);

  return (
    <audio
      ref={audioRef}
      onPlay={onStart}
      onEnded={onEnded}
      className="hidden"
    />
  );
};

export default AudioPlayer;
