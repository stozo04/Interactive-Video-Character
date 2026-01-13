/**
 * Background Jobs Service
 *
 * Handles periodic background tasks like checking for ready promises,
 * cleaning up old data, and keeping the state fresh.
 */

import { checkAndFulfillPromises, cleanupOldPromises } from './promiseService';

let promiseCheckerInterval: ReturnType<typeof setInterval> | null = null;
let promiseCheckerTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the background promise checker.
 * This should be called once on app mount.
 *
 * It checks for ready promises every 5 minutes.
 */
export function startPromiseChecker() {
  if (promiseCheckerInterval || promiseCheckerTimeout) {
    console.log('[Background] Promise checker already running');
    return promiseCheckerInterval;
  }

  // 1. Initial check on startup (handles promises that became ready while offline)
  console.log('[Background] Starting promise checker...');
  
  // Wrapped in a small timeout to ensure app is fully ready
  promiseCheckerTimeout = setTimeout(async () => {
    try {
      const fulfilledCount = await checkAndFulfillPromises();
      if (fulfilledCount > 0) {
        console.log(`[Background] Initial check: Fulfilled ${fulfilledCount} promise(s)`);
      }
      
      // Also run a one-time cleanup on startup
      await cleanupOldPromises();
    } catch (error) {
      console.error('[Background] Error in initial promise check:', error);
    }
  }, 2000);

  // 2. Set up interval for every 5 minutes
  const CHK_INTERVAL_MS = 5 * 60 * 1000;
  
  const intervalId = setInterval(async () => {
    try {
      const fulfilledCount = await checkAndFulfillPromises();
      if (fulfilledCount > 0) {
        console.log(`[Background] Interval check: Fulfilled ${fulfilledCount} promise(s)`);
      }
    } catch (error) {
      console.error('[Background] Error in interval promise check:', error);
    }
  }, CHK_INTERVAL_MS);
  promiseCheckerInterval = intervalId;

  // Return the interval ID so it can be cleared if needed
  return intervalId;
}

export function stopPromiseChecker(): void {
  if (promiseCheckerTimeout) {
    clearTimeout(promiseCheckerTimeout);
    promiseCheckerTimeout = null;
  }

  if (promiseCheckerInterval) {
    clearInterval(promiseCheckerInterval);
    promiseCheckerInterval = null;
  }
}

/**
 * Run a manual check for ready promises.
 * Useful for the login flow or high-priority events.
 */
export async function runManualPromiseCheck(): Promise<number> {
  try {
    const fulfilledCount = await checkAndFulfillPromises();
    return fulfilledCount;
  } catch (error) {
    console.error('[Background] Manual promise check failed:', error);
    return 0;
  }
}
