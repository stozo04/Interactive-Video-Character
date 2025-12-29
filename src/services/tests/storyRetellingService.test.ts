import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase client before imports
const { globalMocks } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    order: vi.fn(),
    from: vi.fn(),
  };
  return { globalMocks: mocks };
});

vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  // Track resolved values as a queue for multiple sequential calls
  let resolvedValueQueue: any[] = [];

  function getNextResolvedValue() {
    if (resolvedValueQueue.length === 0) {
      return { data: null, error: null };
    }
    return resolvedValueQueue.shift();
  }

  // Create a chainable object that supports .eq(), .order(), .in(), .limit(), .maybeSingle(), .single()
  const createChain = () => {
    const resolvable: any = {
      then: vi.fn((resolve: any) =>
        Promise.resolve(getNextResolvedValue()).then(resolve)
      ),
    };

    resolvable.eq = vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return resolvable; // Return self for chaining
    });

    resolvable.in = vi.fn((column: string, values: any[]) => {
      mocks.in(column, values);
      return resolvable; // Return self for chaining
    });

    resolvable.order = vi.fn((column: string, options?: any) => {
      return resolvable; // Return self for chaining
    });

    resolvable.limit = vi.fn((n: number) => {
      return resolvable; // Return self for chaining
    });

    resolvable.maybeSingle = vi.fn(() => {
      return Promise.resolve(getNextResolvedValue());
    });

    resolvable.single = vi.fn(() => {
      return Promise.resolve(getNextResolvedValue());
    });

    return resolvable;
  };

  const mockFrom = vi.fn((table: string) => ({
    select: vi.fn((columns?: string) => {
      mocks.select(columns);
      return createChain();
    }),
    insert: vi.fn((rows: any) => {
      mocks.insert(rows);
      const chain: any = createChain();

      // Add select() method for insert chains
      chain.select = vi.fn(() => {
        const selectChain = createChain();
        selectChain.single = vi.fn(() => Promise.resolve(getNextResolvedValue()));
        return selectChain;
      });

      return chain;
    }),
    update: vi.fn((data: any) => {
      mocks.update(data);
      return createChain();
    }),
  }));

  const client: any = {
    from: mockFrom,
    setNextResolvedValue: (value: any) => {
      resolvedValueQueue.push(value);
    },
    _mocks: mocks,
  };

  return { supabase: client };
});

import { supabase } from "../supabaseClient";
import {
  getStory,
  getAllStories,
  createDynamicStory,
  checkIfTold,
  markAsTold,
  getStoriesToldToUser,
  formatStoriesForPrompt,
  type KayleyStory,
  type StoryDetail,
} from "../storyRetellingService";

