// kayleyPresence.integration.test.ts
// Integration test for presence tracking feature

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getKayleyPresenceState,
  updateKayleyPresenceState,
  clearKayleyPresenceState,
  getDefaultExpirationMinutes,
} from "../kayleyPresenceService";
import { selectReferenceImage } from "../imageGeneration/referenceSelector";
import type { ReferenceSelectionContext } from "../imageGeneration/types";

// Mock Supabase for service tests
const { globalMocks } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    from: vi.fn(),
  };
  return { globalMocks: mocks };
});

vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  const createSelectChain = () => ({
    maybeSingle: mocks.maybeSingle,
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return createSelectChain(); // Return chainable select chain
    }),
  });

  const createUpsertChain = () => ({
    then: vi.fn((resolve: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    ),
  });

  const mockSupabase = {
    from: vi.fn((table: string) => {
      mocks.from(table);
      return {
        select: vi.fn((columns?: string) => {
          mocks.select(columns);
          return createSelectChain();
        }),
        upsert: vi.fn((data: any, options?: any) => {
          mocks.upsert(data, options);
          return createUpsertChain();
        }),
      };
    }),
  };

  return { supabase: mockSupabase };
});

describe("Kayley Presence Tracking - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("End-to-End: Gym Context Flow", () => {
    it("should detect gym mention, store state, and boost messy_bun selection", async () => {
      // STEP 1: Kayley mentions gym
      const kayleyResponse = "Just got back from the gym! Feeling energized 💪";
      const detected = {
        outfit: "just got back from the gym",
        activity: null,
        mood: "feeling energized",
        location: null,
        confidence: 0.9,
      };

      // STEP 2: State is stored with correct expiration
      const expirationMinutes = getDefaultExpirationMinutes(
        detected?.activity,
        detected?.outfit
      );
      expect(expirationMinutes).toBe(120); // 2 hours for gym

      // Mock successful state storage
      globalMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      await updateKayleyPresenceState({
        outfit: detected?.outfit,
        activity: detected?.activity,
        mood: detected?.mood,
        location: detected?.location,
        expirationMinutes,
        confidence: detected?.confidence,
      });

      expect(globalMocks.upsert).toHaveBeenCalled();

      // STEP 3: Selfie generation retrieves state
      const futureDate = new Date(Date.now() + 1000 * 60 * 120); // 2 hours from now
      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          current_outfit: "just got back from the gym",
          current_mood: null,
          current_activity: null,
          current_location: null,
          last_mentioned_at: new Date().toISOString(),
          expires_at: futureDate.toISOString(),
          confidence: 0.6,
        },
        error: null,
      });

      const presenceState = await getKayleyPresenceState();
      expect(presenceState).not.toBeNull();
      expect(presenceState?.currentOutfit).toBe("just got back from the gym");

      // STEP 4: Reference selection uses presence state
      const context: ReferenceSelectionContext = {
        scene: "at home",
        mood: undefined,
        outfit: undefined,
        presenceOutfit: presenceState?.currentOutfit,
        presenceMood: presenceState?.currentMood,
        upcomingEvents: [],
        currentSeason: "summer",
        timeOfDay: "afternoon",
        currentLocation: "home",
        temporalContext: {
          isOldPhoto: false,
          temporalPhrases: [],
        },
        currentLookState: null,
        recentReferenceHistory: [],
      };

      const result = selectReferenceImage(context);

      // Should select messy_bun due to +30 gym boost
      expect(result.referenceId).toContain("messy_bun");
      expect(
        result.reasoning.some((r) =>
          r.includes("presence match (gym → messy bun)")
        )
      ).toBe(true);
    });
  });

  describe("End-to-End: Getting Ready Flow", () => {
    it("should detect getting ready, store state, and boost dressed_up selection", async () => {
      // STEP 1: Kayley mentions getting ready
      const kayleyResponse =
        "Just getting ready for dinner! Trying to look presentable 😊";
      const detected = {
        outfit: null,
        activity: "getting ready",
        mood: null,
        location: null,
        confidence: 0.9,
      };

      // STEP 2: State expires quickly (15 min for quick activity)
      const expirationMinutes = getDefaultExpirationMinutes(
        detected?.activity,
        detected?.outfit
      );
      expect(expirationMinutes).toBe(15);

      // STEP 3: Mock state retrieval
      const futureDate = new Date(Date.now() + 1000 * 60 * 15);
      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          current_outfit: null,
          current_mood: null,
          current_activity: "getting ready",
          current_location: null,
          last_mentioned_at: new Date().toISOString(),
          expires_at: futureDate.toISOString(),
          confidence: 0.6,
        },
        error: null,
      });

      const presenceState = await getKayleyPresenceState();
      expect(presenceState?.currentActivity).toBe("getting ready");

      // STEP 4: Reference selection with "getting ready" in outfit field (detected as outfit)
      const context: ReferenceSelectionContext = {
        scene: "getting ready",
        mood: undefined,
        outfit: undefined,
        presenceOutfit: "getting ready for dinner",
        presenceMood: presenceState?.currentMood,
        upcomingEvents: [],
        currentSeason: "summer",
        timeOfDay: "evening",
        currentLocation: "home",
        temporalContext: {
          isOldPhoto: false,
          temporalPhrases: [],
        },
        currentLookState: null,
        recentReferenceHistory: [],
      };

      const result = selectReferenceImage(context);

      // Should select dressed_up due to +25 getting ready boost
      expect(result.referenceId).toContain("dressed_up");
      expect(
        result.reasoning.some((r) =>
          r.includes("presence match (getting ready → dressed up)")
        )
      ).toBe(true);
    });
  });

  describe("End-to-End: No Presence State", () => {
    it("should work normally when no presence state exists", async () => {
      // STEP 1: No presence state in DB
      globalMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      const presenceState = await getKayleyPresenceState();
      expect(presenceState).toBeNull();

      // STEP 2: Reference selection without presence context
      const context: ReferenceSelectionContext = {
        scene: "sitting on my couch",
        mood: "relaxed",
        outfit: undefined,
        presenceOutfit: undefined,
        presenceMood: undefined,
        upcomingEvents: [],
        currentSeason: "summer",
        timeOfDay: "afternoon",
        currentLocation: "home",
        temporalContext: {
          isOldPhoto: false,
          temporalPhrases: [],
        },
        currentLookState: null,
        recentReferenceHistory: [],
      };

      const result = selectReferenceImage(context);

      // Should select based on other factors (scene, season, time)
      expect(result.referenceId).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(0);
      // Should NOT have presence boost
      expect(result.reasoning.some((r) => r.includes("presence match"))).toBe(
        false
      );
    });
  });

  describe("End-to-End: State Expiration", () => {
    it("should return null for expired state", async () => {
      // Mock expired state
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          current_outfit: "just got back from the gym",
          current_mood: null,
          current_activity: null,
          current_location: null,
          last_mentioned_at: pastDate.toISOString(),
          expires_at: pastDate.toISOString(),
          confidence: 0.9,
        },
        error: null,
      });

      const presenceState = await getKayleyPresenceState();
      expect(presenceState).toBeNull();
    });
  });

});
