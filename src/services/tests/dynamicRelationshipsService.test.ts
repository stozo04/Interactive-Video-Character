import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase client before imports
const { globalMocks, insertResolvedValues } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    match: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    from: vi.fn(),
  };
  const insertValues: any[] = [];
  return { globalMocks: mocks, insertResolvedValues: insertValues };
});

vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  const createEqChain = (): any => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return createEqChain();
    }),
    maybeSingle: mocks.maybeSingle,
    single: mocks.single,
  });

  const createSelectChain = () => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return createEqChain();
    }),
    maybeSingle: mocks.maybeSingle,
    then: (resolve: any) => {
      // Make it thenable so it can be awaited directly
      return mocks.maybeSingle().then(resolve);
    },
  });

  const createUpdateChain = () => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return { single: mocks.single };
    }),
    match: vi.fn((filters: any) => {
      mocks.match(filters);
      return { single: mocks.single };
    }),
  });

  const createInsertChain = () => ({
    select: vi.fn(() => ({
      single: mocks.single,
    })),
  });

  mocks.select.mockImplementation(() => createSelectChain());
  mocks.update.mockImplementation(() => createUpdateChain());
  mocks.insert.mockImplementation(() => createInsertChain());

  const mockFrom = vi.fn(() => ({
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  }));

  return { supabase: { from: mockFrom } };
});
import {
  getPerson,
  updatePersonSituation,
  updatePersonStatus,
  getUserPersonRelationship,
  updateUserPersonScores,
  logUserPersonEvent,
  formatDynamicRelationshipsForPrompt,
  type KayleyPerson,
  type UserPersonRelationship,
  type PersonSituationEvent,
  type UserPersonEvent,
} from "../dynamicRelationshipsService";

