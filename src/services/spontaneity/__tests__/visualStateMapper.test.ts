/**
 * Visual State Mapper Tests
 *
 * Tests the mapping of internal emotional states to video manifests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  mapEmotionalStateToVideo,
  getVisualContext,
  classifyEnergyLevel,
  classifyEmotionalState,
  classifyMoodCategory,
  extractLocation,
  getLocationBackground,
} from '../visualStateMapper';
import type { MoodState, EmotionalMomentum } from '../../stateService';
import type { PresenceContext } from '../../presenceDirector';

// Mock Supabase client
vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
                  })),
                })),
              })),
              is: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
                  })),
                })),
              })),
            })),
          })),
        })),
      })),
    })),
  },
}));

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('classifyEnergyLevel', () => {
  it('should classify low energy correctly', () => {
    const moodState: MoodState = {
      dailyEnergy: 0.3,
      socialBattery: 0.2,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    expect(classifyEnergyLevel(moodState)).toBe('low');
  });

  it('should classify medium energy correctly', () => {
    const moodState: MoodState = {
      dailyEnergy: 0.6,
      socialBattery: 0.5,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    expect(classifyEnergyLevel(moodState)).toBe('medium');
  });

  it('should classify high energy correctly', () => {
    const moodState: MoodState = {
      dailyEnergy: 0.9,
      socialBattery: 0.8,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    expect(classifyEnergyLevel(moodState)).toBe('high');
  });

  it('should handle edge case at low threshold', () => {
    const moodState: MoodState = {
      dailyEnergy: 0.4,
      socialBattery: 0.4,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    expect(classifyEnergyLevel(moodState)).toBe('medium');
  });

  it('should handle edge case at high threshold', () => {
    const moodState: MoodState = {
      dailyEnergy: 0.7,
      socialBattery: 0.7,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    expect(classifyEnergyLevel(moodState)).toBe('high');
  });
});

describe('classifyEmotionalState', () => {
  it('should classify vulnerable state with active vulnerability exchange', () => {
    const momentum = {
      currentMoodLevel: 0.2,
      momentumDirection: 0,
      positiveInteractionStreak: 0,
      recentInteractionTones: [0],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
      vulnerabilityExchangeActive: true,
    } as EmotionalMomentum & { vulnerabilityExchangeActive: boolean };

    expect(classifyEmotionalState(momentum)).toBe('vulnerable');
  });

  it('should classify vulnerable state with low mood and negative momentum', () => {
    const momentum: EmotionalMomentum = {
      currentMoodLevel: -0.5,
      momentumDirection: -0.3,
      positiveInteractionStreak: 0,
      recentInteractionTones: [-0.5, -0.4],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    expect(classifyEmotionalState(momentum)).toBe('vulnerable');
  });

  it('should classify playful state with high mood and streak', () => {
    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.6,
      momentumDirection: 0.5,
      positiveInteractionStreak: 4,
      recentInteractionTones: [0.7, 0.6, 0.8, 0.5],
      genuineMomentDetected: true,
      lastGenuineMomentAt: Date.now(),
    };

    expect(classifyEmotionalState(momentum)).toBe('playful');
  });

  it('should classify flirty state with very high mood and strong momentum', () => {
    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.8,
      momentumDirection: 0.6,
      positiveInteractionStreak: 5,
      recentInteractionTones: [0.8, 0.9, 0.7],
      genuineMomentDetected: true,
      lastGenuineMomentAt: Date.now(),
    };

    expect(classifyEmotionalState(momentum)).toBe('flirty');
  });

  it('should classify open state with positive mood', () => {
    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.3,
      momentumDirection: 0.2,
      positiveInteractionStreak: 1,
      recentInteractionTones: [0.3],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    expect(classifyEmotionalState(momentum)).toBe('open');
  });

  it('should classify guarded state as default', () => {
    const momentum: EmotionalMomentum = {
      currentMoodLevel: -0.1,
      momentumDirection: 0,
      positiveInteractionStreak: 0,
      recentInteractionTones: [0],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    expect(classifyEmotionalState(momentum)).toBe('guarded');
  });
});

describe('classifyMoodCategory', () => {
  it('should classify excited mood', () => {
    expect(classifyMoodCategory(0.8)).toBe('excited');
  });

  it('should classify happy mood', () => {
    expect(classifyMoodCategory(0.5)).toBe('happy');
  });

  it('should classify neutral mood', () => {
    expect(classifyMoodCategory(0)).toBe('neutral');
  });

  it('should classify anxious mood', () => {
    expect(classifyMoodCategory(-0.4)).toBe('anxious');
  });

  it('should classify sad mood', () => {
    expect(classifyMoodCategory(-0.7)).toBe('sad');
  });
});

describe('extractLocation', () => {
  it('should extract cafe location from active loops', () => {
    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'location',
          content: 'Sitting at a cafe working on my laptop',
          salience: 0.8,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    expect(extractLocation(presenceContext)).toBe('cafe');
  });

  it('should extract beach location from active loops', () => {
    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'location',
          content: 'At the beach today, so nice!',
          salience: 0.8,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    expect(extractLocation(presenceContext)).toBe('beach');
  });

  it('should return undefined when no location is found', () => {
    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'weather',
          content: 'Talking about the weather',
          salience: 0.5,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    expect(extractLocation(presenceContext)).toBeUndefined();
  });

  it('should return undefined when presenceContext is missing', () => {
    expect(extractLocation(undefined)).toBeUndefined();
  });

  it('should handle coffee shop variant', () => {
    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'location',
          content: 'Just walked into the coffee shop',
          salience: 0.8,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    expect(extractLocation(presenceContext)).toBe('coffee shop');
  });
});

describe('getLocationBackground', () => {
  it('should return cafe background for cafe location', () => {
    expect(getLocationBackground('cafe')).toBe('bg_cafe');
  });

  it('should return beach background for beach location', () => {
    expect(getLocationBackground('beach')).toBe('bg_beach');
  });

  it('should return park background for park location', () => {
    expect(getLocationBackground('park')).toBe('bg_park');
  });

  it('should return default background for home/bedroom', () => {
    expect(getLocationBackground('home')).toBe('bg_warm');
    expect(getLocationBackground('bedroom')).toBe('bg_warm');
  });

  it('should return undefined for missing location', () => {
    expect(getLocationBackground(undefined)).toBeUndefined();
  });

  it('should handle case-insensitive matching', () => {
    expect(getLocationBackground('CAFE')).toBe('bg_cafe');
    expect(getLocationBackground('Beach')).toBe('bg_beach');
  });

  it('should handle whitespace', () => {
    expect(getLocationBackground('  cafe  ')).toBe('bg_cafe');
  });

  it('should return default for unknown locations', () => {
    expect(getLocationBackground('unknown_place')).toBe('bg_warm');
  });
});

// ============================================================================
// CORE FUNCTION TESTS
// ============================================================================

describe('mapEmotionalStateToVideo', () => {
  it('should return default mapping for guarded + low + neutral', async () => {
    const mapping = await mapEmotionalStateToVideo('guarded', 'low', 'neutral');

    expect(mapping).toBeDefined();
    expect(mapping?.emotionalState).toBe('guarded');
    expect(mapping?.energyLevel).toBe('low');
    expect(mapping?.moodCategory).toBe('neutral');
    expect(mapping?.idleVideoManifestId).toBe('idle_reserved_low');
    expect(mapping?.backgroundId).toBe('bg_dim');
    expect(mapping?.transitionStyle).toBe('subtle');
  });

  it('should return default mapping for open + medium + happy', async () => {
    const mapping = await mapEmotionalStateToVideo('open', 'medium', 'happy');

    expect(mapping).toBeDefined();
    expect(mapping?.emotionalState).toBe('open');
    expect(mapping?.idleVideoManifestId).toBe('idle_warm');
    expect(mapping?.backgroundId).toBe('bg_warm');
    expect(mapping?.transitionStyle).toBe('smooth');
  });

  it('should return default mapping for playful + high + happy', async () => {
    const mapping = await mapEmotionalStateToVideo('playful', 'high', 'happy');

    expect(mapping).toBeDefined();
    expect(mapping?.emotionalState).toBe('playful');
    expect(mapping?.idleVideoManifestId).toBe('idle_playful');
    expect(mapping?.backgroundId).toBe('bg_fun');
    expect(mapping?.transitionStyle).toBe('quick');
  });

  it('should override background when location is provided', async () => {
    const mapping = await mapEmotionalStateToVideo('open', 'medium', 'happy', 'cafe');

    expect(mapping).toBeDefined();
    expect(mapping?.backgroundId).toBe('bg_cafe');
  });

  it('should handle beach location override', async () => {
    const mapping = await mapEmotionalStateToVideo('playful', 'high', 'happy', 'beach');

    expect(mapping).toBeDefined();
    expect(mapping?.backgroundId).toBe('bg_beach');
  });

  it('should fallback to fuzzy match when exact match not found', async () => {
    // "calm" is not in default mappings, should fuzzy match
    const mapping = await mapEmotionalStateToVideo('open', 'medium', 'calm');

    expect(mapping).toBeDefined();
    expect(mapping?.emotionalState).toBe('open');
    expect(mapping?.energyLevel).toBe('medium');
    // Should use the other "open + medium" mapping
  });

  it('should handle completely unknown state with absolute fallback', async () => {
    const mapping = await mapEmotionalStateToVideo('unknown_state', 'low', 'unknown_mood');

    expect(mapping).toBeDefined();
    // Should fall back to safe default
    expect(mapping?.idleVideoManifestId).toBeDefined();
    expect(mapping?.backgroundId).toBeDefined();
  });
});

describe('getVisualContext', () => {
  it('should return complete visual context for happy state', async () => {
    const moodState: MoodState = {
      dailyEnergy: 0.7,
      socialBattery: 0.8,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0.5,
    };

    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.5,
      momentumDirection: 0.3,
      positiveInteractionStreak: 2,
      recentInteractionTones: [0.5, 0.6],
      genuineMomentDetected: true,
      lastGenuineMomentAt: Date.now(),
    };

    const context = await getVisualContext({ momentum, moodState });

    expect(context).toBeDefined();
    expect(context.videoManifestId).toBeDefined();
    expect(context.backgroundId).toBeDefined();
    expect(context.transitionStyle).toBeDefined();
  });

  it('should include location in visual context', async () => {
    const moodState: MoodState = {
      dailyEnergy: 0.6,
      socialBattery: 0.7,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.4,
      momentumDirection: 0.2,
      positiveInteractionStreak: 1,
      recentInteractionTones: [0.4],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'location',
          content: 'At the beach enjoying the sun',
          salience: 0.9,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    const context = await getVisualContext({ momentum, moodState, presenceContext });

    expect(context).toBeDefined();
    expect(context.backgroundId).toBe('bg_beach');
  });

  it('should handle vulnerable state with low energy', async () => {
    const moodState: MoodState = {
      dailyEnergy: 0.3,
      socialBattery: 0.2,
      internalProcessing: true,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: -0.5,
    };

    const momentum = {
      currentMoodLevel: -0.5,
      momentumDirection: -0.3,
      positiveInteractionStreak: 0,
      recentInteractionTones: [-0.5, -0.4],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
      vulnerabilityExchangeActive: true,
    } as EmotionalMomentum & { vulnerabilityExchangeActive: boolean };

    const context = await getVisualContext({ momentum, moodState });

    expect(context).toBeDefined();
    expect(context.videoManifestId).toContain('soft');
    expect(context.backgroundId).toBe('bg_dim');
    expect(context.transitionStyle).toBe('smooth');
  });

  it('should handle playful state with high energy', async () => {
    const moodState: MoodState = {
      dailyEnergy: 0.9,
      socialBattery: 0.85,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0.8,
    };

    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.7,
      momentumDirection: 0.5,
      positiveInteractionStreak: 5,
      recentInteractionTones: [0.8, 0.7, 0.9],
      genuineMomentDetected: true,
      lastGenuineMomentAt: Date.now(),
    };

    const context = await getVisualContext({ momentum, moodState });

    expect(context).toBeDefined();
    expect(context.videoManifestId).toContain('playful');
    expect(context.transitionStyle).toBe('quick');
  });

  it('should provide safe fallback when state is unclear', async () => {
    const moodState: MoodState = {
      dailyEnergy: 0,
      socialBattery: 0,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0,
      momentumDirection: 0,
      positiveInteractionStreak: 0,
      recentInteractionTones: [],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    const context = await getVisualContext({ momentum, moodState });

    // Should still return valid context
    expect(context).toBeDefined();
    expect(context.videoManifestId).toBeDefined();
    expect(context.backgroundId).toBeDefined();
    expect(context.transitionStyle).toBeDefined();
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Visual State Mapper Integration', () => {
  it('should handle full state-to-visual pipeline', async () => {
    // Simulate a happy conversation at a cafe
    const moodState: MoodState = {
      dailyEnergy: 0.7,
      socialBattery: 0.8,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0.6,
    };

    const momentum: EmotionalMomentum = {
      currentMoodLevel: 0.6,
      momentumDirection: 0.4,
      positiveInteractionStreak: 3,
      recentInteractionTones: [0.6, 0.7, 0.5],
      genuineMomentDetected: true,
      lastGenuineMomentAt: Date.now() - 60000,
    };

    const presenceContext: PresenceContext = {
      activeLoops: [
        {
          id: '1',
          topic: 'current_activity',
          content: 'Working on my laptop at a coffee shop',
          salience: 0.8,
          loopType: 'question',
          createdAt: new Date(),
          lastMentioned: new Date(),
        },
      ],
      topLoop: null,
      opinions: [],
      promptSection: '',
    };

    const context = await getVisualContext({ momentum, moodState, presenceContext });

    // Should be playful mood at a cafe
    expect(context.videoManifestId).toBeDefined();
    expect(context.backgroundId).toBe('bg_cafe');
    expect(context.transitionStyle).toBe('quick');
  });

  it('should handle emotional state transitions', async () => {
    // Start guarded
    let moodState: MoodState = {
      dailyEnergy: 0.5,
      socialBattery: 0.6,
      internalProcessing: false,
      calculatedAt: Date.now(),
      dailySeed: 20251226,
      lastInteractionAt: Date.now(),
      lastInteractionTone: 0,
    };

    let momentum: EmotionalMomentum = {
      currentMoodLevel: -0.1,
      momentumDirection: 0,
      positiveInteractionStreak: 0,
      recentInteractionTones: [0],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    const guardedContext = await getVisualContext({ momentum, moodState });
    expect(guardedContext.videoManifestId).toContain('reserved');

    // Transition to open
    momentum = {
      currentMoodLevel: 0.3,
      momentumDirection: 0.2,
      positiveInteractionStreak: 2,
      recentInteractionTones: [0.3, 0.4],
      genuineMomentDetected: false,
      lastGenuineMomentAt: null,
    };

    const openContext = await getVisualContext({ momentum, moodState });
    expect(openContext.videoManifestId).toContain('warm');
    expect(openContext.transitionStyle).toBe('smooth');
  });
});
