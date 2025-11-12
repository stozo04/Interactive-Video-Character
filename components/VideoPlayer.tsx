
import React, { useRef, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface VideoPlayerProps {
  src: string | null;
  onEnded: () => void;
  isLoading: boolean;
  isActionVideo: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, onEnded, isLoading, isActionVideo }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleEnded = () => {
      if (isActionVideo) {
        onEnded();
      }
    };

    videoElement.addEventListener('ended', handleEnded);

    return () => {
      videoElement.removeEventListener('ended', handleEnded);
    };
  }, [isActionVideo, onEnded]);

  return (
    <div className="relative w-full aspect-square max-w-full max-h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
      {isLoading && (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
          <LoadingSpinner />
          <p className="mt-2 text-gray-300">Generating response...</p>
        </div>
      )}
      {src ? (
        <video
          key={src} // Force re-mount when src changes to ensure autoplay works
          ref={videoRef}
          src={src}
          autoPlay
          muted
          playsInline
          loop={!isActionVideo}
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="text-gray-500">Video will appear here</div>
      )}
    </div>
  );
};

export default VideoPlayer;
