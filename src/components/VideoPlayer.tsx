import React, { useRef, useEffect, useState } from 'react';

interface VideoPlayerProps {
  currentSrc: string | null;
  nextSrc: string | null;
  onVideoFinished: () => void;
  loop: boolean;
  muted?: boolean;
}

/**
 * Double-Buffered Video Player for Seamless Transitions
 * ======================================================
 * 
 * Architecture:
 * - Two <video> elements (player0, player1) overlaid using visibility CSS
 * - activePlayer (0 or 1) determines which player is visible
 * - While one plays, the other preloads the next video
 * 
 * Flow:
 * 1. Parent passes currentSrc (playing now) and nextSrc (preload this)
 * 2. Active player displays currentSrc, inactive player loads nextSrc
 * 3. On video end: swap visibility instantly, start playback, notify parent
 * 4. Parent shifts queue, new nextSrc arrives, cycle repeats
 * 
 * Key Benefits:
 * - Zero black frames between videos (instant visibility swap)
 * - No network latency (next video already buffered)
 * - No complex waiting logic (parent guarantees nextSrc is ready)
 */
const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  currentSrc, 
  nextSrc, 
  onVideoFinished, 
  loop, 
  muted = false 
}) => {
  const player0Ref = useRef<HTMLVideoElement>(null);
  const player1Ref = useRef<HTMLVideoElement>(null);
  
  const [activePlayer, setActivePlayer] = useState<0 | 1>(0);
  const [hasStarted, setHasStarted] = useState(false);

  // Load and play videos based on currentSrc and nextSrc
  useEffect(() => {
    if (!currentSrc) return;

    const activeRef = activePlayer === 0 ? player0Ref : player1Ref;
    const inactiveRef = activePlayer === 0 ? player1Ref : player0Ref;
    const activeVideo = activeRef.current;
    const inactiveVideo = inactiveRef.current;

    // Handle initial load
    if (!hasStarted && activeVideo) {
      if (activeVideo.src !== currentSrc) {
        activeVideo.src = currentSrc;
        activeVideo.load();
        
        // Try to autoplay
        activeVideo.play().then(() => {
          setHasStarted(true);
        }).catch((e) => {
          // Autoplay blocked - user needs to interact first
          console.warn("Autoplay blocked (expected):", e);
          setHasStarted(true);
        });
      }
    } else if (hasStarted && activeVideo) {
      // Ensure active player has correct source
      if (activeVideo.src !== currentSrc && currentSrc) {
        const fullCurrentSrc = currentSrc.startsWith('blob:') ? currentSrc : new URL(currentSrc, window.location.origin).href;
        if (activeVideo.src !== fullCurrentSrc) {
          activeVideo.src = currentSrc;
          activeVideo.load();
          activeVideo.play().catch(e => console.warn("Play failed:", e));
        }
      }
    }

    // Preload next video into inactive player
    if (nextSrc && inactiveVideo) {
      const fullNextSrc = nextSrc.startsWith('blob:') ? nextSrc : new URL(nextSrc, window.location.origin).href;
      if (inactiveVideo.src !== fullNextSrc) {
        inactiveVideo.pause();
        inactiveVideo.src = nextSrc;
        inactiveVideo.load();
      }
    }
  }, [currentSrc, nextSrc, activePlayer, hasStarted]);

  // Handle video ending - seamless swap to preloaded next video
  const handleVideoEnded = async () => {
    // Notify parent to shift the queue
    onVideoFinished();
    
    // Only swap if we have a next video preloaded
    if (!nextSrc) {
      // No next video - this shouldn't happen with proper queue management
      return;
    }

    const currentPlayerIdx = activePlayer;
    const nextPlayerIdx = activePlayer === 0 ? 1 : 0;
    const currentRef = currentPlayerIdx === 0 ? player0Ref : player1Ref;
    const nextRef = nextPlayerIdx === 0 ? player0Ref : player1Ref;
    const currentVideo = currentRef.current;
    const nextVideo = nextRef.current;

    // Guard against missing/invalid sources
    if (!nextVideo || !nextVideo.src) {
      return;
    }
    const hasBufferedSource = nextVideo.readyState > 0;

    try {
      // Swap visibility instantly
      setActivePlayer(nextPlayerIdx);
      
      // Start playing the preloaded video
      nextVideo.currentTime = 0;
      if (hasBufferedSource) {
        await nextVideo.play();
      } else {
        // If it wasn't buffered, set the src again and try once
        nextVideo.src = nextSrc;
        nextVideo.load();
        await nextVideo.play();
      }
      
      // Clean up the old player
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.currentTime = 0;
      }
    } catch (e) {
      console.error("Failed to swap video:", e);
      // Fallback: try to keep current video playing
      if (currentVideo) {
        currentVideo.currentTime = 0;
        currentVideo.play().catch(err => console.error('Fallback failed:', err));
      }
    }
  };

  // Sync props (muted and loop)
  useEffect(() => {
    if (player0Ref.current) {
      player0Ref.current.muted = muted;
      player0Ref.current.loop = loop;
    }
    if (player1Ref.current) {
      player1Ref.current.muted = muted;
      player1Ref.current.loop = loop;
    }
  }, [muted, loop]);

  // Helper to get class names
  const getPlayerClass = (playerIdx: 0 | 1) => {
    const isActive = activePlayer === playerIdx;
    // Use visibility instead of opacity for instant swapping with no transition
    return `absolute top-0 left-0 w-full h-full object-contain ${
      isActive ? 'visible z-10' : 'invisible z-0'
    }`;
  };

  return (
    <div className="relative w-full aspect-square max-w-full max-h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
      <video
        ref={player0Ref}
        className={getPlayerClass(0)}
        muted={muted}
        playsInline
        loop={loop}
        onEnded={handleVideoEnded}
        preload="auto"
      />
      <video
        ref={player1Ref}
        className={getPlayerClass(1)}
        muted={muted}
        playsInline
        loop={loop}
        onEnded={handleVideoEnded}
        preload="auto"
      />
      
      {!currentSrc && !hasStarted && (
        <div className="text-gray-500 z-20">No video available</div>
      )}
    </div>
  );
};

export default VideoPlayer;
