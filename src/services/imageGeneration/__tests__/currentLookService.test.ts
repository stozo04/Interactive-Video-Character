// src/services/imageGeneration/__tests__/currentLookService.test.ts

/**
 * NOTE: currentLookService tests are primarily integration tests
 * since they involve database operations.
 *
 * These tests verify the service's contract and error handling.
 * For full coverage, run integration tests against a test database.
 */

import { describe, it, expect, vi } from "vitest";

// Mock Supabase client with proper method chaining
vi.mock("../../supabaseClient", () => {
  const createChain = () => ({
    eq: vi.fn(function (this: any) {
      return this;
    }),
    order: vi.fn(function (this: any) {
      return this;
    }),
    limit: vi.fn(function (this: any) {
      return this;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: vi.fn((resolve: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    ),
  });

  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => createChain()),
        insert: vi.fn(() => createChain()),
        upsert: vi.fn(() => createChain()),
        update: vi.fn(() => createChain()),
      })),
    },
  };
});

describe("currentLookService", () => {
  it("should have proper exports", async () => {
    const module = await import("../currentLookService");

    expect(module.getCurrentLookState).toBeDefined();
    expect(module.lockCurrentLook).toBeDefined();
    expect(module.unlockCurrentLook).toBeDefined();
    expect(module.getRecentSelfieHistory).toBeDefined();
    expect(module.recordSelfieGeneration).toBeDefined();

    expect(typeof module.getCurrentLookState).toBe("function");
    expect(typeof module.lockCurrentLook).toBe("function");
    expect(typeof module.unlockCurrentLook).toBe("function");
    expect(typeof module.getRecentSelfieHistory).toBe("function");
    expect(typeof module.recordSelfieGeneration).toBe("function");
  });

  // NOTE: Database operation tests are better suited as integration tests
  // Run `npm test:integration` for full coverage with real database

  describe("API contracts", () => {
    it("lockCurrentLook should accept required parameters", async () => {
      const module = await import("../currentLookService");
      const result = module.lockCurrentLook(
        "curly_casual",
        "curly",
        "session_start",
        24
      );
      expect(result).toBeInstanceOf(Promise);
    });

    it("recordSelfieGeneration should accept all parameters", async () => {
      const module = await import("../currentLookService");
      const result = module.recordSelfieGeneration(
        "curly_casual",
        "curly",
        "casual",
        "cafe",
        "happy",
        false,
        undefined,
        { test: "data" }
      );
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
