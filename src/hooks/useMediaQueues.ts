import { useState, useCallback } from 'react';

export const useMediaQueues = () => {
  const [videoQueue, setVideoQueue] = useState<string[]>([]);
  const [audioQueue, setAudioQueue] = useState<string[]>([]);

  // Derived state (no useEffect needed!)
  const currentVideoSrc = videoQueue[0] || null;
  const nextVideoSrc = videoQueue[1] || null;
  
  const currentAudioSrc = audioQueue[0] || null;

  const playAction = useCallback((url: string, forceImmediate = false) => {
    setVideoQueue(prev => {
      let next: string[];

      if (forceImmediate) {
        // Replace the current video with the action and keep the rest
        const rest = prev.length > 0 ? prev.slice(1) : [];
        next = [url, ...rest];
      } else {
        const playing = prev[0];
        const rest = prev.slice(1);
        // Inject action immediately after current video (polite queue)
        next = playing ? [playing, url, ...rest] : [url, ...rest];
      }

      return next;
    });
  }, []);

  const handleVideoEnd = useCallback(() => {
    setVideoQueue(prev => prev.slice(1)); // Remove finished video
  }, []);

  const enqueueAudio = useCallback((audioData: string) => {
    setAudioQueue(prev => [...prev, audioData]);
  }, []);

  const handleAudioEnd = useCallback(() => {
    setAudioQueue(prev => prev.slice(1));
  }, []);

  return {
    currentVideoSrc,
    nextVideoSrc,
    currentAudioSrc,
    playAction,
    handleVideoEnd,
    enqueueAudio,
    handleAudioEnd,
    setVideoQueue, // exposed for initialization
    setAudioQueue, // exposed for clearing/resetting
    videoQueue,    // exposed for debugging/checks
    audioQueue
  };
};

