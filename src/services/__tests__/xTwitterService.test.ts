import { describe, it, expect, vi } from "vitest";

// Mock server-only deps before importing the X service module.
vi.mock("../../../server/services/supabaseAdmin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../../../server/runtimeLogger", () => ({
  log: {
    fromContext: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../imageGenerationService", () => ({
  generateCompanionSelfie: vi.fn(),
}));

vi.stubEnv("VITE_X_CLIENT_ID", "test");
vi.stubEnv("VITE_X_CLIENT_SECRET", "test");
vi.stubEnv("VITE_X_CALLBACK_URL", "http://localhost");

import { parseMediaUploadResponse } from "../../../server/services/xTwitterServerService";

describe("xTwitterServerService.parseMediaUploadResponse", () => {
  it("throws when the v2 response is missing data.id", () => {
    expect(() => parseMediaUploadResponse({})).toThrow(
      "Media upload failed: missing media id in response"
    );
  });

  it("returns the media id when present", () => {
    expect(parseMediaUploadResponse({ data: { id: "12345" } })).toBe("12345");
  });
});