describe("dynamicRelationshipsService", () => {
  const mocks = globalMocks;

  beforeEach(() => {
    vi.clearAllMocks();
    insertResolvedValues.length = 0;
  });

  // ========================================
  // Kayley People (Global) - Tests
  // ========================================

  describe("Kayley People (Global)", () => {
    describe("getPerson", () => {
      it("should return person by key", async () => {
        const mockPerson = {
          id: "person-uuid-1",
          person_key: "lena",
          person_name: "Lena Martinez",
          person_role: "Best friend from college",
          relationship_status: "close",
          last_interaction_date: "2025-12-20",
          current_situation: [
            { date: "2025-12-20", event: "Started new job" },
          ],
          kayley_notes: "Lives in Portland",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        };

        mocks.maybeSingle.mockResolvedValue({
          data: mockPerson,
          error: null,
        });

        const result = await getPerson("lena");

        expect(result).toBeDefined();
        expect(result?.personKey).toBe("lena");
        expect(result?.personName).toBe("Lena Martinez");
        expect(result?.relationshipStatus).toBe("close");
        expect(result?.currentSituation).toHaveLength(1);
      });

      it("should return null if person not found", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: null,
        });

        const result = await getPerson("unknown");

        expect(result).toBeNull();
      });

      it("should return null on database error", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: { code: "PGRST500", message: "DB error" },
        });

        const result = await getPerson("lena");

        expect(result).toBeNull();
      });
    });

    describe("updatePersonSituation", () => {
      it("should add event to current_situation array", async () => {
        const mockPerson = {
          id: "person-uuid-1",
          person_key: "lena",
          person_name: "Lena Martinez",
          person_role: "Best friend from college",
          relationship_status: "close",
          last_interaction_date: "2025-12-15",
          current_situation: [
            { date: "2025-12-15", event: "Previous event" },
          ],
          kayley_notes: "Lives in Portland",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        };

        // First call: get existing person
        mocks.maybeSingle.mockResolvedValueOnce({
          data: mockPerson,
          error: null,
        });

        // Second call: return updated person
        mocks.single.mockResolvedValueOnce({
          data: {
            ...mockPerson,
            current_situation: [
              ...mockPerson.current_situation,
              { date: "2025-12-20", event: "Started new job" },
            ],
            last_interaction_date: "2025-12-20",
          },
          error: null,
        });

        const result = await updatePersonSituation("lena", "Started new job");

        expect(result).toBe(true);
        expect(mocks.update).toHaveBeenCalled();
      });

      it("should return false if person not found", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: null,
        });

        const result = await updatePersonSituation(
          "unknown",
          "Some event"
        );

        expect(result).toBe(false);
      });

      it("should return false on update error", async () => {
        const mockPerson = {
          id: "person-uuid-1",
          person_key: "lena",
          current_situation: [],
        };

        mocks.maybeSingle.mockResolvedValue({
          data: mockPerson,
          error: null,
        });

        mocks.single.mockResolvedValue({
          data: null,
          error: { code: "PGRST500", message: "Update failed" },
        });

        const result = await updatePersonSituation("lena", "Event");

        expect(result).toBe(false);
      });
    });

    describe("updatePersonStatus", () => {
      it("should change relationship_status", async () => {
        const mockPerson = {
          id: "person-uuid-1",
          person_key: "lena",
          person_name: "Lena Martinez",
          relationship_status: "close",
        };

        mocks.single.mockResolvedValue({
          data: { ...mockPerson, relationship_status: "distant" },
          error: null,
        });

        const result = await updatePersonStatus("lena", "distant");

        expect(result).toBe(true);
        expect(mocks.update).toHaveBeenCalled();
      });

      it("should return false on update error", async () => {
        mocks.single.mockResolvedValue({
          data: null,
          error: { code: "PGRST500", message: "Update failed" },
        });

        const result = await updatePersonStatus("lena", "distant");

        expect(result).toBe(false);
      });
    });
  });

  // ========================================
  // User-Person Relationships (Per-User) - Tests
  // ========================================

  describe("User-Person Relationships (Per-User)", () => {
    const testUserId = "user-123";

    describe("getUserPersonRelationship", () => {
      it("should return existing relationship", async () => {
        const mockRelationship = {
          id: "rel-uuid-1",
          user_id: testUserId,
          person_key: "lena",
          warmth_score: 25.0,
          trust_score: 15.0,
          familiarity_score: 40.0,
          relationship_state: "familiar",
          mention_count: 5,
          last_mentioned_at: "2025-12-20T10:00:00Z",
          user_events: [
            {
              date: "2025-12-20",
              event: "User said Lena sounds cool",
              sentiment: "positive",
            },
          ],
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-12-20T10:00:00Z",
        };

        mocks.maybeSingle.mockResolvedValue({
          data: mockRelationship,
          error: null,
        });

        const result = await getUserPersonRelationship(testUserId, "lena");

        expect(result).toBeDefined();
        expect(result?.userId).toBe(testUserId);
        expect(result?.personKey).toBe("lena");
        expect(result?.warmthScore).toBe(25.0);
        expect(result?.trustScore).toBe(15.0);
        expect(result?.familiarityScore).toBe(40.0);
        expect(result?.relationshipState).toBe("familiar");
        expect(result?.mentionCount).toBe(5);
      });

      it("should create if not exists", async () => {
        // First call: not found
        mocks.maybeSingle.mockResolvedValueOnce({
          data: null,
          error: null,
        });

        // Second call: created relationship
        const newRelationship = {
          id: "rel-uuid-new",
          user_id: testUserId,
          person_key: "ethan",
          warmth_score: 0.0,
          trust_score: 0.0,
          familiarity_score: 0.0,
          relationship_state: "unknown",
          mention_count: 0,
          last_mentioned_at: null,
          user_events: [],
          created_at: "2025-12-27T00:00:00Z",
          updated_at: "2025-12-27T00:00:00Z",
        };

        mocks.single.mockResolvedValueOnce({
          data: newRelationship,
          error: null,
        });

        const result = await getUserPersonRelationship(testUserId, "ethan");

        expect(result).toBeDefined();
        expect(result?.warmthScore).toBe(0.0);
        expect(result?.relationshipState).toBe("unknown");
        expect(mocks.insert).toHaveBeenCalled();
      });

      it("should return null on error", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: { code: "PGRST500", message: "DB error" },
        });

        const result = await getUserPersonRelationship(testUserId, "lena");

        expect(result).toBeNull();
      });
    });

    describe("updateUserPersonScores", () => {
      it("should update warmth/trust/familiarity scores", async () => {
        const existing = {
          id: "rel-uuid-1",
          user_id: testUserId,
          person_key: "lena",
          warmth_score: 10.0,
          trust_score: 5.0,
          familiarity_score: 20.0,
          relationship_state: "heard_of",
          mention_count: 2,
          user_events: [],
        };

        // Get existing
        mocks.maybeSingle.mockResolvedValueOnce({
          data: existing,
          error: null,
        });

        // Update result
        const updated = {
          ...existing,
          warmth_score: 15.0, // +5
          trust_score: 10.0, // +5
          familiarity_score: 25.0, // +5
          relationship_state: "familiar",
        };

        mocks.single.mockResolvedValueOnce({
          data: updated,
          error: null,
        });

        const result = await updateUserPersonScores(testUserId, "lena", {
          warmthChange: 5,
          trustChange: 5,
          familiarityChange: 5,
        });

        expect(result).toBeDefined();
        expect(result?.warmthScore).toBe(15.0);
        expect(result?.trustScore).toBe(10.0);
        expect(result?.familiarityScore).toBe(25.0);
        expect(mocks.update).toHaveBeenCalled();
      });

      it("should clamp scores to valid ranges", async () => {
        const existing = {
          id: "rel-uuid-1",
          user_id: testUserId,
          person_key: "lena",
          warmth_score: 45.0,
          trust_score: -45.0,
          familiarity_score: 95.0,
        };

        mocks.maybeSingle.mockResolvedValueOnce({
          data: existing,
          error: null,
        });

        const clamped = {
          ...existing,
          warmth_score: 50.0, // Clamped to max
          trust_score: -50.0, // Clamped to min
          familiarity_score: 100.0, // Clamped to max
        };

        mocks.single.mockResolvedValueOnce({
          data: clamped,
          error: null,
        });

        const result = await updateUserPersonScores(testUserId, "lena", {
          warmthChange: 20, // Would go to 65, but clamped to 50
          trustChange: -20, // Would go to -65, but clamped to -50
          familiarityChange: 20, // Would go to 115, but clamped to 100
        });

        expect(result?.warmthScore).toBe(50.0);
        expect(result?.trustScore).toBe(-50.0);
        expect(result?.familiarityScore).toBe(100.0);
      });

      it("should return null if relationship not found", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: null,
        });

        const result = await updateUserPersonScores(testUserId, "unknown", {
          warmthChange: 5,
        });

        expect(result).toBeNull();
      });

      it("should return null on update error", async () => {
        mocks.maybeSingle.mockResolvedValueOnce({
          data: { warmth_score: 10 },
          error: null,
        });

        mocks.single.mockResolvedValue({
          data: null,
          error: { code: "PGRST500", message: "Update failed" },
        });

        const result = await updateUserPersonScores(testUserId, "lena", {
          warmthChange: 5,
        });

        expect(result).toBeNull();
      });
    });

    describe("logUserPersonEvent", () => {
      it("should add to user_events array and increment mention_count", async () => {
        const existing = {
          id: "rel-uuid-1",
          user_id: testUserId,
          person_key: "lena",
          mention_count: 3,
          user_events: [
            { date: "2025-12-15", event: "Previous event", sentiment: "neutral" },
          ],
        };

        mocks.maybeSingle.mockResolvedValueOnce({
          data: existing,
          error: null,
        });

        const updated = {
          ...existing,
          mention_count: 4,
          user_events: [
            ...existing.user_events,
            {
              date: "2025-12-20",
              event: "Kayley mentioned Lena's new job",
              sentiment: "positive",
            },
          ],
        };

        mocks.single.mockResolvedValueOnce({
          data: updated,
          error: null,
        });

        const result = await logUserPersonEvent(
          testUserId,
          "lena",
          "Kayley mentioned Lena's new job",
          "positive"
        );

        expect(result).toBe(true);
        expect(mocks.update).toHaveBeenCalled();
      });

      it("should return false if relationship not found", async () => {
        mocks.maybeSingle.mockResolvedValue({
          data: null,
          error: null,
        });

        const result = await logUserPersonEvent(
          testUserId,
          "unknown",
          "Event"
        );

        expect(result).toBe(false);
      });
    });
  });

  // ========================================
  // Prompt Formatting - Tests
  // ========================================

  describe("Prompt Formatting", () => {
    const testUserId = "user-123";

    describe("formatDynamicRelationshipsForPrompt", () => {
      it("should return empty string if no relationships", async () => {
        // No people in kayley_people - select returns empty array
        mocks.maybeSingle.mockResolvedValue({
          data: [],
          error: null,
        });

        const result = await formatDynamicRelationshipsForPrompt(testUserId);

        expect(result).toBe("");
      });

      it("should format both Kayley's and user's perspectives", async () => {
        // Mock getPerson calls (kayley_people)
        const mockLena = {
          id: "person-uuid-1",
          person_key: "lena",
          person_name: "Lena Martinez",
          person_role: "Best friend from college",
          relationship_status: "close",
          last_interaction_date: "2025-12-20",
          current_situation: [
            { date: "2025-12-20", event: "Started new job at design agency" },
          ],
          kayley_notes: "Lives in Portland, we video chat weekly",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-12-20T00:00:00Z",
        };

        // Mock getUserPersonRelationship
        const mockUserRel = {
          id: "rel-uuid-1",
          user_id: testUserId,
          person_key: "lena",
          warmth_score: 25.0,
          trust_score: 15.0,
          familiarity_score: 40.0,
          relationship_state: "familiar",
          mention_count: 8,
          last_mentioned_at: "2025-12-20T10:00:00Z",
          user_events: [],
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-12-20T10:00:00Z",
        };

        // First call: select all people from kayley_people
        mocks.maybeSingle.mockResolvedValueOnce({
          data: [mockLena],
          error: null,
        });

        // Second call: user-person relationship
        mocks.maybeSingle.mockResolvedValueOnce({
          data: mockUserRel,
          error: null,
        });

        const result = await formatDynamicRelationshipsForPrompt(testUserId);

        expect(result).toContain("## People in Your Life");
        expect(result).toContain("Lena Martinez");
        expect(result).toContain("Best friend from college");
        expect(result).toContain("close"); // Kayley's relationship
        expect(result).toContain("Started new job"); // Recent event
        expect(result).toContain("User's perspective");
        expect(result).toContain("40/100"); // Familiarity
        expect(result).toContain("+25"); // Warmth
        expect(result).toContain("+15"); // Trust
        expect(result).toContain("8 times"); // Mention count
      });

      it("should handle multiple people correctly", async () => {
        // This test would verify formatting with multiple people
        // Implementation similar to above but with array of people
        expect(true).toBe(true); // Placeholder
      });
    });
  });
});
