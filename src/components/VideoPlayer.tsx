import React, { useRef, useEffect, useState } from 'react';

interface VideoPlayerProps {
  src: string | null;
  onEnded: () => void;
  loop: boolean;
  muted?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, onEnded, loop, muted = false }) => {
  const player0Ref = useRef<HTMLVideoElement>(null);
  const player1Ref = useRef<HTMLVideoElement>(null);
  
  const [activePlayer, setActivePlayer] = useState<0 | 1>(0);
  const [hasStarted, setHasStarted] = useState(false);
  const loadingRef = useRef(false);

  // Handle initial load and subsequent preloads
  useEffect(() => {
    if (!src) return;
    
    // Prevent multiple simultaneous loads
    if (loadingRef.current) {
      console.log('⏳ Load already in progress, skipping...');
      return;
    }

    const performLoad = async () => {
      loadingRef.current = true;
      
      try {
        // If we haven't started yet, we want to start playing immediately.
        if (!hasStarted) {
          const targetPlayerIdx = activePlayer === 0 ? 1 : 0;
          const targetRef = targetPlayerIdx === 0 ? player0Ref : player1Ref;
          const targetVideo = targetRef.current;

          if (targetVideo) {
            console.log('🎬 Initial video load');
            targetVideo.src = src;
            
            // Wait for the video to be ready
            await new Promise<void>((resolve) => {
              const handleCanPlay = () => {
                targetVideo.removeEventListener('canplay', handleCanPlay);
                resolve();
              };
              targetVideo.addEventListener('canplay', handleCanPlay);
              targetVideo.load();
            });
            
            try {
              await targetVideo.play();
              setActivePlayer(targetPlayerIdx);
              setHasStarted(true);
              console.log('✅ Initial video playing');
            } catch (e) {
              // Autoplay might be blocked - this is okay, user can click to start
              console.warn("Autoplay blocked (expected):", e);
              setActivePlayer(targetPlayerIdx);
              setHasStarted(true);
            }
          }
        } else {
          // Normal operation: Preload into inactive player
          const inactivePlayerIdx = activePlayer === 0 ? 1 : 0;
          const inactiveRef = inactivePlayerIdx === 0 ? player0Ref : player1Ref;
          const inactiveVideo = inactiveRef.current;

          if (inactiveVideo) {
            console.log(`📦 Preloading next video into player ${inactivePlayerIdx}`);
            
            // Pause any ongoing playback on inactive player
            inactiveVideo.pause();
            
            // Set new source and preload
            inactiveVideo.src = src;
            inactiveVideo.load();
          }
        }
      } finally {
        loadingRef.current = false;
      }
    };

    performLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]); // Only react to src changes

  // Handle video ending (The Swap)
  const handleVideoEnded = async () => {
    console.log('🔄 Video ended, swapping to next...');
    
    // Identify current and next players
    const currentPlayerIdx = activePlayer;
    const nextPlayerIdx = activePlayer === 0 ? 1 : 0;
    const currentRef = currentPlayerIdx === 0 ? player0Ref : player1Ref;
    const nextRef = nextPlayerIdx === 0 ? player0Ref : player1Ref;
    const currentVideo = currentRef.current;
    const nextVideo = nextRef.current;

    if (nextVideo && nextVideo.src) {
      try {
        // Check if video is ready to play
        if (nextVideo.readyState >= 2) { // HAVE_CURRENT_DATA or better
          // Swap visibility FIRST (instant)
          setActivePlayer(nextPlayerIdx);
          
          // Start playing immediately
          nextVideo.currentTime = 0; // Ensure we start at beginning
          await nextVideo.play();
          
          // Pause and reset the old video
          if (currentVideo) {
            currentVideo.pause();
            currentVideo.currentTime = 0;
          }
          
          console.log(`✅ Swapped to player ${nextPlayerIdx}`);
        } else {
          // If not ready, wait for it
          console.log('⏳ Waiting for next video to be ready...');
          await new Promise<void>((resolve) => {
            const handleCanPlay = () => {
              nextVideo.removeEventListener('canplay', handleCanPlay);
              resolve();
            };
            nextVideo.addEventListener('canplay', handleCanPlay);
          });
          
          // Swap visibility FIRST (instant)
          setActivePlayer(nextPlayerIdx);
          
          // Start playing immediately
          nextVideo.currentTime = 0;
          await nextVideo.play();
          
          // Pause and reset the old video
          if (currentVideo) {
            currentVideo.pause();
            currentVideo.currentTime = 0;
          }
          
          console.log(`✅ Swapped to player ${nextPlayerIdx} (after waiting)`);
        }
        
        // Notify parent that we finished and started the next video
        onEnded();
      } catch (e) {
        console.error("Failed to swap video:", e);
        // Try to recover by notifying parent anyway
        onEnded();
      }
    } else {
      console.warn('⚠️ Next video not ready, notifying parent...');
      onEnded();
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
      
      {!src && !hasStarted && (
        <div className="text-gray-500 z-20">No video available</div>
      )}
    </div>
  );
};

export default VideoPlayer;
