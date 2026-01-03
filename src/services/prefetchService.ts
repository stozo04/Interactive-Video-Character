import { getSoulLayerContextAsync } from './promptUtils';
import { formatCharacterFactsForPrompt } from './characterFactsService';

export interface PrefetchedContext {
  soulContext: any;
  characterFacts: string;
  timestamp: number;
}

let prefetchCache: PrefetchedContext | null = null;
const PREFETCH_TTL = 60000; // 60 seconds

/**
 * Pre-fetches context data and stores it in a global cache.
 * 
 */
export async function prefetchOnIdle(): Promise<void> {
  console.log('🚀 [PrefetchService] Pre-fetching context on idle...');
  
  try {
    const [soulContext, characterFacts] = await Promise.all([
      getSoulLayerContextAsync(),
      formatCharacterFactsForPrompt()
    ]);
    
    prefetchCache = {
      soulContext,
      characterFacts,
      timestamp: Date.now()
    };
    
    console.log('✅ [PrefetchService] Idle pre-fetch complete');
  } catch (error) {
    console.warn('⚠️ [PrefetchService] Idle pre-fetch failed:', error);
  }
}

/**
 * Returns the cached pre-fetched context if it's still valid.
 * 
 * @returns PrefetchedContext or null
 */
export function getPrefetchedContext(): PrefetchedContext | null {
  if (!prefetchCache) return null;
  
  const age = Date.now() - prefetchCache.timestamp;
  if (age > PREFETCH_TTL) {
    console.log('📋 [PrefetchService] Cache expired');
    prefetchCache = null;
    return null;
  }
  
  console.log('📋 [PrefetchService] Cache hit! Age:', Math.round(age / 1000), 's');
  return prefetchCache;
}

/**
 * Clears the pre-fetch cache.
 */
export function clearPrefetchCache(): void {
  prefetchCache = null;
}
