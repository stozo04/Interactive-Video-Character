// kayleyPresenceService.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getKayleyPresenceState,
  updateKayleyPresenceState,
  clearKayleyPresenceState,
  getDefaultExpirationMinutes,
} from "../kayleyPresenceService";

// Create mocks using vi.hoisted()
const { globalMocks } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    from: vi.fn(),
  };
  return { globalMocks: mocks };
});

// Mock the supabase client module
vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  const createSelectChain = () => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return {
        maybeSingle: mocks.maybeSingle,
      };
    }),
  });

  const createUpsertChain = () => ({
    then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
  });

  const createUpdateChain = () => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return {
        then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
      };
    }),
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
        update: vi.fn((data: any) => {
          mocks.update(data);
          return createUpdateChain();
        }),
      };
    }),
  };

  return {
    supabase: mockSupabase,
  };
});

describe("kayleyPresenceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getKayleyPresenceState", () => {
    it("should return null when no state exists", async () => {
      globalMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await getKayleyPresenceState("test-user");

      expect(result).toBeNull();
      expect(globalMocks.from).toHaveBeenCalledWith("kayley_presence_state");
      expect(globalMocks.select).toHaveBeenCalledWith("*");
      expect(globalMocks.eq).toHaveBeenCalledWith("user_id", "test-user");
    });

    it("should return null when state is expired", async () => {
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          user_id: "test-user",
          current_outfit: "in my pajamas",
          current_mood: "tired",
          current_activity: "relaxing",
          current_location: "at home",
          last_mentioned_at: expiredDate.toISOString(),
          expires_at: expiredDate.toISOString(),
          confidence: 0.9,
        },
        error: null,
      });

      const result = await getKayleyPresenceState("test-user");

      expect(result).toBeNull();
    });

    it("should return valid state when not expired", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now
      const lastMentioned = new Date(Date.now() - 1000 * 60 * 30); // 30 min ago

      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          user_id: "test-user",
          current_outfit: "in my gym clothes",
          current_mood: "energized",
          current_activity: "working out",
          current_location: "at the gym",
          last_mentioned_at: lastMentioned.toISOString(),
          expires_at: futureDate.toISOString(),
          confidence: 0.95,
        },
        error: null,
      });

      const result = await getKayleyPresenceState("test-user");

      expect(result).not.toBeNull();
      expect(result?.currentOutfit).toBe("in my gym clothes");
      expect(result?.currentMood).toBe("energized");
      expect(result?.currentActivity).toBe("working out");
      expect(result?.currentLocation).toBe("at the gym");
      expect(result?.confidence).toBe(0.95);
    });

    it("should return valid state when no expiration is set", async () => {
      const lastMentioned = new Date(Date.now() - 1000 * 60 * 30);

      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          user_id: "test-user",
          current_outfit: "in my favorite hoodie",
          current_mood: null,
          current_activity: null,
          current_location: "at home",
          last_mentioned_at: lastMentioned.toISOString(),
          expires_at: null, // No expiration
          confidence: 1.0,
        },
        error: null,
      });

      const result = await getKayleyPresenceState("test-user");

      expect(result).not.toBeNull();
      expect(result?.currentOutfit).toBe("in my favorite hoodie");
      expect(result?.expiresAt).toBeUndefined();
    });

    it("should handle database errors gracefully", async () => {
      globalMocks.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      });

      const result = await getKayleyPresenceState("test-user");

      expect(result).toBeNull();
    });
  });

  describe("updateKayleyPresenceState", () => {
    it("should upsert new state with all fields", async () => {
      globalMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      await updateKayleyPresenceState("test-user", {
        outfit: "in my pajamas",
        mood: "sleepy",
        activity: "getting ready for bed",
        location: "at home",
        expirationMinutes: 120,
        confidence: 0.9,
      });

      expect(globalMocks.from).toHaveBeenCalledWith("kayley_presence_state");
      expect(globalMocks.upsert).toHaveBeenCalled();

      const upsertCall = globalMocks.upsert.mock.calls[0];
      const upsertData = upsertCall[0];

      expect(upsertData.user_id).toBe("test-user");
      expect(upsertData.current_outfit).toBe("in my pajamas");
      expect(upsertData.current_mood).toBe("sleepy");
      expect(upsertData.current_activity).toBe("getting ready for bed");
      expect(upsertData.current_location).toBe("at home");
      expect(upsertData.confidence).toBe(0.9);
      expect(upsertData.expires_at).not.toBeNull();
    });

    it("should merge with existing state", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      const lastMentioned = new Date(Date.now() - 1000 * 60 * 30);

      globalMocks.maybeSingle.mockResolvedValue({
        data: {
          user_id: "test-user",
          current_outfit: "in my gym clothes",
          current_mood: "energized",
          current_activity: null,
          current_location: "at the gym",
          last_mentioned_at: lastMentioned.toISOString(),
          expires_at: futureDate.toISOString(),
          confidence: 0.9,
        },
        error: null,
      });

      await updateKayleyPresenceState("test-user", {
        activity: "working out",
        expirationMinutes: 120,
      });

      const upsertCall = globalMocks.upsert.mock.calls[0];
      const upsertData = upsertCall[0];

      // Should keep existing outfit and mood
      expect(upsertData.current_outfit).toBe("in my gym clothes");
      expect(upsertData.current_mood).toBe("energized");
      // Should add new activity
      expect(upsertData.current_activity).toBe("working out");
      // Should keep existing location
      expect(upsertData.current_location).toBe("at the gym");
    });

    it("should set expiration to null when expirationMinutes not provided", async () => {
      globalMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      await updateKayleyPresenceState("test-user", {
        outfit: "in casual clothes",
      });

      const upsertCall = globalMocks.upsert.mock.calls[0];
      const upsertData = upsertCall[0];

      expect(upsertData.expires_at).toBeNull();
    });
  });

  describe("clearKayleyPresenceState", () => {
    it("should set expires_at to now", async () => {
      await clearKayleyPresenceState("test-user");

      expect(globalMocks.from).toHaveBeenCalledWith("kayley_presence_state");
      expect(globalMocks.update).toHaveBeenCalled();
      expect(globalMocks.eq).toHaveBeenCalledWith("user_id", "test-user");

      const updateCall = globalMocks.update.mock.calls[0];
      const updateData = updateCall[0];

      expect(updateData.expires_at).toBeDefined();
      expect(updateData.updated_at).toBeDefined();
    });
  });

  describe("getDefaultExpirationMinutes", () => {
    it("should return 15 min for quick activities", () => {
      expect(getDefaultExpirationMinutes("making coffee")).toBe(15);
      expect(getDefaultExpirationMinutes("getting ready")).toBe(15);
      expect(getDefaultExpirationMinutes("taking a shower")).toBe(15);
    });

    it("should return 120 min for medium activities", () => {
      expect(getDefaultExpirationMinutes("working on laptop")).toBe(120);
      expect(getDefaultExpirationMinutes("studying for exam")).toBe(120);
    });

    it("should return 120 min for gym/workout outfits", () => {
      expect(getDefaultExpirationMinutes(undefined, "just got back from the gym")).toBe(120);
      expect(getDefaultExpirationMinutes(undefined, "in my workout clothes")).toBe(120);
    });

    it("should return 240 min for outfit mentions", () => {
      expect(getDefaultExpirationMinutes(undefined, "wearing my favorite dress")).toBe(240);
      expect(getDefaultExpirationMinutes(undefined, "dressed up for dinner")).toBe(240);
      expect(getDefaultExpirationMinutes(undefined, "in my new outfit")).toBe(240);
    });

    it("should return 120 min as default", () => {
      expect(getDefaultExpirationMinutes("some random activity")).toBe(120);
      expect(getDefaultExpirationMinutes()).toBe(120);
    });

    it("should prioritize activity over outfit for expiration", () => {
      // Quick activity should override outfit's longer duration
      expect(getDefaultExpirationMinutes("making coffee", "wearing my dress")).toBe(15);
    });
  });
});
