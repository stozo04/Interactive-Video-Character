import React, { useRef, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface VideoPlayerProps {
  src: string | null;
  onEnded: () => void;
  loop: boolean;
  muted?: boolean; // Default: false (all videos have audio)
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, onEnded, loop, muted = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // This effect handles setting the video source and the ended event listener.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // When the src changes, load the new video
    if (src && videoElement.src !== src) {
        videoElement.src = src;
        videoElement.load();
        videoElement.play().catch(() => {
            // Autoplay is often blocked by browsers. This is expected.
            // The `muted` prop helps, but isn't a guarantee.
        });
    }

    // Attach the 'ended' event listener.
    // It will only be called for non-looping videos.
    const handleEnded = () => onEnded();
    videoElement.addEventListener('ended', handleEnded);
    
    // Cleanup function to remove the event listener.
    return () => {
      videoElement.removeEventListener('ended', handleEnded);
    };
  }, [src, onEnded]);
  
  // This effect ensures the video's loop attribute is always in sync with the prop.
  useEffect(() => {
    if(videoRef.current) {
      videoRef.current.loop = loop;
    }
  }, [loop]);

  // This effect ensures the video's muted attribute is always in sync with the prop.
  useEffect(() => {
    if(videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  return (
    <div className="relative w-full aspect-square max-w-full max-h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
      
      {src ? (
          <video
            ref={videoRef}
            muted={muted}
            playsInline
            loop={loop}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-gray-500">No video available</div>
      )}
    </div>
  );
};

export default VideoPlayer;
