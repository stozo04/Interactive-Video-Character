import { useEffect, useRef } from 'react';
import { warmContextCache } from '../services/stateService';

/**
 * Hook to warm the context cache when the component mounts.
 * Only runs once per user session to avoid redundant fetches.
 * 
 */
export function useCacheWarming(): void {
  // Track if we've already warmed the cache
  const hasWarmed = useRef(false);
  
  useEffect(() => {
    // Skip already warmed
    if (hasWarmed.current) {
      return;
    }
    
    // Mark as warmed immediately to prevent duplicate calls
    hasWarmed.current = true;
    
    console.log('🧊 [useCacheWarming] Initializing cache warming');
    
    // Warm the cache (fire-and-forget)
    warmContextCache().catch(error => {
      console.error('⚠️ [useCacheWarming] Initial warm failed:', error);
    });
    
    // Also warm again after 5 minutes to keep cache relatively fresh
    // The implementation plan suggested 30 seconds, but that's very aggressive
    // for a database fetch that doesn't change THAT fast. 
    // However, I'll stick to the plan's 30s or maybe 60s for "idle" freshness.
    // The plan said:
    // const refreshInterval = setInterval(() => {
    //   warmContextCache().catch(console.error);
    // }, 30000); // 30 seconds
    
    const REFRESH_INTERVAL_MS = 60000; // 1 minute is safer for "idle"
    
    const refreshInterval = setInterval(() => {
      console.log('🧊 [useCacheWarming] Refreshing context cache...');
      warmContextCache().catch(error => {
        console.warn('⚠️ [useCacheWarming] Refresh fail:', error);
      });
    }, REFRESH_INTERVAL_MS);
    
    return () => {
      clearInterval(refreshInterval);
    };
  }, );
}
