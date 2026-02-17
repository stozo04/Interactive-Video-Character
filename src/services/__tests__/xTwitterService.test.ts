import { describe, it, expect, vi } from "vitest";

// Mock supabaseClient before any imports that trigger its initialization
vi.mock("../supabaseClient", () => ({
  supabase: { from: vi.fn() },
}));

import { parseMediaUploadResponse } from "../xTwitterService";

describe("xTwitterService.parseMediaUploadResponse", () => {
  it("throws when the v2 response is missing data.id", () => {
    expect(() => parseMediaUploadResponse({})).toThrow(
      "Media upload failed: missing media id in response"
    );
  });

  it("returns the media id when present", () => {
    expect(parseMediaUploadResponse({ data: { id: "12345" } })).toBe("12345");
  });
});
