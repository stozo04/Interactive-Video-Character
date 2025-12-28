// src/services/imageGeneration/__tests__/referenceSelector.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectReferenceImage, getCurrentSeason, getTimeOfDay } from '../referenceSelector';
import type { ReferenceSelectionContext } from '../types';

// Mock the base64 reference images module
vi.mock('../../../utils/base64ReferencedImages', () => ({
  REFERENCE_IMAGE_REGISTRY: [
    {
      id: 'curly_casual',
      fileName: 'curly_hair_casual.txt',
      hairstyle: 'curly',
      outfitStyle: 'casual',
      baseFrequency: 0.4,
      suitableScenes: ['coffee', 'cafe', 'home', 'park'],
      unsuitableScenes: ['gym', 'pool'],
      suitableSeasons: ['fall', 'winter', 'spring', 'summer'],
      moodAffinity: { playful: 0.7, confident: 0.6, relaxed: 0.8, excited: 0.7, flirty: 0.6 },
      timeOfDay: { morning: 0.9, afternoon: 0.8, evening: 0.6, night: 0.5 },
    },
    {
      id: 'straight_dressed_up',
      fileName: 'straight_hair_dressed_up.txt',
      hairstyle: 'straight',
      outfitStyle: 'dressed_up',
      baseFrequency: 0.1,
      suitableScenes: ['restaurant', 'concert', 'sunset'],
      unsuitableScenes: ['gym', 'bedroom'],
      suitableSeasons: ['fall', 'winter', 'spring', 'summer'],
      moodAffinity: { playful: 0.4, confident: 0.95, relaxed: 0.3, excited: 0.9, flirty: 0.95 },
      timeOfDay: { morning: 0.1, afternoon: 0.4, evening: 0.95, night: 0.95 },
    },
    {
      id: 'messy_bun_casual',
      fileName: 'curly_hair_messy_bun_casual.txt',
      hairstyle: 'messy_bun',
      outfitStyle: 'casual',
      baseFrequency: 0.2,
      suitableScenes: ['gym', 'home', 'bedroom', 'kitchen'],
      unsuitableScenes: ['restaurant', 'concert'],
      suitableSeasons: ['spring', 'summer', 'fall'],
      moodAffinity: { playful: 0.6, confident: 0.5, relaxed: 0.9, excited: 0.5, flirty: 0.4 },
      timeOfDay: { morning: 0.9, afternoon: 0.7, evening: 0.6, night: 0.7 },
    },
  ],
  getReferenceImageContent: (id: string) => `mock-base64-content-for-${id}`,
}));