describe("storyRetellingService", () => {
  const mocks = globalMocks;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to set the next resolved value
  function setMockResponse(data: any) {
    (supabase as any).setNextResolvedValue({ data, error: null });
  }

  // ========================================
  // Story Management (Global) - Tests
  // ========================================

  describe("Story Management (Global)", () => {
    describe("getStory", () => {
      it("should return story by key", async () => {
        const mockStory = {
          id: "story-1",
          story_key: "viral_oops_video",
          story_title: "The Viral Oops Video",
          summary: "A video that went viral by accident",
          key_details: [
            { detail: "quote", value: "Wait, that sounded smarter in my head" },
            { detail: "outcome", value: "Semi-viral success" },
          ],
          story_type: "predefined",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        setMockResponse(mockStory);

        const result = await getStory("viral_oops_video");

        expect(result).toBeDefined();
        expect(result?.storyKey).toBe("viral_oops_video");
        expect(result?.storyTitle).toBe("The Viral Oops Video");
        expect(result?.keyDetails).toHaveLength(2);
        expect(result?.storyType).toBe("predefined");
      });

      it("should return null if story not found", async () => {
        setMockResponse(null);

        const result = await getStory("nonexistent_story");

        expect(result).toBeNull();
      });
    });

    describe("getAllStories", () => {
      it("should return all stories", async () => {
        const mockStories = [
          {
            id: "story-1",
            story_key: "viral_oops_video",
            story_title: "The Viral Oops Video",
            summary: "A video that went viral",
            key_details: [],
            story_type: "predefined",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: "story-2",
            story_key: "laptop_catastrophe",
            story_title: "The Laptop Catastrophe",
            summary: "Spilled coffee on laptop",
            key_details: [],
            story_type: "predefined",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];

        setMockResponse(mockStories);

        const result = await getAllStories();

        expect(result).toHaveLength(2);
        expect(result[0].storyKey).toBe("viral_oops_video");
        expect(result[1].storyKey).toBe("laptop_catastrophe");
      });

      it("should filter by story type", async () => {
        const mockStories = [
          {
            id: "story-1",
            story_key: "custom_story",
            story_title: "My Custom Story",
            summary: "A dynamically created story",
            key_details: [],
            story_type: "dynamic",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];

        setMockResponse(mockStories);

        const result = await getAllStories({ storyType: "dynamic" });

        expect(result).toHaveLength(1);
        expect(result[0].storyType).toBe("dynamic");
      });
    });

    describe("createDynamicStory", () => {
      it("should create a new dynamic story", async () => {
        const newStory = {
          id: "story-new",
          story_key: "my_new_story",
          story_title: "My New Story",
          summary: "A newly created story",
          key_details: [
            { detail: "location", "value": "Austin" },
          ],
          story_type: "dynamic",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        setMockResponse(newStory);

        const result = await createDynamicStory({
          storyKey: "my_new_story",
          storyTitle: "My New Story",
          summary: "A newly created story",
          keyDetails: [{ detail: "location", value: "Austin" }],
        });

        expect(result).toBeDefined();
        expect(result?.storyKey).toBe("my_new_story");
        expect(result?.storyType).toBe("dynamic");
      });

      it("should return null on creation failure", async () => {
        (supabase as any).setNextResolvedValue({ data: null, error: new Error("Insert failed") });

        const result = await createDynamicStory({
          storyKey: "failing_story",
          storyTitle: "Failing Story",
          summary: "This should fail",
          keyDetails: [],
        });

        expect(result).toBeNull();
      });
    });
  });

  // ========================================
  // User Story Tracking (Per-User) - Tests
  // ========================================

  describe("User Story Tracking (Per-User)", () => {
    describe("checkIfTold", () => {
      it("should return hasTold=false for untold story", async () => {
        const mockStory = {
          id: "story-1",
          story_key: "viral_oops_video",
          story_title: "The Viral Oops Video",
          summary: "A video that went viral",
          key_details: [
            { detail: "quote", value: "Wait, that sounded smarter in my head" },
          ],
          story_type: "predefined",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // First call for getStory returns the story
        // Second call for tracking check returns null (not told yet)
        setMockResponse(mockStory);

        const result = await checkIfTold("user123", "viral_oops_video");

        expect(result.hasTold).toBe(false);
        expect(result.canRetell).toBe(true);
        expect(result.story).toBeDefined();
        expect(result.story?.storyTitle).toBe("The Viral Oops Video");
      });

      it("should calculate cooldown correctly", async () => {
        const mockStory = {
          id: "story-1",
          story_key: "viral_oops_video",
          story_title: "The Viral Oops Video",
          summary: "A video that went viral",
          key_details: [],
          story_type: "predefined",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        const mockTracking = {
          id: "tracking-1",
          user_id: "user123",
          story_key: "viral_oops_video",
          first_told_at: fiveDaysAgo.toISOString(),
          last_told_at: fiveDaysAgo.toISOString(),
          times_told: 1,
          created_at: fiveDaysAgo.toISOString(),
          updated_at: fiveDaysAgo.toISOString(),
        };

        // First call for getStory, second call for tracking check
        setMockResponse(mockStory);
        setMockResponse(mockTracking);

        const result = await checkIfTold("user123", "viral_oops_video", 30);

        expect(result.hasTold).toBe(true);
        expect(result.canRetell).toBe(false); // Within 30-day cooldown
        expect(result.daysSinceLastTold).toBeGreaterThanOrEqual(4);
        expect(result.daysSinceLastTold).toBeLessThanOrEqual(6);
      });

      it("should allow retelling after cooldown period", async () => {
        const mockStory = {
          id: "story-1",
          story_key: "viral_oops_video",
          story_title: "The Viral Oops Video",
          summary: "A video that went viral",
          key_details: [],
          story_type: "predefined",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const fortyDaysAgo = new Date();
        fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

        const mockTracking = {
          id: "tracking-1",
          user_id: "user123",
          story_key: "viral_oops_video",
          first_told_at: fortyDaysAgo.toISOString(),
          last_told_at: fortyDaysAgo.toISOString(),
          times_told: 1,
          created_at: fortyDaysAgo.toISOString(),
          updated_at: fortyDaysAgo.toISOString(),
        };

        // First call for getStory, second call for tracking check
        setMockResponse(mockStory);
        setMockResponse(mockTracking);

        const result = await checkIfTold("user123", "viral_oops_video", 30);

        expect(result.hasTold).toBe(true);
        expect(result.canRetell).toBe(true); // Beyond 30-day cooldown
        expect(result.daysSinceLastTold).toBeGreaterThanOrEqual(39);
      });
    });

    describe("markAsTold", () => {
      it("should create tracking record for first telling", async () => {
        // Check if exists (no existing record)
        setMockResponse(null);

        const result = await markAsTold("user123", "viral_oops_video");

        expect(result).toBe(true);
        expect(mocks.insert).toHaveBeenCalled();
      });

      it("should update tracking record for retelling", async () => {
        const existingTracking = {
          id: "tracking-1",
          user_id: "user123",
          story_key: "viral_oops_video",
          first_told_at: new Date().toISOString(),
          last_told_at: new Date().toISOString(),
          times_told: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Check if exists (existing record found)
        setMockResponse(existingTracking);

        const result = await markAsTold("user123", "viral_oops_video");

        expect(result).toBe(true);
        expect(mocks.update).toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Prompt Formatting - Tests
  // ========================================

  describe("Prompt Formatting", () => {
    describe("formatStoriesForPrompt", () => {
      it("should format stories with already-told markers", async () => {
        const mockAllStories = [
          {
            id: "story-1",
            story_key: "viral_oops_video",
            story_title: "The Viral Oops Video",
            summary: "A video that went viral",
            key_details: [
              { detail: "quote", value: "Wait, that sounded smarter in my head" },
            ],
            story_type: "predefined",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: "story-2",
            story_key: "laptop_catastrophe",
            story_title: "The Laptop Catastrophe",
            summary: "Spilled coffee on laptop",
            key_details: [],
            story_type: "predefined",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];

        const mockToldStories = [
          {
            id: "tracking-1",
            user_id: "user123",
            story_key: "viral_oops_video",
            first_told_at: new Date().toISOString(),
            last_told_at: new Date().toISOString(),
            times_told: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];

        // Mock getAllStories call
        setMockResponse(mockAllStories);

        // Mock getStoriesToldToUser: first call gets tracking records
        setMockResponse(mockToldStories);

        // Mock getStoriesToldToUser: second call gets the stories
        setMockResponse([mockAllStories[0]]);

        const result = await formatStoriesForPrompt("user123");

        expect(result).toContain("Your Signature Stories");
        expect(result).toContain("The Viral Oops Video");
        expect(result).toContain("Already told to this user");
        expect(result).toContain("The Laptop Catastrophe");
        expect(result).toContain("Key Details");
        expect(result).toContain("recall_story");
      });
    });
  });
});