describe('referenceSelector', () => {
  describe('getCurrentSeason', () => {
    it('should return winter for December, January, February', () => {
      // Mock Date to return December
      vi.setSystemTime(new Date('2025-12-15'));
      expect(getCurrentSeason()).toBe('winter');

      vi.setSystemTime(new Date('2025-01-15'));
      expect(getCurrentSeason()).toBe('winter');

      vi.setSystemTime(new Date('2025-02-15'));
      expect(getCurrentSeason()).toBe('winter');
    });

    it('should return spring for March, April, May', () => {
      vi.setSystemTime(new Date('2025-03-15'));
      expect(getCurrentSeason()).toBe('spring');

      vi.setSystemTime(new Date('2025-04-15'));
      expect(getCurrentSeason()).toBe('spring');

      vi.setSystemTime(new Date('2025-05-15'));
      expect(getCurrentSeason()).toBe('spring');
    });

    it('should return summer for June, July, August', () => {
      vi.setSystemTime(new Date('2025-06-15'));
      expect(getCurrentSeason()).toBe('summer');

      vi.setSystemTime(new Date('2025-07-15'));
      expect(getCurrentSeason()).toBe('summer');

      vi.setSystemTime(new Date('2025-08-15'));
      expect(getCurrentSeason()).toBe('summer');
    });

    it('should return fall for September, October, November', () => {
      vi.setSystemTime(new Date('2025-09-15'));
      expect(getCurrentSeason()).toBe('fall');

      vi.setSystemTime(new Date('2025-10-15'));
      expect(getCurrentSeason()).toBe('fall');

      vi.setSystemTime(new Date('2025-11-15'));
      expect(getCurrentSeason()).toBe('fall');
    });
  });

  describe('getTimeOfDay', () => {
    it('should return morning for 5am-11:59am', () => {
      vi.setSystemTime(new Date('2025-12-27T05:00:00'));
      expect(getTimeOfDay()).toBe('morning');

      vi.setSystemTime(new Date('2025-12-27T11:59:00'));
      expect(getTimeOfDay()).toBe('morning');
    });

    it('should return afternoon for 12pm-4:59pm', () => {
      vi.setSystemTime(new Date('2025-12-27T12:00:00'));
      expect(getTimeOfDay()).toBe('afternoon');

      vi.setSystemTime(new Date('2025-12-27T16:59:00'));
      expect(getTimeOfDay()).toBe('afternoon');
    });

    it('should return evening for 5pm-8:59pm', () => {
      vi.setSystemTime(new Date('2025-12-27T17:00:00'));
      expect(getTimeOfDay()).toBe('evening');

      vi.setSystemTime(new Date('2025-12-27T20:59:00'));
      expect(getTimeOfDay()).toBe('evening');
    });

    it('should return night for 9pm-4:59am', () => {
      vi.setSystemTime(new Date('2025-12-27T21:00:00'));
      expect(getTimeOfDay()).toBe('night');

      vi.setSystemTime(new Date('2025-12-27T04:59:00'));
      expect(getTimeOfDay()).toBe('night');
    });
  });

  describe('selectReferenceImage', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date('2025-12-27T10:00:00')); // Winter morning
    });

    it('should use locked current look when available and not expired', () => {
      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        mood: 'confident',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: {
          hairstyle: 'curly',
          referenceImageId: 'curly_casual',
          lockedAt: new Date('2025-12-27T08:00:00'),
          expiresAt: new Date('2025-12-28T08:00:00'), // Not expired
          lockReason: 'session_start',
          isCurrentLook: true,
        },
        temporalContext: {
          isOldPhoto: false,
          temporalPhrases: [],
        },
      };

      const result = selectReferenceImage(context);

      expect(result.referenceId).toBe('curly_casual');
      expect(result.reasoning).toContain('Using locked current look: curly');
    });

    it('should bypass locked look for old photos', () => {
      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        mood: 'confident',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: {
          hairstyle: 'curly',
          referenceImageId: 'curly_casual',
          lockedAt: new Date('2025-12-27T08:00:00'),
          expiresAt: new Date('2025-12-28T08:00:00'),
          lockReason: 'session_start',
          isCurrentLook: true,
        },
        temporalContext: {
          isOldPhoto: true,
          referenceDate: new Date('2025-12-20'),
          temporalPhrases: ['last week'],
        },
      };

      const result = selectReferenceImage(context);

      // Should NOT use locked look, should select based on scene/mood
      expect(result.reasoning.some(r => r.includes('OLD PHOTO DETECTED'))).toBe(true);
      expect(result.reasoning.some(r => r.includes('Allowing different hairstyle'))).toBe(true);
    });

    it('should prefer suitable scenes (+30 points)', () => {
      const context: ReferenceSelectionContext = {
        scene: 'gym',
        currentSeason: 'summer',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // messy_bun_casual has gym in suitableScenes
      expect(result.referenceId).toBe('messy_bun_casual');
      expect(result.reasoning.some(r => r.includes('+30 scene match'))).toBe(true);
    });

    it('should penalize unsuitable scenes (-50 points)', () => {
      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // messy_bun_casual has restaurant in unsuitableScenes, should not be selected
      expect(result.referenceId).not.toBe('messy_bun_casual');
      // straight_dressed_up should win (restaurant in suitableScenes)
      expect(result.referenceId).toBe('straight_dressed_up');
    });

    it('should apply mood affinity scoring', () => {
      const context: ReferenceSelectionContext = {
        scene: 'cafe',
        mood: 'confident',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // Check that mood scoring was applied
      const moodScoringApplied = result.reasoning.some(r =>
        r.includes('mood') && r.includes('confident')
      );
      expect(moodScoringApplied).toBe(true);
    });

    it('should apply time of day scoring', () => {
      vi.setSystemTime(new Date('2025-12-27T21:00:00')); // Night

      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        currentSeason: 'winter',
        timeOfDay: 'night',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // straight_dressed_up has night: 0.95 (highest)
      expect(result.referenceId).toBe('straight_dressed_up');
    });

    it('should apply season scoring', () => {
      const context: ReferenceSelectionContext = {
        scene: 'home',
        currentSeason: 'winter',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // messy_bun_casual does NOT have winter in suitableSeasons
      // Should get -15 penalty
      const winterPenalty = result.reasoning.some(r =>
        r.includes('messy_bun_casual') && r.includes('-15 wrong season')
      );
      expect(winterPenalty).toBe(true);
    });

    it('should boost dressed_up for outfit hint', () => {
      const context: ReferenceSelectionContext = {
        scene: 'going out',
        outfitHint: 'nice dress',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      expect(result.referenceId).toBe('straight_dressed_up');
      expect(result.reasoning.some(r => r.includes('outfit hint match'))).toBe(true);
    });

    it('should boost messy_bun for gym presence', () => {
      const context: ReferenceSelectionContext = {
        scene: 'home',
        presenceOutfit: 'just got back from the gym',
        currentSeason: 'summer',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      expect(result.referenceId).toBe('messy_bun_casual');
      expect(result.reasoning.some(r => r.includes('presence match (gym → messy bun)'))).toBe(true);
    });

    it('should boost dressed_up for nearby formal events', () => {
      const now = new Date('2025-12-27T18:00:00');
      vi.setSystemTime(now);

      const formalEvent = new Date('2025-12-27T19:00:00'); // 1 hour from now

      const context: ReferenceSelectionContext = {
        scene: 'home',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [
          {
            title: 'Dinner with Sarah',
            startTime: formalEvent,
            isFormal: true,
          },
        ],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      expect(result.referenceId).toBe('straight_dressed_up');
      expect(result.reasoning.some(r => r.includes('+60 nearby formal event'))).toBe(true);
    });

    it('should apply anti-repetition penalty for recent use', () => {
      const context: ReferenceSelectionContext = {
        scene: 'cafe',
        currentSeason: 'winter',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [
          {
            referenceImageId: 'curly_casual',
            usedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
            scene: 'coffee',
          },
        ],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // Should have -40 penalty (< 6 hours)
      expect(result.reasoning.some(r =>
        r.includes('curly_casual') && r.includes('-40 repetition penalty')
      )).toBe(true);
    });

    it('should skip anti-repetition penalty for same scene < 1 hour', () => {
      const context: ReferenceSelectionContext = {
        scene: 'cafe',
        currentSeason: 'winter',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [
          {
            referenceImageId: 'curly_casual',
            usedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
            scene: 'cafe', // SAME scene
          },
        ],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // Should skip penalty for same scene
      expect(result.reasoning.some(r =>
        r.includes('No penalty (same scene, same session)')
      )).toBe(true);
    });

    it('should select highest scored reference', () => {
      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        mood: 'confident',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      // straight_dressed_up should win:
      // - restaurant in suitableScenes: +30
      // - confident mood affinity 0.95: +19
      // - evening time 0.95: +14.25
      // - winter season: +10
      // Total: 73.25+ base frequency (10)
      expect(result.referenceId).toBe('straight_dressed_up');
      expect(result.reasoning.some(r => r.includes('SELECTED: straight_dressed_up'))).toBe(true);
    });

    it('should return base64 content with selection', () => {
      const context: ReferenceSelectionContext = {
        scene: 'cafe',
        currentSeason: 'winter',
        timeOfDay: 'morning',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      expect(result.base64Content).toBeDefined();
      expect(result.base64Content).toContain('mock-base64-content');
    });

    it('should include detailed reasoning in output', () => {
      const context: ReferenceSelectionContext = {
        scene: 'restaurant',
        mood: 'flirty',
        currentSeason: 'winter',
        timeOfDay: 'evening',
        currentLocation: null,
        upcomingEvents: [],
        recentReferenceHistory: [],
        currentLookState: null,
        temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      };

      const result = selectReferenceImage(context);

      expect(result.reasoning).toBeDefined();
      expect(result.reasoning.length).toBeGreaterThan(0);
      // Should include scoring breakdown for each reference
      expect(result.reasoning.some(r => r.includes('curly_casual'))).toBe(true);
      expect(result.reasoning.some(r => r.includes('straight_dressed_up'))).toBe(true);
      expect(result.reasoning.some(r => r.includes('messy_bun_casual'))).toBe(true);
      // Should include final selection
      expect(result.reasoning.some(r => r.includes('🎯 SELECTED'))).toBe(true);
    });
  });
});
